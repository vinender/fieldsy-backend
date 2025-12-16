"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initPayoutJobs = void 0;
exports.processAutomaticTransfers = processAutomaticTransfers;
//@ts-nocheck
const node_cron_1 = __importDefault(require("node-cron"));
const refund_service_1 = __importDefault(require("../services/refund.service"));
const database_1 = __importDefault(require("../config/database"));
const notification_controller_1 = require("../controllers/notification.controller");
const auto_payout_service_1 = require("../services/auto-payout.service");
const stripe_config_1 = require("../config/stripe.config");
const stripe_payout_helper_1 = require("../utils/stripe-payout.helper");
/**
 * Scheduled job to process payouts for completed bookings
 * Runs every hour to check for bookings that have passed their cancellation period
 */
const initPayoutJobs = () => {
    // Run every 30 minutes to mark past bookings as completed
    node_cron_1.default.schedule('*/30 * * * *', async () => {
        console.log('📋 Marking past bookings as completed...');
        try {
            const now = new Date();
            // First, get all CONFIRMED bookings that might need to be marked as completed
            const potentialBookings = await database_1.default.booking.findMany({
                where: {
                    status: 'CONFIRMED',
                    paymentStatus: 'PAID',
                },
                select: {
                    id: true,
                    date: true,
                    endTime: true,
                }
            });
            // Filter bookings where the end time has passed
            const bookingsToComplete = potentialBookings.filter(booking => {
                if (!booking.endTime)
                    return false;
                // Parse end time (format: "11:30AM" or "23:30")
                const endTimeParts = booking.endTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
                if (!endTimeParts)
                    return false;
                let hours = parseInt(endTimeParts[1]);
                const minutes = parseInt(endTimeParts[2]);
                const period = endTimeParts[3]?.toUpperCase();
                // Convert to 24-hour format if needed
                if (period === 'PM' && hours !== 12) {
                    hours += 12;
                }
                else if (period === 'AM' && hours === 12) {
                    hours = 0;
                }
                // Create a Date object for the booking end time
                const bookingEndDateTime = new Date(booking.date);
                bookingEndDateTime.setHours(hours, minutes, 0, 0);
                // Check if booking end time has passed
                return bookingEndDateTime < now;
            });
            // Update bookings to COMPLETED
            let completedCount = 0;
            for (const booking of bookingsToComplete) {
                await database_1.default.booking.update({
                    where: { id: booking.id },
                    data: { status: 'COMPLETED' }
                });
                completedCount++;
            }
            console.log(`✅ Marked ${completedCount} bookings as completed`);
            // Now trigger payouts for newly completed bookings
            if (completedCount > 0) {
                // Get the bookings that were just marked as completed
                // Use OR with isSet: false to handle both null values and missing fields (Prisma MongoDB quirk)
                const newlyCompletedBookings = await database_1.default.booking.findMany({
                    where: {
                        status: 'COMPLETED',
                        paymentStatus: 'PAID',
                        updatedAt: {
                            gte: new Date(Date.now() - 5 * 60 * 1000) // Updated in last 5 minutes
                        },
                        OR: [
                            { payoutStatus: { isSet: false } },
                            { payoutStatus: null }
                        ]
                    }
                });
                // Import payout service
                const { payoutService } = await Promise.resolve().then(() => __importStar(require('../services/payout.service')));
                // Process payouts for each booking
                for (const booking of newlyCompletedBookings) {
                    try {
                        await payoutService.processBookingPayout(booking.id);
                        console.log(`💰 Payout processed for booking ${booking.id}`);
                    }
                    catch (error) {
                        console.error(`Failed to process payout for booking ${booking.id}:`, error);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error marking bookings as completed:', error);
        }
    });
    // Run every hour at minute 0
    node_cron_1.default.schedule('0 * * * *', async () => {
        console.log('🏦 Running scheduled automatic payout job...');
        try {
            // Process automatic payouts for bookings past cancellation window
            const results = await auto_payout_service_1.automaticPayoutService.processEligiblePayouts();
            console.log(`✅ Automatic payouts processed:`);
            console.log(`   - Processed: ${results.processed}`);
            console.log(`   - Skipped: ${results.skipped}`);
            console.log(`   - Failed: ${results.failed}`);
            // Process payouts for completed bookings past cancellation period (legacy)
            await refund_service_1.default.processCompletedBookingPayouts();
            // Also check for any failed payouts to retry
            await retryFailedPayouts();
            console.log('✅ Payout job completed successfully');
        }
        catch (error) {
            console.error('❌ Payout job error:', error);
            // Notify admins of job failure
            const adminUsers = await database_1.default.user.findMany({
                where: { role: 'ADMIN' }
            });
            for (const admin of adminUsers) {
                await (0, notification_controller_1.createNotification)({
                    userId: admin.id,
                    type: 'PAYOUT_JOB_ERROR',
                    title: 'Scheduled Payout Job Failed',
                    message: `The automatic payout job encountered an error: ${error.message}`,
                    data: {
                        error: error.message,
                        timestamp: new Date()
                    }
                });
            }
        }
    });
    // Run daily at midnight to calculate and update field owner earnings
    node_cron_1.default.schedule('0 0 * * *', async () => {
        console.log('Running daily earnings calculation...');
        try {
            await calculateFieldOwnerEarnings();
            console.log('Earnings calculation completed');
        }
        catch (error) {
            console.error('Earnings calculation error:', error);
        }
    });
};
exports.initPayoutJobs = initPayoutJobs;
/**
 * Retry failed payouts
 */
async function retryFailedPayouts() {
    try {
        const failedPayouts = await database_1.default.payout.findMany({
            where: {
                status: 'failed',
                createdAt: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Only retry payouts from last 24 hours
                }
            },
            include: {
                stripeAccount: {
                    include: {
                        user: true
                    }
                }
            }
        });
        for (const payout of failedPayouts) {
            // Check if Stripe account is now ready
            if (!payout.stripeAccount.payoutsEnabled) {
                continue; // Skip if account still not ready
            }
            try {
                // Attempt to retry the payout
                const transfer = await stripe_config_1.stripe.transfers.create({
                    amount: Math.round(payout.amount * 100),
                    currency: payout.currency,
                    destination: payout.stripeAccount.stripeAccountId,
                    description: payout.description || `Retry payout ${payout.id}`,
                    metadata: {
                        payoutId: payout.id,
                        retryAttempt: 'true'
                    }
                });
                let stripePayout = null;
                try {
                    stripePayout = await (0, stripe_payout_helper_1.createConnectedAccountPayout)({
                        stripeAccountId: payout.stripeAccount.stripeAccountId,
                        amountInMinorUnits: Math.round(payout.amount * 100),
                        description: payout.description || `Retry payout ${payout.id}`,
                        metadata: {
                            payoutId: payout.id,
                            retryAttempt: 'true',
                            transferId: transfer.id,
                            source: 'retry_failed_payout'
                        }
                    });
                }
                catch (payoutError) {
                    console.error('Stripe payout creation failed during retry:', payoutError);
                }
                // Update payout status
                await database_1.default.payout.update({
                    where: { id: payout.id },
                    data: {
                        status: stripePayout?.status || 'processing',
                        stripePayoutId: stripePayout?.id || transfer.id,
                        arrivalDate: stripePayout?.arrival_date
                            ? new Date(stripePayout.arrival_date * 1000)
                            : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
                        failureCode: stripePayout?.failure_code || null,
                        failureMessage: stripePayout?.failure_message || null
                    }
                });
                // Send success notification
                await (0, notification_controller_1.createNotification)({
                    userId: payout.stripeAccount.userId,
                    type: 'payout_retry_success',
                    title: 'Payout Processed',
                    message: `Your previously failed payout of £${payout.amount.toFixed(2)} has been successfully processed.`,
                    data: {
                        payoutId: payout.id,
                        amount: payout.amount
                    }
                });
                console.log(`Successfully retried payout ${payout.id}`);
            }
            catch (retryError) {
                console.error(`Failed to retry payout ${payout.id}:`, retryError);
                // Update failure reason
                await database_1.default.payout.update({
                    where: { id: payout.id },
                    data: {
                        failureMessage: retryError.message,
                        failureCode: retryError.code
                    }
                });
            }
        }
    }
    catch (error) {
        console.error('Retry failed payouts error:', error);
    }
}
/**
 * Calculate and update field owner earnings
 */
async function calculateFieldOwnerEarnings() {
    try {
        // Get all field owners
        const fieldOwners = await database_1.default.user.findMany({
            where: {
                role: 'FIELD_OWNER',
                stripeAccount: {
                    isNot: null
                }
            },
            include: {
                stripeAccount: true,
                ownedFields: {
                    include: {
                        bookings: {
                            where: {
                                OR: [
                                    { status: 'COMPLETED' },
                                    {
                                        status: 'CANCELLED',
                                        cancelledAt: {
                                            not: null
                                        }
                                    }
                                ]
                            },
                            include: {
                                payment: true
                            }
                        }
                    }
                }
            }
        });
        for (const owner of fieldOwners) {
            let totalEarnings = 0;
            let pendingEarnings = 0;
            let availableEarnings = 0;
            for (const field of owner.ownedFields) {
                for (const booking of field.bookings) {
                    if (!booking.payment)
                        continue;
                    // Get field owner amount - use stored or calculate dynamically
                    let bookingAmount = booking.fieldOwnerAmount;
                    if (!bookingAmount) {
                        const { calculatePayoutAmounts } = require('../utils/commission.utils');
                        const calculated = await calculatePayoutAmounts(booking.totalPrice, owner.id);
                        bookingAmount = calculated.fieldOwnerAmount;
                    }
                    if (booking.payoutStatus === 'COMPLETED') {
                        totalEarnings += bookingAmount;
                        availableEarnings += bookingAmount;
                    }
                    else if (booking.payoutStatus === 'PROCESSING' || booking.payoutStatus === 'PENDING') {
                        pendingEarnings += bookingAmount;
                    }
                }
            }
            // Get all successful payouts
            const payouts = await database_1.default.payout.findMany({
                where: {
                    stripeAccountId: owner.stripeAccount.id,
                    status: 'paid'
                }
            });
            const totalPayouts = payouts.reduce((sum, payout) => sum + payout.amount, 0);
            // Skip notification if there is nothing meaningful to report
            // Only send if there are pending or available earnings, or if total earnings for the period are positive
            // We exclude totalPayouts from this check because historical payouts shouldn't trigger a "Current Earnings" notification
            const hasEarningsActivity = totalEarnings > 0 ||
                availableEarnings > 0 ||
                pendingEarnings > 0;
            if (!hasEarningsActivity) {
                continue;
            }
            // Update user's earning statistics (you may need to add these fields to User model)
            // For now, we'll store this in a notification
            await (0, notification_controller_1.createNotification)({
                userId: owner.id,
                type: 'earnings_update',
                title: 'Earnings Update',
                message: `Your current earnings: Total: £${totalEarnings.toFixed(2)}, Available: £${availableEarnings.toFixed(2)}, Pending: £${pendingEarnings.toFixed(2)}`,
                data: {
                    totalEarnings,
                    availableEarnings,
                    pendingEarnings,
                    totalPayouts
                }
            });
        }
    }
    catch (error) {
        console.error('Calculate earnings error:', error);
    }
}
/**
 * Process automatic transfers for bookings past cancellation period
 * This ensures field owners receive their share after 24 hours even if no cancellation occurred
 */
async function processAutomaticTransfers() {
    try {
        // Use OR with isSet: false to handle both null values and missing fields (Prisma MongoDB quirk)
        const eligibleBookings = await database_1.default.booking.findMany({
            where: {
                status: 'COMPLETED',
                date: {
                    lte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours after booking date
                },
                OR: [
                    { payoutStatus: { isSet: false } },
                    { payoutStatus: null }
                ]
            },
            include: {
                payment: true,
                field: {
                    include: {
                        owner: {
                            include: {
                                stripeAccount: true
                            }
                        }
                    }
                }
            }
        });
        for (const booking of eligibleBookings) {
            if (!booking.payment || booking.payment.status !== 'completed') {
                continue;
            }
            try {
                // Mark as processing to avoid duplicate processing
                await database_1.default.booking.update({
                    where: { id: booking.id },
                    data: { payoutStatus: 'PROCESSING' }
                });
                // Process the payout
                await refund_service_1.default.processFieldOwnerPayout(booking, 0);
                console.log(`Processed automatic transfer for booking ${booking.id}`);
            }
            catch (error) {
                console.error(`Failed to process transfer for booking ${booking.id}:`, error);
                // Revert status on error
                await database_1.default.booking.update({
                    where: { id: booking.id },
                    data: { payoutStatus: null }
                });
            }
        }
    }
    catch (error) {
        console.error('Process automatic transfers error:', error);
    }
}
