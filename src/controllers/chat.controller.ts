//@ts-nocheck
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { sendMessageToKafka } from '../config/kafka';

const prisma = new PrismaClient();

// Get or create conversation
export const getOrCreateConversation = async (req: Request, res: Response) => {
  try {
    const { receiverId, fieldId } = req.body;
    const senderId = (req as any).user.id;

    if (!receiverId) {
      return res.status(400).json({ error: 'Receiver ID is required' });
    }

    // Resolve receiverId to internal ObjectID if it's a human-readable ID
    const resolvedReceiverId = await UserModel.resolveId(receiverId);

    // Sort participants to ensure consistent ordering for deduplication
    const sortedParticipants = [senderId, resolvedReceiverId].sort();

    // Check if conversation already exists between these two users
    // Important: Find ANY conversation between these users to prevent duplicates
    // We search for both possible orderings of participants array
    let conversation = await prisma.conversation.findFirst({
      where: {
        OR: [
          {
            participants: {
              equals: [senderId, resolvedReceiverId]
            }
          },
          {
            participants: {
              equals: [resolvedReceiverId, senderId]
            }
          },
          // Also check sorted order for consistency
          {
            participants: {
              equals: sortedParticipants
            }
          }
        ]
      },
      include: {
        field: {
          select: {
            id: true,
            name: true,
            images: true
          }
        }
      }
    });

    if (!conversation) {
      // Double-check one more time to avoid race conditions
      // This helps prevent duplicates when multiple requests come simultaneously
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          participants: {
            hasEvery: [senderId, resolvedReceiverId]
          }
        },
        include: {
          field: {
            select: {
              id: true,
              name: true,
              images: true
            }
          }
        }
      });

      if (existingConversation) {
        conversation = existingConversation;
      } else {
        // Create new conversation with sorted participants for consistency
        conversation = await prisma.conversation.create({
          data: {
            participants: sortedParticipants,
            fieldId: fieldId || undefined
          },
          include: {
            field: {
              select: {
                id: true,
                name: true,
                images: true
              }
            }
          }
        });
      }
    }

    // Get participants info
    const participants = await prisma.user.findMany({
      where: {
        id: {
          in: [senderId, resolvedReceiverId]
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true
      }
    });

    // Identify the other participant
    const otherUser = participants.find(p => p.id !== senderId);

    res.json({
      ...conversation,
      participants: participants,
      otherUser: otherUser ? {
        id: otherUser.id,
        name: otherUser.name,
        image: otherUser.image,
        role: otherUser.role
      } : null
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

// Get user's conversations
export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          has: userId
        }
      },
      include: {
        field: {
          select: {
            id: true,
            name: true,
            images: true
          }
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc'
          },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                image: true
              }
            }
          }
        }
      },
      orderBy: {
        lastMessageAt: 'desc'
      },
      skip,
      take: Number(limit)
    });

    // Get participants info for each conversation
    const conversationsWithParticipants = await Promise.all(
      conversations.map(async (conv) => {
        const participants = await prisma.user.findMany({
          where: {
            id: {
              in: conv.participants
            }
          },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: true
          }
        });

        // Get unread count
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            receiverId: userId,
            isRead: false
          }
        });

        // Identify the other participant
        const otherUser = participants.find(p => p.id !== userId);

        return {
          ...conv,
          participants,
          otherUser: otherUser ? {
            id: otherUser.id,
            name: otherUser.name,
            image: otherUser.image,
            role: otherUser.role
          } : null,
          unreadCount
        };
      })
    );

    // Get total count
    const total = await prisma.conversation.count({
      where: {
        participants: {
          has: userId
        }
      }
    });

    res.json({
      conversations: conversationsWithParticipants,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

// Get messages for a conversation
export const getMessages = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).user.id;
    const { page = 1, limit = 50 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // Verify user is part of the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          has: userId
        }
      }
    });

    if (!conversation) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId
      },
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
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: Number(limit)
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

    // Get total count
    const total = await prisma.message.count({
      where: {
        conversationId
      }
    });

    res.json({
      messages: messages.reverse(), // Reverse to get chronological order
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

// Send a message
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { conversationId, content, receiverId } = req.body;
    const senderId = (req as any).user.id;

    if (!conversationId || !content || !receiverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Resolve receiverId to internal ObjectID if it's a human-readable ID
    const resolvedReceiverId = await UserModel.resolveId(receiverId);

    // Verify user is part of the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          has: senderId
        }
      }
    });

    if (!conversation) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if users have blocked each other
    const [senderBlockedReceiver, receiverBlockedSender] = await Promise.all([
      prisma.userBlock.findUnique({
        where: {
          blockerId_blockedUserId: {
            blockerId: senderId,
            blockedUserId: resolvedReceiverId
          }
        }
      }),
      prisma.userBlock.findUnique({
        where: {
          blockerId_blockedUserId: {
            blockerId: resolvedReceiverId,
            blockedUserId: senderId
          }
        }
      })
    ]);

    if (senderBlockedReceiver || receiverBlockedSender) {
      return res.status(403).json({
        error: 'Cannot send messages. One or both users have blocked each other.',
        blocked: true
      });
    }

    // Send message to Kafka for processing
    console.log('[Chat] Sending message:', { conversationId, senderId, receiverId, contentLength: content.length });

    const savedMessage = await sendMessageToKafka({
      conversationId,
      senderId,
      receiverId: resolvedReceiverId,
      content,
      timestamp: new Date()
    });

    console.log('[Chat] Message sent successfully:', savedMessage?.id);

    // Return the saved message
    res.json(savedMessage || { success: true, message: 'Message queued for delivery' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// Get unread message count
export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Get distinct conversation IDs that have unread messages for this user
    const unreadConversations = await prisma.message.findMany({
      where: {
        receiverId: userId,
        isRead: false
      },
      select: {
        conversationId: true
      },
      distinct: ['conversationId']
    });

    // Count the number of conversations with unread messages
    const unreadCount = unreadConversations.length;

    res.json({ unreadCount });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

// Delete conversation
export const deleteConversation = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).user.id;

    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation ID is required' });
    }

    // Verify user is part of the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          has: userId
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Delete all messages in the conversation
    await prisma.message.deleteMany({
      where: {
        conversationId
      }
    });

    // Delete the conversation
    await prisma.conversation.delete({
      where: {
        id: conversationId
      }
    });

    res.json({ success: true, message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
};

// Get count of conversations with unread messages
export const getUnreadConversationsCount = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Get all conversations for the user
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          has: userId
        }
      },
      select: {
        id: true
      }
    });

    // Count conversations that have at least one unread message for this user
    const conversationIds = conversations.map(conv => conv.id);

    if (conversationIds.length === 0) {
      return res.json({
        success: true,
        unreadConversationsCount: 0
      });
    }

    // Find unique conversations with unread messages
    const conversationsWithUnread = await prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: {
          in: conversationIds
        },
        receiverId: userId,
        isRead: false
      },
      _count: {
        conversationId: true
      }
    });

    res.json({
      success: true,
      unreadConversationsCount: conversationsWithUnread.length
    });
  } catch (error) {
    console.error('Error fetching unread conversations count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unread conversations count'
    });
  }
};
