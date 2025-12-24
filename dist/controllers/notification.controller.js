"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationController = void 0;
exports.createNotification = createNotification;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.notificationController = {
    // Get all notifications for a user
    async getUserNotifications(req, res) {
        try {
            // Get userId from req.user (set by auth middleware) or req.userId
            const userId = req.user?.id;
            console.log('Getting notifications for user:', userId);
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated',
                });
            }
            const { page = 1, limit = 20, unreadOnly = false, markAsRead = 'false' } = req.query;
            const skip = (Number(page) - 1) * Number(limit);
            const where = { userId };
            if (unreadOnly === 'true') {
                where.read = false;
            }
            const [notifications, total, unreadCount] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: Number(limit),
                }),
                prisma.notification.count({ where }),
                prisma.notification.count({ where: { userId, read: false } }),
            ]);
            // If markAsRead query param is true, mark all fetched notifications as read
            if (markAsRead === 'true' && notifications.length > 0) {
                const notificationIds = notifications
                    .filter(n => !n.read)
                    .map(n => n.id);
                if (notificationIds.length > 0) {
                    await prisma.notification.updateMany({
                        where: {
                            id: { in: notificationIds },
                            userId, // Ensure user owns these notifications
                        },
                        data: {
                            read: true,
                            readAt: new Date(),
                        },
                    });
                    console.log(`Marked ${notificationIds.length} notifications as read for user ${userId}`);
                    // Update the notifications array to reflect the changes
                    notifications.forEach(notification => {
                        if (notificationIds.includes(notification.id)) {
                            notification.read = true;
                            notification.readAt = new Date();
                        }
                    });
                }
            }
            res.json({
                success: true,
                data: notifications,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
                unreadCount: markAsRead === 'true' ? 0 : unreadCount, // If we just marked all as read, unread count is 0
            });
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch notifications',
            });
        }
    },
    // Mark notification as read
    async markAsRead(req, res) {
        try {
            const userId = req.user?.id;
            const { id } = req.params;
            const notification = await prisma.notification.findFirst({
                where: { id, userId },
            });
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found',
                });
            }
            const updated = await prisma.notification.update({
                where: { id },
                data: {
                    read: true,
                    readAt: new Date(),
                },
            });
            res.json({
                success: true,
                data: updated,
            });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to mark notification as read',
            });
        }
    },
    // Mark all notifications as read
    async markAllAsRead(req, res) {
        try {
            const userId = req.user?.id;
            await prisma.notification.updateMany({
                where: { userId, read: false },
                data: {
                    read: true,
                    readAt: new Date(),
                },
            });
            res.json({
                success: true,
                message: 'All notifications marked as read',
            });
        }
        catch (error) {
            console.error('Error marking all notifications as read:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to mark all notifications as read',
            });
        }
    },
    // Delete a notification
    async deleteNotification(req, res) {
        try {
            const userId = req.user?.id;
            const { id } = req.params;
            const notification = await prisma.notification.findFirst({
                where: { id, userId },
            });
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found',
                });
            }
            await prisma.notification.delete({
                where: { id },
            });
            res.json({
                success: true,
                message: 'Notification deleted',
            });
        }
        catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete notification',
            });
        }
    },
    // Clear all notifications
    async clearAllNotifications(req, res) {
        try {
            const userId = req.user?.id;
            await prisma.notification.deleteMany({
                where: { userId },
            });
            res.json({
                success: true,
                message: 'All notifications cleared',
            });
        }
        catch (error) {
            console.error('Error clearing notifications:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to clear notifications',
            });
        }
    },
    // Get unread notification count
    async getUnreadCount(req, res) {
        try {
            const userId = req.user?.id;
            console.log('Getting unread count for user:', userId);
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User not authenticated',
                });
            }
            const unreadCount = await prisma.notification.count({
                where: {
                    userId,
                    read: false,
                },
            });
            res.json({
                success: true,
                count: unreadCount,
            });
        }
        catch (error) {
            console.error('Error fetching unread count:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch unread notification count',
            });
        }
    },
};
// Notification creation helper (to be used in other controllers)
async function createNotification({ userId, type, title, message, data, }) {
    try {
        console.log('=== Creating Notification ===');
        console.log('Target User ID (ObjectId):', userId);
        console.log('Notification Type:', type);
        console.log('Title:', title);
        // Validate userId is a valid ObjectId
        if (!userId || typeof userId !== 'string' || userId.length !== 24) {
            console.error('Invalid userId format:', userId);
            return null;
        }
        // Deduplication: Check for recent duplicate notifications (within last 5 minutes)
        // This prevents duplicate notifications when multiple services process the same event
        const deduplicationTypes = [
            'PAYOUT_PROCESSED',
            'payout_processed',
            'PAYOUT_PENDING',
            'PAYOUT_FAILED',
            'payout_retry_success',
            'earnings_update'
        ];
        if (deduplicationTypes.includes(type) && data?.bookingId) {
            const recentDuplicate = await prisma.notification.findFirst({
                where: {
                    userId,
                    type,
                    createdAt: {
                        gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
            if (recentDuplicate) {
                // Check if the data contains the same bookingId
                const existingBookingId = recentDuplicate.data?.bookingId;
                if (existingBookingId === data.bookingId) {
                    console.log(`Duplicate notification prevented: ${type} for booking ${data.bookingId}`);
                    return recentDuplicate; // Return existing notification instead of creating new one
                }
            }
        }
        const notification = await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                data,
            },
        });
        console.log('Notification created in DB with ID:', notification.id);
        console.log('Notification userId:', notification.userId);
        // Emit real-time notification if WebSocket is connected
        const io = global.io;
        if (io) {
            const roomName = `user-${userId}`; // Using user- format to match socket.ts
            console.log('Emitting notification to WebSocket room:', roomName);
            // Get all sockets in the room to verify
            const sockets = await io.in(roomName).fetchSockets();
            console.log(`Found ${sockets.length} socket(s) in room ${roomName}`);
            if (sockets.length > 0) {
                io.to(roomName).emit('notification', notification);
                console.log('Notification emitted successfully to room:', roomName);
            }
            else {
                console.log('No active sockets in room, user might be offline');
            }
        }
        else {
            console.log('WebSocket server not available, notification saved to DB only');
        }
        return notification;
    }
    catch (error) {
        console.error('Error creating notification:', error);
        return null;
    }
}
