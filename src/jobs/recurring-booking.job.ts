//@ts-nocheck
import cron from 'node-cron';
import prisma from '../config/database';
import { createNotification } from '../controllers/notification.controller';
import { getSubscriptionService } from '../config/payout-services';
const subscriptionService = getSubscriptionService();
import { addDays, addMonths, format, isBefore, isAfter } from 'date-fns';

/**
 * Scheduled job to automatically create recurring bookings for the next billing cycle
 * Runs daily at 2 AM to check for subscriptions that need new bookings created
 * Also runs hourly to check for completed bookings that need next booking created
 * Also runs daily at 8 AM to retry failed subscription payments
 */
export const initRecurringBookingJobs = () => {
  // NOTE: Subscription payment retries are now handled by the payout engine scheduler.
  // See payoutEngine.startScheduler(cron) in server.ts

  // Run daily at 2:00 AM to create upcoming recurring bookings
  cron.schedule('0 2 * * *', async () => {
    console.log('📅 Running recurring booking creation job...');

    try {
      const results = await createUpcomingRecurringBookings();

      console.log(`✅ Recurring booking job completed:`);
      console.log(`   - Created: ${results.created}`);
      console.log(`   - Skipped: ${results.skipped}`);
      console.log(`   - Failed: ${results.failed}`);
      console.log(`   - Cancelled: ${results.cancelled}`);
    } catch (error) {
      console.error('❌ Recurring booking job error:', error);

      // Notify admins of job failure
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' }
      });

      for (const admin of adminUsers) {
        await createNotification({
          userId: admin.id,
          type: 'RECURRING_JOB_ERROR',
          title: 'Recurring Booking Job Failed',
          message: `The automatic recurring booking job encountered an error: ${(error as any).message}`,
          data: {
            error: (error as any).message,
            timestamp: new Date()
          }
        });
      }
    }
  });

  // Run every hour to check for past bookings and auto-create next recurring booking
  cron.schedule('0 * * * *', async () => {
    console.log('🔄 Running past bookings check for auto-creation...');

    try {
      const results = await checkPastBookingsAndCreateNext();

      console.log(`✅ Past bookings check completed:`);
      console.log(`   - Created: ${results.created}`);
      console.log(`   - Skipped: ${results.skipped}`);
      console.log(`   - Failed: ${results.failed}`);
    } catch (error) {
      console.error('❌ Past bookings check error:', error);
    }
  });

  console.log('✅ Recurring booking jobs initialized');
  console.log('   - Daily job: 2:00 AM (create upcoming bookings)');
  console.log('   - Hourly job: Every hour (check past bookings)');
  console.log('   - (Subscription payment retries handled by payout engine)');
};

/**
 * Create upcoming recurring bookings for active subscriptions
 */
