//@ts-nocheck
import { PrismaClient } from '@prisma/client';
import { createNotification } from '../controllers/notification.controller';
import { calculatePayoutAmounts } from '../utils/commission.utils';
import { stripe } from '../config/stripe.config';
import { createConnectedAccountPayout } from '../utils/stripe-payout.helper';
import {
  checkPlatformBalance,
  checkChargeFundsAvailable,
  safeTransferWithBalanceGate
} from '../utils/stripe-balance.helper';

const prisma = new PrismaClient();

export class PayoutService {
  /**
   * Process automatic payout when booking is completed
   * This transfers the field owner's portion from the platform account to their connected account
   */
  async processBookingPayout(bookingId: string) {
    try {
      // Get booking with field and owner details
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

      // Check if payout has already been processed or is held
      if (booking.payoutStatus === 'COMPLETED' || booking.payoutStatus === 'PROCESSING') {
        console.log(`Payout already ${booking.payoutStatus} for booking ${bookingId}`);
        return;
      }
      
      // Check if payout is held (e.g., no Stripe account)
      if (booking.payoutStatus === 'HELD') {
        console.log(`Payout is held for booking ${bookingId}. Reason: ${booking.payoutHeldReason}`);
        return;
      }

      // Check if booking is completed and payment was successful
      if (booking.status !== 'COMPLETED' || booking.paymentStatus !== 'PAID') {
        console.log(`Booking ${bookingId} is not eligible for payout. Status: ${booking.status}, Payment: ${booking.paymentStatus}`);
        return;
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
        
        // Notify field owner to set up Stripe account
        // Calculate field owner amount if not stored
        const { fieldOwnerAmount: calculatedAmount } = await calculatePayoutAmounts(
          booking.totalPrice,
          fieldOwner.id
        );
        const payoutAmount = booking.fieldOwnerAmount || calculatedAmount;

        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PENDING',
          title: 'Set up payment account',
          message: 'You have pending payouts. Please set up your payment account to receive funds.',
          data: {
            bookingId,
            amount: payoutAmount
          }
        });
        
        // Mark payout as pending account setup
        await prisma.booking.update({
          where: { id: bookingId },
          data: { payoutStatus: 'PENDING_ACCOUNT' }
        });
        
        return;
      }

