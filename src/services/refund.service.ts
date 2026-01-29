//@ts-nocheck
import { stripe } from '../config/stripe.config';
import prisma from '../config/database';
import { createNotification } from '../controllers/notification.controller';
import { createConnectedAccountPayout } from '../utils/stripe-payout.helper';

export class RefundService {
  /**
   * Get cancellation window hours from system settings
   */
  private async getCancellationWindowHours(): Promise<number> {
    const settings = await prisma.systemSettings.findFirst();
    return settings?.cancellationWindowHours || 24; // Default to 24 hours if not set
  }

  /**
   * Process immediate refund for cancelled booking
   */
  async processRefund(bookingId: string, reason: string = 'requested_by_customer'): Promise<any> {
    try {
      // Get cancellation window from settings
      const cancellationWindowHours = await this.getCancellationWindowHours();

      // Support both ObjectId and human-readable bookingId
      const isObjectId = bookingId.length === 24 && /^[0-9a-fA-F]+$/.test(bookingId);
      const where = isObjectId ? { id: bookingId } : { bookingId: bookingId };

      // Get booking with payment details
      const booking = await prisma.booking.findFirst({
        where,
        include: {
          payment: true,
          user: true,
          field: {
            include: {
              owner: true
            }
          }
        }
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      if (!booking.payment) {
        throw new Error('No payment found for this booking');
      }

      // Check if already refunded
      if (booking.payment.status === 'refunded') {
        return {
          success: false,
          message: 'Booking already refunded'
        };
      }

      // Check if payment was successful
      if (booking.payment.status !== 'completed') {
        return {
          success: false,
          message: 'Cannot refund incomplete payment'
        };
      }

      // Calculate refund amount based on cancellation timing
      const bookingDate = new Date(booking.date);
      const bookingTime = booking.startTime.split(':');
      bookingDate.setHours(parseInt(bookingTime[0]), parseInt(bookingTime[1]));
      
      const now = new Date();
      const hoursUntilBooking = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      let refundAmount = 0;
      let refundPercentage = 0;
      
      if (hoursUntilBooking >= cancellationWindowHours) {
        // Full refund if cancelled at least cancellationWindowHours before
        refundAmount = booking.payment.amount;
        refundPercentage = 100;
      } else if (hoursUntilBooking >= cancellationWindowHours / 2) {
        // 50% refund if cancelled between half and full cancellation window
        refundAmount = booking.payment.amount * 0.5;
        refundPercentage = 50;
      } else {
        // No refund if cancelled less than half the cancellation window
        refundAmount = 0;
        refundPercentage = 0;
      }

      // Process refund through Stripe if amount > 0
      let stripeRefund = null;
      if (refundAmount > 0 && booking.payment.stripePaymentId) {
        try {
          // Create refund in Stripe
          // Note: Stripe only accepts 'duplicate', 'fraudulent', or 'requested_by_customer' as reason
          stripeRefund = await stripe.refunds.create({
            payment_intent: booking.payment.stripePaymentId,
            amount: Math.round(refundAmount * 100), // Convert to cents
            reason: 'requested_by_customer',
            metadata: {
              bookingId: booking.id,
              userId: booking.userId,
              fieldId: booking.fieldId,
              cancellationReason: reason?.substring(0, 500) || 'No reason provided' // Store user's reason in metadata (max 500 chars)
            }
          });

          // Update payment record
          await prisma.payment.update({
            where: { id: booking.payment.id },
            data: {
              status: 'refunded',
              stripeRefundId: stripeRefund.id,
              refundAmount: refundAmount,
              refundReason: reason,
              processedAt: new Date()
            }
          });

          // Create transaction record for refund with lifecycle tracking
          await prisma.transaction.create({
            data: {
              bookingId: booking.id,
              userId: booking.userId,
              amount: -refundAmount, // Negative amount for refund
              type: 'REFUND',
              status: 'COMPLETED',
              stripeRefundId: stripeRefund.id,
              stripePaymentIntentId: booking.payment.stripePaymentId,
              description: `Refund for booking cancellation (${refundPercentage}%)`,
              // Lifecycle tracking
              lifecycleStage: 'REFUNDED',
              refundedAt: new Date()
            }
          });

          // Update booking/payment payout metadata
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              paymentStatus: 'REFUNDED',
              payoutStatus: 'REFUNDED'
            }
          });

          // Flag related payouts as canceled
          await prisma.payout.updateMany({
            where: {
              bookingIds: {
                has: booking.id
              }
            },
            data: {
              status: 'canceled',
              description: `Payout canceled due to refund for booking ${booking.id}`
            }
          });

          // Send refund notification to user
          await createNotification({
            userId: booking.userId,
            type: 'refund_processed',
            title: 'Refund Processed',
            message: `Your refund of £${refundAmount.toFixed(2)} for ${booking.field.name} has been processed. It will appear in your account within 5-7 business days.`,
            data: {
              bookingId: booking.id,
              refundAmount,
              refundPercentage,
              stripeRefundId: stripeRefund.id
            }
          });

          // If partial refund, transfer remaining amount to field owner immediately
          if (refundPercentage < 100) {
            await this.processFieldOwnerPayout(booking, refundAmount);
          }

          return {
            success: true,
            refundAmount,
            refundPercentage,
            stripeRefundId: stripeRefund.id,
            message: `Refund of £${refundAmount.toFixed(2)} processed successfully`
          };
        } catch (stripeError: any) {
          console.error('Stripe refund error:', stripeError);
          throw new Error(`Failed to process refund: ${stripeError.message}`);
        }
      } else {
        // No refund but transfer full amount to field owner
        await this.processFieldOwnerPayout(booking, 0);

        return {
          success: true,
          refundAmount: 0,
          refundPercentage: 0,
          message: 'No refund eligible, full amount will be transferred to field owner'
        };
      }
    } catch (error: any) {
      console.error('Refund processing error:', error);
      throw error;
    }
  }

  /**
   * Process payout to field owner after cancellation period
   */
  async processFieldOwnerPayout(booking: any, refundedAmount: number): Promise<void> {
    try {
      const totalAmount = booking.payment.amount;
      const fieldOwnerShare = totalAmount - refundedAmount;
      
      // Calculate platform commission (20%)
      const platformCommission = fieldOwnerShare * 0.2;
      const netPayoutAmount = fieldOwnerShare - platformCommission;

      if (netPayoutAmount <= 0) {
        return; // No payout if amount is 0 or negative
      }

      // Check if field owner has Stripe Connect account
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: booking.field.ownerId }
      });

      if (!stripeAccount || !stripeAccount.payoutsEnabled) {
        // Queue payout for later when account is ready
        await prisma.payout.create({
          data: {
            stripeAccountId: stripeAccount?.id || '',
            amount: netPayoutAmount,
            currency: 'gbp',
            status: 'pending',
            description: `Payout for cancelled booking ${booking.id}`,
            bookingIds: [booking.id]
          }
        });

        await createNotification({
          userId: booking.field.ownerId,
          type: 'payout_pending',
          title: 'Payout Pending',
          message: `A payout of £${netPayoutAmount.toFixed(2)} is pending. Please complete your Stripe account setup to receive payments.`,
          data: {
            bookingId: booking.id,
            amount: netPayoutAmount
          }
        });
        
        return;
      }

      // Create transfer to connected account
      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(netPayoutAmount * 100), // Convert to cents
          currency: 'gbp',
          destination: stripeAccount.stripeAccountId,
          description: `Payout for booking ${booking.id}`,
          metadata: {
            bookingId: booking.id,
            fieldId: booking.fieldId,
            platformCommission: platformCommission.toString(),
            refundedAmount: refundedAmount.toString()
          }
        });

        let stripePayout = null;
        try {
          stripePayout = await createConnectedAccountPayout({
            stripeAccountId: stripeAccount.stripeAccountId,
            amountInMinorUnits: Math.round(netPayoutAmount * 100),
            description: `Payout for booking ${booking.id}`,
            metadata: {
              bookingId: booking.id,
              bookingIds: JSON.stringify([booking.id]),
              fieldId: booking.fieldId,
              fieldOwnerId: booking.field.ownerId,
              transferId: transfer.id,
              source: 'refund_payout'
            }
          });
        } catch (payoutError) {
          console.error('Stripe payout creation failed:', payoutError);
        }

        // Create payout record
        const payout = await prisma.payout.create({
          data: {
            stripeAccountId: stripeAccount.id,
            stripePayoutId: stripePayout?.id || transfer.id,
            amount: netPayoutAmount,
            currency: 'gbp',
            status: stripePayout?.status || 'processing',
            description: `Payout for booking ${booking.id}`,
            bookingIds: [booking.id],
            arrivalDate: stripePayout?.arrival_date ? new Date(stripePayout.arrival_date * 1000) : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
            failureCode: stripePayout?.failure_code || null,
            failureMessage: stripePayout?.failure_message || null
          }
        });

        // Update booking with payout reference
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            payoutStatus: stripePayout?.status === 'paid' ? 'COMPLETED' : 'PROCESSING',
            payoutId: payout.id
          }
        });

        // Send notification to field owner
        await createNotification({
          userId: booking.field.ownerId,
          type: 'payout_processed',
          title: 'Payout Processed',
          message: `A payout of £${netPayoutAmount.toFixed(2)} has been sent to your account for the cancelled booking.`,
          data: {
            bookingId: booking.id,
            payoutId: payout.id,
            amount: netPayoutAmount,
            arrivalDate: payout.arrivalDate
          }
        });
      } catch (transferError: any) {
        console.error('Transfer error:', transferError);
        
        // Queue payout for retry
        await prisma.payout.create({
          data: {
            stripeAccountId: stripeAccount.id,
            amount: netPayoutAmount,
            currency: 'gbp',
            status: 'failed',
            description: `Failed payout for booking ${booking.id}`,
            bookingIds: [booking.id],
            failureCode: transferError.code,
            failureMessage: transferError.message
          }
        });
        
        throw transferError;
      }
    } catch (error) {
      console.error('Field owner payout error:', error);
      throw error;
    }
  }

  /**
   * Process payouts for completed bookings after cancellation period expires
   */
  async processCompletedBookingPayouts(): Promise<void> {
    try {
      // Find all completed bookings that are past their cancellation period (24 hours after completion)
      const eligibleBookings = await prisma.booking.findMany({
        where: {
          status: 'COMPLETED',
          payoutStatus: null, // Not yet processed for payout
          createdAt: {
            lte: new Date(Date.now() - 24 * 60 * 60 * 1000) // At least 24 hours old
          }
        },
        include: {
          payment: true,
          field: {
            include: {
              owner: true
            }
          }
        }
      });

      for (const booking of eligibleBookings) {
        if (!booking.payment || booking.payment.status !== 'completed') {
          continue; // Skip if no valid payment
        }

        // Process payout for this booking
        await this.processFieldOwnerPayout(booking, 0);
        
        // Mark booking as processed
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            payoutStatus: 'PROCESSING'
          }
        });
      }
    } catch (error) {
      console.error('Batch payout processing error:', error);
      throw error;
    }
  }
}

export default new RefundService();
