"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocket = setupWebSocket;
//@ts-nocheck
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const kafka_1 = require("../config/kafka");
const prisma = new client_1.PrismaClient();
// Socket debug logging flag - controlled by environment variable
const SOCKET_DEBUG = process.env.SOCKET_DEBUG_LOGGING === 'true';
// Debug logger - only logs if SOCKET_DEBUG is true
const socketLog = (...args) => {
    if (SOCKET_DEBUG) {
        console.log(...args);
    }
};
// Always log errors regardless of debug flag
const socketError = (...args) => {
    console.error(...args);
};
function setupWebSocket(server) {
    // ALLOW ALL ORIGINS WITH DYNAMIC REFLECTION FOR CREDENTIALS
    console.log('[WebSocket] CORS: Allowing all origins with credentials support');
    const io = new socket_io_1.Server(server, {
        cors: {
            // CRITICAL: Cannot use origin: '*' with credentials: true
            // Solution: Dynamically reflect the requesting origin
            origin: (origin, callback) => {
                // Always allow requests (reflect the origin back)
                // This allows credentials while accepting all origins
                callback(null, origin || '*');
            },
            credentials: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        },
        transports: ['polling', 'websocket'], // Polling first for better compatibility
        allowEIO3: true, // Allow different Socket.IO versions
        pingTimeout: 60000, // 60 seconds
        pingInterval: 25000, // 25 seconds
        upgradeTimeout: 30000, // 30 seconds for upgrade
        maxHttpBufferSize: 1e8, // 100 MB
        path: '/socket.io/', // Explicit path
    });
    // Store io instance globally for use in other modules
    global.io = io;
    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            console.log('WebSocket Auth - Decoded token:', {
                id: decoded.id,
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role
            });
            // The token uses 'id' not 'userId'
            const userId = decoded.id || decoded.userId;
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, role: true, email: true, name: true },
            });
            if (!user) {
                return next(new Error('User not found'));
            }
            // Attach user to socket
            socket.userId = user.id;
            socket.userRole = user.role;
            socket.user = user;
            next();
        }
        catch (error) {
            next(new Error('Authentication error'));
        }
    });
    io.on('connection', async (socket) => {
        const userId = socket.userId;
        const userRole = socket.userRole;
        const userEmail = socket.user?.email;
        socketLog('=== WebSocket Connection (websocket.ts) ===');
        socketLog(`User connected:`);
        socketLog(`  - ID (ObjectId): ${userId}`);
        socketLog(`  - Email: ${userEmail}`);
        socketLog(`  - Role: ${userRole}`);
        socketLog(`  - Socket ID: ${socket.id}`);
        // Leave all rooms first (except the socket's own room)
        const rooms = Array.from(socket.rooms);
        for (const room of rooms) {
            if (room !== socket.id) {
                socket.leave(room);
            }
        }
        // Join user-specific room based on ObjectId
        const userRoom = `user-${userId}`;
        socket.join(userRoom);
        socketLog(`  - Joined room: ${userRoom}`);
        // Auto-join all conversation rooms for this user
        try {
            const conversations = await prisma.conversation.findMany({
                where: {
                    participants: {
                        has: userId
                    }
                },
                select: { id: true }
            });
            conversations.forEach(conv => {
                const convRoom = `conversation:${conv.id}`;
                socket.join(convRoom);
                socketLog(`  - Auto-joined conversation: ${convRoom}`);
            });
            socketLog(`  - Total conversations joined: ${conversations.length}`);
        }
        catch (error) {
            socketError('Error auto-joining conversations:', error);
        }
        // Verify room membership
        if (SOCKET_DEBUG) {
            const roomsAfterJoin = Array.from(socket.rooms);
            socketLog(`  - Socket is in rooms:`, roomsAfterJoin);
            // Check how many sockets are in this user's room
            const socketsInRoom = await io.in(userRoom).fetchSockets();
            socketLog(`  - Total sockets in ${userRoom}: ${socketsInRoom.length}`);
        }
        // Send initial unread count
        sendUnreadCount(userId);
        // ============ CHAT MESSAGING SOCKET EVENTS ============
        // Join a specific conversation and fetch message history
        socket.on('join-conversation', async (data) => {
            try {
                const { conversationId } = data;
                console.log(`[Socket] User ${userId} joining conversation: ${conversationId}`);
                // Verify user is participant
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: conversationId,
                        participants: {
                            has: userId
                        }
                    }
                });
                if (!conversation) {
                    socket.emit('conversation-error', { error: 'Access denied' });
                    return;
                }
                // Join conversation room
                const convRoom = `conversation:${conversationId}`;
                socket.join(convRoom);
                console.log(`[Socket] User ${userId} joined room: ${convRoom}`);
                // Verify room membership
                const socketsInRoom = await io.in(convRoom).fetchSockets();
                console.log(`[Socket] Room ${convRoom} now has ${socketsInRoom.length} members`);
                // Fetch and send message history (most recent 50 messages)
                const messages = await prisma.message.findMany({
                    where: { conversationId },
                    include: {
                        sender: {
                            select: {
                                id: true,
                                name: true,
                                image: true,
                                role: true
                            }
                        },
                        receiver: {
                            select: {
                                id: true,
                                name: true,
                                image: true,
                                role: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }, // Get newest first
                    take: 50
                });
                // Reverse to show oldest to newest
                messages.reverse();
                // Send message history to this specific socket
                socket.emit('message-history', {
                    conversationId,
                    messages,
                    total: messages.length
                });
                console.log(`[Socket] Sent ${messages.length} messages to user ${userId}`);
                // Mark unread messages as read
                await prisma.message.updateMany({
                    where: {
                        conversationId,
                        receiverId: userId,
                        isRead: false
                    },
                    data: {
                        isRead: true,
                        readAt: new Date()
                    }
                });
            }
            catch (error) {
                console.error('[Socket] Error joining conversation:', error);
                socket.emit('conversation-error', { error: 'Failed to join conversation' });
            }
        });
        // Fetch messages for a conversation (pagination support)
        socket.on('fetch-messages', async (data) => {
            try {
                const { conversationId, page = 1, limit = 50 } = data;
                const skip = (page - 1) * limit;
                // Verify user is participant
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: conversationId,
                        participants: {
                            has: userId
                        }
                    }
                });
                if (!conversation) {
                    socket.emit('messages-error', { error: 'Access denied' });
                    return;
                }
                // Get messages
                const messages = await prisma.message.findMany({
                    where: { conversationId },
                    include: {
                        sender: {
                            select: {
                                id: true,
                                name: true,
                                image: true,
                                role: true
                            }
                        },
                        receiver: {
                            select: {
                                id: true,
                                name: true,
                                image: true,
                                role: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit
                });
                const total = await prisma.message.count({
                    where: { conversationId }
                });
                // Send messages to this socket
                socket.emit('messages-fetched', {
                    conversationId,
                    messages: messages.reverse(),
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages: Math.ceil(total / limit)
                    }
                });
                // Mark messages as read
                await prisma.message.updateMany({
                    where: {
                        conversationId,
                        receiverId: userId,
                        isRead: false
                    },
                    data: {
                        isRead: true,
                        readAt: new Date()
                    }
                });
            }
            catch (error) {
                console.error('[Socket] Error fetching messages:', error);
                socket.emit('messages-error', { error: 'Failed to fetch messages' });
            }
        });
        // Send a message via socket (with acknowledgment callback)
        socket.on('send-message', async (data, callback) => {
            socketLog(`[Socket] === SEND-MESSAGE EVENT RECEIVED ===`);
            socketLog(`[Socket] From user: ${userId}`);
            socketLog(`[Socket] Data:`, data);
            socketLog(`[Socket] Has callback:`, !!callback);
            try {
                const { conversationId, content, receiverId, correlationId } = data;
                // Quick validation
                if (!conversationId || !content || !receiverId) {
                    socketLog(`[Socket] Missing required fields, sending error`);
                    const error = { error: 'Missing required fields', correlationId };
                    socket.emit('message-error', error);
                    if (callback)
                        callback({ success: false, error: 'Missing required fields' });
                    return;
                }
                const convRoom = `conversation:${conversationId}`;
                socketLog(`[Socket] User ${userId} sending message to conversation ${conversationId}`);
                // Join conversation room if not already in it
                if (!socket.rooms.has(convRoom)) {
                    socketLog(`[Socket] Adding sender to conversation room: ${convRoom}`);
                    socket.join(convRoom);
                }
                else {
                    socketLog(`[Socket] Sender already in conversation room: ${convRoom}`);
                }
                // Parallel database operations for speed
                const [conversation, senderBlockedReceiver, receiverBlockedSender] = await Promise.all([
                    // Verify user is participant
                    prisma.conversation.findFirst({
                        where: {
                            id: conversationId,
                            participants: {
                                has: userId
                            }
                        }
                    }),
                    // Check if sender blocked receiver
                    prisma.userBlock.findUnique({
                        where: {
                            blockerId_blockedUserId: {
                                blockerId: userId,
                                blockedUserId: receiverId
                            }
                        }
                    }),
                    // Check if receiver blocked sender
                    prisma.userBlock.findUnique({
                        where: {
                            blockerId_blockedUserId: {
                                blockerId: receiverId,
                                blockedUserId: userId
                            }
                        }
                    })
                ]);
                // Validation checks
                if (!conversation) {
                    socketLog(`[Socket] Access denied - user not participant in conversation`);
                    const error = { error: 'Access denied', correlationId };
                    socket.emit('message-error', error);
                    if (callback)
                        callback({ success: false, error: 'Access denied' });
                    return;
                }
                if (senderBlockedReceiver || receiverBlockedSender) {
                    socketLog(`[Socket] Cannot send - users have blocked each other`);
                    const error = {
                        error: 'Cannot send messages. One or both users have blocked each other.',
                        blocked: true,
                        correlationId
                    };
                    socket.emit('message-error', error);
                    if (callback)
                        callback({ success: false, error: error.error, blocked: true });
                    return;
                }
                // Generate a temporary message ID for immediate ACK
                const tempMessageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const timestamp = new Date();
                // Create optimistic message for immediate ACK
                const optimisticMessage = {
                    id: tempMessageId,
                    conversationId,
                    senderId: userId,
                    receiverId,
                    content,
                    createdAt: timestamp.toISOString(),
                    isRead: false,
                    sender: {
                        id: userId,
                        name: socket.user?.name || 'User',
                        image: socket.user?.image || null,
                        role: socket.userRole || 'DOG_OWNER'
                    }
                };
                // Send immediate ACK to client with optimistic message
                if (callback) {
                    socketLog(`[Socket] Sending immediate ACK with temp ID: ${tempMessageId}`);
                    callback({
                        success: true,
                        message: optimisticMessage,
                        correlationId: data.correlationId,
                        pending: true // Indicates message is being processed
                    });
                }
                // Send message to Kafka for async processing (or process directly if Kafka disabled)
                socketLog(`[Socket] Sending message to Kafka for processing`);
                try {
                    const savedMessage = await (0, kafka_1.sendMessageToKafka)({
                        conversationId,
                        senderId: userId,
                        receiverId,
                        content,
                        timestamp,
                        correlationId: correlationId || tempMessageId,
                        socketId: socket.id // Track which socket sent this
                    });
                    // processMessage() in kafka.ts already handles all emissions
                    // (new-message, new-message-notification, message-confirmed)
                    // So we just log the result here
                    if (savedMessage) {
                        socketLog(`[Socket] Direct processing complete, message ID: ${savedMessage.id}`);
                    }
                    else {
                        socketLog(`[Socket] Message sent to Kafka queue, will be processed asynchronously`);
                    }
                }
                catch (kafkaError) {
                    socketError('[Socket] Kafka/processing error:', kafkaError);
                    socketError('[Socket] Error details:', {
                        name: kafkaError?.name,
                        message: kafkaError?.message,
                        stack: kafkaError?.stack?.split('\n').slice(0, 3).join('\n')
                    });
                    // Notify client of the error with more details
                    socket.emit('message-error', {
                        error: 'Failed to process message',
                        errorDetails: kafkaError?.message || 'Unknown error',
                        correlationId: data.correlationId,
                        tempId: tempMessageId
                    });
                }
                socketLog(`[Socket] Message flow completed successfully`);
            }
            catch (error) {
                socketError('[Socket] Error sending message:', error);
                const errorResponse = { error: 'Failed to send message', correlationId: data.correlationId };
                socket.emit('message-error', errorResponse);
                if (callback)
                    callback({ success: false, error: 'Failed to send message' });
            }
        });
        // Mark messages as read
        socket.on('mark-as-read', async (data) => {
            try {
                const { messageIds } = data;
                await prisma.message.updateMany({
                    where: {
                        id: { in: messageIds },
                        receiverId: userId
                    },
                    data: {
                        isRead: true,
                        readAt: new Date()
                    }
                });
                console.log(`[Socket] Marked ${messageIds.length} messages as read for user ${userId}`);
            }
            catch (error) {
                console.error('[Socket] Error marking messages as read:', error);
            }
        });
        // Typing indicator
        socket.on('typing', async (data) => {
            try {
                const { conversationId, isTyping } = data;
                // Broadcast to conversation room (except sender)
                socket.to(`conversation:${conversationId}`).emit('user-typing', {
                    userId,
                    conversationId,
                    isTyping
                });
            }
            catch (error) {
                console.error('[Socket] Error handling typing:', error);
            }
        });
        // ============ END CHAT MESSAGING EVENTS ============
        // Handle disconnect
        socket.on('disconnect', () => {
            socketLog(`User ${userId} disconnected`);
        });
        // Handle marking notifications as read
        socket.on('markAsRead', async (notificationId) => {
            try {
                await prisma.notification.update({
                    where: { id: notificationId },
                    data: { read: true, readAt: new Date() },
                });
                // Send updated unread count
                sendUnreadCount(userId);
            }
            catch (error) {
                console.error('Error marking notification as read:', error);
            }
        });
        // Handle marking all as read
        socket.on('markAllAsRead', async () => {
            try {
                await prisma.notification.updateMany({
                    where: { userId, read: false },
                    data: { read: true, readAt: new Date() },
                });
                // Send updated unread count
                sendUnreadCount(userId);
            }
            catch (error) {
                console.error('Error marking all notifications as read:', error);
            }
        });
    });
    // Helper function to send unread count
    async function sendUnreadCount(userId) {
        try {
            const unreadCount = await prisma.notification.count({
                where: { userId, read: false },
            });
            io.to(`user-${userId}`).emit('unreadCount', unreadCount);
        }
        catch (error) {
            console.error('Error sending unread count:', error);
        }
    }
    return io;
}
