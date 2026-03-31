"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const initializeSocket = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            // origin: process.env.FRONTEND_URL || 'http://localhost:3001',
            origin: '*',
            credentials: true,
        },
    });
    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            console.log('WebSocket Auth - Decoded token:', {
                id: decoded.id,
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role
            });
            // Get userId from token (it's stored as 'id' in the JWT)
            const userId = decoded.id || decoded.userId;
            if (!userId) {
                console.error('No userId found in token');
                return next(new Error('Invalid token - no user ID'));
            }
            // Verify user exists
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, role: true, name: true, email: true }
            });
            if (!user) {
                return next(new Error('User not found'));
            }
            socket.userId = user.id;
            socket.userRole = user.role;
            socket.userEmail = user.email;
            next();
        }
        catch (error) {
            next(new Error('Invalid token'));
        }
    });
    // Connection handler
    io.on('connection', async (socket) => {
        console.log('=== WebSocket Connection ===');
        console.log('User connected:');
        console.log('  - ID (ObjectId):', socket.userId);
        console.log('  - Email:', socket.userEmail);
        console.log('  - Role:', socket.userRole);
        console.log('  - Socket ID:', socket.id);
        // Join user's personal room with proper format
        const userRoom = `user-${socket.userId}`;
        socket.join(userRoom);
        console.log(`  - Joined room: ${userRoom}`);
        // Log all rooms this socket is in
        console.log('  - Socket is in rooms:', Array.from(socket.rooms));
        // Check how many sockets are in the user's room
        const socketsInRoom = await io.in(userRoom).fetchSockets();
        console.log(`  - Total sockets in ${userRoom}: ${socketsInRoom.length}`);
        // Automatically join all conversation rooms for this user
        try {
            const conversations = await prisma.conversation.findMany({
                where: {
                    participants: {
                        has: socket.userId
                    }
                },
                select: { id: true }
            });
            conversations.forEach(conv => {
                const convRoom = `conversation:${conv.id}`;
                socket.join(convRoom);
                console.log(`  - Auto-joined conversation room: ${convRoom}`);
            });
            console.log(`  - Total conversation rooms joined: ${conversations.length}`);
        }
        catch (error) {
            console.error('Error auto-joining conversations:', error);
        }
        // Also handle explicit join-conversations event
        socket.on('join-conversations', async () => {
            try {
                const conversations = await prisma.conversation.findMany({
                    where: {
                        participants: {
                            has: socket.userId
                        }
                    },
                    select: { id: true }
                });
                conversations.forEach(conv => {
                    socket.join(`conversation:${conv.id}`);
                });
                console.log(`[join-conversations] User ${socket.userId} joined ${conversations.length} conversation rooms`);
            }
            catch (error) {
                console.error('Error joining conversations:', error);
            }
        });
        // Handle joining a specific conversation
        socket.on('join-conversation', (conversationId) => {
            socket.join(`conversation:${conversationId}`);
        });
        // Handle leaving a conversation
        socket.on('leave-conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
        });
        // Handle typing indicator
        socket.on('typing', ({ conversationId, isTyping }) => {
            socket.to(`conversation:${conversationId}`).emit('user-typing', {
                userId: socket.userId,
                isTyping
            });
        });
        // Handle message read
        socket.on('mark-as-read', async ({ messageIds }) => {
            try {
                await prisma.message.updateMany({
                    where: {
                        id: { in: messageIds },
                        receiverId: socket.userId
                    },
                    data: {
                        isRead: true,
                        readAt: new Date()
                    }
                });
                // Notify sender that message was read
                const messages = await prisma.message.findMany({
                    where: { id: { in: messageIds } },
                    select: { senderId: true, conversationId: true }
                });
                messages.forEach(msg => {
                    io.to(`user-${msg.senderId}`).emit('message-read', {
                        messageIds,
                        conversationId: msg.conversationId
                    });
                });
            }
            catch (error) {
                console.error('Error marking messages as read:', error);
            }
        });
        // Handle fetching messages for a conversation
        socket.on('fetch-messages', async ({ conversationId, page = 1, limit = 50 }) => {
            try {
                console.log(`[fetch-messages] User ${socket.userId} fetching messages for conversation ${conversationId}`);
                // Verify user has access to this conversation
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: conversationId,
                        participants: {
                            has: socket.userId
                        }
                    }
                });
                if (!conversation) {
                    socket.emit('messages-error', {
                        error: 'Conversation not found or access denied'
                    });
                    return;
                }
                // Fetch messages with pagination
                const skip = (page - 1) * limit;
                const messages = await prisma.message.findMany({
                    where: {
                        conversationId
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    skip,
                    take: limit,
                    include: {
                        sender: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                image: true
                            }
                        },
                        receiver: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                image: true
                            }
                        }
                    }
                });
                // Get total count for pagination
                const totalCount = await prisma.message.count({
                    where: { conversationId }
                });
                // Emit messages back to the requesting socket
                socket.emit('messages-fetched', {
                    conversationId,
                    messages: messages.reverse(), // Reverse to get chronological order
                    pagination: {
                        page,
                        limit,
                        totalCount,
                        totalPages: Math.ceil(totalCount / limit),
                        hasMore: skip + limit < totalCount
                    }
                });
                console.log(`[fetch-messages] Sent ${messages.length} messages to user ${socket.userId}`);
            }
            catch (error) {
                console.error('Error fetching messages:', error);
                socket.emit('messages-error', {
                    error: 'Failed to fetch messages'
                });
            }
        });
        // Handle fetching notifications
        socket.on('fetch-notifications', async ({ page = 1, limit = 20 }) => {
            try {
                console.log(`[fetch-notifications] User ${socket.userId} fetching notifications`);
                const skip = (page - 1) * limit;
                // Fetch notifications
                const notifications = await prisma.notification.findMany({
                    where: {
                        userId: socket.userId
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    skip,
                    take: limit
                });
                // Get unread count
                const unreadCount = await prisma.notification.count({
                    where: {
                        userId: socket.userId,
                        read: false
                    }
                });
                // Get total count
                const totalCount = await prisma.notification.count({
                    where: {
                        userId: socket.userId
                    }
                });
                // Emit notifications back to the requesting socket
                socket.emit('notifications-fetched', {
                    notifications,
                    unreadCount,
                    pagination: {
                        page,
                        limit,
                        totalCount,
                        totalPages: Math.ceil(totalCount / limit),
                        hasMore: skip + limit < totalCount
                    }
                });
                console.log(`[fetch-notifications] Sent ${notifications.length} notifications to user ${socket.userId}`);
            }
            catch (error) {
                console.error('Error fetching notifications:', error);
                socket.emit('notifications-error', {
                    error: 'Failed to fetch notifications'
                });
            }
        });
        // Handle marking notifications as read
        socket.on('mark-notification-read', async ({ notificationId }) => {
            try {
                await prisma.notification.update({
                    where: {
                        id: notificationId,
                        userId: socket.userId
                    },
                    data: {
                        read: true,
                        readAt: new Date()
                    }
                });
                // Get updated unread count
                const unreadCount = await prisma.notification.count({
                    where: {
                        userId: socket.userId,
                        read: false
                    }
                });
                // Emit updated unread count
                socket.emit('notification-read', {
                    notificationId,
                    unreadCount
                });
                console.log(`[mark-notification-read] Notification ${notificationId} marked as read`);
            }
            catch (error) {
                console.error('Error marking notification as read:', error);
            }
        });
        // Handle marking all notifications as read
        socket.on('mark-all-notifications-read', async () => {
            try {
                await prisma.notification.updateMany({
                    where: {
                        userId: socket.userId,
                        read: false
                    },
                    data: {
                        read: true,
                        readAt: new Date()
                    }
                });
                // Emit success with zero unread count
                socket.emit('all-notifications-read', {
                    unreadCount: 0
                });
                console.log(`[mark-all-notifications-read] All notifications marked as read for user ${socket.userId}`);
            }
            catch (error) {
                console.error('Error marking all notifications as read:', error);
            }
        });
        // Handle disconnect
        socket.on('disconnect', () => {
            console.log(`User ${socket.userId} disconnected`);
        });
    });
    return io;
};
exports.initializeSocket = initializeSocket;
