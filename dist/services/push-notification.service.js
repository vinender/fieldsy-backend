"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushNotificationService = void 0;
//@ts-nocheck
const client_1 = require("@prisma/client");
const firebase_config_1 = require("../config/firebase.config");
const prisma = new client_1.PrismaClient();
/**
 * Push Notification Service
 * Handles sending push notifications via Firebase Cloud Messaging
 */
class PushNotificationService {
    /**
     * Send push notification to a single user (all their devices)
     */
    static async sendToUser(payload) {
        const messaging = (0, firebase_config_1.getMessaging)();
        if (!messaging) {
            console.log('[PushService] Firebase not initialized, skipping push notification');
            return { successCount: 0, failureCount: 0, invalidTokens: [] };
        }
        try {
            // Get all active device tokens for the user
            const deviceTokens = await prisma.deviceToken.findMany({
                where: {
                    userId: payload.userId,
                    isActive: true,
                },
                select: { token: true, id: true, platform: true },
            });
            if (deviceTokens.length === 0) {
                console.log(`[PushService] No active tokens for user ${payload.userId}`);
                return { successCount: 0, failureCount: 0, invalidTokens: [] };
            }
            const tokens = deviceTokens.map((dt) => dt.token);
            console.log(`[PushService] Sending to ${tokens.length} device(s) for user ${payload.userId}`);
            // Build the multicast message
            const message = {
                tokens,
                notification: {
                    title: payload.title,
                    body: payload.body,
                    imageUrl: payload.imageUrl,
                },
                data: payload.data || {},
                // Android-specific options
                android: {
                    notification: {
                        channelId: 'fieldsy_default',
                        priority: 'high',
                        defaultSound: true,
                        icon: 'ic_notification', // Requires app to have this icon
                    },
                },
                // iOS-specific options (APNs)
                apns: {
                    payload: {
                        aps: {
                            badge: payload.badge,
                            sound: 'default',
                            contentAvailable: true,
                        },
                    },
                },
                // Web push options
                webpush: {
                    notification: {
                        icon: '/logo.svg',
                        badge: '/logo-badge.png',
                    },
                    fcmOptions: {
                        link: payload.data?.link || '/',
                    },
                },
            };
            const response = await messaging.sendEachForMulticast(message);
            // Handle invalid tokens
            const invalidTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const error = resp.error;
                    console.log(`[PushService] Failed to send to token ${idx}:`, error?.code, error?.message);
                    // Mark token as invalid if it's no longer registered
                    if (error?.code === 'messaging/registration-token-not-registered' ||
                        error?.code === 'messaging/invalid-registration-token' ||
                        error?.code === 'messaging/invalid-argument') {
                        invalidTokens.push(tokens[idx]);
                    }
                }
            });
            // Deactivate invalid tokens
            if (invalidTokens.length > 0) {
                await this.deactivateTokens(invalidTokens);
            }
            console.log(`[PushService] Sent to user ${payload.userId}: ${response.successCount} success, ${response.failureCount} failed`);
            return {
                successCount: response.successCount,
                failureCount: response.failureCount,
                invalidTokens,
            };
        }
        catch (error) {
            console.error('[PushService] Error sending push notification:', error.message);
            return { successCount: 0, failureCount: 0, invalidTokens: [] };
        }
    }
    /**
     * Send push notification to multiple users
     */
    static async sendToUsers(payload) {
        let totalSuccess = 0;
        let totalFailure = 0;
        console.log(`[PushService] Sending batch notification to ${payload.userIds.length} users`);
        for (const userId of payload.userIds) {
            const result = await this.sendToUser({
                userId,
                title: payload.title,
                body: payload.body,
                data: payload.data,
            });
            totalSuccess += result.successCount;
            totalFailure += result.failureCount;
        }
        console.log(`[PushService] Batch complete: ${totalSuccess} success, ${totalFailure} failed`);
        return { totalSuccess, totalFailure };
    }
    /**
     * Deactivate invalid tokens
     */
    static async deactivateTokens(tokens) {
        try {
            const result = await prisma.deviceToken.updateMany({
                where: { token: { in: tokens } },
                data: { isActive: false },
            });
            console.log(`[PushService] Deactivated ${result.count} invalid token(s)`);
        }
        catch (error) {
            console.error('[PushService] Error deactivating tokens:', error.message);
        }
    }
    /**
     * Get notification content based on notification type
     * Maps notification types to push-friendly titles and bodies
     */
    static getNotificationContent(type, data) {
        const contentMap = {
            // Booking notifications
            new_booking_received: {
                title: 'New Booking Request!',
                body: `You have a new booking request for ${data.fieldName || 'your field'}`,
                link: '/field-owner/bookings',
            },
            booking_received: {
                title: 'New Booking Request!',
                body: `You have a new booking request for ${data.fieldName || 'your field'}`,
                link: '/field-owner/bookings',
            },
            booking_confirmed: {
                title: 'Booking Confirmed!',
                body: `Your booking at ${data.fieldName || 'the field'} has been confirmed`,
                link: '/user/my-bookings',
            },
            booking_request_sent: {
                title: 'Booking Request Sent',
                body: `Your booking request for ${data.fieldName || 'the field'} has been sent`,
                link: '/user/my-bookings',
            },
            booking_cancelled: {
                title: 'Booking Cancelled',
                body: `A booking for ${data.fieldName || 'your field'} has been cancelled`,
                link: '/user/my-bookings',
            },
            booking_completed: {
                title: 'Booking Completed',
                body: `Your booking at ${data.fieldName || 'the field'} is complete. Leave a review!`,
                link: '/user/my-bookings',
            },
            recurring_booking_created: {
                title: 'Recurring Booking Scheduled',
                body: `Your next recurring booking at ${data.fieldName || 'the field'} has been scheduled`,
                link: '/user/my-bookings',
            },
            // Message notifications
            new_message: {
                title: `Message from ${data.senderName || 'Someone'}`,
                body: data.messagePreview || 'You have a new message',
                link: '/user/messages',
            },
            // Payment notifications
            payment_received: {
                title: 'Payment Received!',
                body: `Payment of £${data.amount || '0'} has been received`,
                link: '/field-owner/earnings',
            },
            payment_failed: {
                title: 'Payment Failed',
                body: 'Your payment could not be processed. Please try again.',
                link: '/user/my-bookings',
            },
            // Payout notifications
            payout_completed: {
                title: 'Payout Completed!',
                body: `£${data.amount || '0'} has been transferred to your bank account`,
                link: '/field-owner/earnings',
            },
            payout_processed: {
                title: 'Payout Processed!',
                body: `£${data.amount || '0'} is on its way to your bank account`,
                link: '/field-owner/earnings',
            },
            payout_failed: {
                title: 'Payout Failed',
                body: 'Your payout could not be processed. Please check your bank details.',
                link: '/field-owner/settings',
            },
            // Review notifications
            new_review_received: {
                title: 'New Review!',
                body: `${data.reviewerName || 'Someone'} left a ${data.rating || 5}-star review on ${data.fieldName || 'your field'}`,
                link: data.fieldId ? `/fields/${data.fieldId}` : '/field-owner/my-fields',
            },
            review_posted: {
                title: 'New Review!',
                body: `A new review has been posted on ${data.fieldName || 'your field'}`,
                link: data.fieldId ? `/fields/${data.fieldId}` : '/field-owner/my-fields',
            },
            // Field notifications
            field_approved: {
                title: 'Field Approved!',
                body: `Your field "${data.fieldName || ''}" has been approved and is now live`,
                link: '/field-owner/my-fields',
            },
            field_submitted: {
                title: 'Field Submitted',
                body: `Your field "${data.fieldName || ''}" has been submitted for review`,
                link: '/field-owner/my-fields',
            },
            field_added: {
                title: 'New Field Added',
                body: `A new field "${data.fieldName || ''}" has been added`,
                link: '/admin/fields',
            },
            // Refund notifications
            refund_processed: {
                title: 'Refund Processed',
                body: `Your refund of £${data.amount || '0'} has been processed`,
                link: '/user/my-bookings',
            },
            // Stripe Connect notifications
            stripe_account_ready: {
                title: 'Stripe Account Ready!',
                body: 'Your Stripe account is now set up and ready to receive payouts',
                link: '/field-owner/earnings',
            },
            stripe_requirements: {
                title: 'Action Required',
                body: 'Please complete your Stripe account setup to receive payouts',
                link: '/field-owner/settings',
            },
            // User notifications
            user_registered: {
                title: 'Welcome to Fieldsy!',
                body: 'Your account has been created successfully',
                link: '/',
            },
        };
        return (contentMap[type] || {
            title: 'Fieldsy',
            body: 'You have a new notification',
            link: '/',
        });
    }
    /**
     * Send a push notification for a specific notification type
     * Convenience method that combines getNotificationContent with sendToUser
     */
    static async sendNotificationByType(userId, type, notificationId, data = {}) {
        const content = this.getNotificationContent(type, data);
        return this.sendToUser({
            userId,
            title: content.title,
            body: content.body,
            data: {
                type,
                notificationId,
                link: content.link,
                // Convert all data values to strings for FCM
                ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])),
            },
        });
    }
}
exports.PushNotificationService = PushNotificationService;
exports.default = PushNotificationService;
