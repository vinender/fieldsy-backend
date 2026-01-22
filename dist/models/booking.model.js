"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../config/database"));
const date_fns_1 = require("date-fns");
class BookingModel {
    // Helper to generate public booking ID
    async generateBookingId() {
        const counter = await database_1.default.counter.upsert({
            where: { name: 'booking' },
            update: { value: { increment: 1 } },
            create: { name: 'booking', value: 1111 },
        });
        return counter.value.toString();
    }
    // Create a new booking
    async create(data) {
        const { dogOwnerId, ...rest } = data;
        // Get field data for snapshot
        const field = await database_1.default.field.findUnique({
            where: { id: data.fieldId },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
        });
        if (!field) {
            throw new Error('Field not found');
        }
        // Generate human-friendly booking ID
        const bookingId = await this.generateBookingId();
        return database_1.default.booking.create({
            data: {
                ...rest,
                userId: dogOwnerId,
                bookingId,
                status: data.status || 'PENDING'
            },
            include: {
                field: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    // Find booking by ID
    async findById(id) {
        const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
        const where = isObjectId ? { id } : { bookingId: id };
        return database_1.default.booking.findUnique({
            where,
            include: {
                field: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    // Find all bookings with filters
    async findAll(filters = {}) {
        const where = {};
        if (filters.dogOwnerId) {
            where.userId = filters.dogOwnerId;
        }
        if (filters.fieldId) {
            where.fieldId = filters.fieldId;
        }
        if (filters.status) {
            where.status = filters.status;
        }
        if (filters.date) {
            const startOfDay = new Date(filters.date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(filters.date);
            endOfDay.setHours(23, 59, 59, 999);
            where.date = {
                gte: startOfDay,
                lte: endOfDay,
            };
        }
        if (filters.startDate && filters.endDate) {
            where.date = {
                gte: filters.startDate,
                lte: filters.endDate,
            };
        }
        return database_1.default.booking.findMany({
            where,
            skip: filters.skip,
            take: filters.take,
            orderBy: {
                date: 'desc',
            },
            include: {
                field: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    // Find bookings by dog owner
    async findByDogOwner(dogOwnerId) {
        return this.findAll({ dogOwnerId });
    }
    // Find bookings by field
    async findByField(fieldId) {
        return this.findAll({ fieldId });
    }
    // Find bookings by field owner
    async findByFieldOwner(ownerId) {
        return database_1.default.booking.findMany({
            where: {
                field: {
                    ownerId,
                },
            },
            orderBy: {
                date: 'desc',
            },
            include: {
                field: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    // Update booking status
    async updateStatus(id, status) {
        return database_1.default.booking.update({
            where: { id },
            data: { status },
            include: {
                field: true,
                user: true,
            },
        });
    }
    // Update booking
    async update(id, data) {
        return database_1.default.booking.update({
            where: { id },
            data,
            include: {
                field: true,
                user: true,
            },
        });
    }
    // Cancel booking
    async cancel(id, reason) {
        return database_1.default.booking.update({
            where: { id },
            data: {
                status: 'CANCELLED',
                cancellationReason: reason,
                cancelledAt: new Date(),
            },
            include: {
                field: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    // Complete booking
    async complete(id) {
        return this.updateStatus(id, 'COMPLETED');
    }
    // Delete booking
    async delete(id) {
        await database_1.default.booking.delete({
            where: { id },
        });
    }
    // Check availability for a field on a specific date and time
    async checkAvailability(fieldId, date, startTime, endTime, excludeBookingId) {
        const where = {
            fieldId,
            date,
            status: {
                notIn: ['CANCELLED', 'COMPLETED'],
            },
        };
        if (excludeBookingId) {
            where.id = {
                not: excludeBookingId,
            };
        }
        const conflictingBookings = await database_1.default.booking.findMany({
            where,
        });
        // Check for time conflicts
        for (const booking of conflictingBookings) {
            const bookingStart = this.timeToMinutes(booking.startTime);
            const bookingEnd = this.timeToMinutes(booking.endTime);
            const requestedStart = this.timeToMinutes(startTime);
            const requestedEnd = this.timeToMinutes(endTime);
            // Check if times overlap
            if ((requestedStart >= bookingStart && requestedStart < bookingEnd) ||
                (requestedEnd > bookingStart && requestedEnd <= bookingEnd) ||
                (requestedStart <= bookingStart && requestedEnd >= bookingEnd)) {
                return false; // Time conflict found
            }
        }
        return true; // No conflicts
    }
    // Helper function to convert time string to minutes
    timeToMinutes(time) {
        // Handle both "HH:mm" and "H:mmAM/PM" formats
        if (time.includes('AM') || time.includes('PM')) {
            const match = time.match(/(\d+):(\d+)(AM|PM)/i);
            if (match) {
                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const period = match[3].toUpperCase();
                if (period === 'PM' && hours !== 12)
                    hours += 12;
                if (period === 'AM' && hours === 12)
                    hours = 0;
                return hours * 60 + minutes;
            }
        }
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + (minutes || 0);
    }
    /**
     * Check if a date falls on a recurring subscription's scheduled day
     * Returns the subscription if there's a conflict, null otherwise
     */
    async checkRecurringSlotConflict(fieldId, date, startTime, endTime, excludeSubscriptionId) {
        // Get all active subscriptions for this field
        const activeSubscriptions = await database_1.default.subscription.findMany({
            where: {
                fieldId,
                status: 'active',
                cancelAtPeriodEnd: false,
                ...(excludeSubscriptionId ? { id: { not: excludeSubscriptionId } } : {})
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
        if (activeSubscriptions.length === 0) {
            return { hasConflict: false };
        }
        const requestedDate = new Date(date);
        requestedDate.setHours(0, 0, 0, 0);
        const requestedDayOfWeek = requestedDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const requestedDayOfMonth = requestedDate.getDate();
        // Day name mapping
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const requestedDayName = dayNames[requestedDayOfWeek];
        for (const subscription of activeSubscriptions) {
            let isDateMatch = false;
            if (subscription.interval === 'everyday') {
                // Everyday subscription - every day matches
                isDateMatch = true;
            }
            else if (subscription.interval === 'weekly') {
                // Weekly subscription - check if day of week matches
                isDateMatch = subscription.dayOfWeek === requestedDayName;
            }
            else if (subscription.interval === 'monthly') {
                // Monthly subscription - check if day of month matches
                isDateMatch = subscription.dayOfMonth === requestedDayOfMonth;
            }
            if (isDateMatch) {
                // Check time overlap
                const subStart = this.timeToMinutes(subscription.startTime);
                const subEnd = this.timeToMinutes(subscription.endTime);
                const reqStart = this.timeToMinutes(startTime);
                const reqEnd = this.timeToMinutes(endTime);
                // Check if times overlap
                const hasTimeOverlap = (reqStart >= subStart && reqStart < subEnd) ||
                    (reqEnd > subStart && reqEnd <= subEnd) ||
                    (reqStart <= subStart && reqEnd >= subEnd);
                if (hasTimeOverlap) {
                    return {
                        hasConflict: true,
                        subscription,
                        reason: `This time slot is reserved by a ${subscription.interval} recurring booking (${subscription.timeSlot})`
                    };
                }
            }
        }
        return { hasConflict: false };
    }
    /**
     * Get all future dates reserved by recurring subscriptions for a field
     * Used to show reserved slots in the calendar UI
     */
    async getRecurringReservedDates(fieldId, startDate, endDate) {
        const activeSubscriptions = await database_1.default.subscription.findMany({
            where: {
                fieldId,
                status: 'active',
                cancelAtPeriodEnd: false
            }
        });
        const reservedDates = [];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        for (const subscription of activeSubscriptions) {
            let currentDate = new Date(startDate);
            currentDate.setHours(0, 0, 0, 0);
            while (currentDate <= endDate) {
                let shouldAdd = false;
                if (subscription.interval === 'everyday') {
                    shouldAdd = true;
                }
                else if (subscription.interval === 'weekly') {
                    const currentDayName = dayNames[currentDate.getDay()];
                    shouldAdd = subscription.dayOfWeek === currentDayName;
                }
                else if (subscription.interval === 'monthly') {
                    shouldAdd = subscription.dayOfMonth === currentDate.getDate();
                }
                if (shouldAdd) {
                    // Check if there's already a booking for this subscription on this date
                    const existingBooking = await database_1.default.booking.findFirst({
                        where: {
                            subscriptionId: subscription.id,
                            date: currentDate,
                            status: { notIn: ['CANCELLED'] }
                        }
                    });
                    // Only add to reserved if no booking exists yet (booking will show in regular availability)
                    if (!existingBooking) {
                        reservedDates.push({
                            date: new Date(currentDate),
                            timeSlot: subscription.timeSlot,
                            subscriptionId: subscription.id,
                            interval: subscription.interval
                        });
                    }
                }
                currentDate = (0, date_fns_1.addDays)(currentDate, 1);
            }
        }
        return reservedDates;
    }
    /**
     * Check if creating a recurring subscription would conflict with existing bookings
     * This checks all future dates that the recurring subscription would occupy
     */
    async checkRecurringSubscriptionConflicts(fieldId, startDate, startTime, endTime, interval, maxDaysToCheck = 60 // Check up to 60 days ahead by default
    ) {
        const conflictingDates = [];
        // Get the day of week and day of month from start date
        const dayOfWeek = startDate.getDay(); // 0-6
        const dayOfMonth = startDate.getDate(); // 1-31
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        // Calculate end date for checking
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + maxDaysToCheck);
        // Get all existing non-cancelled bookings for this field in the date range
        const existingBookings = await database_1.default.booking.findMany({
            where: {
                fieldId,
                date: {
                    gte: startDate,
                    lte: endDate
                },
                status: {
                    notIn: ['CANCELLED']
                }
            },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                }
            }
        });
        // Convert start/end times to minutes for comparison
        const reqStart = this.timeToMinutes(startTime);
        const reqEnd = this.timeToMinutes(endTime);
        // Check each existing booking to see if it would conflict
        for (const booking of existingBookings) {
            const bookingDate = new Date(booking.date);
            bookingDate.setHours(0, 0, 0, 0);
            let wouldConflict = false;
            if (interval === 'everyday') {
                // Every day conflicts
                wouldConflict = true;
            }
            else if (interval === 'weekly') {
                // Check if booking is on the same day of week
                wouldConflict = bookingDate.getDay() === dayOfWeek;
            }
            else if (interval === 'monthly') {
                // Check if booking is on the same day of month
                wouldConflict = bookingDate.getDate() === dayOfMonth;
            }
            if (wouldConflict) {
                // Check time overlap
                const bookingStart = this.timeToMinutes(booking.startTime);
                const bookingEnd = this.timeToMinutes(booking.endTime);
                const hasTimeOverlap = (reqStart >= bookingStart && reqStart < bookingEnd) ||
                    (reqEnd > bookingStart && reqEnd <= bookingEnd) ||
                    (reqStart <= bookingStart && reqEnd >= bookingEnd);
                if (hasTimeOverlap) {
                    conflictingDates.push({
                        date: bookingDate,
                        existingBooking: booking
                    });
                }
            }
        }
        return {
            hasConflict: conflictingDates.length > 0,
            conflictingDates
        };
    }
    /**
     * Enhanced availability check that includes both existing bookings AND recurring reservations
     */
    async checkFullAvailability(fieldId, date, startTime, endTime, excludeBookingId, excludeSubscriptionId) {
        // First check existing bookings
        const bookingAvailable = await this.checkAvailability(fieldId, date, startTime, endTime, excludeBookingId);
        if (!bookingAvailable) {
            return {
                available: false,
                reason: 'This time slot is already booked',
                conflictType: 'booking'
            };
        }
        // Then check recurring subscription reservations
        const recurringCheck = await this.checkRecurringSlotConflict(fieldId, date, startTime, endTime, excludeSubscriptionId);
        if (recurringCheck.hasConflict) {
            return {
                available: false,
                reason: recurringCheck.reason,
                conflictType: 'recurring'
            };
        }
        return { available: true };
    }
    // Get booking statistics for a field owner
    async getFieldOwnerStats(ownerId) {
        const bookings = await this.findByFieldOwner(ownerId);
        const stats = {
            total: bookings.length,
            pending: bookings.filter(b => b.status === 'PENDING').length,
            confirmed: bookings.filter(b => b.status === 'CONFIRMED').length,
            completed: bookings.filter(b => b.status === 'COMPLETED').length,
            cancelled: bookings.filter(b => b.status === 'CANCELLED').length,
            totalRevenue: bookings
                .filter(b => b.status === 'COMPLETED')
                .reduce((sum, b) => sum + b.totalPrice, 0),
        };
        return stats;
    }
    // Get booking statistics for a dog owner
    async getDogOwnerStats(dogOwnerId) {
        const bookings = await this.findByDogOwner(dogOwnerId);
        const stats = {
            total: bookings.length,
            upcoming: bookings.filter(b => b.status === 'CONFIRMED' && new Date(b.date) >= new Date()).length,
            completed: bookings.filter(b => b.status === 'COMPLETED').length,
            cancelled: bookings.filter(b => b.status === 'CANCELLED').length,
            totalSpent: bookings
                .filter(b => b.status === 'COMPLETED')
                .reduce((sum, b) => sum + b.totalPrice, 0),
        };
        return stats;
    }
    // Sanitize booking object for API responses
    sanitize(booking) {
        if (!booking)
            return null;
        const { id, userId, fieldId, bookingId, ...rest } = booking;
        // Handle nested field and user if they exist
        if (rest.field) {
            const { id: fid, ...fieldRest } = rest.field;
            rest.field = {
                id: rest.field.fieldId || fid,
                ...fieldRest
            };
            // Sanitize field owner if it exists
            if (rest.field.owner) {
                const { id: oid, ...ownerRest } = rest.field.owner;
                rest.field.owner = {
                    id: rest.field.owner.userId || oid,
                    ...ownerRest
                };
            }
        }
        if (rest.user) {
            const { id: uid, ...userRest } = rest.user;
            rest.user = {
                id: rest.user.userId || uid,
                ...userRest
            };
        }
        return {
            id: bookingId || id,
            ...rest
        };
    }
}
exports.default = new BookingModel();
