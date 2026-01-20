//@ts-nocheck
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';

const prisma = new PrismaClient();

// Flag to track if Kafka is available
let kafkaEnabled = false;
let kafkaConnecting = false; // Prevent multiple connection attempts
let producer: Producer | null = null;
let consumer: Consumer | null = null;
let kafkaInstance: Kafka | null = null;

// ============================================
// AUTO-SCALING CONFIGURATION
// ============================================
const AUTO_SCALE_CONFIG = {
  enabled: process.env.KAFKA_AUTO_SCALE !== 'false', // Enabled by default
  threshold: parseInt(process.env.KAFKA_THRESHOLD || '100', 10), // Messages per minute to trigger Kafka
  windowMs: 60000, // 1 minute window
  cooldownMs: 300000, // 5 minutes before disabling Kafka after load drops
};

// Rate tracking
let messageCount = 0;
let windowStartTime = Date.now();
let lastHighLoadTime = 0;
let currentRate = 0;

// Track and log message rate
function trackMessageRate(): void {
  messageCount++;
  const now = Date.now();
  const elapsed = now - windowStartTime;

  // Calculate rate every window
  if (elapsed >= AUTO_SCALE_CONFIG.windowMs) {
    currentRate = Math.round((messageCount / elapsed) * 60000); // msgs/min
    console.log(`[AutoScale] Message rate: ${currentRate} msgs/min (threshold: ${AUTO_SCALE_CONFIG.threshold})`);

    // Check if we need to scale up
    if (currentRate >= AUTO_SCALE_CONFIG.threshold) {
      lastHighLoadTime = now;
      if (!kafkaEnabled && !kafkaConnecting && AUTO_SCALE_CONFIG.enabled) {
        console.log(`[AutoScale] 🚀 High load detected! Enabling Kafka...`);
        enableKafkaAutomatically();
      }
    }

    // Reset window
    messageCount = 0;
    windowStartTime = now;
  }
}

// Get current stats (for monitoring/debugging)
export function getMessageStats() {
  return {
    currentRate,
    kafkaEnabled,
    threshold: AUTO_SCALE_CONFIG.threshold,
    autoScaleEnabled: AUTO_SCALE_CONFIG.enabled,
  };
}

// Dynamically enable Kafka when threshold is reached
async function enableKafkaAutomatically(): Promise<void> {
  if (kafkaConnecting || kafkaEnabled) return;

  kafkaConnecting = true;
  console.log('[AutoScale] Attempting to connect to Kafka...');

  try {
    // Create Kafka instance if not exists
    if (!kafkaInstance) {
      kafkaInstance = new Kafka({
        clientId: 'fieldsy-chat',
        brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
        retry: {
          initialRetryTime: 100,
          retries: 3,
        },
      });
    }

    // Create producer and consumer
    producer = kafkaInstance.producer();
    consumer = kafkaInstance.consumer({ groupId: 'chat-service-group' });

    // Connect producer
    await producer.connect();
    console.log('[AutoScale] ✅ Kafka producer connected');

    // Connect consumer
    await consumer.connect();
    console.log('[AutoScale] ✅ Kafka consumer connected');

    // Subscribe to topic
    await consumer.subscribe({ topic: 'chat-messages', fromBeginning: false });

    // Run consumer
    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          if (!message.value) return;
          const chatMessage: ChatMessage = JSON.parse(message.value.toString());
          if (socketIO) {
            await processMessage(chatMessage, socketIO);
          }
        } catch (error) {
          console.error('[AutoScale] Error processing Kafka message:', error);
        }
      },
    });

    kafkaEnabled = true;
    console.log('[AutoScale] ✅ Kafka fully enabled via auto-scaling!');
  } catch (error) {
    console.error('[AutoScale] ❌ Failed to enable Kafka:', error.message);
    console.log('[AutoScale] Continuing with direct processing...');
    // Clean up on failure
    producer = null;
    consumer = null;
  } finally {
    kafkaConnecting = false;
  }
}

// Initialize Kafka on startup (only if explicitly enabled via env)
if (process.env.ENABLE_KAFKA === 'true') {
  kafkaInstance = new Kafka({
    clientId: 'fieldsy-chat',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
    retry: {
      initialRetryTime: 100,
      retries: 3,
    },
  });

  producer = kafkaInstance.producer();
  consumer = kafkaInstance.consumer({ groupId: 'chat-service-group' });
}

