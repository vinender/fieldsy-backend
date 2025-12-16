//@ts-nocheck
import { PrismaClient } from '@prisma/client';
import { createNotification } from '../controllers/notification.controller';
import { stripe } from '../config/stripe.config';
import { createConnectedAccountPayout } from '../utils/stripe-payout.helper';
import {
  checkPlatformBalance,
  checkChargeFundsAvailable,
  safeTransferWithBalanceGate
} from '../utils/stripe-balance.helper';

const prisma = new PrismaClient();

// Stripe fee structure (2.9% + 30 cents per transaction)
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_FIXED_FEE_CENTS = 30;

export class AutomaticPayoutService {
  /**
   * Calculate Stripe fee for a given amount
   */
  private calculateStripeFee(amountInCents: number): number {
    return Math.round(amountInCents * STRIPE_PERCENTAGE_FEE + STRIPE_FIXED_FEE_CENTS);
  }

  /**
   * Check if booking has passed the cancellation window (configurable hours before booking time)
   */
  private hasCancellationWindowPassed(booking: any, cancellationWindowHours: number = 24): boolean {
    const now = new Date();
    const bookingDateTime = new Date(booking.date);
    
    // Parse the start time and add it to the booking date
    const [time, period] = booking.startTime.split(/(?=[AP]M)/);
    const [hours, minutes] = time.split(':').map(Number);
    let hour = hours;
    
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    
    bookingDateTime.setHours(hour, minutes || 0, 0, 0);
    
    // Subtract configured hours to get the cancellation deadline
    const cancellationDeadline = new Date(bookingDateTime.getTime() - cancellationWindowHours * 60 * 60 * 1000);
    
    // Return true if current time is past the cancellation deadline
    return now > cancellationDeadline;
  }

  /**
   * Check if payout should be released based on admin settings
   */
  private async shouldReleasePayout(booking: any, settings: any): Promise<boolean> {
    const payoutReleaseSchedule = settings?.payoutReleaseSchedule || 'after_cancellation_window';
    const cancellationWindowHours = settings?.cancellationWindowHours || 24;

    if (payoutReleaseSchedule === 'on_weekend') {
      // Check if today is Friday-Sunday
      const today = new Date().getDay();
      // Friday = 5, Saturday = 6, Sunday = 0
      return today === 5 || today === 6 || today === 0;
    } else if (payoutReleaseSchedule === 'after_cancellation_window') {
      // Check if cancellation window has passed
      return this.hasCancellationWindowPassed(booking, cancellationWindowHours);
    }
    
    return false;
  }

