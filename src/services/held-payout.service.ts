//@ts-nocheck
import { PrismaClient } from '@prisma/client';
import { createNotification } from '../controllers/notification.controller';

const prisma = new PrismaClient();

export class HeldPayoutService {
  /**
   * Release held payouts for a field owner who just connected their Stripe account
   */
  async releaseHeldPayouts(userId: string): Promise<void> {
    try {
      // Check if user has a properly connected Stripe account
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId }
      });

      if (!stripeAccount || !stripeAccount.chargesEnabled || !stripeAccount.payoutsEnabled) {
        console.log(`User ${userId} does not have a fully connected Stripe account yet`);
        return;
      }

      // Find all fields owned by this user
      const fields = await prisma.field.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true }
      });

      if (fields.length === 0) {
        console.log(`User ${userId} has no fields`);
        return;
      }

      const fieldIds = fields.map(f => f.id);

      // Find all held bookings for these fields
      const heldBookings = await prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          payoutStatus: 'HELD',
          payoutHeldReason: 'NO_STRIPE_ACCOUNT',
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          paymentStatus: 'PAID'
        }
      });

      if (heldBookings.length === 0) {
        console.log(`No held bookings found for user ${userId}`);
        return;
      }

      console.log(`Found ${heldBookings.length} held bookings for user ${userId}`);

      // Get system settings for payout release schedule
      const systemSettings = await prisma.systemSettings.findFirst();
      const payoutReleaseSchedule = systemSettings?.payoutReleaseSchedule || 'after_cancellation_window';

      // Update bookings based on payout release schedule
      for (const booking of heldBookings) {
        let newPayoutStatus = 'PENDING';

        // Check payout release schedule
        if (payoutReleaseSchedule === 'on_weekend') {
          // Will be processed on weekend
          newPayoutStatus = 'PENDING';
        } else if (payoutReleaseSchedule === 'after_cancellation_window') {
          // Check if cancellation window has expired
          const cancellationWindowHours = systemSettings?.cancellationWindowHours || 24;
          const bookingDateTime = new Date(booking.date);
          const [startHourStr] = booking.startTime.split(':');
          bookingDateTime.setHours(parseInt(startHourStr));
          
          const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
          
          if (hoursUntilBooking < cancellationWindowHours) {
            // Cancellation window has passed, can release
            newPayoutStatus = 'PENDING';
          } else {
            // Still within cancellation window, keep held but update reason
            console.log(`Booking ${booking.id} still within cancellation window`);
            continue;
          }
        }

        // Update booking payout status
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            payoutStatus: newPayoutStatus,
            payoutHeldReason: null,
            payoutReleasedAt: new Date()
          }
        });

        console.log(`Released held payout for booking ${booking.id}`);
      }

      // Notify field owner about released payouts
      const releasedCount = heldBookings.filter(b => {
        if (payoutReleaseSchedule !== 'after_cancellation_window') return true;
        
        const cancellationWindowHours = systemSettings?.cancellationWindowHours || 24;
        const bookingDateTime = new Date(b.date);
        const [startHourStr] = b.startTime.split(':');
        bookingDateTime.setHours(parseInt(startHourStr));
        const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
        
        return hoursUntilBooking < cancellationWindowHours;
      }).length;

      if (releasedCount > 0) {
        await createNotification({
          userId,
          type: 'PAYOUT_RELEASED',
          title: 'Held Payments Released',
          message: `Great news! ${releasedCount} held payment(s) have been released now that your Stripe account is connected. They will be processed according to your payout schedule.`,
          data: { count: releasedCount }
        });
      }

    } catch (error) {
      console.error('Error releasing held payouts:', error);
      throw error;
    }
  }

  /**
   * Check and release held payouts that have passed their hold period
   * This should be run periodically (e.g., daily)
   */
  async processScheduledReleases(): Promise<void> {
    try {
      const systemSettings = await prisma.systemSettings.findFirst();
      const payoutReleaseSchedule = systemSettings?.payoutReleaseSchedule || 'after_cancellation_window';
      const cancellationWindowHours = systemSettings?.cancellationWindowHours || 24;

      // Find all held bookings
      const heldBookings = await prisma.booking.findMany({
        where: {
          payoutStatus: 'HELD',
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          paymentStatus: 'PAID'
        },
        include: {
          field: {
            include: {
              owner: true
            }
          }
        }
      });

      for (const booking of heldBookings) {
        let shouldRelease = false;

        // Check if field owner now has a Stripe account
        const stripeAccount = await prisma.stripeAccount.findUnique({
          where: { userId: booking.field.ownerId }
        });

        if (!stripeAccount || !stripeAccount.chargesEnabled || !stripeAccount.payoutsEnabled) {
          // Still no Stripe account, keep held
          continue;
        }

        // Field owner has Stripe account, check release schedule
        if (payoutReleaseSchedule === 'on_weekend') {
          // Check if today is Friday-Sunday
          const today = new Date().getDay();
          if (today >= 5 || today === 0) { // Friday = 5, Saturday = 6, Sunday = 0
            shouldRelease = true;
          }
        } else if (payoutReleaseSchedule === 'after_cancellation_window') {
          // Check if cancellation window has expired
          const bookingDateTime = new Date(booking.date);
          const [startHourStr] = booking.startTime.split(':');
          bookingDateTime.setHours(parseInt(startHourStr));
          
          const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
          
          if (hoursUntilBooking < cancellationWindowHours || bookingDateTime < new Date()) {
            // Cancellation window has passed or booking already happened
            shouldRelease = true;
          }
        }

        if (shouldRelease) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              payoutStatus: 'PENDING',
              payoutHeldReason: null,
              payoutReleasedAt: new Date()
            }
          });

          console.log(`Released held payout for booking ${booking.id}`);

          // Notify field owner
          await createNotification({
            userId: booking.field.ownerId,
            type: 'PAYOUT_RELEASED',
            title: 'Payment Released',
            message: `A payment of $${booking.fieldOwnerAmount} for booking on ${booking.date.toLocaleDateString('en-GB', { timeZone: 'Europe/London' })} has been released and will be processed soon.`,
            data: { 
              bookingId: booking.id,
              amount: booking.fieldOwnerAmount
            }
          });
        }
      }
    } catch (error) {
      console.error('Error processing scheduled payout releases:', error);
      throw error;
    }
  }
}

export const heldPayoutService = new HeldPayoutService();