async function createUpcomingRecurringBookings() {
  const results = {
    created: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0
  };

  try {
    // Get system settings for max advance booking days
    const settings = await prisma.systemSettings.findFirst({
      select: { maxAdvanceBookingDays: true }
    });
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;

    // Get all active subscriptions
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false
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

    console.log(`📊 Found ${activeSubscriptions.length} active subscriptions`);

    for (const subscription of activeSubscriptions) {
      try {
        // Calculate next booking date
        let nextBookingDate = calculateNextBookingDate(subscription);

        // Check if we already have a booking for the next date
        const existingBooking = await prisma.booking.findFirst({
          where: {
            subscriptionId: subscription.id,
            date: nextBookingDate,
            status: {
              not: 'CANCELLED'
            }
          }
        });

        if (existingBooking) {
          console.log(`⏭️  Booking already exists for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')}`);
          results.skipped++;
          continue;
        }

        // Validate that next booking date is within advance booking days range
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const maxFutureDate = new Date(today);
        maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

        // Check if the last booking date has passed
        const lastBookingDate = subscription.lastBookingDate || new Date(subscription.createdAt);
        const lastBookingDateOnly = new Date(lastBookingDate);
        lastBookingDateOnly.setHours(0, 0, 0, 0);

        // Only create next booking if last booking date has passed
        if (isAfter(lastBookingDateOnly, today)) {
          console.log(`⏳ Last booking date (${format(lastBookingDate, 'PPP')}) has not passed yet for subscription ${subscription.id}`);
          results.skipped++;
          continue;
        }

        // Check if next booking date falls within advance booking range
        if (isAfter(nextBookingDate, maxFutureDate)) {
          console.log(`📆 Next booking date (${format(nextBookingDate, 'PPP')}) is beyond max advance booking days (${maxAdvanceBookingDays}) for subscription ${subscription.id}`);
          results.skipped++;
          continue;
        }

        // Check if next booking date is in the past
        if (isBefore(nextBookingDate, today)) {
          console.log(`⚠️  Next booking date (${format(nextBookingDate, 'PPP')}) is in the past for subscription ${subscription.id}`);

          // If the subscription is old and hasn't been used, cancel it
          const daysSinceLastBooking = Math.floor((today.getTime() - lastBookingDateOnly.getTime()) / (1000 * 60 * 60 * 24));

          if (daysSinceLastBooking > 14) { // If no booking for 14+ days, consider cancelling
            console.log(`🚫 Cancelling inactive subscription ${subscription.id}`);

            // Cancel the subscription
            await subscriptionService.cancelSubscription(subscription.id, true);

            // Notify user
            await createNotification({
              userId: subscription.userId,
              type: 'subscription_auto_cancelled',
              title: 'Recurring Booking Cancelled',
              message: `Your ${subscription.interval} recurring booking for ${subscription.field.name} has been automatically cancelled due to inactivity.`,
              data: {
                subscriptionId: subscription.id,
                fieldId: subscription.fieldId,
                fieldName: subscription.field.name,
                reason: 'inactive'
              }
            });

            results.cancelled++;
            continue;
          }

          // Otherwise, calculate the next valid date
          nextBookingDate = calculateNextValidBookingDate(subscription, today);
        }

        // Check if field is still active and accepting bookings
        if (!subscription.field.isActive || !subscription.field.isApproved) {
          console.log(`⚠️  Field ${subscription.fieldId} is not active/approved for subscription ${subscription.id}`);
          results.skipped++;
          continue;
        }

        // Create the booking for the next billing cycle
        console.log(`✨ Creating booking for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')}`);

        const booking = await subscriptionService.createBookingFromSubscription(
          subscription.id,
          nextBookingDate
        );

        // Check if booking was skipped due to slot conflict (returns null)
        if (booking === null) {
          console.log(`⚠️ Slot conflict for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')} - skipping (notification suppressed)`);
          results.skipped++;
          // Note: Notification removed to prevent spam - slots are already shown as unavailable in UI
          continue;
        }

        // Notify the user about the upcoming booking
        await createNotification({
          userId: subscription.userId,
          type: 'recurring_booking_created',
          title: 'Upcoming Booking Scheduled',
          message: `Your ${subscription.interval} booking at ${subscription.field.name} has been scheduled for ${format(nextBookingDate, 'PPP')} at ${subscription.timeSlot}`,
          data: {
            bookingId: booking.id,
            subscriptionId: subscription.id,
            fieldId: subscription.fieldId,
            fieldName: subscription.field.name,
            bookingDate: nextBookingDate.toISOString(),
            timeSlot: subscription.timeSlot
          }
        });

        // Send email to dog owner
        try {
          const { emailService } = await import('../services/email.service');
          await emailService.sendRecurringBookingEmailToDogOwner({
            email: subscription.user.email,
            userName: subscription.user.name || 'Valued Customer',
            fieldName: subscription.field.name,
            bookingDate: nextBookingDate,
            timeSlot: subscription.timeSlot,
            startTime: subscription.startTime,
            endTime: subscription.endTime,
            interval: subscription.interval,
            numberOfDogs: subscription.numberOfDogs,
            totalPrice: booking.totalPrice
          });
        } catch (emailError) {
          console.error('Failed to send recurring booking email to dog owner:', emailError);
        }

        // Notify the field owner
        if (subscription.field.ownerId && subscription.field.ownerId !== subscription.userId) {
          await createNotification({
            userId: subscription.field.ownerId,
            type: 'recurring_booking_scheduled',
            title: 'Recurring Booking Scheduled',
            message: `A ${subscription.interval} booking has been scheduled for ${subscription.field.name} on ${format(nextBookingDate, 'PPP')} at ${subscription.timeSlot}`,
            data: {
              bookingId: booking.id,
              subscriptionId: subscription.id,
              fieldId: subscription.fieldId,
              fieldName: subscription.field.name,
              bookingDate: nextBookingDate.toISOString(),
              timeSlot: subscription.timeSlot,
              dogOwnerName: subscription.user.name
            }
          });

          // Send email to field owner
          try {
            const { emailService } = await import('../services/email.service');
            await emailService.sendRecurringBookingEmailToFieldOwner({
              email: subscription.field.owner.email,
              ownerName: subscription.field.owner.name || 'Field Owner',
              fieldName: subscription.field.name,
              bookingDate: nextBookingDate,
              timeSlot: subscription.timeSlot,
              startTime: subscription.startTime,
              endTime: subscription.endTime,
              interval: subscription.interval,
              numberOfDogs: subscription.numberOfDogs,
              dogOwnerName: subscription.user.name || 'Dog Owner',
              totalPrice: booking.totalPrice,
              fieldOwnerAmount: booking.fieldOwnerAmount
            });
          } catch (emailError) {
            console.error('Failed to send recurring booking email to field owner:', emailError);
          }
        }

        results.created++;
        console.log(`✅ Created booking ${booking.id} for subscription ${subscription.id}`);

      } catch (error) {
        const errorMessage = (error as any).message || 'Unknown error';
        console.error(`❌ Failed to process subscription ${subscription.id}:`, error);
        results.failed++;

        // Check if this is a slot conflict error
        const isSlotConflict = errorMessage.includes('Slot not available');

        // Note: Notifications removed to prevent spam
        // Slot conflicts are expected and normal - slots are shown as unavailable in UI
        // Only log actual failures (non-conflict errors) for monitoring
        if (!isSlotConflict) {
          console.error(`⚠️ Non-conflict error for subscription ${subscription.id}:`, errorMessage);
          // Could add admin notification here for actual system failures if needed
        }
      }
    }

  } catch (error) {
    console.error('❌ Error in createUpcomingRecurringBookings:', error);
    throw error;
  }

  return results;
}