  /**
   * Process automatic payout for bookings where cancellation window has passed
   * This should be called by a cron job periodically
   */
  async processEligiblePayouts() {
    try {
      console.log('Starting automatic payout processing...');
      
      // Get system settings for payout release schedule
      const systemSettings = await prisma.systemSettings.findFirst();
      
      // Find all confirmed bookings where:
      // 1. Payment is completed (PAID)
      // 2. Payout hasn't been processed yet
      // 3. Based on the payout release schedule from admin settings
      // Note: Use isSet: false to handle missing fields (Prisma MongoDB quirk)
      const eligibleBookings = await prisma.booking.findMany({
        where: {
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          OR: [
            { payoutStatus: { isSet: false } },
            { payoutStatus: null },
            { payoutStatus: 'PENDING' },
            { payoutStatus: 'HELD' }
          ]
        },
        include: {
          field: {
            include: {
              owner: true
            }
          },
          user: true
        }
      });

      console.log(`Found ${eligibleBookings.length} potentially eligible bookings`);
      console.log(`Payout release schedule: ${systemSettings?.payoutReleaseSchedule || 'after_cancellation_window'}`);

      const results = {
        processed: 0,
        skipped: 0,
        failed: 0,
        details: [] as any[]
      };

      for (const booking of eligibleBookings) {
        try {
          // Check if payout should be released based on admin settings
          if (!await this.shouldReleasePayout(booking, systemSettings)) {
            console.log(`Booking ${booking.id} not eligible for payout release yet`);
            results.skipped++;
            results.details.push({
              bookingId: booking.id,
              status: 'skipped',
              reason: 'Not meeting payout release criteria'
            });
            continue;
          }

          // Process the payout
          const payoutResult = await this.processBookingPayoutAfterCancellationWindow(booking.id);
          
          if (payoutResult) {
            results.processed++;
            results.details.push({
              bookingId: booking.id,
              status: 'processed',
              payoutId: payoutResult.id,
              amount: payoutResult.amount
            });
          } else {
            results.skipped++;
            results.details.push({
              bookingId: booking.id,
              status: 'skipped',
              reason: 'Not eligible or already processed'
            });
          }
        } catch (error: any) {
          console.error(`Error processing payout for booking ${booking.id}:`, error);
          results.failed++;
          results.details.push({
            bookingId: booking.id,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`Payout processing complete. Processed: ${results.processed}, Skipped: ${results.skipped}, Failed: ${results.failed}`);
      return results;
    } catch (error) {
      console.error('Error in automatic payout processing:', error);
      throw error;
    }
  }

  /**
   * Process payout for a specific booking after cancellation window has passed
   */
  async processBookingPayoutAfterCancellationWindow(bookingId: string) {
    try {
      // Get system settings
      const systemSettings = await prisma.systemSettings.findFirst();
      
      // Get booking with all necessary relations
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          field: {
            include: {
              owner: true
            }
          },
          user: true
        }
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Verify payout should be released based on admin settings
      if (!await this.shouldReleasePayout(booking, systemSettings)) {
        console.log(`Booking ${bookingId} is not eligible for payout based on admin settings`);
        return null;
      }

      // Check if payout has already been processed
      if (booking.payoutStatus === 'COMPLETED' || booking.payoutStatus === 'PROCESSING') {
        console.log(`Payout already ${booking.payoutStatus} for booking ${bookingId}`);
        return null;
      }

      // Check if booking is confirmed and payment was successful
      if (booking.status !== 'CONFIRMED' || booking.paymentStatus !== 'PAID') {
        console.log(`Booking ${bookingId} is not eligible for payout. Status: ${booking.status}, Payment: ${booking.paymentStatus}`);
        return null;
      }

      const field = booking.field;
      const fieldOwner = field.owner;

      if (!fieldOwner) {
        throw new Error('Field owner not found');
      }

      // Check if field owner has a connected Stripe account
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: fieldOwner.id }
      });

      if (!stripeAccount) {
        console.log(`Field owner ${fieldOwner.id} does not have a Stripe account`);
        
        // Calculate field owner amount if not stored
        let payoutAmount = booking.fieldOwnerAmount;
        if (!payoutAmount) {
          const { calculatePayoutAmounts } = await import('../utils/commission.utils');
          const calculated = await calculatePayoutAmounts(booking.totalPrice, fieldOwner.id);
          payoutAmount = calculated.fieldOwnerAmount;
        }

        // Notify field owner to set up Stripe account
        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PENDING',
          title: 'Set up payment account for automatic payouts',
          message: `You have a pending payout of £${payoutAmount.toFixed(2)} from a booking that's ready for payment. Please set up your payment account to receive funds automatically.`,
          data: {
            bookingId,
            amount: payoutAmount,
            fieldName: field.name
          }
        });
        
        // Mark payout as pending account setup
        await prisma.booking.update({
          where: { id: bookingId },
          data: { payoutStatus: 'PENDING_ACCOUNT' }
        });
        
