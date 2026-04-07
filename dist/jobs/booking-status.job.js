"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "initBookingStatusJob", {
    enumerable: true,
    get: function() {
        return initBookingStatusJob;
    }
});
const _nodecron = /*#__PURE__*/ _interop_require_default(require("node-cron"));
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _ukTime = require("../utils/ukTime");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const initBookingStatusJob = ()=>{
    // Schedule task to run every 15 minutes
    _nodecron.default.schedule('*/15 * * * *', async ()=>{
        console.log('Running booking status update job...');
        try {
            const now = (0, _ukTime.getNowUK)();
            // Find all CONFIRMED bookings that have ended
            // We need to check both the date and the end time
            // Since end time is a string (e.g., "14:00"), we'll fetch potential candidates first
            // and then filter them in memory or use a more complex query if possible.
            // For simplicity and safety, we'll fetch confirmed bookings from the past few days up to today.
            // 1. Find bookings with date < today (strictly past dates)
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const pastDateBookings = await _database.default.booking.updateMany({
                where: {
                    status: 'CONFIRMED',
                    date: {
                        lt: startOfToday // Strictly less than start of today (UK time)
                    }
                },
                data: {
                    status: 'COMPLETED'
                }
            });
            if (pastDateBookings.count > 0) {
                console.log(`Updated ${pastDateBookings.count} past bookings to COMPLETED`);
            }
            // 2. Find bookings for TODAY that have ended
            // This requires checking the endTime string
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayBookings = await _database.default.booking.findMany({
                where: {
                    status: 'CONFIRMED',
                    date: {
                        equals: today
                    }
                },
                select: {
                    id: true,
                    endTime: true
                }
            });
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const bookingsToComplete = todayBookings.filter((booking)=>{
                if (!booking.endTime) return false;
                // Parse time format (handles both "14:30" and "2:30PM" formats)
                let endHour = 0;
                let endMinute = 0;
                // Check if time includes AM/PM
                const timeMatch = booking.endTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                if (timeMatch) {
                    endHour = parseInt(timeMatch[1]);
                    endMinute = parseInt(timeMatch[2]);
                    const period = timeMatch[3]?.toUpperCase();
                    // Convert to 24-hour format if AM/PM is present
                    if (period === 'PM' && endHour !== 12) {
                        endHour += 12;
                    } else if (period === 'AM' && endHour === 12) {
                        endHour = 0;
                    }
                }
                // Check if booking end time has passed
                if (currentHour > endHour || currentHour === endHour && currentMinute >= endMinute) {
                    return true;
                }
                return false;
            });
            if (bookingsToComplete.length > 0) {
                await _database.default.booking.updateMany({
                    where: {
                        id: {
                            in: bookingsToComplete.map((b)=>b.id)
                        }
                    },
                    data: {
                        status: 'COMPLETED'
                    }
                });
                console.log(`Updated ${bookingsToComplete.length} today's bookings to COMPLETED`);
            }
        } catch (error) {
            console.error('Error in booking status job:', error);
        }
    });
    console.log('✅ Booking status job initialized');
};

//# sourceMappingURL=booking-status.job.js.map