//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PaymentController", {
    enumerable: true,
    get: function() {
        return PaymentController;
    }
});
const _stripeconfig = require("../config/stripe.config");
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _notificationcontroller = require("./notification.controller");
const _notificationservice = require("../services/notification.service");
const _commissionutils = require("../utils/commission.utils");
const _payoutservices = require("../config/payout-services");
const _emailservice = require("../services/email.service");
const _bookingmodel = /*#__PURE__*/ _interop_require_default(require("../models/booking.model"));
const _constants = require("../config/constants");
const _fieldutils = require("../utils/field.utils");
const _settingscache = require("../config/settings-cache");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const subscriptionService = (0, _payoutservices.getSubscriptionService)();
/**
 * Check if a date is valid for a field's operating days
 */ function isDateValidForField(date, operatingDays) {
    if (!operatingDays || operatingDays.length === 0) {
        return true; // If no operating days specified, assume all days are valid
    }
    const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday'
    ];
    const dayOfWeek = dayNames[date.getDay()];
    const weekdays = [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday'
    ];
    const weekends = [
        'Saturday',
        'Sunday'
    ];
    for (const opDay of operatingDays){
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
 * Get the next valid booking date for everyday subscriptions
 * Skips days when the field doesn't operate
 */ function getNextValidBookingDate(baseDate, operatingDays) {
    let nextDate = new Date(baseDate);
    nextDate.setDate(nextDate.getDate() + 1);
    // Find the next valid operating day (max 7 iterations to prevent infinite loop)
    let iterations = 0;
    while(!isDateValidForField(nextDate, operatingDays) && iterations < 7){
        nextDate.setDate(nextDate.getDate() + 1);
        iterations++;
    }
    return nextDate;
}
class PaymentController {
    // Create a payment intent for booking a field
    async createPaymentIntent(req, res) {
        try {
            const { fieldId: rawFieldId, numberOfDogs, date, timeSlots, repeatBooking, amount, paymentMethodId, duration// Optional: booking duration ('30min' or '60min')
             } = req.body;
            let fieldId1 = rawFieldId;
            // Normalize timeSlots - ensure it's always an array
            const normalizedTimeSlots = Array.isArray(timeSlots) ? timeSlots : timeSlots ? [
                timeSlots
            ] : [];
            if (normalizedTimeSlots.length === 0) {
                return res.status(400).json({
                    error: 'At least one time slot is required'
                });
            }
            // For display purposes, use first and last slot
            const displayTimeSlot = normalizedTimeSlots.length === 1 ? normalizedTimeSlots[0] : `${normalizedTimeSlots[0]} (+${normalizedTimeSlots.length - 1} more)`;
            // Validate user
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    error: 'User not authenticated'
                });
            }
            // Get user for Stripe customer
            const user = await _database.default.user.findUnique({
                where: {
                    id: userId
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    stripeCustomerId: true
                }
            });
            // Check if user is blocked (field might not exist in production yet)
            try {
                const userBlockStatus = await _database.default.user.findUnique({
                    where: {
                        id: userId
                    },
                    select: {
                        isBlocked: true,
                        blockReason: true
                    }
                });
                if (userBlockStatus?.isBlocked) {
                    return res.status(403).json({
                        error: 'Your account has been blocked',
                        reason: userBlockStatus.blockReason || 'Please contact support for more information'
                    });
                }
            } catch (error) {
                // isBlocked field doesn't exist in production yet, skip check
                console.warn('Warning: isBlocked field not found in User model.');
            }
            // Resolve field early - support both ObjectID and human-readable fieldId (e.g. "F1153")
            const field = await (0, _fieldutils.resolveField)(fieldId1);
            if (!field) {
                return res.status(404).json({
                    error: 'Field not found'
                });
            }
            // Reassign fieldId to the resolved MongoDB ObjectID for all downstream database queries
            fieldId1 = field.id;
            // ============================================================
            // SLOT AVAILABILITY CHECK - Prevent race conditions
            // Check availability BEFORE creating payment intent
            // ============================================================
            const bookingDate = new Date(date);
            bookingDate.setHours(0, 0, 0, 0);
            // Parse time slots and check availability for each
            const actualDurationMinutes = duration === '30min' ? 30 : 60;
            // Helper function to parse time string to minutes
            const parseTimeToMinutesLocal = (timeStr)=>{
                const match = timeStr.match(/(\d+):(\d+)(AM|PM)/i);
                if (!match) return 0;
                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const period = match[3].toUpperCase();
                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;
                return hours * 60 + minutes;
            };
            // Helper function to convert minutes to time string
            const minutesToTimeStrLocal = (totalMinutes)=>{
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const period = hours >= 12 ? 'PM' : 'AM';
                const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
            };
            // Check availability for ALL slots atomically before proceeding
            // Batch DB queries: fetch all bookings and recurring subscriptions ONCE
            const [slotBookings, activeSubscriptions] = await Promise.all([
                _database.default.booking.findMany({
                    where: {
                        fieldId: fieldId1,
                        date: bookingDate,
                        status: {
                            notIn: [
                                'CANCELLED'
                            ]
                        }
                    },
                    select: {
                        id: true,
                        startTime: true,
                        endTime: true,
                        timeSlot: true,
                        userId: true
                    }
                }),
                _database.default.subscription.findMany({
                    where: {
                        fieldId: fieldId1,
                        status: 'active',
                        cancelAtPeriodEnd: false
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
                })
            ]);
            // Pre-compute recurring subscription date matching
            const requestedDate = new Date(bookingDate);
            requestedDate.setHours(0, 0, 0, 0);
            const requestedDayOfWeek = requestedDate.getDay();
            const requestedDayOfMonth = requestedDate.getDate();
            const dayNames = [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday'
            ];
            const requestedDayName = dayNames[requestedDayOfWeek];
            for (const slot of normalizedTimeSlots){
                const [slotStart, displaySlotEnd] = slot.split(' - ').map((t)=>t.trim());
                const startMinutes = parseTimeToMinutesLocal(slotStart);
                const actualEndMinutes = startMinutes + actualDurationMinutes;
                const actualSlotEnd = minutesToTimeStrLocal(actualEndMinutes);
                // Check for time overlap with existing bookings (in-memory)
                for (const booking of slotBookings){
                    const bookingStart = parseTimeToMinutesLocal(booking.startTime);
                    const bookingEnd = parseTimeToMinutesLocal(booking.endTime);
                    const requestedStart = startMinutes;
                    const requestedEnd = actualEndMinutes;
                    // Check if times overlap
                    const hasOverlap = requestedStart >= bookingStart && requestedStart < bookingEnd || requestedEnd > bookingStart && requestedEnd <= bookingEnd || requestedStart <= bookingStart && requestedEnd >= bookingEnd;
                    if (hasOverlap) {
                        console.log('[PaymentController] Slot conflict detected:', {
                            requestedSlot: slot,
                            conflictingBookingId: booking.id,
                            conflictingSlot: booking.timeSlot
                        });
                        return res.status(409).json({
                            error: 'One or more selected time slots are no longer available',
                            code: 'SLOT_UNAVAILABLE',
                            unavailableSlot: slot,
                            message: `The slot ${slot} has already been booked. Please refresh and select a different time.`
                        });
                    }
                }
                // Check for recurring subscription conflicts (in-memory)
                for (const subscription of activeSubscriptions){
                    let isDateMatch = false;
                    if (subscription.interval === 'everyday') {
                        isDateMatch = true;
                    } else if (subscription.interval === 'weekly') {
                        isDateMatch = subscription.dayOfWeek === requestedDayName;
                    } else if (subscription.interval === 'monthly') {
                        isDateMatch = subscription.dayOfMonth === requestedDayOfMonth;
                    }
                    if (isDateMatch) {
                        const subStart = parseTimeToMinutesLocal(subscription.startTime);
                        const subEnd = parseTimeToMinutesLocal(subscription.endTime);
                        const hasTimeOverlap = startMinutes >= subStart && startMinutes < subEnd || actualEndMinutes > subStart && actualEndMinutes <= subEnd || startMinutes <= subStart && actualEndMinutes >= subEnd;
                        if (hasTimeOverlap) {
                            const reason = `This time slot is reserved by a ${subscription.interval} recurring booking (${subscription.timeSlot})`;
                            console.log('[PaymentController] Recurring subscription conflict detected:', {
                                requestedSlot: slot,
                                reason
                            });
                            return res.status(409).json({
                                error: reason,
                                code: 'RECURRING_SLOT_CONFLICT',
                                unavailableSlot: slot,
                                message: reason
                            });
                        }
                    }
                }
            }
            console.log('[PaymentController] Slot availability check passed for all slots:', normalizedTimeSlots);
            // ============================================================
            // ============================================================
            // SLOT LOCKING - Prevent race conditions with concurrent bookings
            // Acquire exclusive locks on slots BEFORE creating payment intent
            // ============================================================
            const LOCK_EXPIRY_MINUTES = 10; // Lock expires after 10 minutes
            const lockExpiresAt = new Date(Date.now() + LOCK_EXPIRY_MINUTES * 60 * 1000);
            const acquiredLocks = [];
            let slotLockingEnabled = true;
            // Check if slotLock model is available (might not be on production yet)
            if (!_database.default.slotLock) {
                console.warn('[PaymentController] SlotLock model not available - skipping slot locking');
                slotLockingEnabled = false;
            }
            if (slotLockingEnabled) {
                try {
                    // First, clean up any expired locks for these slots
                    await _database.default.slotLock.deleteMany({
                        where: {
                            fieldId: fieldId1,
                            date: bookingDate,
                            expiresAt: {
                                lt: new Date()
                            }
                        }
                    });
                    // Try to acquire locks for all slots
                    for (const slot of normalizedTimeSlots){
                        const [slotStart, displaySlotEnd] = slot.split(' - ').map((t)=>t.trim());
                        const startMinutes = parseTimeToMinutesLocal(slotStart);
                        const actualEndMinutes = startMinutes + actualDurationMinutes;
                        const actualSlotEnd = minutesToTimeStrLocal(actualEndMinutes);
                        try {
                            // Try to create a lock - the unique constraint on (fieldId, date, startTime)
                            // will cause this to fail if another user already has a lock
                            await _database.default.slotLock.create({
                                data: {
                                    fieldId: fieldId1,
                                    date: bookingDate,
                                    startTime: slotStart,
                                    endTime: actualSlotEnd,
                                    userId,
                                    expiresAt: lockExpiresAt
                                }
                            });
                            acquiredLocks.push(slotStart);
                            console.log(`[PaymentController] Acquired lock for slot ${slot}`);
                        } catch (lockError) {
                            // Check if this is a unique constraint violation (slot already locked)
                            if (lockError.code === 'P2002') {
                                // Check if the existing lock belongs to another user
                                const existingLock = await _database.default.slotLock.findFirst({
                                    where: {
                                        fieldId: fieldId1,
                                        date: bookingDate,
                                        startTime: slotStart,
                                        expiresAt: {
                                            gt: new Date()
                                        } // Only consider non-expired locks
                                    }
                                });
                                if (existingLock && existingLock.userId !== userId) {
                                    // Another user has the lock - log warning but allow to proceed
                                    // The transaction-level check will catch actual conflicts
                                    console.log(`[PaymentController] Slot ${slot} is locked by another user, but allowing to proceed (transaction will catch conflicts)`);
                                // Don't add to acquiredLocks since we don't own this lock
                                // Continue without blocking - let the booking transaction handle conflicts
                                } else if (existingLock && existingLock.userId === userId) {
                                    // Same user already has the lock (retry attempt) - that's fine
                                    acquiredLocks.push(slotStart);
                                    console.log(`[PaymentController] Reusing existing lock for slot ${slot}`);
                                } else {
                                    // Lock exists but is expired - try to delete and recreate
                                    await _database.default.slotLock.deleteMany({
                                        where: {
                                            fieldId: fieldId1,
                                            date: bookingDate,
                                            startTime: slotStart
                                        }
                                    });
                                    // Try again to create the lock
                                    await _database.default.slotLock.create({
                                        data: {
                                            fieldId: fieldId1,
                                            date: bookingDate,
                                            startTime: slotStart,
                                            endTime: actualSlotEnd,
                                            userId,
                                            expiresAt: lockExpiresAt
                                        }
                                    });
                                    acquiredLocks.push(slotStart);
                                    console.log(`[PaymentController] Acquired lock after cleanup for slot ${slot}`);
                                }
                            } else {
                                // Some other error - rethrow
                                throw lockError;
                            }
                        }
                    }
                    console.log('[PaymentController] All slot locks acquired successfully:', acquiredLocks);
                } catch (lockError) {
                    // Failed to acquire locks - clean up any we got
                    if (acquiredLocks.length > 0) {
                        await _database.default.slotLock.deleteMany({
                            where: {
                                fieldId: fieldId1,
                                date: bookingDate,
                                startTime: {
                                    in: acquiredLocks
                                },
                                userId
                            }
                        });
                    }
                    console.error('[PaymentController] Failed to acquire slot locks:', lockError);
                    throw lockError;
                }
            } // End of slotLockingEnabled check
            // ============================================================
            // Create idempotency key to prevent duplicate bookings
            // Use a deterministic key based on the booking parameters (NOT random!)
            // This ensures that retry attempts for the same booking use the same key
            const crypto = require('crypto');
            const timeSlotsKey = normalizedTimeSlots.sort().join('_');
            const repeatBookingKey = repeatBooking || 'none';
            // Create a hash of the booking parameters for idempotency
            const idempotencyBase = `${userId}_${fieldId1}_${date}_${timeSlotsKey}_${repeatBookingKey}_${numberOfDogs}_${Date.now()}`;
            const idempotencyKey = `booking_${crypto.createHash('sha256').update(idempotencyBase).digest('hex').substring(0, 32)}`;
            // Check if bookings already exist for any of the selected time slots
            const existingBookings = await _database.default.booking.findMany({
                where: {
                    userId,
                    fieldId: fieldId1,
                    date: new Date(date),
                    timeSlot: {
                        in: normalizedTimeSlots
                    },
                    status: {
                        notIn: [
                            'CANCELLED'
                        ]
                    }
                }
            });
            if (existingBookings.length > 0) {
                const existingSlots = existingBookings.map((b)=>b.timeSlot);
                console.log('Duplicate booking attempt detected:', {
                    userId,
                    fieldId: fieldId1,
                    date,
                    existingSlots,
                    existingBookingIds: existingBookings.map((b)=>b.id),
                    existingStatuses: existingBookings.map((b)=>({
                            status: b.status,
                            paymentStatus: b.paymentStatus
                        }))
                });
                // Check if all existing bookings are already paid
                const allPaid = existingBookings.every((b)=>b.paymentStatus === 'PAID' && b.status === 'CONFIRMED');
                const anyPending = existingBookings.some((b)=>b.paymentStatus === 'PENDING');
                // Check if booking was created very recently (within last 30 seconds) - likely a duplicate request
                const recentlyCreated = existingBookings.some((b)=>{
                    const createdAt = new Date(b.createdAt);
                    const now = new Date();
                    return now.getTime() - createdAt.getTime() < 30000; // 30 seconds
                });
                if (allPaid && existingBookings.length === normalizedTimeSlots.length) {
                    // All slots are already booked and confirmed
                    return res.status(200).json({
                        paymentSucceeded: true,
                        bookingId: existingBookings[0].id,
                        bookingIds: existingBookings.map((b)=>b.id),
                        message: 'Booking already exists and is confirmed',
                        isDuplicate: true
                    });
                } else if (anyPending || recentlyCreated) {
                    // Either pending payment or just created - prevent duplicate
                    return res.status(200).json({
                        paymentSucceeded: false,
                        bookingId: existingBookings[0].id,
                        bookingIds: existingBookings.map((b)=>b.id),
                        message: 'A booking for one or more slots is already being processed',
                        isDuplicate: true,
                        isPending: true
                    });
                } else {
                    // Existing bookings that aren't paid and weren't recently created - still prevent duplicates
                    // These are likely failed or incomplete bookings
                    console.log('Found existing non-paid bookings, preventing duplicate creation');
                    return res.status(400).json({
                        error: 'A booking already exists for one or more of these time slots. Please refresh and try again.',
                        existingSlots,
                        isDuplicate: true
                    });
                }
            }
            if (!user) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }
            // Calculate amount in cents (Stripe uses smallest currency unit)
            const amountInCents = Math.round(amount * 100);
            // Calculate platform commission dynamically using commission utils
            const { fieldOwnerAmount, platformCommission, commissionRate, isCustomCommission, defaultCommissionRate } = await (0, _commissionutils.calculatePayoutAmounts)(amount, field.ownerId || '');
            // Prepare payment intent parameters
            // Payment goes to platform account (admin) first
            // ============================================================
            // CREATE ONE PAYMENT INTENT PER SLOT
            // Each slot gets its own PaymentIntent so refunds are isolated
            // ============================================================
            const pricePerSlot = amount / normalizedTimeSlots.length;
            const pricePerSlotCents = Math.round(pricePerSlot * 100);
            const platformCommissionPerSlot = platformCommission / normalizedTimeSlots.length;
            const fieldOwnerAmountPerSlot = fieldOwnerAmount / normalizedTimeSlots.length;
            const basePaymentIntentParams = {
                currency: 'gbp',
                receipt_email: req.user?.email
            };
            // If a payment method is provided, use it
            if (paymentMethodId) {
                // Verify the payment method belongs to this user
                const paymentMethod = await _database.default.paymentMethod.findFirst({
                    where: {
                        id: paymentMethodId,
                        userId: userId
                    }
                });
                if (!paymentMethod) {
                    return res.status(400).json({
                        error: 'Invalid payment method'
                    });
                }
                // Ensure user has a valid Stripe customer ID
                let customerId = user.stripeCustomerId;
                // Verify customer exists in Stripe
                if (customerId) {
                    try {
                        const customer = await _stripeconfig.stripe.customers.retrieve(customerId);
                        if (customer.deleted) {
                            console.log(`Stripe customer ${customerId} was deleted, creating new one`);
                            customerId = null; // Force recreation
                        }
                    } catch (error) {
                        if (error.statusCode === 404 || error.code === 'resource_missing') {
                            console.log(`Stripe customer ${customerId} not found, creating new one`);
                            customerId = null; // Force recreation
                        } else {
                            throw error; // Re-throw other errors
                        }
                    }
                }
                // Create customer if doesn't exist or was invalid
                if (!customerId) {
                    const customer = await _stripeconfig.stripe.customers.create({
                        email: user.email,
                        name: user.name || undefined,
                        metadata: {
                            userId: user.id
                        }
                    });
                    customerId = customer.id;
                    // Save customer ID
                    await _database.default.user.update({
                        where: {
                            id: userId
                        },
                        data: {
                            stripeCustomerId: customerId
                        }
                    });
                }
                try {
                    // Verify the payment method still exists in Stripe
                    const stripePaymentMethod = await _stripeconfig.stripe.paymentMethods.retrieve(paymentMethod.stripePaymentMethodId);
                    // Check if payment method is attached to the customer
                    if (stripePaymentMethod.customer !== customerId) {
                        // Attach payment method to customer if not already attached
                        await _stripeconfig.stripe.paymentMethods.attach(paymentMethod.stripePaymentMethodId, {
                            customer: customerId
                        });
                    }
                } catch (stripeError) {
                    console.error('Stripe payment method error:', stripeError);
                    // Payment method doesn't exist or is invalid
                    if (stripeError.code === 'resource_missing' || stripeError.statusCode === 404) {
                        // Remove invalid payment method from database
                        await _database.default.paymentMethod.delete({
                            where: {
                                id: paymentMethodId
                            }
                        });
                        return res.status(400).json({
                            error: 'Payment method no longer valid. Please add a new payment method.',
                            code: 'PAYMENT_METHOD_EXPIRED'
                        });
                    }
                    // Other Stripe errors
                    return res.status(400).json({
                        error: 'Unable to process payment method. Please try again or use a different payment method.',
                        code: 'PAYMENT_METHOD_ERROR'
                    });
                }
                basePaymentIntentParams.customer = customerId;
                basePaymentIntentParams.payment_method = paymentMethod.stripePaymentMethodId;
                basePaymentIntentParams.confirm = true;
                basePaymentIntentParams.return_url = `${_constants.FRONTEND_URL}/user/my-bookings`;
                basePaymentIntentParams.automatic_payment_methods = {
                    enabled: true,
                    allow_redirects: 'always'
                };
            } else {
                basePaymentIntentParams.automatic_payment_methods = {
                    enabled: true
                };
            }
            // Create one PaymentIntent per slot
            const paymentIntents = [];
            try {
                for(let i = 0; i < normalizedTimeSlots.length; i++){
                    const slot = normalizedTimeSlots[i];
                    const slotIdempotencyKey = `${idempotencyKey}_slot_${i}`;
                    const slotPaymentIntent = await _stripeconfig.stripe.paymentIntents.create({
                        ...basePaymentIntentParams,
                        amount: pricePerSlotCents,
                        metadata: {
                            userId,
                            fieldId: fieldId1,
                            fieldOwnerId: field.ownerId || '',
                            numberOfDogs: numberOfDogs.toString(),
                            date,
                            timeSlot: slot,
                            slotIndex: i.toString(),
                            totalSlots: normalizedTimeSlots.length.toString(),
                            repeatBooking: repeatBooking || 'none',
                            duration: duration || '60min',
                            type: 'field_booking',
                            platformCommission: platformCommissionPerSlot.toString(),
                            fieldOwnerAmount: fieldOwnerAmountPerSlot.toString(),
                            commissionRate: commissionRate.toString(),
                            isCustomCommission: isCustomCommission.toString(),
                            defaultCommissionRate: defaultCommissionRate.toString()
                        },
                        description: `Booking for ${field.name} on ${date} - ${slot}`
                    }, {
                        idempotencyKey: slotIdempotencyKey
                    });
                    paymentIntents.push(slotPaymentIntent);
                }
            } catch (stripeError) {
                console.error('Error creating payment intent:', stripeError);
                // Rollback: cancel any already-created payment intents
                for (const pi of paymentIntents){
                    try {
                        await _stripeconfig.stripe.paymentIntents.cancel(pi.id);
                    } catch (e) {}
                }
                if (stripeError.type === 'StripeInvalidRequestError') {
                    if (stripeError.message.includes('No such PaymentMethod')) {
                        return res.status(400).json({
                            error: 'Payment method not found. Please select a different payment method.',
                            code: 'PAYMENT_METHOD_NOT_FOUND'
                        });
                    }
                    if (stripeError.message.includes('Payment method not available')) {
                        return res.status(400).json({
                            error: 'This payment method is not available. Please try a different payment method.',
                            code: 'PAYMENT_METHOD_UNAVAILABLE'
                        });
                    }
                }
                return res.status(500).json({
                    error: 'Unable to process payment. Please try again.',
                    code: 'PAYMENT_PROCESSING_ERROR',
                    details: process.env.NODE_ENV === 'development' ? stripeError.message : undefined
                });
            }
            // Parse the first time slot to extract start and end times for subscription
            // Expected format: "4:00PM - 4:55PM" (display time with 5-min buffer)
            const firstTimeSlot = normalizedTimeSlots[0];
            const [startTimeStr, displayEndTimeStr] = firstTimeSlot.split(' - ').map((t)=>t.trim());
            // Helper function to parse time string to minutes (for subscription end time calculation)
            const parseTimeForSubscription = (timeStr)=>{
                const match = timeStr.match(/(\d+):(\d+)(AM|PM)/i);
                if (!match) return 0;
                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const period = match[3].toUpperCase();
                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;
                return hours * 60 + minutes;
            };
            // Helper function to convert minutes to time string (for subscription end time calculation)
            const minutesToTimeForSubscription = (totalMinutes)=>{
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const period = hours >= 12 ? 'PM' : 'AM';
                const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
            };
            // Calculate actual end time for subscription (full duration, not display time)
            const subscriptionDurationMinutes = duration === '30min' ? 30 : 60;
            const subscriptionStartMinutes = parseTimeForSubscription(startTimeStr);
            const subscriptionActualEndMinutes = subscriptionStartMinutes + subscriptionDurationMinutes;
            const endTimeStr = minutesToTimeForSubscription(subscriptionActualEndMinutes);
            // Determine booking status from the first payment intent (all share the same card/status)
            const primaryPaymentIntent = paymentIntents[0];
            const allSucceeded = paymentIntents.every((pi)=>pi.status === 'succeeded');
            const anyRequiresAction = paymentIntents.some((pi)=>pi.status === 'requires_action');
            const bookingStatus = allSucceeded ? 'CONFIRMED' : 'PENDING';
            const paymentStatus = allSucceeded ? 'PAID' : 'PENDING';
            // Check if field owner has a connected Stripe account
            const fieldOwnerStripeAccount = await _database.default.stripeAccount.findUnique({
                where: {
                    userId: field.ownerId
                }
            });
            // Get system settings for payout release schedule
            const systemSettings = await (0, _settingscache.getSystemSettings)();
            const payoutReleaseSchedule = systemSettings?.payoutReleaseSchedule || 'after_cancellation_window';
            // Determine payout status based on Stripe account connection and release schedule
            let payoutStatus = 'PENDING';
            let payoutHeldReason = undefined;
            if (primaryPaymentIntent.status === 'succeeded') {
                if (!fieldOwnerStripeAccount || !fieldOwnerStripeAccount.chargesEnabled || !fieldOwnerStripeAccount.payoutsEnabled) {
                    // Hold the payout if field owner doesn't have a connected Stripe account
                    payoutStatus = 'HELD';
                    payoutHeldReason = 'NO_STRIPE_ACCOUNT';
                } else if (payoutReleaseSchedule === 'on_weekend') {
                    // Check if today is weekend
                    const today = new Date().getDay();
                    if (today === 5 || today === 6 || today === 0) {
                        payoutStatus = 'PENDING';
                    } else {
                        payoutStatus = 'HELD';
                        payoutHeldReason = 'WAITING_FOR_WEEKEND';
                    }
                } else {
                    payoutStatus = 'HELD';
                    payoutHeldReason = 'WITHIN_CANCELLATION_WINDOW';
                }
            }
            // Get field owner details for snapshot
            const fieldOwner = await _database.default.user.findUnique({
                where: {
                    id: field.ownerId
                },
                select: {
                    name: true,
                    email: true
                }
            });
            // Check if this is a recurring booking - subscriptions will be created per-slot inside the booking loop
            const recurringOptions = [
                'everyday',
                'weekly',
                'monthly'
            ];
            const normalizedRepeatBooking = repeatBooking?.toLowerCase();
            const isRecurringBooking = repeatBooking && recurringOptions.includes(normalizedRepeatBooking);
            console.log('🔍 REPEAT BOOKING CHECK:', {
                repeatBooking,
                normalizedRepeatBooking,
                isRecurring: isRecurringBooking,
                recurringOptions
            });
            // For recurring bookings, check for conflicts with existing bookings on future recurring dates
            // Instead of blocking, we'll store the conflicts and skip those dates automatically
            let skippedDates = [];
            if (isRecurringBooking) {
                const bookingDate = new Date(date);
                const conflictCheck = await _bookingmodel.default.checkRecurringSubscriptionConflicts(fieldId1, bookingDate, startTimeStr, endTimeStr, normalizedRepeatBooking);
                if (conflictCheck.hasConflict) {
                    // Store conflicts as skipped dates - these will be automatically skipped by subscription service
                    skippedDates = conflictCheck.conflictingDates.map((c)=>({
                            date: c.date.toISOString(),
                            formattedDate: c.date.toLocaleDateString('en-GB', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                timeZone: 'Europe/London'
                            }),
                            bookedBy: c.existingBooking.user?.name || 'Another user'
                        }));
                    console.log(`📅 Recurring booking will skip ${skippedDates.length} conflicting dates:`, skippedDates.map((s)=>s.formattedDate).join(', '));
                }
            }
            // Create a booking for each selected time slot
            // Per-slot amounts already calculated above (pricePerSlot, platformCommissionPerSlot, fieldOwnerAmountPerSlot)
            // Helper function to parse time string to minutes
            const parseTimeToMinutes = (timeStr)=>{
                const match = timeStr.match(/(\d+):(\d+)(AM|PM)/i);
                if (!match) return 0;
                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const period = match[3].toUpperCase();
                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;
                return hours * 60 + minutes;
            };
            // Helper function to convert minutes back to time string
            const minutesToTimeStr = (totalMinutes)=>{
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const period = hours >= 12 ? 'PM' : 'AM';
                const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
                return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
            };
            // Determine actual slot duration in minutes (30 or 60)
            const slotDuration = duration === '30min' ? 30 : 60;
            // ============================================================
            // ATOMIC BOOKING CREATION WITH TRANSACTION
            // Re-check availability inside transaction to prevent race conditions
            // ============================================================
            let bookings;
            try {
                bookings = await _database.default.$transaction(async (tx)=>{
                    // Re-check availability inside transaction for each slot
                    for (const slot of normalizedTimeSlots){
                        const [slotStart] = slot.split(' - ').map((t)=>t.trim());
                        const startMinutes = parseTimeToMinutes(slotStart);
                        const actualEndMinutes = startMinutes + slotDuration;
                        const actualSlotEnd = minutesToTimeStr(actualEndMinutes);
                        // Check for conflicting bookings within transaction
                        const conflictingBookings = await tx.booking.findMany({
                            where: {
                                fieldId: fieldId1,
                                date: new Date(date),
                                status: {
                                    notIn: [
                                        'CANCELLED'
                                    ]
                                }
                            },
                            select: {
                                id: true,
                                startTime: true,
                                endTime: true,
                                timeSlot: true
                            }
                        });
                        // Check for time overlap with existing bookings
                        for (const existingBooking of conflictingBookings){
                            const existingStart = parseTimeToMinutes(existingBooking.startTime);
                            const existingEnd = parseTimeToMinutes(existingBooking.endTime);
                            const hasOverlap = startMinutes >= existingStart && startMinutes < existingEnd || actualEndMinutes > existingStart && actualEndMinutes <= existingEnd || startMinutes <= existingStart && actualEndMinutes >= existingEnd;
                            if (hasOverlap) {
                                throw new Error(`SLOT_CONFLICT:${slot}:${existingBooking.timeSlot}`);
                            }
                        }
                    }
                    // All slots are available, create bookings atomically
                    // For recurring bookings, create a SEPARATE subscription for each slot
                    const createdBookings = [];
                    const bookingDate = new Date(date);
                    const dayOfWeek = bookingDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        timeZone: 'Europe/London'
                    });
                    const dayOfMonth = bookingDate.getDate();
                    for (const slot of normalizedTimeSlots){
                        const [slotStart, displaySlotEnd] = slot.split(' - ').map((t)=>t.trim());
                        const startMinutes = parseTimeToMinutes(slotStart);
                        const actualEndMinutes = startMinutes + slotDuration;
                        const actualSlotEnd = minutesToTimeStr(actualEndMinutes);
                        // Create separate subscription for this slot if it's a recurring booking
                        let slotSubscriptionId = undefined;
                        if (isRecurringBooking) {
                            try {
                                // Calculate next billing date for this slot
                                let nextBillingDate;
                                let currentPeriodEnd;
                                if (normalizedRepeatBooking === 'everyday') {
                                    // Get next valid booking date, skipping days when field doesn't operate
                                    nextBillingDate = getNextValidBookingDate(bookingDate, field.operatingDays);
                                    currentPeriodEnd = new Date(nextBillingDate);
                                } else if (normalizedRepeatBooking === 'weekly') {
                                    nextBillingDate = new Date(bookingDate);
                                    nextBillingDate.setDate(bookingDate.getDate() + 7);
                                    currentPeriodEnd = new Date(nextBillingDate);
                                } else {
                                    // Monthly
                                    const targetMonth = bookingDate.getMonth() + 1;
                                    const targetYear = bookingDate.getFullYear() + (targetMonth > 11 ? 1 : 0);
                                    const normalizedTargetMonth = targetMonth > 11 ? 0 : targetMonth;
                                    const lastDayOfTargetMonth = new Date(targetYear, normalizedTargetMonth + 1, 0).getDate();
                                    const targetDay = Math.min(dayOfMonth, lastDayOfTargetMonth);
                                    nextBillingDate = new Date(targetYear, normalizedTargetMonth, targetDay);
                                    currentPeriodEnd = new Date(nextBillingDate);
                                }
                                // Create or reuse subscription for this specific slot (upsert to avoid unique constraint failures on retry)
                                const subscriptionStripeId = `${paymentIntent.id}_slot_${normalizedTimeSlots.indexOf(slot)}`;
                                const slotSubscription = await tx.subscription.upsert({
                                    where: {
                                        stripeSubscriptionId: subscriptionStripeId
                                    },
                                    create: {
                                        userId,
                                        fieldId: fieldId1,
                                        stripeSubscriptionId: subscriptionStripeId,
                                        stripeCustomerId: user.stripeCustomerId || '',
                                        status: 'active',
                                        interval: normalizedRepeatBooking,
                                        intervalCount: 1,
                                        currentPeriodStart: bookingDate,
                                        currentPeriodEnd: currentPeriodEnd,
                                        timeSlot: slot,
                                        timeSlots: [
                                            slot
                                        ],
                                        dayOfWeek: normalizedRepeatBooking === 'weekly' ? dayOfWeek : null,
                                        dayOfMonth: normalizedRepeatBooking === 'monthly' ? dayOfMonth : null,
                                        startTime: slotStart,
                                        endTime: actualSlotEnd,
                                        numberOfDogs: parseInt(numberOfDogs),
                                        totalPrice: pricePerSlot,
                                        nextBillingDate: nextBillingDate,
                                        lastBookingDate: bookingDate
                                    },
                                    update: {
                                        status: 'active',
                                        currentPeriodStart: bookingDate,
                                        currentPeriodEnd: currentPeriodEnd,
                                        nextBillingDate: nextBillingDate,
                                        lastBookingDate: bookingDate
                                    }
                                });
                                slotSubscriptionId = slotSubscription.id;
                                console.log(`✅ Created subscription for slot ${slot}:`, {
                                    subscriptionId: slotSubscriptionId,
                                    timeSlot: slot,
                                    pricePerSlot,
                                    interval: normalizedRepeatBooking
                                });
                            } catch (subscriptionError) {
                                console.error(`Error creating subscription for slot ${slot}:`, subscriptionError);
                            // Continue with booking creation even if subscription fails
                            }
                        }
                        // Each slot gets its own PaymentIntent
                        const slotPaymentIntent = paymentIntents[normalizedTimeSlots.indexOf(slot)];
                        const newBooking = await tx.booking.create({
                            data: {
                                fieldId: fieldId1,
                                userId,
                                date: new Date(date),
                                startTime: slotStart,
                                endTime: actualSlotEnd,
                                timeSlot: slot,
                                numberOfDogs: parseInt(numberOfDogs),
                                totalPrice: pricePerSlot,
                                platformCommission: platformCommissionPerSlot,
                                fieldOwnerAmount: fieldOwnerAmountPerSlot,
                                bookingId: await _bookingmodel.default.generateBookingId(),
                                status: bookingStatus,
                                paymentStatus: paymentStatus,
                                paymentIntentId: slotPaymentIntent.id,
                                payoutStatus,
                                payoutHeldReason,
                                repeatBooking: normalizedRepeatBooking || repeatBooking || 'none',
                                subscriptionId: slotSubscriptionId,
                                bookingDuration: duration || '60min'
                            }
                        });
                        createdBookings.push(newBooking);
                    }
                    return createdBookings;
                }, {
                    timeout: 10000 // 10 second timeout for the transaction
                });
            } catch (txError) {
                // Handle slot conflict error from transaction
                if (txError.message?.startsWith('SLOT_CONFLICT:')) {
                    const parts = txError.message.split(':');
                    const conflictSlot = parts[1];
                    const existingSlot = parts[2];
                    console.log('[PaymentController] Slot conflict in transaction:', {
                        requestedSlot: conflictSlot,
                        existingSlot
                    });
                    return res.status(409).json({
                        error: 'One or more selected time slots are no longer available',
                        code: 'SLOT_UNAVAILABLE',
                        unavailableSlot: conflictSlot,
                        message: `The slot ${conflictSlot} was just booked by another user. Please refresh and select a different time.`
                    });
                }
                // Re-throw other errors
                throw txError;
            }
            // ============================================================
            // ============================================================
            // RELEASE SLOT LOCKS - Booking was successfully created
            // ============================================================
            if (slotLockingEnabled && _database.default.slotLock) {
                try {
                    await _database.default.slotLock.deleteMany({
                        where: {
                            fieldId: fieldId1,
                            date: bookingDate,
                            userId
                        }
                    });
                    console.log('[PaymentController] Released slot locks after successful booking creation');
                } catch (lockCleanupError) {
                    // Non-critical error - locks will expire anyway
                    console.warn('[PaymentController] Failed to cleanup slot locks:', lockCleanupError);
                }
            }
            // ============================================================
            const booking = bookings[0]; // Primary booking for notifications
            const allBookingIds = bookings.map((b)=>b.id);
            // If payment was auto-confirmed with saved card, create payment + transaction records per booking
            if (allSucceeded) {
                const fieldOwnerStripeAccount = await _database.default.stripeAccount.findFirst({
                    where: {
                        userId: field.ownerId
                    }
                });
                // Create one Payment record and one Transaction record per booking/slot
                for(let i = 0; i < bookings.length; i++){
                    const slotBooking = bookings[i];
                    const slotPI = paymentIntents[i];
                    await _database.default.payment.create({
                        data: {
                            bookingId: slotBooking.id,
                            userId,
                            amount: pricePerSlot,
                            currency: 'GBP',
                            status: 'completed',
                            paymentMethod: 'card',
                            stripePaymentId: slotPI.id,
                            processedAt: new Date()
                        }
                    });
                    const existingTxn = await _database.default.transaction.findFirst({
                        where: {
                            stripePaymentIntentId: slotPI.id
                        }
                    });
                    if (!existingTxn) {
                        await _database.default.transaction.create({
                            data: {
                                bookingId: slotBooking.id,
                                userId,
                                fieldOwnerId: field.ownerId || null,
                                amount: pricePerSlot,
                                netAmount: fieldOwnerAmountPerSlot,
                                platformFee: platformCommissionPerSlot,
                                commissionRate: commissionRate,
                                isCustomCommission: isCustomCommission,
                                defaultCommissionRate: defaultCommissionRate,
                                type: 'PAYMENT',
                                status: 'COMPLETED',
                                stripePaymentIntentId: slotPI.id,
                                connectedAccountId: fieldOwnerStripeAccount?.stripeAccountId || null,
                                lifecycleStage: 'PAYMENT_RECEIVED',
                                paymentReceivedAt: new Date(),
                                description: `Payment for booking at ${field.name} - ${slotBooking.timeSlot || normalizedTimeSlots[i]}`
                            }
                        });
                    }
                }
                console.log(`[PaymentController] Created ${bookings.length} payment + transaction records for ${bookings.length} slots`);
                // Send notifications and emails in background (non-blocking)
                // Payment is already confirmed — don't delay the response
                const slotsDisplay = normalizedTimeSlots.length === 1 ? normalizedTimeSlots[0] : `${normalizedTimeSlots.length} time slots`;
                // Fire and forget — notifications and emails happen asynchronously
                // Each step is independent so one failure doesn't block the others
                (async ()=>{
                    // 1. In-app notifications (independent of emails)
                    try {
                        await (0, _notificationcontroller.createNotification)({
                            userId,
                            type: 'BOOKING_CONFIRMATION',
                            title: 'Booking Confirmed',
                            message: `Your booking for ${field.name} on ${date} (${slotsDisplay}) has been confirmed.`,
                            data: {
                                bookingId: booking.id,
                                bookingIds: allBookingIds,
                                fieldId: fieldId1
                            }
                        });
                    } catch (err) {
                        console.error('[Payment] Failed to send dog owner notification:', err);
                    }
                    try {
                        if (field.ownerId && field.ownerId !== userId) {
                            await (0, _notificationcontroller.createNotification)({
                                userId: field.ownerId,
                                type: 'NEW_BOOKING',
                                title: 'New Booking',
                                message: `You have a new booking for ${field.name} on ${date} (${slotsDisplay}).`,
                                data: {
                                    bookingId: booking.id,
                                    bookingIds: allBookingIds,
                                    fieldId: fieldId1
                                }
                            });
                        }
                    } catch (err) {
                        console.error('[Payment] Failed to send field owner notification:', err);
                    }
                    // 2. Email notifications (independent of in-app notifications)
                    try {
                        const fieldOwner = await _database.default.user.findUnique({
                            where: {
                                id: field.ownerId
                            },
                            select: {
                                name: true,
                                email: true
                            }
                        });
                        if (user.email) {
                            console.log(`[Payment] Sending booking confirmation email to dog owner: ${user.email}`);
                            await _emailservice.emailService.sendBookingConfirmationToDogOwner({
                                email: user.email,
                                userName: user.name || 'Valued Customer',
                                bookingId: booking.bookingId || booking.id,
                                fieldId: field.fieldId || '',
                                fieldName: field.name,
                                fieldAddress: field.address || '',
                                date: new Date(date),
                                startTime: startTimeStr,
                                endTime: endTimeStr,
                                totalPrice: amount,
                                fieldOwnerName: fieldOwner?.name || 'Field Owner',
                                entryCode: field.entryCode || undefined
                            });
                            console.log(`[Payment] Dog owner booking email sent to ${user.email}`);
                        } else {
                            console.log('[Payment] Dog owner has no email, skipping confirmation email');
                        }
                        if (fieldOwner?.email) {
                            console.log(`[Payment] Sending new booking notification email to field owner: ${fieldOwner.email}`);
                            await _emailservice.emailService.sendNewBookingNotificationToFieldOwner({
                                email: fieldOwner.email,
                                ownerName: fieldOwner.name || 'Field Owner',
                                bookingId: booking.bookingId || booking.id,
                                fieldId: field.fieldId || '',
                                fieldName: field.name,
                                date: new Date(date),
                                startTime: startTimeStr,
                                endTime: endTimeStr,
                                totalPrice: amount,
                                fieldOwnerAmount,
                                platformCommission,
                                dogOwnerName: user.name || user.email || 'Customer',
                                entryCode: field.entryCode || undefined
                            });
                            console.log(`[Payment] Field owner booking email sent to ${fieldOwner.email}`);
                        } else {
                            console.log('[Payment] Field owner has no email, skipping notification email');
                        }
                    } catch (emailErr) {
                        console.error('[Payment] Failed to send booking emails:', emailErr);
                    }
                })();
            }
            res.json({
                // Primary client secret (first slot) — for single-slot bookings this is the only one
                clientSecret: primaryPaymentIntent.client_secret,
                // All client secrets — frontend confirms each one for multi-slot bookings
                clientSecrets: paymentIntents.map((pi)=>pi.client_secret),
                paymentIntentIds: paymentIntents.map((pi)=>pi.id),
                bookingId: booking.id,
                bookingIds: allBookingIds,
                slotsCount: normalizedTimeSlots.length,
                paymentSucceeded: allSucceeded,
                requiresAction: anyRequiresAction,
                publishableKey: process.env.STRIPE_PRODUCTION_MODE === 'true' ? process.env.STRIPE_LIVE_PUBLISHABLE_KEY : process.env.STRIPE_TEST_PUBLISHABLE_KEY,
                // Include skipped dates for recurring bookings (these dates will be automatically skipped)
                ...skippedDates.length > 0 && {
                    skippedDates,
                    skippedDatesWarning: `Note: ${skippedDates.length} future date(s) will be skipped due to existing bookings: ${skippedDates.slice(0, 3).map((s)=>s.formattedDate).join(', ')}${skippedDates.length > 3 ? ` and ${skippedDates.length - 3} more` : ''}`
                }
            });
        } catch (error) {
            console.error('Error creating payment intent:', error);
            // Try to release any slot locks on error (only if slotLock model exists)
            // Use the outer `fieldId` (already resolved to MongoDB ObjectID) instead of re-reading raw req.body
            if (_database.default.slotLock) {
                try {
                    const userId = req.user?.id;
                    const { date } = req.body;
                    if (userId && fieldId && date) {
                        const bookingDate = new Date(date);
                        bookingDate.setHours(0, 0, 0, 0);
                        await _database.default.slotLock.deleteMany({
                            where: {
                                fieldId,
                                date: bookingDate,
                                userId
                            }
                        });
                        console.log('[PaymentController] Released slot locks on error');
                    }
                } catch (lockCleanupError) {
                    // Non-critical - locks will expire anyway
                    console.warn('[PaymentController] Failed to cleanup locks on error:', lockCleanupError);
                }
            }
            res.status(500).json({
                error: 'Failed to create payment intent',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // Confirm payment and update booking status
    async confirmPayment(req, res) {
        try {
            const { paymentIntentId, bookingId } = req.body;
            // Retrieve the payment intent from Stripe
            const paymentIntent1 = await _stripeconfig.stripe.paymentIntents.retrieve(paymentIntentId);
            if (paymentIntent1.status === 'succeeded') {
                // Update booking status
                const booking = await _database.default.booking.update({
                    where: {
                        id: bookingId
                    },
                    data: {
                        status: 'CONFIRMED',
                        paymentStatus: 'PAID'
                    },
                    include: {
                        field: true,
                        user: true
                    }
                });
                // Get field owner details first
                const field = await _database.default.field.findUnique({
                    where: {
                        id: booking.fieldId
                    },
                    include: {
                        owner: true
                    }
                });
                // Calculate commission amounts
                const { fieldOwnerAmount, platformFeeAmount, commissionRate, isCustomCommission, defaultCommissionRate } = await (0, _commissionutils.calculatePayoutAmounts)(booking.totalPrice, field?.ownerId || '');
                // Create transaction record with commission details and lifecycle tracking
                await _database.default.transaction.create({
                    data: {
                        bookingId: booking.id,
                        userId: booking.userId,
                        fieldOwnerId: field?.ownerId || null,
                        amount: booking.totalPrice,
                        netAmount: fieldOwnerAmount,
                        platformFee: platformFeeAmount,
                        commissionRate: commissionRate,
                        isCustomCommission: isCustomCommission,
                        defaultCommissionRate: defaultCommissionRate,
                        type: 'PAYMENT',
                        status: 'COMPLETED',
                        stripePaymentIntentId: paymentIntentId,
                        // Lifecycle tracking
                        lifecycleStage: 'PAYMENT_RECEIVED',
                        paymentReceivedAt: new Date(),
                        description: `Payment for booking at ${field?.name || 'field'}`
                    }
                });
                // Send response immediately — don't wait for notifications
                res.json({
                    success: true,
                    booking,
                    message: 'Payment confirmed successfully'
                });
                // Send notifications and emails in background (non-blocking, after response)
                (async ()=>{
                    // 1. In-app notifications
                    try {
                        if (field?.ownerId && field.ownerId !== booking.userId) {
                            const bookingDateLabel = new Date(booking.date).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                timeZone: 'Europe/London'
                            });
                            const bookingTimeLabel = `${booking.startTime} - ${booking.endTime}`;
                            const customerName = booking.user.name || booking.user.email || 'A dog owner';
                            const amountDisplay = typeof booking.totalPrice === 'number' ? booking.totalPrice.toFixed(2) : booking.totalPrice;
                            await _notificationservice.NotificationService.createNotification({
                                userId: field.ownerId,
                                type: 'booking_received',
                                title: 'New Booking Received!',
                                message: `You have a new booking for ${field.name} on ${new Date(booking.date).toLocaleDateString('en-GB', {
                                    timeZone: 'Europe/London'
                                })} at ${booking.startTime}`,
                                adminTitle: 'New booking scheduled',
                                adminMessage: `${customerName} booked "${field.name}" for ${bookingDateLabel} at ${bookingTimeLabel}. Total £${amountDisplay}.`,
                                data: {
                                    bookingId: booking.id,
                                    fieldId: booking.fieldId,
                                    fieldName: field.name,
                                    date: booking.date,
                                    time: `${booking.startTime} - ${booking.endTime}`,
                                    customerName: booking.user.name || booking.user.email,
                                    numberOfDogs: booking.numberOfDogs,
                                    amount: booking.totalPrice
                                }
                            }, true);
                        }
                    } catch (err) {
                        console.error('[ConfirmPayment] Failed to send field owner notification:', err);
                    }
                    try {
                        await (0, _notificationcontroller.createNotification)({
                            userId: booking.userId,
                            type: 'booking_confirmed',
                            title: 'Booking Confirmed!',
                            message: `Your booking for ${field?.name || 'the field'} on ${new Date(booking.date).toLocaleDateString('en-GB', {
                                timeZone: 'Europe/London'
                            })} at ${booking.startTime} has been confirmed.`,
                            data: {
                                bookingId: booking.id,
                                fieldId: booking.fieldId,
                                fieldName: field?.name,
                                date: booking.date,
                                time: `${booking.startTime} - ${booking.endTime}`,
                                amount: booking.totalPrice,
                                paymentIntentId
                            }
                        });
                    } catch (err) {
                        console.error('[ConfirmPayment] Failed to send dog owner notification:', err);
                    }
                    // 2. Email notifications
                    try {
                        if (booking.user?.email) {
                            console.log(`[ConfirmPayment] Sending booking confirmation email to dog owner: ${booking.user.email}`);
                            await _emailservice.emailService.sendBookingConfirmationToDogOwner({
                                email: booking.user.email,
                                userName: booking.user.name || 'Valued Customer',
                                bookingId: booking.bookingId || booking.id,
                                fieldId: field?.fieldId || '',
                                fieldName: field?.name || 'Field',
                                fieldAddress: field?.address || '',
                                date: new Date(booking.date),
                                startTime: booking.startTime,
                                endTime: booking.endTime,
                                totalPrice: booking.totalPrice,
                                fieldOwnerName: field?.owner?.name || 'Field Owner',
                                entryCode: field?.entryCode || undefined
                            });
                            console.log(`[ConfirmPayment] Dog owner booking email sent to ${booking.user.email}`);
                        } else {
                            console.log('[ConfirmPayment] Dog owner has no email, skipping confirmation email');
                        }
                        if (field?.owner?.email) {
                            console.log(`[ConfirmPayment] Sending new booking notification email to field owner: ${field.owner.email}`);
                            const { fieldOwnerAmount: foAmount, platformFeeAmount: pfAmount } = await (0, _commissionutils.calculatePayoutAmounts)(booking.totalPrice, field.ownerId || '');
                            await _emailservice.emailService.sendNewBookingNotificationToFieldOwner({
                                email: field.owner.email,
                                ownerName: field.owner.name || 'Field Owner',
                                bookingId: booking.bookingId || booking.id,
                                fieldId: field?.fieldId || '',
                                fieldName: field.name,
                                date: new Date(booking.date),
                                startTime: booking.startTime,
                                endTime: booking.endTime,
                                totalPrice: booking.totalPrice,
                                fieldOwnerAmount: foAmount,
                                platformCommission: pfAmount,
                                dogOwnerName: booking.user?.name || booking.user?.email || 'Customer',
                                entryCode: field?.entryCode || undefined
                            });
                            console.log(`[ConfirmPayment] Field owner booking email sent to ${field.owner.email}`);
                        } else {
                            console.log('[ConfirmPayment] Field owner has no email, skipping notification email');
                        }
                    } catch (emailErr) {
                        console.error('[ConfirmPayment] Failed to send booking emails:', emailErr);
                    }
                })();
            } else {
                res.status(400).json({
                    error: 'Payment not successful',
                    status: paymentIntent1.status
                });
            }
        } catch (error) {
            console.error('Error confirming payment:', error);
            res.status(500).json({
                error: 'Failed to confirm payment',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // Handle Stripe webhooks
    async handleWebhook(req, res) {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = _stripeconfig.STRIPE_PAYMENT_WEBHOOK_SECRET;
        const connectWebhookSecret = _stripeconfig.STRIPE_CONNECT_WEBHOOK_SECRET;
        if (!webhookSecret && !connectWebhookSecret) {
            console.error('Stripe webhook secret not configured');
            return res.status(500).json({
                error: 'Webhook secret not configured'
            });
        }
        let event;
        // Try to verify with the main webhook secret first, then try connect webhook secret
        // This handles both direct account events and connected account events
        try {
            // First, try the main webhook secret
            if (webhookSecret) {
                try {
                    event = _stripeconfig.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
                } catch (err) {
                    // If main secret fails and we have a connect secret, try that
                    if (connectWebhookSecret) {
                        event = _stripeconfig.stripe.webhooks.constructEvent(req.body, sig, connectWebhookSecret);
                    } else {
                        throw err;
                    }
                }
            } else if (connectWebhookSecret) {
                event = _stripeconfig.stripe.webhooks.constructEvent(req.body, sig, connectWebhookSecret);
            } else {
                throw new Error('No webhook secret configured');
            }
        } catch (err) {
            console.error('Webhook signature verification failed:', err);
            return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        // Log connected account events for debugging
        const connectedAccountId = event.account;
        if (connectedAccountId) {
            console.log(`[Webhook] Received event ${event.type} from connected account: ${connectedAccountId}`);
        }
        // Handle the event
        try {
            switch(event.type){
                case 'payment_intent.succeeded':
                    const paymentIntent1 = event.data.object;
                    // Use transaction to prevent duplicate booking updates
                    await _database.default.$transaction(async (tx)=>{
                        // Check if booking exists
                        const booking = await tx.booking.findFirst({
                            where: {
                                paymentIntentId: paymentIntent1.id
                            }
                        });
                        if (!booking) {
                            // If no booking exists with this payment intent ID, check metadata
                            // This handles edge cases where webhook arrives before booking creation
                            const metadata = paymentIntent1.metadata;
                            if (metadata.userId && metadata.fieldId && metadata.date && metadata.timeSlot) {
                                // Check if a booking already exists for this exact combination
                                const existingBooking = await tx.booking.findFirst({
                                    where: {
                                        userId: metadata.userId,
                                        fieldId: metadata.fieldId,
                                        date: new Date(metadata.date),
                                        timeSlot: metadata.timeSlot,
                                        status: {
                                            notIn: [
                                                'CANCELLED'
                                            ]
                                        }
                                    }
                                });
                                if (existingBooking) {
                                    console.log('Webhook: Duplicate booking prevented for payment intent:', paymentIntent1.id);
                                    // Update existing booking's payment intent if needed
                                    if (!existingBooking.paymentIntentId) {
                                        await tx.booking.update({
                                            where: {
                                                id: existingBooking.id
                                            },
                                            data: {
                                                paymentIntentId: paymentIntent1.id,
                                                status: 'CONFIRMED',
                                                paymentStatus: 'PAID'
                                            }
                                        });
                                    }
                                    return; // Exit early to prevent duplicate
                                }
                                // Create new booking from webhook if it doesn't exist
                                const [startTimeStr, endTimeStr] = metadata.timeSlot.split(' - ').map((t)=>t.trim());
                                const platformCommission = parseFloat(metadata.platformCommission || '0');
                                const fieldOwnerAmount = parseFloat(metadata.fieldOwnerAmount || '0');
                                const newBooking = await tx.booking.create({
                                    data: {
                                        fieldId: metadata.fieldId,
                                        userId: metadata.userId,
                                        date: new Date(metadata.date),
                                        startTime: startTimeStr,
                                        endTime: endTimeStr,
                                        timeSlot: metadata.timeSlot,
                                        numberOfDogs: parseInt(metadata.numberOfDogs || '1'),
                                        totalPrice: paymentIntent1.amount / 100,
                                        platformCommission,
                                        fieldOwnerAmount,
                                        bookingId: await _bookingmodel.default.generateBookingId(),
                                        status: 'CONFIRMED',
                                        paymentStatus: 'PAID',
                                        paymentIntentId: paymentIntent1.id,
                                        payoutStatus: 'PENDING',
                                        repeatBooking: metadata.repeatBooking || 'none'
                                    }
                                });
                                // Get field owner for commission calculation
                                const field = await tx.field.findUnique({
                                    where: {
                                        id: metadata.fieldId
                                    },
                                    select: {
                                        ownerId: true
                                    }
                                });
                                // Calculate commission amounts
                                const payoutAmounts = await (0, _commissionutils.calculatePayoutAmounts)(paymentIntent1.amount / 100, field?.ownerId || '');
                                // Create transaction record with commission details and lifecycle tracking
                                await tx.transaction.create({
                                    data: {
                                        bookingId: newBooking.id,
                                        userId: metadata.userId,
                                        fieldOwnerId: field?.ownerId || null,
                                        amount: paymentIntent1.amount / 100,
                                        netAmount: payoutAmounts.fieldOwnerAmount,
                                        platformFee: payoutAmounts.platformFeeAmount,
                                        commissionRate: payoutAmounts.commissionRate,
                                        type: 'PAYMENT',
                                        status: 'COMPLETED',
                                        stripePaymentIntentId: paymentIntent1.id,
                                        // Lifecycle tracking
                                        lifecycleStage: 'PAYMENT_RECEIVED',
                                        paymentReceivedAt: new Date(),
                                        description: `Payment for booking (webhook)`
                                    }
                                });
                                console.log('Webhook: Created new booking from payment intent:', newBooking.id);
                            }
                        } else if (booking.status !== 'CONFIRMED' || booking.paymentStatus !== 'PAID') {
                            // Update existing booking status
                            await tx.booking.update({
                                where: {
                                    id: booking.id
                                },
                                data: {
                                    status: 'CONFIRMED',
                                    paymentStatus: 'PAID'
                                }
                            });
                            // Check if transaction already exists
                            const existingTransaction = await tx.transaction.findFirst({
                                where: {
                                    stripePaymentIntentId: paymentIntent1.id
                                }
                            });
                            if (!existingTransaction) {
                                // Get field for commission calculation
                                const field = await tx.field.findUnique({
                                    where: {
                                        id: booking.fieldId
                                    },
                                    select: {
                                        ownerId: true
                                    }
                                });
                                // Calculate commission amounts
                                const payoutAmounts = await (0, _commissionutils.calculatePayoutAmounts)(booking.totalPrice, field?.ownerId || '');
                                // Create transaction record with commission details and lifecycle tracking
                                await tx.transaction.create({
                                    data: {
                                        bookingId: booking.id,
                                        userId: booking.userId,
                                        fieldOwnerId: field?.ownerId || null,
                                        amount: booking.totalPrice,
                                        netAmount: payoutAmounts.fieldOwnerAmount,
                                        platformFee: payoutAmounts.platformFeeAmount,
                                        commissionRate: payoutAmounts.commissionRate,
                                        type: 'PAYMENT',
                                        status: 'COMPLETED',
                                        stripePaymentIntentId: paymentIntent1.id,
                                        // Lifecycle tracking
                                        lifecycleStage: 'PAYMENT_RECEIVED',
                                        paymentReceivedAt: new Date(),
                                        description: `Payment for booking (webhook)`
                                    }
                                });
                            }
                        }
                    });
                    break;
                case 'payment_intent.payment_failed':
                    const failedPayment = event.data.object;
                    // Update booking status to failed
                    const failedBooking = await _database.default.booking.findFirst({
                        where: {
                            paymentIntentId: failedPayment.id
                        }
                    });
                    if (failedBooking) {
                        await _database.default.booking.update({
                            where: {
                                id: failedBooking.id
                            },
                            data: {
                                status: 'CANCELLED',
                                paymentStatus: 'FAILED'
                            }
                        });
                    }
                    break;
                case 'payout.created':
                case 'payout.updated':
                case 'payout.paid':
                case 'payout.failed':
                case 'payout.canceled':
                    await syncStripePayoutEvent(event);
                    break;
                case 'balance.available':
                    // Log available balance updates
                    // This event is triggered when your balance becomes available for payout
                    console.log('Balance available event received:', event.id);
                    break;
                case 'charge.refunded':
                    const refundedCharge = event.data.object;
                    console.log('Charge refunded:', refundedCharge.id);
                    // Find booking associated with this charge
                    if (refundedCharge.payment_intent) {
                        const refundedBooking = await _database.default.booking.findFirst({
                            where: {
                                paymentIntentId: refundedCharge.payment_intent
                            }
                        });
                        if (refundedBooking) {
                            await _database.default.booking.update({
                                where: {
                                    id: refundedBooking.id
                                },
                                data: {
                                    status: 'CANCELLED',
                                    paymentStatus: 'REFUNDED'
                                }
                            });
                            console.log(`Booking ${refundedBooking.id} marked as refunded`);
                        }
                    }
                    break;
                case 'charge.succeeded':
                    // This is usually redundant if we handle payment_intent.succeeded
                    // But can be useful for logging or specific charge-level logic
                    const succeededCharge = event.data.object;
                    console.log('Charge succeeded:', succeededCharge.id);
                    break;
                case 'payment_intent.created':
                    const createdIntent = event.data.object;
                    console.log('Payment intent created:', createdIntent.id);
                    break;
                case 'transfer.created':
                case 'transfer.paid':
                case 'transfer.failed':
                case 'transfer.reversed':
                    await syncStripeTransferEvent(event);
                    break;
                case 'refund.created':
                case 'refund.updated':
                case 'refund.failed':
                    await syncStripeRefundEvent(event);
                    break;
                default:
                    console.log(`Unhandled event type ${event.type}`);
            }
            res.json({
                received: true
            });
        } catch (error) {
            console.error('Error processing webhook:', error);
            res.status(500).json({
                error: 'Webhook processing failed'
            });
        }
    }
    // Get payment methods for user
    async getPaymentMethods(req, res) {
        try {
            const userId = req.user?.id;
            // For now, return mock data
            // In production, integrate with Stripe Customer API
            res.json({
                paymentMethods: []
            });
        } catch (error) {
            console.error('Error fetching payment methods:', error);
            res.status(500).json({
                error: 'Failed to fetch payment methods'
            });
        }
    }
}
function extractBookingIdsFromMetadata(metadata) {
    if (!metadata) return [];
    if (metadata.bookingId) {
        return [
            metadata.bookingId
        ];
    }
    if (metadata.bookingIds) {
        try {
            const parsed = JSON.parse(metadata.bookingIds);
            if (Array.isArray(parsed)) {
                return parsed.filter(Boolean);
            }
        } catch (error) {
            // bookingIds might be a comma separated list
            return metadata.bookingIds.split(',').map((id)=>id.trim()).filter(Boolean);
        }
    }
    return [];
}
async function syncStripePayoutEvent(event) {
    const payoutObject = event.data.object;
    const connectedAccountId = event.account;
    console.log(`[StripeWebhook] Processing ${event.type} event:`, {
        eventId: event.id,
        payoutId: payoutObject?.id,
        payoutStatus: payoutObject?.status,
        amount: payoutObject?.amount,
        connectedAccountId,
        metadata: payoutObject?.metadata
    });
    if (!payoutObject) {
        console.warn('[StripeWebhook] Payout event missing payout object');
        return;
    }
    // For automatic payouts without connected account ID, try to find the account by payout ID
    if (!connectedAccountId) {
        console.log('[StripeWebhook] No connected account ID in event, attempting to find account from payout metadata or existing record');
        // Check if we have an existing payout record
        const existingPayout = await _database.default.payout.findFirst({
            where: {
                stripePayoutId: payoutObject.id
            },
            include: {
                stripeAccount: true
            }
        });
        if (existingPayout) {
            console.log(`[StripeWebhook] Found existing payout record, updating status to: ${payoutObject.status}`);
            await _database.default.payout.update({
                where: {
                    id: existingPayout.id
                },
                data: {
                    status: payoutObject.status,
                    arrivalDate: payoutObject.arrival_date ? new Date(payoutObject.arrival_date * 1000) : null,
                    failureCode: payoutObject.failure_code || null,
                    failureMessage: payoutObject.failure_message || null
                }
            });
            return;
        }
        console.warn('[StripeWebhook] Cannot process payout without connected account ID and no existing record found');
        return;
    }
    console.log(`[StripeWebhook] Processing payout event for account: ${connectedAccountId}`);
    let stripeAccount = await _database.default.stripeAccount.findFirst({
        where: {
            stripeAccountId: connectedAccountId
        }
    });
    if (!stripeAccount) {
        console.warn(`[StripeWebhook] Account ${connectedAccountId} not found in DB. Attempting self-healing...`);
        try {
            // Fetch account from Stripe to check metadata
            const account = await _stripeconfig.stripe.accounts.retrieve(connectedAccountId);
            const userId = account.metadata?.userId;
            if (userId) {
                // Verify user exists
                const user = await _database.default.user.findUnique({
                    where: {
                        id: userId
                    }
                });
                if (user) {
                    console.log(`[StripeWebhook] Found user ${userId} for orphaned account ${connectedAccountId}. Re-linking...`);
                    // Create missing StripeAccount record
                    stripeAccount = await _database.default.stripeAccount.create({
                        data: {
                            userId,
                            stripeAccountId: connectedAccountId,
                            accountType: account.type || 'express',
                            chargesEnabled: account.charges_enabled,
                            payoutsEnabled: account.payouts_enabled,
                            detailsSubmitted: account.details_submitted,
                            defaultCurrency: account.default_currency || 'gbp',
                            country: account.country || 'GB',
                            email: account.email || user.email
                        }
                    });
                    console.log(`[StripeWebhook] Successfully re-linked account ${connectedAccountId} to user ${userId}`);
                } else {
                    console.error(`[StripeWebhook] User ${userId} from Stripe metadata not found in DB.`);
                }
            } else {
                console.warn(`[StripeWebhook] No userId in metadata for account ${connectedAccountId}. Cannot self-heal.`);
            }
        } catch (error) {
            console.error(`[StripeWebhook] Failed to fetch account ${connectedAccountId} from Stripe:`, error);
        }
    }
    if (!stripeAccount) {
        console.warn(`[StripeWebhook] Received payout event for unknown account: ${connectedAccountId}. Available accounts count: ${await _database.default.stripeAccount.count()}`);
        return;
    }
    console.log(`[StripeWebhook] Found matching internal account: ${stripeAccount.id} for Stripe account: ${connectedAccountId}`);
    const bookingIds = extractBookingIdsFromMetadata(payoutObject.metadata);
    const payoutData = {
        amount: (payoutObject.amount || 0) / 100,
        currency: payoutObject.currency || 'gbp',
        status: payoutObject.status,
        method: payoutObject.method || 'standard',
        description: payoutObject.description || null,
        arrivalDate: payoutObject.arrival_date ? new Date(payoutObject.arrival_date * 1000) : null,
        failureCode: payoutObject.failure_code || null,
        failureMessage: payoutObject.failure_message || null
    };
    const existingPayout = payoutObject.id ? await _database.default.payout.findUnique({
        where: {
            stripePayoutId: payoutObject.id
        }
    }) : null;
    if (existingPayout) {
        await _database.default.payout.update({
            where: {
                id: existingPayout.id
            },
            data: {
                ...payoutData,
                ...bookingIds.length && !existingPayout.bookingIds.length ? {
                    bookingIds
                } : {}
            }
        });
    } else {
        await _database.default.payout.create({
            data: {
                stripeAccountId: stripeAccount.id,
                stripePayoutId: payoutObject.id,
                bookingIds,
                ...payoutData
            }
        });
    }
    if (bookingIds.length) {
        let payoutStatus = 'PROCESSING';
        if (payoutObject.status === 'paid') {
            payoutStatus = 'COMPLETED';
        } else if (payoutObject.status === 'failed' || payoutObject.status === 'canceled') {
            payoutStatus = 'FAILED';
        }
        await _database.default.booking.updateMany({
            where: {
                id: {
                    in: bookingIds
                }
            },
            data: {
                payoutStatus,
                ...payoutStatus === 'COMPLETED' ? {
                    payoutReleasedAt: new Date()
                } : {}
            }
        });
        // Update Transaction lifecycle when payout completes
        if (payoutStatus === 'COMPLETED' && bookingIds.length > 0) {
            await _database.default.transaction.updateMany({
                where: {
                    bookingId: {
                        in: bookingIds
                    }
                },
                data: {
                    lifecycleStage: 'PAYOUT_COMPLETED',
                    stripePayoutId: payoutObject.id,
                    payoutCompletedAt: new Date()
                }
            });
            console.log(`[StripeWebhook] Updated transaction lifecycle to PAYOUT_COMPLETED for bookings: ${bookingIds.join(', ')}`);
        } else if (payoutStatus === 'PROCESSING' && bookingIds.length > 0) {
            await _database.default.transaction.updateMany({
                where: {
                    bookingId: {
                        in: bookingIds
                    }
                },
                data: {
                    lifecycleStage: 'PAYOUT_INITIATED',
                    stripePayoutId: payoutObject.id,
                    payoutInitiatedAt: new Date()
                }
            });
        }
    }
}
/**
 * Sync Stripe transfer events to update booking and transaction records
 */ async function syncStripeTransferEvent(event) {
    const transfer = event.data.object;
    console.log(`[StripeWebhook] Processing ${event.type} event:`, {
        eventId: event.id,
        transferId: transfer.id,
        amount: transfer.amount,
        destination: transfer.destination,
        metadata: transfer.metadata
    });
    const bookingIds = extractBookingIdsFromMetadata(transfer.metadata);
    if (bookingIds.length === 0) {
        console.log('[StripeWebhook] No booking IDs found in transfer metadata');
        return;
    }
    // Update bookings based on transfer status
    if (event.type === 'transfer.created') {
        // Transfer created - funds are being moved to connected account
        console.log(`[StripeWebhook] Transfer created for bookings: ${bookingIds.join(', ')}`);
        // Update transaction lifecycle
        await _database.default.transaction.updateMany({
            where: {
                bookingId: {
                    in: bookingIds
                }
            },
            data: {
                lifecycleStage: 'TRANSFERRED',
                stripeTransferId: transfer.id,
                transferredAt: new Date(),
                connectedAccountId: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id
            }
        });
    } else if (event.type === 'transfer.paid') {
        // Transfer completed successfully
        console.log(`[StripeWebhook] Transfer paid for bookings: ${bookingIds.join(', ')}`);
        // Mark transfer as complete in booking (if not already processing payout)
        await _database.default.booking.updateMany({
            where: {
                id: {
                    in: bookingIds
                },
                payoutStatus: {
                    in: [
                        'PENDING',
                        'HELD',
                        null
                    ]
                }
            },
            data: {
                payoutStatus: 'PROCESSING'
            }
        });
    } else if (event.type === 'transfer.failed' || event.type === 'transfer.reversed') {
        // Transfer failed or was reversed
        console.log(`[StripeWebhook] Transfer ${event.type} for bookings: ${bookingIds.join(', ')}`);
        await _database.default.booking.updateMany({
            where: {
                id: {
                    in: bookingIds
                }
            },
            data: {
                payoutStatus: 'FAILED'
            }
        });
        // Update transaction with failure info
        await _database.default.transaction.updateMany({
            where: {
                bookingId: {
                    in: bookingIds
                }
            },
            data: {
                lifecycleStage: 'TRANSFER_FAILED',
                failureCode: event.type === 'transfer.reversed' ? 'REVERSED' : 'FAILED',
                failureMessage: event.type === 'transfer.reversed' ? 'Transfer was reversed' : 'Transfer failed'
            }
        });
        // Notify admins about failed transfer
        const adminUsers = await _database.default.user.findMany({
            where: {
                role: 'ADMIN'
            }
        });
        for (const admin of adminUsers){
            await _database.default.notification.create({
                data: {
                    userId: admin.id,
                    type: 'PAYOUT_FAILED',
                    title: `Transfer ${event.type === 'transfer.reversed' ? 'Reversed' : 'Failed'}`,
                    message: `Transfer ${transfer.id} ${event.type === 'transfer.reversed' ? 'was reversed' : 'failed'} for bookings: ${bookingIds.join(', ')}`,
                    data: {
                        transferId: transfer.id,
                        bookingIds,
                        eventType: event.type
                    }
                }
            });
        }
    }
}
/**
 * Sync Stripe refund events to update booking and transaction records
 */ async function syncStripeRefundEvent(event) {
    const refund = event.data.object;
    console.log(`[StripeWebhook] Processing ${event.type} event:`, {
        eventId: event.id,
        refundId: refund.id,
        amount: refund.amount,
        status: refund.status,
        paymentIntent: refund.payment_intent,
        metadata: refund.metadata
    });
    // Find booking by payment intent
    const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    if (!paymentIntentId) {
        console.log('[StripeWebhook] No payment intent found in refund');
        return;
    }
    const booking = await _database.default.booking.findFirst({
        where: {
            paymentIntentId
        },
        include: {
            field: {
                select: {
                    ownerId: true,
                    name: true
                }
            },
            user: {
                select: {
                    name: true,
                    email: true
                }
            }
        }
    });
    if (!booking) {
        console.log(`[StripeWebhook] No booking found for payment intent: ${paymentIntentId}`);
        return;
    }
    const refundAmount = refund.amount / 100;
    if (event.type === 'refund.created' || event.type === 'refund.updated') {
        // Update transaction record
        const existingTransaction = await _database.default.transaction.findFirst({
            where: {
                bookingId: booking.id,
                type: 'REFUND'
            }
        });
        if (existingTransaction) {
            // Update existing refund transaction
            await _database.default.transaction.update({
                where: {
                    id: existingTransaction.id
                },
                data: {
                    status: refund.status === 'succeeded' ? 'COMPLETED' : refund.status === 'failed' ? 'FAILED' : 'PROCESSING',
                    stripeRefundId: refund.id,
                    refundedAt: refund.status === 'succeeded' ? new Date() : null,
                    failureCode: refund.failure_reason || null,
                    failureMessage: refund.failure_reason || null
                }
            });
        } else {
            // Create new refund transaction record
            await _database.default.transaction.create({
                data: {
                    bookingId: booking.id,
                    userId: booking.userId,
                    fieldOwnerId: booking.field.ownerId,
                    amount: refundAmount,
                    netAmount: refundAmount,
                    type: 'REFUND',
                    status: refund.status === 'succeeded' ? 'COMPLETED' : refund.status === 'failed' ? 'FAILED' : 'PROCESSING',
                    lifecycleStage: 'REFUNDED',
                    stripePaymentIntentId: paymentIntentId,
                    stripeRefundId: refund.id,
                    refundedAt: refund.status === 'succeeded' ? new Date() : null,
                    description: `Refund for booking ${booking.id}`
                }
            });
        }
        // Also update the original payment transaction
        await _database.default.transaction.updateMany({
            where: {
                bookingId: booking.id,
                type: 'PAYMENT'
            },
            data: {
                lifecycleStage: 'REFUNDED',
                stripeRefundId: refund.id,
                refundedAt: refund.status === 'succeeded' ? new Date() : null
            }
        });
        // Update booking status
        if (refund.status === 'succeeded') {
            await _database.default.booking.update({
                where: {
                    id: booking.id
                },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'REFUNDED',
                    payoutStatus: 'REFUNDED'
                }
            });
            console.log(`[StripeWebhook] Booking ${booking.id} marked as refunded`);
        }
    } else if (event.type === 'refund.failed') {
        // Update transaction with failure
        await _database.default.transaction.updateMany({
            where: {
                bookingId: booking.id,
                type: 'REFUND'
            },
            data: {
                status: 'FAILED',
                failureCode: refund.failure_reason || 'UNKNOWN',
                failureMessage: refund.failure_reason || 'Refund failed'
            }
        });
        // Notify admins about failed refund
        const adminUsers = await _database.default.user.findMany({
            where: {
                role: 'ADMIN'
            }
        });
        for (const admin of adminUsers){
            await _database.default.notification.create({
                data: {
                    userId: admin.id,
                    type: 'REFUND_FAILED',
                    title: 'Refund Failed',
                    message: `Refund of £${refundAmount.toFixed(2)} failed for booking ${booking.id}. Reason: ${refund.failure_reason || 'Unknown'}`,
                    data: {
                        bookingId: booking.id,
                        refundId: refund.id,
                        amount: refundAmount,
                        failureReason: refund.failure_reason
                    }
                }
            });
        }
    }
}

//# sourceMappingURL=payment.controller.js.map