        return null;
      }

      // Check if Stripe account is fully onboarded
      if (!stripeAccount.chargesEnabled || !stripeAccount.payoutsEnabled) {
        console.log(`Field owner ${fieldOwner.id} Stripe account is not fully set up`);
        
        // Calculate field owner amount if not stored
        let payoutAmount = booking.fieldOwnerAmount;
        if (!payoutAmount) {
          const { calculatePayoutAmounts } = await import('../utils/commission.utils');
          const calculated = await calculatePayoutAmounts(booking.totalPrice, fieldOwner.id);
          payoutAmount = calculated.fieldOwnerAmount;
        }

        // Notify field owner to complete Stripe onboarding
        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PENDING',
          title: 'Complete payment account setup',
          message: `Complete your payment account setup to receive £${payoutAmount.toFixed(2)} from a recent booking.`,
          data: {
            bookingId,
            amount: payoutAmount,
            fieldName: field.name
          }
        });
        
        // Mark payout as pending account setup
        await prisma.booking.update({
          where: { id: bookingId },
          data: { payoutStatus: 'PENDING_ACCOUNT' }
        });
        
        return null;
      }

      // Get payout amount - use stored value or calculate
      let payoutAmount = booking.fieldOwnerAmount;
      if (!payoutAmount) {
        const { calculatePayoutAmounts } = await import('../utils/commission.utils');
        const calculated = await calculatePayoutAmounts(booking.totalPrice, fieldOwner.id);
        payoutAmount = calculated.fieldOwnerAmount;
      }
      const payoutAmountInCents = Math.round(payoutAmount * 100);

      // ============================================================================
      // BALANCE GATE: Check if funds are available before attempting transfer
      // Rule 2: Never create transfers without verifying available balance
      // ============================================================================

      // Check if funds from the original payment are available
      const transaction = await prisma.transaction.findFirst({
        where: { bookingId, type: 'PAYMENT' }
      });

      if (transaction?.stripeChargeId) {
        const fundsCheck = await checkChargeFundsAvailable(transaction.stripeChargeId);
        if (!fundsCheck.isAvailable) {
          console.log(`[AutoPayout] Funds not yet available for booking ${bookingId}: ${fundsCheck.message}`);

          // Update booking - will be retried in next cron cycle
          await prisma.booking.update({
            where: { id: bookingId },
            data: {
              payoutStatus: 'PENDING',
              payoutHeldReason: `Funds pending availability: ${fundsCheck.availableOn?.toISOString() || 'unknown'}`
            }
          });

          // Update transaction lifecycle
          await prisma.transaction.updateMany({
            where: { bookingId },
            data: { lifecycleStage: 'FUNDS_PENDING' }
          });

          return null; // Will be processed when funds become available
        }

        // Update lifecycle to FUNDS_AVAILABLE
        await prisma.transaction.updateMany({
          where: { bookingId },
          data: {
            lifecycleStage: 'FUNDS_AVAILABLE',
            fundsAvailableAt: new Date()
          }
        });
      }

      // Check platform balance can cover this transfer
      const balanceCheck = await checkPlatformBalance(payoutAmountInCents, 'gbp');
      if (!balanceCheck.canTransfer) {
        console.log(`[AutoPayout] Insufficient platform balance for booking ${bookingId}: ${balanceCheck.message}`);

        // Keep as PENDING - will be retried in next cron cycle
        await prisma.booking.update({
          where: { id: bookingId },
          data: {
            payoutStatus: 'PENDING',
            payoutHeldReason: `Insufficient platform balance: ${balanceCheck.availableAmount / 100} GBP available, need ${payoutAmountInCents / 100} GBP`
          }
        });

        return null; // Will be processed when balance is sufficient
      }

      // Update booking to processing (only after all checks pass)
      await prisma.booking.update({
        where: { id: bookingId },
        data: { payoutStatus: 'PROCESSING' }
      });

      try {
        // Create a transfer to the connected account using safe transfer with balance gate
        const transferResult = await safeTransferWithBalanceGate({
          amount: payoutAmountInCents,
          currency: 'gbp',
          destination: stripeAccount.stripeAccountId,
          transferGroup: `booking_${bookingId}`,
          metadata: {
            bookingId,
            fieldId: field.id,
            fieldOwnerId: fieldOwner.id,
            type: 'automatic_booking_payout',
            processingReason: 'cancellation_window_passed'
          },
          description: `Automatic payout for booking ${bookingId} - ${field.name}`
        });

        // If transfer was deferred due to balance issues, mark for retry
        if (!transferResult.success && transferResult.shouldDefer) {
          console.log(`[AutoPayout] Transfer deferred for booking ${bookingId}: ${transferResult.reason}`);

          await prisma.booking.update({
            where: { id: bookingId },
            data: {
              payoutStatus: 'PENDING',
              payoutHeldReason: transferResult.reason
            }
          });

          return null; // Will be retried in next cron cycle
        }

        if (!transferResult.success) {
          throw new Error(transferResult.reason);
        }

        const transfer = transferResult.transfer;

        let stripePayout = null;
        try {
          stripePayout = await createConnectedAccountPayout({
            stripeAccountId: stripeAccount.stripeAccountId,
            amountInMinorUnits: payoutAmountInCents,
            description: `Automatic payout for booking ${bookingId} - Cancellation window passed`,
            metadata: {
              bookingId,
              bookingIds: JSON.stringify([bookingId]),
              fieldId: field.id,
              fieldOwnerId: fieldOwner.id,
              transferId: transfer.id,
              source: 'auto_payout'
            }
          });
        } catch (payoutError) {
          console.error('Stripe payout creation failed:', payoutError);
        }

        // Create payout record in database
        const payout = await prisma.payout.create({
          data: {
            stripeAccountId: stripeAccount.id,
            stripePayoutId: stripePayout?.id || transfer.id,
            amount: payoutAmount,
            currency: 'gbp',
            status: stripePayout?.status || 'processing',
            method: stripePayout?.method || 'standard',
            description: `Automatic payout for booking ${bookingId} - Cancellation window passed`,
            bookingIds: [bookingId],
            arrivalDate: stripePayout?.arrival_date ? new Date(stripePayout.arrival_date * 1000) : new Date(),
            failureCode: stripePayout?.failure_code || null,
            failureMessage: stripePayout?.failure_message || null
          }
        });

        // Update booking with payout details
        await prisma.booking.update({
          where: { id: bookingId },
          data: {
            payoutStatus: stripePayout?.status === 'paid' ? 'COMPLETED' : 'PROCESSING',
            payoutId: payout.id
          }
        });

        // Update Transaction lifecycle to track the transfer and payout
        await prisma.transaction.updateMany({
          where: { bookingId },
          data: {
            lifecycleStage: stripePayout?.status === 'paid' ? 'PAYOUT_COMPLETED' : 'PAYOUT_INITIATED',
            stripeTransferId: transfer.id,
            stripePayoutId: stripePayout?.id || null,
            connectedAccountId: stripeAccount.stripeAccountId,
            transferredAt: new Date(),
            payoutInitiatedAt: new Date(),
            ...(stripePayout?.status === 'paid' ? { payoutCompletedAt: new Date() } : {})
          }
        });

        // Generate and store invoice details
        const invoiceData = {
          invoiceNumber: `INV-${booking.id.slice(-8).toUpperCase()}`,
          bookingDate: booking.date,
          bookingTime: `${booking.startTime} - ${booking.endTime}`,
          customerName: booking.user.name || booking.user.email,
          fieldName: field.name,
          totalAmount: booking.totalPrice,
          platformFee: booking.platformCommission || (booking.totalPrice * 0.8), // Platform gets ~80% (100% - field owner's 20% commission)
          payoutAmount: payoutAmount,
          payoutDate: new Date()
        };

        // Send notification to field owner with invoice
        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PROCESSED',
          title: '💰 Payment Received!',
          message: `£${payoutAmount.toFixed(2)} has been automatically transferred to your account for the ${field.name} booking.`,
          data: {
            bookingId,
            payoutId: payout.id,
            amount: payoutAmount,
            fieldName: field.name,
            customerName: booking.user.name || booking.user.email,
            invoice: invoiceData
          }
        });

        console.log(`Automatic payout processed successfully for booking ${bookingId}: £${payoutAmount}`);
        
        return payout;

      } catch (stripeError: any) {
        console.error('Stripe transfer error:', stripeError);
        
        // Update booking to failed payout
        await prisma.booking.update({
          where: { id: bookingId },
          data: { payoutStatus: 'FAILED' }
        });

        // Notify admin about failed payout
        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN' }
        });

        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: 'PAYOUT_FAILED',
            title: 'Automatic Payout Failed',
            message: `Failed to process automatic payout for booking ${bookingId}. Error: ${stripeError.message}`,
            data: {
              bookingId,
              fieldOwnerId: fieldOwner.id,
              error: stripeError.message
            }
          });
        }

        throw stripeError;
      }
    } catch (error) {
      console.error('Error processing automatic payout:', error);
      throw error;
    }
  }

  /**
   * Handle refund with proper fee management
   * When a refund is issued, the Stripe fee is deducted from the field owner's account
   */
  async processRefundWithFeeAdjustment(bookingId: string, refundReason: string) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          field: {
            include: {
              owner: true
            }
          },
          payment: true,
          user: true
        }
      });

      if (!booking || !booking.payment) {
        throw new Error('Booking or payment not found');
      }

      const totalAmountInCents = Math.round(booking.totalPrice * 100);
      const stripeFee = this.calculateStripeFee(totalAmountInCents);
      
      // Check if payout was already made to field owner
      if (booking.payoutStatus === 'COMPLETED' && booking.payoutId) {
        // Need to reverse the transfer and deduct Stripe fee
        const fieldOwnerStripeAccount = await prisma.stripeAccount.findUnique({
          where: { userId: booking.field.owner.id }
        });

        if (fieldOwnerStripeAccount) {
          try {
            // Create a reverse transfer (negative transfer) to recover funds from field owner
            // This includes the original payout amount plus the Stripe fee
            const fieldOwnerAmount = booking.fieldOwnerAmount || (booking.totalPrice * 0.2); // Field owner gets ~20% commission
            const fieldOwnerAmountInCents = Math.round(fieldOwnerAmount * 100);
            const totalRecoveryAmount = fieldOwnerAmountInCents + stripeFee;

            const reverseTransfer = await stripe.transfers.create({
              amount: totalRecoveryAmount,
              currency: 'gbp',
              destination: fieldOwnerStripeAccount.stripeAccountId,
              reverse_transfer: true as any, // This reverses the original transfer
              metadata: {
                bookingId,
                type: 'refund_reversal',
                originalPayoutId: booking.payoutId,
                stripeFeeIncluded: stripeFee,
                reason: refundReason
              },
              description: `Refund reversal for booking ${bookingId} (includes Stripe fee)`
            });

            // Notify field owner about the reversal
            await createNotification({
              userId: booking.field.owner.id,
              type: 'PAYOUT_REVERSED',
              title: 'Payout Reversed Due to Refund',
              message: `£${(totalRecoveryAmount / 100).toFixed(2)} has been deducted from your account due to a booking cancellation. This includes the Stripe processing fee.`,
              data: {
                bookingId,
                reversalAmount: totalRecoveryAmount / 100,
                stripeFee: stripeFee / 100,
                refundReason
              }
            });
          } catch (reversalError) {
            console.error('Error reversing field owner payout:', reversalError);
            // Continue with refund even if reversal fails - admin will handle manually
          }
        }
      }

      // Process the refund to the customer
      const refund = await stripe.refunds.create({
        payment_intent: booking.paymentIntentId!,
        reason: 'requested_by_customer' as any,
        metadata: {
          bookingId,
          reason: refundReason
        }
      });

      // Update payment record
      await prisma.payment.update({
        where: { id: booking.payment.id },
        data: {
          status: 'refunded',
          stripeRefundId: refund.id,
          refundAmount: booking.totalPrice,
          refundReason
        }
      });

      // Update booking status
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          payoutStatus: 'REFUNDED',
          cancellationReason: refundReason,
          cancelledAt: new Date()
        }
      });

      // Notify customer about refund
      await createNotification({
        userId: booking.userId,
        type: 'REFUND_PROCESSED',
        title: 'Refund Processed',
        message: `Your refund of £${booking.totalPrice.toFixed(2)} has been initiated and will be credited to your account within 5-7 business days.`,
        data: {
          bookingId,
          refundAmount: booking.totalPrice,
          fieldName: booking.field.name
        }
      });

      return refund;
    } catch (error) {
      console.error('Error processing refund with fee adjustment:', error);
      throw error;
    }
  }

  /**
   * Get payout summary for field owner dashboard
   */
  async getPayoutSummary(userId: string) {
    try {
      const userFields = await prisma.field.findMany({
        where: { ownerId: userId },
        select: { id: true }
      });

      const fieldIds = userFields.map(f => f.id);

      // Get all bookings for user's fields
      const bookings = await prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          paymentStatus: 'PAID'
        }
      });

      const now = new Date();
      const summary = {
        totalEarnings: 0,
        pendingPayouts: 0,
        completedPayouts: 0,
        upcomingPayouts: 0, // Bookings where cancellation window hasn't passed
        bookingsInCancellationWindow: [] as any[]
      };

      // Import commission calculation utility
      const { calculatePayoutAmounts } = await import('../utils/commission.utils');

      for (const booking of bookings) {
        let amount = booking.fieldOwnerAmount;
        if (!amount) {
          const calculated = await calculatePayoutAmounts(booking.totalPrice, userId);
          amount = calculated.fieldOwnerAmount;
        }
        
        if (booking.payoutStatus === 'COMPLETED') {
          summary.completedPayouts += amount;
          summary.totalEarnings += amount;
        } else if (booking.payoutStatus === 'PROCESSING') {
          summary.pendingPayouts += amount;
        } else if (booking.status === 'CONFIRMED') {
          const systemSettings = await prisma.systemSettings.findFirst();
          if (await this.shouldReleasePayout(booking, systemSettings)) {
            summary.pendingPayouts += amount;
          } else {
            summary.upcomingPayouts += amount;
            
            // Calculate when payout will be available
            const bookingDateTime = new Date(booking.date);
            const [time, period] = booking.startTime.split(/(?=[AP]M)/);
            const [hours, minutes] = time.split(':').map(Number);
            let hour = hours;
            
            if (period === 'PM' && hour !== 12) hour += 12;
            if (period === 'AM' && hour === 12) hour = 0;
            
            bookingDateTime.setHours(hour, minutes || 0, 0, 0);
            const payoutAvailableAt = new Date(bookingDateTime.getTime() - 24 * 60 * 60 * 1000);
            
            summary.bookingsInCancellationWindow.push({
              bookingId: booking.id,
              amount,
              bookingDate: booking.date,
              bookingTime: booking.startTime,
              payoutAvailableAt
            });
          }
        }
      }

      return summary;
    } catch (error) {
      console.error('Error getting payout summary:', error);
      throw error;
    }
  }
}

export const automaticPayoutService = new AutomaticPayoutService();