      // Check if Stripe account is fully onboarded
      if (!stripeAccount.chargesEnabled || !stripeAccount.payoutsEnabled) {
        console.log(`Field owner ${fieldOwner.id} Stripe account is not fully set up`);

        // Calculate field owner amount if not stored
        const { fieldOwnerAmount: calculatedAmount } = await calculatePayoutAmounts(
          booking.totalPrice,
          fieldOwner.id
        );
        const payoutAmount = booking.fieldOwnerAmount || calculatedAmount;

        // Notify field owner to complete Stripe onboarding
        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PENDING',
          title: 'Complete payment account setup',
          message: 'Please complete your payment account setup to receive pending payouts.',
          data: {
            bookingId,
            amount: payoutAmount
          }
        });
        
        // Mark payout as pending account setup
        await prisma.booking.update({
          where: { id: bookingId },
          data: { payoutStatus: 'PENDING_ACCOUNT' }
        });
        
        return;
      }

      // Get payout amount - use stored value or calculate
      let payoutAmount = booking.fieldOwnerAmount;
      let platformCommission = booking.platformCommission;

      if (!payoutAmount) {
        // Calculate if not stored (fallback for old bookings)
        const calculated = await calculatePayoutAmounts(booking.totalPrice, fieldOwner.id);
        payoutAmount = calculated.fieldOwnerAmount;
        platformCommission = calculated.platformCommission;
      }

      const payoutAmountInCents = Math.round(payoutAmount * 100);

      // ============================================================================
      // BALANCE GATE: Check if funds are available before attempting transfer
      // Rule 2: Never create transfers without verifying available balance
      // ============================================================================

      // First, check if funds from the original payment are available
      // This prevents "insufficient balance" errors from Stripe
      const transaction = await prisma.transaction.findFirst({
        where: { bookingId, type: 'PAYMENT' }
      });

      if (transaction?.stripeChargeId) {
        const fundsCheck = await checkChargeFundsAvailable(transaction.stripeChargeId);
        if (!fundsCheck.isAvailable) {
          console.log(`[PayoutService] Funds not yet available for booking ${bookingId}: ${fundsCheck.message}`);

          // Mark as PENDING_FUNDS instead of failing - will be retried by cron job
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
      }

      // Check platform balance can cover this transfer
      const balanceCheck = await checkPlatformBalance(payoutAmountInCents, 'gbp');
      if (!balanceCheck.canTransfer) {
        console.log(`[PayoutService] Insufficient platform balance for booking ${bookingId}: ${balanceCheck.message}`);

        // Mark as PENDING - will be retried by cron job when balance is available
        await prisma.booking.update({
          where: { id: bookingId },
          data: {
            payoutStatus: 'PENDING',
            payoutHeldReason: `Insufficient platform balance: ${balanceCheck.availableAmount / 100} GBP available, need ${payoutAmountInCents / 100} GBP`
          }
        });

        return null; // Will be processed when balance is sufficient
      }

      // Update booking to processing (only after balance checks pass)
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
            type: 'booking_payout'
          },
          description: `Payout for booking ${bookingId} - ${field.name}`
        });

        // If transfer was deferred due to balance issues, mark for retry
        if (!transferResult.success && transferResult.shouldDefer) {
          console.log(`[PayoutService] Transfer deferred for booking ${bookingId}: ${transferResult.reason}`);

          await prisma.booking.update({
            where: { id: bookingId },
            data: {
              payoutStatus: 'PENDING',
              payoutHeldReason: transferResult.reason
            }
          });

          return null; // Will be retried later
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
            description: `Payout for booking ${bookingId} - ${field.name}`,
            metadata: {
              bookingId,
              bookingIds: JSON.stringify([bookingId]),
              fieldId: field.id,
              fieldOwnerId: fieldOwner.id,
              transferId: transfer.id,
              source: 'booking_completion'
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
            description: `Payout for booking ${bookingId}`,
            bookingIds: [bookingId],
            arrivalDate: stripePayout?.arrival_date ? new Date(stripePayout.arrival_date * 1000) : new Date(),
            failureCode: stripePayout?.failure_code || null,
            failureMessage: stripePayout?.failure_message || null
          }
        });

        // Update booking with payout details and commission amounts
        await prisma.booking.update({
          where: { id: bookingId },
          data: {
            payoutStatus: stripePayout?.status === 'paid' ? 'COMPLETED' : 'PROCESSING',
            payoutId: payout.id,
            fieldOwnerAmount: payoutAmount,
            platformCommission: platformCommission
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

        // Send notification to field owner
        await createNotification({
          userId: fieldOwner.id,
          type: 'PAYOUT_PROCESSED',
          title: 'Payment Received!',
          message: `£${payoutAmount.toFixed(2)} has been transferred to your account for ${field.name} booking.`,
          data: {
            bookingId,
            payoutId: payout.id,
            amount: payoutAmount,
            fieldName: field.name,
            customerName: booking.user.name || booking.user.email
          }
        });

        console.log(`Payout processed successfully for booking ${bookingId}: £${payoutAmount}`);
        
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
            title: 'Payout Failed',
            message: `Failed to process payout for booking ${bookingId}. Error: ${stripeError.message}`,
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
      console.error('Error processing payout:', error);
      throw error;
    }
  }

  /**
   * Process pending payouts for field owners who have completed Stripe onboarding
   */
  async processPendingPayouts(userId: string) {
    try {
      // Get all bookings pending payout for this user's fields
      const userFields = await prisma.field.findMany({
        where: { ownerId: userId },
        select: { id: true }
      });

      const fieldIds = userFields.map(f => f.id);

      const pendingBookings = await prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          payoutStatus: { in: ['PENDING', 'PENDING_ACCOUNT'] }
        }
      });

      console.log(`Processing ${pendingBookings.length} pending payouts for user ${userId}`);

      const results = [];
      for (const booking of pendingBookings) {
        try {
          const payout = await this.processBookingPayout(booking.id);
          results.push({ bookingId: booking.id, success: true, payout });
        } catch (error) {
          console.error(`Failed to process payout for booking ${booking.id}:`, error);
          results.push({ bookingId: booking.id, success: false, error });
        }
      }

      return results;
    } catch (error) {
      console.error('Error processing pending payouts:', error);
      throw error;
    }
  }

  /**
   * Get payout history for a field owner
   */
  async getPayoutHistory(userId: string, page = 1, limit = 10) {
    try {
      // Get Stripe account for this user
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId }
      });

      if (!stripeAccount) {
        return {
          payouts: [],
          total: 0,
          page,
          limit,
          totalPages: 0
        };
      }

      const skip = (page - 1) * limit;

      const [payouts, total] = await Promise.all([
        prisma.payout.findMany({
          where: { stripeAccountId: stripeAccount.id },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.payout.count({
          where: { stripeAccountId: stripeAccount.id }
        })
      ]);

      // Enhance payouts with booking details
      const enhancedPayouts = await Promise.all(
        payouts.map(async (payout) => {
          const bookings = await prisma.booking.findMany({
            where: { id: { in: payout.bookingIds } },
            include: {
              field: { select: { name: true } },
              user: { select: { name: true, email: true } }
            }
          });

          return {
            ...payout,
            bookings: bookings.map(b => ({
              id: b.id,
              fieldName: b.field.name,
              customerName: b.user.name || b.user.email,
              date: b.date,
              amount: b.fieldOwnerAmount || (b.totalPrice * 0.2) // Field owner gets ~20% commission
            }))
          };
        })
      );

      return {
        payouts: enhancedPayouts,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('Error fetching payout history:', error);
      throw error;
    }
  }
}

export const payoutService = new PayoutService();
