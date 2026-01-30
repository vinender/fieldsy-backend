//@ts-nocheck
import cron from 'node-cron';
import prisma from '../config/database';
import { createNotification } from '../controllers/notification.controller';
import { differenceInHours, parseISO, addHours, isBefore, isAfter, format } from 'date-fns';

/**
 * Scheduled job to send booking reminders
 * Runs every 30 minutes to check for upcoming bookings
 * Sends reminder 2 hours before booking time, or immediately if less than 2 hours away
 */
export const initBookingReminderJobs = () => {
  // Run every 30 minutes to check for upcoming bookings
  cron.schedule('*/30 * * * *', async () => {
    console.log('📧 Running booking reminder check...');

    try {
      const results = await sendBookingReminders();

      console.log(`✅ Booking reminder check completed:`);
      console.log(`   - Reminders sent: ${results.sent}`);
      console.log(`   - Already sent: ${results.skipped}`);
      console.log(`   - Failed: ${results.failed}`);
    } catch (error) {
      console.error('❌ Booking reminder job error:', error);
    }
  });

  console.log('✅ Booking reminder jobs initialized');
  console.log('   - Runs every 30 minutes');
  console.log('   - Sends reminder 2 hours before booking time');
};

/**
 * Send booking reminders for upcoming bookings
 */
async function sendBookingReminders() {
  const results = {
    sent: 0,
    skipped: 0,
    failed: 0
  };

  try {
    const now = new Date();

    // Find all confirmed bookings that are in the future
    const upcomingBookings = await prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        date: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) // Today or later
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        field: {
          select: {
            id: true,
            fieldId: true,
            name: true,
            address: true,
            location: true
          }
        }
      }
    });

    console.log(`📊 Found ${upcomingBookings.length} upcoming confirmed bookings`);

    for (const booking of upcomingBookings) {
      try {
        // Parse booking date and time
        const bookingDate = new Date(booking.date);
        const [startHourStr, startPeriod] = booking.startTime.split(/(?=[AP]M)/);
        let startHour = parseInt(startHourStr.split(':')[0]);
        const startMinute = parseInt(startHourStr.split(':')[1] || '0');

        // Convert to 24-hour format
        if (startPeriod === 'PM' && startHour !== 12) startHour += 12;
        if (startPeriod === 'AM' && startHour === 12) startHour = 0;

        // Create booking datetime
        const bookingDateTime = new Date(bookingDate);
        bookingDateTime.setHours(startHour, startMinute, 0, 0);

        // Calculate hours until booking
        const hoursUntilBooking = Math.floor((bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60));

        // Skip if booking is in the past
        if (hoursUntilBooking < 0) {
          continue;
        }

        // Skip if booking is more than 24 hours away (we'll catch it in next runs)
        if (hoursUntilBooking > 24) {
          continue;
        }

        // Check if reminder has already been sent
        const reminderSent = booking.reminderSent || false;

        // Determine if we should send reminder
        let shouldSendReminder = false;
        let reminderReason = '';

        if (!reminderSent) {
          if (hoursUntilBooking <= 2) {
            // Less than 2 hours away - send immediately
            shouldSendReminder = true;
            reminderReason = 'less than 2 hours away';
          }
        }

        if (!shouldSendReminder) {
          // console.log(`⏭️  Skipping booking ${booking.id} - reminder ${reminderSent ? 'already sent' : `not yet time (${hoursUntilBooking}h until booking)`}`);
          results.skipped++;
          continue;
        }

        console.log(`📧 Sending ${reminderReason} for booking ${booking.id} (${hoursUntilBooking}h away)`);

        // Mark reminder as sent FIRST to prevent race conditions with concurrent job runs
        // Use updateMany with a condition to ensure atomic update (only updates if not already sent)
        const updateResult = await prisma.booking.updateMany({
          where: {
            id: booking.id,
            reminderSent: false // Only update if not already sent
          },
          data: { reminderSent: true }
        });

        // If no rows were updated, another process already sent the reminder
        if (updateResult.count === 0) {
          console.log(`⏭️  Skipping booking ${booking.id} - reminder already sent by another process`);
          results.skipped++;
          continue;
        }

        // Send in-app notification
        await createNotification({
          userId: booking.userId,
          type: 'booking_reminder',
          title: 'Upcoming Booking Reminder',
          message: `Your booking at ${booking.field.name} is coming up ${hoursUntilBooking >= 2 ? `in ${hoursUntilBooking} hours` : 'soon'}! Time: ${booking.timeSlot}`,
          data: {
            bookingId: booking.id,
            fieldId: booking.fieldId,
            fieldName: booking.field.name,
            bookingDate: booking.date.toISOString(),
            timeSlot: booking.timeSlot,
            hoursUntilBooking
          }
        });

        // Send email reminder
        try {
          const { emailService } = await import('../services/email.service');
          await emailService.sendBookingReminderEmail({
            email: booking.user.email,
            userName: booking.user.name || 'Valued Customer',
            bookingId: booking.bookingId || booking.id,
            fieldId: booking.field.fieldId || '',
            fieldName: booking.field.name,
            bookingDate: booking.date,
            timeSlot: booking.timeSlot,
            startTime: booking.startTime,
            endTime: booking.endTime,
            numberOfDogs: booking.numberOfDogs,
            address: booking.field.address || booking.field.location || 'Address not available',
            hoursUntilBooking
          });
        } catch (emailError) {
          console.error('Failed to send reminder email:', emailError);
        }

        results.sent++;
        console.log(`✅ Sent reminder for booking ${booking.id} to ${booking.user.email}`);

      } catch (error) {
        console.error(`❌ Failed to process booking ${booking.id}:`, error);
        results.failed++;
      }
    }

  } catch (error) {
    console.error('❌ Error in sendBookingReminders:', error);
    throw error;
  }

  return results;
}

/**
 * Manual trigger for testing
 */
export async function triggerBookingReminders() {
  console.log('🔧 Manually triggering booking reminders...');
  const results = await sendBookingReminders();
  console.log('✅ Manual trigger completed:', results);
  return results;
}
