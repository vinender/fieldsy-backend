//@ts-nocheck
import { Server } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { sendMessageToKafka } from '../config/kafka';

const prisma = new PrismaClient();

// Socket debug logging flag - controlled by environment variable
const SOCKET_DEBUG = process.env.SOCKET_DEBUG_LOGGING === 'true';

// Debug logger - only logs if SOCKET_DEBUG is true
const socketLog = (...args: any[]) => {
  if (SOCKET_DEBUG) {
    console.log(...args);
  }
};

// Always log errors regardless of debug flag
const socketError = (...args: any[]) => {
  console.error(...args);
};

export function setupWebSocket(server: HTTPServer) {
  // ALLOW ALL ORIGINS WITH DYNAMIC REFLECTION FOR CREDENTIALS
  console.log('[WebSocket] CORS: Allowing all origins with credentials support');

  const io = new Server(server, {
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
  (global as any).io = io;

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
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
      (socket as any).userId = user.id;
      (socket as any).userRole = user.role;
      (socket as any).user = user;

      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = (socket as any).userId;
    const userRole = (socket as any).userRole;
    const userEmail = (socket as any).user?.email;

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
    } catch (error) {
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
    socket.on('join-conversation', async (data: { conversationId: string }) => {
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

        // Fetch initial message history with pagination (most recent messages first)
        const limit = 30; // Initial load limit
        const [messages, totalCount] = await Promise.all([
          prisma.message.findMany({
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
            orderBy: { createdAt: 'desc' },  // Get newest first
            take: limit
          }),
          prisma.message.count({ where: { conversationId } })
        ]);

        // Reverse to show oldest to newest in UI
        messages.reverse();

        // Send message history with pagination info
        socket.emit('message-history', {
          conversationId,
          messages,
          pagination: {
            total: totalCount,
            limit,
            hasMore: totalCount > limit,
            oldestMessageId: messages.length > 0 ? messages[0].id : null
          }
        });

        console.log(`[Socket] Sent ${messages.length}/${totalCount} messages to user ${userId}`);

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

      } catch (error) {
        console.error('[Socket] Error joining conversation:', error);
        socket.emit('conversation-error', { error: 'Failed to join conversation' });
      }
    });

    // Fetch messages for a conversation (cursor-based pagination for infinite scroll)
    socket.on('fetch-messages', async (data: {
      conversationId: string;
      beforeMessageId?: string;  // Cursor: fetch messages older than this ID
      limit?: number;
    }) => {
      try {
        const { conversationId, beforeMessageId, limit: requestedLimit } = data;

        // Validation
        if (!conversationId || typeof conversationId !== 'string') {
          socket.emit('messages-error', { error: 'Invalid conversationId' });
          return;
        }

        // Sanitize limit (max 50, default 30)
        const limit = Math.min(Math.max(requestedLimit || 30, 1), 50);

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

        // Build query with cursor if provided
        const whereClause: any = { conversationId };

        if (beforeMessageId) {
          // Get the timestamp of the cursor message for efficient querying
          const cursorMessage = await prisma.message.findUnique({
            where: { id: beforeMessageId },
            select: { createdAt: true }
          });

          if (cursorMessage) {
            whereClause.createdAt = { lt: cursorMessage.createdAt };
          }
        }

        // Get messages older than cursor
        const messages = await prisma.message.findMany({
          where: whereClause,
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
          take: limit + 1  // Fetch one extra to check if there are more
        });

        // Check if there are more messages
        const hasMore = messages.length > limit;
        if (hasMore) {
          messages.pop(); // Remove the extra message
        }

        // Reverse to show chronological order
        messages.reverse();

        // Send messages to this socket
        socket.emit('messages-fetched', {
          conversationId,
          messages,
          pagination: {
            limit,
            hasMore,
            oldestMessageId: messages.length > 0 ? messages[0].id : null
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

      } catch (error) {
        console.error('[Socket] Error fetching messages:', error);
        socket.emit('messages-error', { error: 'Failed to fetch messages' });
      }
    });

    // Send a message via socket (with acknowledgment callback)
    socket.on('send-message', async (data: { conversationId: string; content: string; receiverId: string; correlationId?: string }, callback?: Function) => {
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
          if (callback) callback({ success: false, error: 'Missing required fields' });
          return;
        }

        const convRoom = `conversation:${conversationId}`;
        socketLog(`[Socket] User ${userId} sending message to conversation ${conversationId}`);

        // Join conversation room if not already in it
        if (!socket.rooms.has(convRoom)) {
          socketLog(`[Socket] Adding sender to conversation room: ${convRoom}`);
          socket.join(convRoom);
        } else {
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
          if (callback) callback({ success: false, error: 'Access denied' });
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
          if (callback) callback({ success: false, error: error.error, blocked: true });
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
            name: (socket as any).user?.name || 'User',
            image: (socket as any).user?.image || null,
            role: (socket as any).userRole || 'DOG_OWNER'
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
          const savedMessage = await sendMessageToKafka({
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
          } else {
            socketLog(`[Socket] Message sent to Kafka queue, will be processed asynchronously`);
          }
        } catch (kafkaError) {
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

      } catch (error) {
        socketError('[Socket] Error sending message:', error);
        const errorResponse = { error: 'Failed to send message', correlationId: data.correlationId };
        socket.emit('message-error', errorResponse);
        if (callback) callback({ success: false, error: 'Failed to send message' });
      }
    });

    // Mark messages as read
    socket.on('mark-as-read', async (data: { messageIds: string[] }) => {
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

      } catch (error) {
        console.error('[Socket] Error marking messages as read:', error);
      }
    });

    // Typing indicator
    socket.on('typing', async (data: { conversationId: string; isTyping: boolean }) => {
      try {
        const { conversationId, isTyping } = data;

        // Broadcast to conversation room (except sender)
        socket.to(`conversation:${conversationId}`).emit('user-typing', {
          userId,
          conversationId,
          isTyping
        });

      } catch (error) {
        console.error('[Socket] Error handling typing:', error);
      }
    });

    // ============ END CHAT MESSAGING EVENTS ============

    // Handle disconnect
    socket.on('disconnect', () => {
      socketLog(`User ${userId} disconnected`);
    });

    // Handle marking notifications as read
    socket.on('markAsRead', async (notificationId: string) => {
      try {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { read: true, readAt: new Date() },
        });

        // Send updated unread count
        sendUnreadCount(userId);
      } catch (error) {
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
      } catch (error) {
        console.error('Error marking all notifications as read:', error);
      }
    });
  });

  // Helper function to send unread count
  async function sendUnreadCount(userId: string) {
    try {
      const unreadCount = await prisma.notification.count({
        where: { userId, read: false },
      });
      
      io.to(`user-${userId}`).emit('unreadCount', unreadCount);
    } catch (error) {
      console.error('Error sending unread count:', error);
    }
  }

  return io;
}
