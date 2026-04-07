//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get initBookingReminderJobs () {
        return initBookingReminderJobs;
    },
    get triggerBookingReminders () {
        return triggerBookingReminders;
    }
});
const _nodecron = /*#__PURE__*/ _interop_require_default(require("node-cron"));
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _notificationcontroller = require("../controllers/notification.controller");
const _ukTime = require("../utils/ukTime");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const initBookingReminderJobs = ()=>{
    // Run every 30 minutes to check for upcoming bookings
    _nodecron.default.schedule('*/30 * * * *', async ()=>{
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
 */ async function sendBookingReminders() {
    const results = {
        sent: 0,
        skipped: 0,
        failed: 0
    };
    try {
        const now = (0, _ukTime.getNowUK)();
        // Find all confirmed bookings that are in the future (using UK time)
        const upcomingBookings = await _database.default.booking.findMany({
            where: {
                status: 'CONFIRMED',
                date: {
                    gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) // Today or later (UK time)
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
        for (const booking of upcomingBookings){
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
                const updateResult = await _database.default.booking.updateMany({
                    where: {
                        id: booking.id,
                        reminderSent: false // Only update if not already sent
                    },
                    data: {
                        reminderSent: true
                    }
                });
                // If no rows were updated, another process already sent the reminder
                if (updateResult.count === 0) {
                    console.log(`⏭️  Skipping booking ${booking.id} - reminder already sent by another process`);
                    results.skipped++;
                    continue;
                }
                // Send in-app notification
                await (0, _notificationcontroller.createNotification)({
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
                    const { emailService } = await Promise.resolve().then(()=>/*#__PURE__*/ _interop_require_wildcard(require("../services/email.service")));
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
async function triggerBookingReminders() {
    console.log('🔧 Manually triggering booking reminders...');
    const results = await sendBookingReminders();
    console.log('✅ Manual trigger completed:', results);
    return results;
}

//# sourceMappingURL=booking-reminder.job.js.map