// Message types
export interface ChatMessage {
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: Date;
  correlationId?: string;
  socketId?: string;
}

// Track processed messages to prevent duplicates
const processedMessages = new Set<string>();
const MESSAGE_CACHE_SIZE = 10000; // Keep last 10k message IDs
const messageCacheArray: string[] = [];

// Store Socket.io instance for direct message handling
let socketIO: SocketIOServer | null = null;

// Batch conversation updates to avoid bottleneck
const conversationUpdateQueue = new Map<string, { content: string; timestamp: Date; timeout: NodeJS.Timeout }>();
const CONVERSATION_UPDATE_DELAY = 1000; // Wait 1 second before updating conversation

// Initialize Kafka producer and consumer (if enabled)
export const initializeKafka = async (io: SocketIOServer) => {
  socketIO = io; // Store the Socket.io instance

  if (!producer || !consumer) {
    console.log('Kafka is disabled. Messages will be handled directly.');
    kafkaEnabled = false;
    return;
  }

  try {
    // Connect producer
    await producer.connect();
    console.log('Kafka producer connected');

    // Connect consumer
    await consumer.connect();
    console.log('Kafka consumer connected');

    kafkaEnabled = true;

    // Subscribe to the chat topic
    await consumer.subscribe({ topic: 'chat-messages', fromBeginning: false });

    // Run the consumer
    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          if (!message.value) return;

          const chatMessage: ChatMessage = JSON.parse(message.value.toString());
          await processMessage(chatMessage, io);
        } catch (error) {
          console.error('Error processing Kafka message:', error);
        }
      },
    });
  } catch (error) {
    console.error('Kafka initialization failed, falling back to direct processing:', error);
    kafkaEnabled = false;
  }
};

// Batch update conversation - debounced to handle rapid messages
function scheduleConversationUpdate(conversationId: string, content: string, timestamp: Date) {
  // Clear existing timeout if any
  const existing = conversationUpdateQueue.get(conversationId);
  if (existing) {
    clearTimeout(existing.timeout);
  }

  // Schedule new update
  const timeout = setTimeout(async () => {
    try {
      const data = conversationUpdateQueue.get(conversationId);
      if (data) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessage: data.content,
            lastMessageAt: data.timestamp,
          },
        });
        conversationUpdateQueue.delete(conversationId);
        console.log(`[ConversationUpdate] Updated conversation ${conversationId}`);
      }
    } catch (error) {
      console.warn('[ConversationUpdate] Failed (non-critical):', error.message);
      conversationUpdateQueue.delete(conversationId);
    }
  }, CONVERSATION_UPDATE_DELAY);

  conversationUpdateQueue.set(conversationId, { content, timestamp, timeout });
}

