/**
 * Payout Engine — Event Wiring.
 *
 * Subscribes to all engine events and bridges them to Fieldsy's
 * existing notification system + email service.
 *
 * This file is imported for its side-effects in server.ts:
 *   import './config/payout-engine-events';
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _payoutengine = require("./payout-engine");
const _notificationcontroller = require("../controllers/notification.controller");
const _notificationservice = require("../services/notification.service");
const _emailservice = require("../services/email.service");
const _database = require("./database");
const events = _payoutengine.payoutEngine.events;
// ---------------------------------------------------------------------------
// Payout lifecycle events
// ---------------------------------------------------------------------------
events.on('payout:completed', async (e)=>{
    const { merchantId, amount, currency } = e.data;
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYOUT_PROCESSED',
            title: e.title,
            message: e.message,
            data: e.data
        });
        const merchant = await _payoutengine.payoutEngine.autoPayoutService ? null : null; // info already in event
        // Send email — need merchant email
        const info = await getMerchantEmail(merchantId);
        if (info?.email) {
            await _emailservice.emailService.sendPayoutCompletedEmail({
                email: info.email,
                userName: info.name || 'Field Owner',
                amount: amount.toFixed(2),
                currency: currency.toUpperCase()
            });
        }
    }
});
events.on('payout:failed', async (e)=>{
    // Per recent requirement: only notify admin, NOT field owner
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Payout Failed', e.message, e.data);
});
events.on('payout:pending_account', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYOUT_PENDING',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('payout:held', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYOUT_PENDING',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('payout:released', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYOUT_RELEASED',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('payout:retry_success', async (e)=>{
    const { merchantId, amount, currency } = e.data;
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'payout_retry_success',
            title: e.title,
            message: e.message,
            data: e.data
        });
        const info = await getMerchantEmail(merchantId);
        if (info?.email) {
            await _emailservice.emailService.sendPayoutCompletedEmail({
                email: info.email,
                userName: info.name || 'Field Owner',
                amount: amount.toFixed(2),
                currency: currency.toUpperCase()
            });
        }
    }
});
events.on('payout:processing', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYOUT_PENDING',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
// ---------------------------------------------------------------------------
// Refund events
// ---------------------------------------------------------------------------
events.on('refund:processed', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'REFUND_PROCESSED',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('refund:failed', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Refund Failed', e.message, e.data);
});
events.on('refund:reversal', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Refund Reversal', e.message, e.data);
});
// ---------------------------------------------------------------------------
// Payment events
// ---------------------------------------------------------------------------
events.on('payment:succeeded', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYMENT_RECEIVED',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('payment:failed', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'PAYMENT_FAILED',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
// ---------------------------------------------------------------------------
// Subscription events
// ---------------------------------------------------------------------------
events.on('subscription:created', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'subscription_created',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('subscription:renewed', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'subscription_renewed',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('subscription:payment_failed', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'payment_failed',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('subscription:cancelled', async (e)=>{
    const { merchantId, customerId, listingId, interval } = e.data;
    // Notify customer
    if (customerId) {
        await (0, _notificationcontroller.createNotification)({
            userId: customerId,
            type: 'subscription_cancelled',
            title: e.title,
            message: e.message,
            data: e.data
        });
        const customerInfo = await getCustomerEmail(customerId);
        if (customerInfo?.email) {
            await _emailservice.emailService.sendSubscriptionCancelledEmail({
                email: customerInfo.email,
                userName: customerInfo.name || 'Customer',
                fieldName: e.data.listingId,
                interval,
                cancelledAt: new Date(),
                reason: e.data.cancellationReason,
                isFieldOwner: false
            });
        }
    }
    // Notify merchant
    if (merchantId) {
        await (0, _notificationcontroller.createNotification)({
            userId: merchantId,
            type: 'subscription_cancelled',
            title: 'Subscription Cancelled',
            message: `A recurring booking subscription has been cancelled.`,
            data: e.data
        });
        const merchantInfo = await getMerchantEmail(merchantId);
        if (merchantInfo?.email) {
            await _emailservice.emailService.sendSubscriptionCancelledEmail({
                email: merchantInfo.email,
                userName: merchantInfo.name || 'Field Owner',
                fieldName: e.data.listingId,
                interval,
                cancelledAt: new Date(),
                reason: e.data.cancellationReason,
                isFieldOwner: true
            });
        }
    }
});
events.on('subscription:cancelled_user', async (e)=>{
    // User-initiated cancellation — same as above
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'subscription_cancelled',
            title: e.title,
            message: e.message,
            data: e.data
        });
        const info = await getCustomerEmail(e.targetUserId);
        if (info?.email) {
            await _emailservice.emailService.sendSubscriptionCancelledEmail({
                email: info.email,
                userName: info.name || 'Customer',
                fieldName: e.data.listingId,
                interval: e.data.interval,
                cancelledAt: new Date(),
                reason: e.data.cancellationReason,
                isFieldOwner: false
            });
        }
    }
});
// ---------------------------------------------------------------------------
// Connect account events
// ---------------------------------------------------------------------------
events.on('connect:account_ready', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'stripe_account_ready',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('connect:account_disconnected', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Stripe Account Disconnected', e.message, e.data);
});
events.on('connect:requirements_due', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'stripe_requirements_due',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
// ---------------------------------------------------------------------------
// Order events
// ---------------------------------------------------------------------------
events.on('order:confirmed', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'booking_confirmed',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
events.on('order:new', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'booking_received',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
// ---------------------------------------------------------------------------
// Admin events
// ---------------------------------------------------------------------------
events.on('admin:payout_failed', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Payout Failed', e.message, e.data);
});
events.on('admin:job_error', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Job Error', e.message, e.data);
});
events.on('admin:job_summary', async (e)=>{
    // Log only, no notification for routine summaries
    console.log(`[PayoutEngine] Job summary: ${e.data.jobName} — processed: ${e.data.processed}, failed: ${e.data.failed}`);
});
events.on('admin:daily_summary', async (e)=>{
    await _notificationservice.NotificationService.notifyAdmins(e.title || 'Daily Payout Summary', e.message, e.data);
});
events.on('admin:earnings_update', async (e)=>{
    if (e.targetUserId) {
        await (0, _notificationcontroller.createNotification)({
            userId: e.targetUserId,
            type: 'earnings_update',
            title: e.title,
            message: e.message,
            data: e.data
        });
    }
});
async function getMerchantEmail(merchantId) {
    const user = await _database.prisma.user.findUnique({
        where: {
            id: merchantId
        },
        select: {
            email: true,
            name: true
        }
    });
    if (!user?.email) return null;
    return {
        email: user.email,
        name: user.name || ''
    };
}
async function getCustomerEmail(customerId) {
    const user = await _database.prisma.user.findUnique({
        where: {
            id: customerId
        },
        select: {
            email: true,
            name: true
        }
    });
    if (!user?.email) return null;
    return {
        email: user.email,
        name: user.name || ''
    };
}
console.log('[PayoutEngine] Event wiring initialized — 27 event listeners registered');

//# sourceMappingURL=payout-engine-events.js.map