/**
 * Check if a date is valid for a field's operating days
 */
function isDateValidForField(date: Date, operatingDays: string[] | undefined): boolean {
  if (!operatingDays || operatingDays.length === 0) {
    return true; // If no operating days specified, assume all days are valid
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayOfWeek = dayNames[date.getDay()];
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekends = ['Saturday', 'Sunday'];

  for (const opDay of operatingDays) {
    if (opDay === 'everyday') {
      return true;
    } else if (opDay === 'weekdays' && weekdays.includes(dayOfWeek)) {
      return true;
    } else if (opDay === 'weekends' && weekends.includes(dayOfWeek)) {
      return true;
    } else if (opDay === dayOfWeek) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate the next booking date based on subscription interval
 * For 'everyday' subscriptions, skips days when the field doesn't operate
 */
function calculateNextBookingDate(subscription: any): Date {
  const lastBookingDate = subscription.lastBookingDate || new Date(subscription.createdAt);
  const operatingDays = subscription.field?.operatingDays;

  if (subscription.interval === 'everyday') {
    // Add 1 day to last booking date, but skip days when field doesn't operate
    let nextDate = addDays(lastBookingDate, 1);

    // For everyday subscriptions, find the next valid operating day
    // Maximum 7 iterations to prevent infinite loop (covers a full week)
    let iterations = 0;
    while (!isDateValidForField(nextDate, operatingDays) && iterations < 7) {
      nextDate = addDays(nextDate, 1);
      iterations++;
    }

    return nextDate;
  } else if (subscription.interval === 'weekly') {
    // Add 7 days to last booking date
    return addDays(lastBookingDate, 7);
  } else if (subscription.interval === 'monthly') {
    // Add 1 month to last booking date
    return addMonths(lastBookingDate, 1);
  } else {
    throw new Error(`Unknown subscription interval: ${subscription.interval}`);
  }
}

/**
 * Calculate the next valid booking date starting from today
 * For 'everyday' subscriptions, skips days when the field doesn't operate
 */
function calculateNextValidBookingDate(subscription: any, today: Date): Date {
  let nextDate = new Date(today);
  const operatingDays = subscription.field?.operatingDays;

  if (subscription.interval === 'everyday') {
    // Next valid date is tomorrow, but skip days when field doesn't operate
    nextDate = addDays(nextDate, 1);

    // Find the next valid operating day (max 7 iterations)
    let iterations = 0;
    while (!isDateValidForField(nextDate, operatingDays) && iterations < 7) {
      nextDate = addDays(nextDate, 1);
      iterations++;
    }

    return nextDate;
  } else if (subscription.interval === 'weekly') {
    // Find next occurrence of the day of week
    const targetDayOfWeek = new Date(subscription.lastBookingDate || subscription.createdAt).getDay();
    const currentDayOfWeek = nextDate.getDay();

    let daysToAdd = targetDayOfWeek - currentDayOfWeek;
    if (daysToAdd <= 0) {
      daysToAdd += 7; // Move to next week
    }

    return addDays(nextDate, daysToAdd);
  } else if (subscription.interval === 'monthly') {
    // Use the day of month from original booking
    const targetDayOfMonth = subscription.dayOfMonth || new Date(subscription.lastBookingDate || subscription.createdAt).getDate();

    nextDate.setDate(1); // Start from first day of current month
    nextDate = addMonths(nextDate, 1); // Move to next month

    // Set to target day of month (handle cases where day doesn't exist in month)
    const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
    nextDate.setDate(Math.min(targetDayOfMonth, lastDayOfMonth));

    return nextDate;
  } else {
    throw new Error(`Unknown subscription interval: ${subscription.interval}`);
  }
}

/**
 * Check for past bookings with subscriptions and auto-create next booking
 */
async function checkPastBookingsAndCreateNext() {
  const results = {
    created: 0,
    skipped: 0,
    failed: 0
  };

  try {
    const now = new Date();

    // Get system settings for maxAdvanceBookingDays
    const settings = await prisma.systemSettings.findFirst({
      select: { maxAdvanceBookingDays: true }
    });
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;
    const maxFutureDate = new Date(now);
    maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

    // Find all active subscriptions that have bookings in the past
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        cancelAtPeriodEnd: false
      },
      include: {
        field: {
          include: { owner: true }
        },
        user: true,
        bookings: {
          where: {
            status: {
              in: ['CONFIRMED', 'COMPLETED'] // Include both confirmed and completed bookings
            },
            date: {
              lt: now // Past bookings
            }
          },
          orderBy: {
            date: 'desc'
          },
          take: 1 // Get most recent past booking
        }
      }
    });

    console.log(`📊 Found ${subscriptions.length} active subscriptions to check`);

    for (const subscription of subscriptions) {
      try {
        // Skip if no past bookings found
        if (!subscription.bookings || subscription.bookings.length === 0) {
          continue;
        }

        const lastBooking = subscription.bookings[0];

        // Parse the booking end time to check if the session has ended
        const bookingDate = new Date(lastBooking.date);
        const [endHourStr, endPeriod] = lastBooking.endTime.split(/(?=[AP]M)/);
        let endHour = parseInt(endHourStr.split(':')[0]);
        const endMinute = parseInt(endHourStr.split(':')[1] || '0');
        if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
        if (endPeriod === 'AM' && endHour === 12) endHour = 0;

        bookingDate.setHours(endHour, endMinute, 0, 0);

        // Only process if the booking end time has passed
        if (bookingDate >= now) {
          continue;
        }

        // Calculate next booking date
        const lastBookingDate = subscription.lastBookingDate || lastBooking.date;
        let nextBookingDate = new Date();

        if (subscription.interval === 'everyday') {
          nextBookingDate = addDays(lastBookingDate, 1);
        } else if (subscription.interval === 'weekly') {
          nextBookingDate = addDays(lastBookingDate, 7);
        } else if (subscription.interval === 'monthly') {
          nextBookingDate = addMonths(lastBookingDate, 1);
        }

        // Ensure next booking date is in the future
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (isBefore(nextBookingDate, today)) {
          // Calculate a valid future date
          nextBookingDate = calculateNextValidBookingDate(subscription, today);
        }

        // Check if next booking is within advance booking range
        if (isAfter(nextBookingDate, maxFutureDate)) {
          console.log(`⏭️  Next booking date (${format(nextBookingDate, 'PPP')}) is beyond max advance booking days for subscription ${subscription.id}`);
          results.skipped++;
          continue;
        }

        // Check if booking already exists for this date
        const existingBooking = await prisma.booking.findFirst({
          where: {
            subscriptionId: subscription.id,
            date: nextBookingDate,
            status: { not: 'CANCELLED' }
          }
        });

        if (existingBooking) {
          console.log(`⏭️  Booking already exists for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')}`);
          results.skipped++;
          continue;
        }

        // Create the next booking
        console.log(`✨ Auto-creating next booking for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')}`);

        const newBooking = await subscriptionService.createBookingFromSubscription(
          subscription.id,
          nextBookingDate
        );

        // Check if booking was skipped due to slot conflict (returns null)
        if (newBooking === null) {
          console.log(`⚠️ Slot conflict for subscription ${subscription.id} on ${format(nextBookingDate, 'PPP')} - skipping (notification suppressed)`);
          results.skipped++;
          // Note: Notification removed to prevent spam - slots are already shown as unavailable in UI
          continue;
        }

        // NOTE: Notifications are sent by the daily job (createUpcomingRecurringBookings)
        // to avoid duplicate notifications. This hourly job only creates bookings silently.

        results.created++;
        console.log(`✅ Created booking ${newBooking.id} for subscription ${subscription.id}`);

      } catch (error) {
        console.error(`❌ Failed to process subscription ${subscription.id}:`, error);
        results.failed++;
      }
    }

  } catch (error) {
    console.error('❌ Error in checkPastBookingsAndCreateNext:', error);
    throw error;
  }

  return results;
}

/**
 * Manual trigger for testing or admin purposes
 */
export async function triggerRecurringBookingCreation() {
  console.log('🔧 Manually triggering recurring booking creation...');
  const results = await createUpcomingRecurringBookings();
  console.log('✅ Manual trigger completed:', results);
  return results;
}