// Process message (used by both Kafka and direct processing)
async function processMessage(chatMessage: ChatMessage, io: SocketIOServer) {
  // Generate unique key using correlationId (preferred) or content hash
  // IMPORTANT: Don't use just timestamp - multiple messages can have same timestamp!
  const messageKey = chatMessage.correlationId ||
    `${chatMessage.conversationId}-${chatMessage.senderId}-${chatMessage.timestamp.getTime()}-${chatMessage.content.slice(0, 20)}-${Math.random().toString(36).substr(2, 5)}`;

  try {
    // Check for duplicate processing - only if correlationId exists (client-generated unique ID)
    // Without correlationId, we skip duplicate check to avoid false positives
    if (chatMessage.correlationId && processedMessages.has(messageKey)) {
      console.log(`[ProcessMessage] Skipping duplicate message: ${messageKey}`);
      return null;
    }

    // Add to processed set only if we have a reliable correlationId
    if (chatMessage.correlationId) {
      processedMessages.add(messageKey);
      messageCacheArray.push(messageKey);

      // Maintain cache size
      if (messageCacheArray.length > MESSAGE_CACHE_SIZE) {
        const oldKey = messageCacheArray.shift();
        if (oldKey) processedMessages.delete(oldKey);
      }
    }

    // Save message to database (this is the only blocking operation)
    const savedMessage = await prisma.message.create({
      data: {
        conversationId: chatMessage.conversationId,
        senderId: chatMessage.senderId,
        receiverId: chatMessage.receiverId,
        content: chatMessage.content,
        createdAt: chatMessage.timestamp,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            role: true
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            role: true
          },
        },
      },
    });

    // Schedule conversation update (batched, non-blocking)
    scheduleConversationUpdate(chatMessage.conversationId, chatMessage.content, chatMessage.timestamp);

    // Emit to Socket.io rooms immediately (non-blocking)
    const conversationRoom = `conversation:${chatMessage.conversationId}`;
    const receiverRoom = `user-${chatMessage.receiverId}`;

    // Emit to conversation room (all participants)
    io.to(conversationRoom).emit('new-message', savedMessage);

    // Notify receiver if not in conversation room
    io.to(receiverRoom).emit('new-message-notification', {
      conversationId: chatMessage.conversationId,
      message: savedMessage,
    });

    // Send confirmation to the specific socket that sent the message (if still connected)
    if (chatMessage.socketId && chatMessage.correlationId) {
      const senderSocket = io.sockets.sockets.get(chatMessage.socketId);
      if (senderSocket) {
        senderSocket.emit('message-confirmed', {
          tempId: chatMessage.correlationId,
          realId: savedMessage.id,
          message: savedMessage,
          correlationId: chatMessage.correlationId
        });
      }
    }

    // --- SEND PUSH NOTIFICATION ---
    // Only send if the user is NOT in the conversation room (i.e., not actively viewing)
    // Or if we want to notify them regardless (usually better UX to always notify on mobile/background)
    try {
      // Import dynamically to avoid circular dependencies if any
      const { PushNotificationService } = await import('../services/push-notification.service');

      console.log(`[ProcessMessage] Sending push notification to ${chatMessage.receiverId}`);
      await PushNotificationService.sendNotificationByType(
        chatMessage.receiverId,
        'new_message',
        savedMessage.id,
        {
          senderId: chatMessage.senderId,
          senderName: savedMessage.sender?.name || 'User',
          senderImage: savedMessage.sender?.image || '',
          messagePreview: chatMessage.content.length > 50 ? chatMessage.content.substring(0, 50) + '...' : chatMessage.content,
          conversationId: chatMessage.conversationId,
          fieldId: (savedMessage as any).conversation?.fieldId || ''
        }
      );
    } catch (pushError) {
      console.error('[ProcessMessage] Failed to send push notification:', pushError);
      // Non-blocking error, continue
    }

    return savedMessage;

  } catch (error) {
    console.error('[ProcessMessage] Error processing message:', error);
    // Remove from processed set on error so it can be retried
    processedMessages.delete(messageKey);
    const index = messageCacheArray.indexOf(messageKey);
    if (index > -1) messageCacheArray.splice(index, 1);
    throw error;
  }
}

// Send message to Kafka or process directly (parallel processing)
export const sendMessageToKafka = async (message: ChatMessage) => {
  // Track message rate for auto-scaling
  trackMessageRate();

  try {
    if (kafkaEnabled && producer) {
      // Send to Kafka with conversation ID as partition key
      // This ensures all messages for the same conversation are processed in order
      await producer.send({
        topic: 'chat-messages',
        messages: [
          {
            key: message.conversationId, // Partition key ensures ordering per conversation
            value: JSON.stringify(message),
            headers: {
              correlationId: message.correlationId || '',
              socketId: message.socketId || '',
              timestamp: message.timestamp.toISOString(),
            },
          },
        ],
      });
      return null; // Return null to indicate async processing
    } else {
      // Process directly if Kafka is not available (parallel processing)
      if (socketIO) {
        const savedMessage = await processMessage(message, socketIO);
        return savedMessage; // Return saved message for immediate handling
      } else {
        throw new Error('Socket.io not initialized');
      }
    }
  } catch (error) {
    console.error('[Kafka] Error handling message:', error);
    // If Kafka fails, try direct processing as fallback
    if (socketIO && error instanceof Error && !error.message.includes('Socket.io')) {
      console.log('[Kafka] Kafka failed, falling back to direct processing');
      return await processMessage(message, socketIO);
    }
    throw error;
  }
};

// Graceful shutdown
export const shutdownKafka = async () => {
  if (producer) {
    await producer.disconnect();
  }
  if (consumer) {
    await consumer.disconnect();
  }
  if (kafkaEnabled) {
    console.log('Kafka connections closed');
  }
};
