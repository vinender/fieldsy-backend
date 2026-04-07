//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get deleteConversation () {
        return deleteConversation;
    },
    get getConversations () {
        return getConversations;
    },
    get getMessages () {
        return getMessages;
    },
    get getOrCreateConversation () {
        return getOrCreateConversation;
    },
    get getUnreadConversationsCount () {
        return getUnreadConversationsCount;
    },
    get getUnreadCount () {
        return getUnreadCount;
    },
    get sendMessage () {
        return sendMessage;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _kafka = require("../config/kafka");
const _usermodel = /*#__PURE__*/ _interop_require_default(require("../models/user.model"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const getOrCreateConversation = async (req, res)=>{
    try {
        const { receiverId, fieldId } = req.body;
        const senderId = req.user.id;
        if (!receiverId) {
            return res.status(400).json({
                error: 'Receiver ID is required'
            });
        }
        // Resolve receiverId to internal ObjectID if it's a human-readable ID
        const resolvedReceiverId = await _usermodel.default.resolveId(receiverId);
        // Sort participants for consistent ordering when creating
        const sortedParticipants = [
            senderId,
            resolvedReceiverId
        ].sort();
        // Check if conversation already exists using hasEvery (order-agnostic)
        let conversation = await _database.default.conversation.findFirst({
            where: {
                participants: {
                    hasEvery: [
                        senderId,
                        resolvedReceiverId
                    ]
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
        if (!conversation) {
            // Create new conversation with sorted participants for consistency
            conversation = await _database.default.conversation.create({
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
        // Get participants info
        const participants = await _database.default.user.findMany({
            where: {
                id: {
                    in: [
                        senderId,
                        resolvedReceiverId
                    ]
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
        const otherUser = participants.find((p)=>p.id !== senderId);
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
        res.status(500).json({
            error: 'Failed to create conversation'
        });
    }
};
const getConversations = async (req, res)=>{
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const conversations = await _database.default.conversation.findMany({
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
        // Batch-fetch all participant info and unread counts to avoid N+1 queries
        const allParticipantIds = [
            ...new Set(conversations.flatMap((conv)=>conv.participants))
        ];
        const conversationIds = conversations.map((conv)=>conv.id);
        const [allParticipants, unreadCounts] = await Promise.all([
            _database.default.user.findMany({
                where: {
                    id: {
                        in: allParticipantIds
                    }
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                    role: true
                }
            }),
            _database.default.message.groupBy({
                by: [
                    'conversationId'
                ],
                where: {
                    conversationId: {
                        in: conversationIds
                    },
                    receiverId: userId,
                    isRead: false
                },
                _count: {
                    _all: true
                }
            })
        ]);
        // Build lookup maps for O(1) access
        const participantMap = new Map(allParticipants.map((p)=>[
                p.id,
                p
            ]));
        const unreadCountMap = new Map(unreadCounts.map((uc)=>[
                uc.conversationId,
                uc._count._all
            ]));
        const conversationsWithParticipants = conversations.map((conv)=>{
            const participants = conv.participants.map((pid)=>participantMap.get(pid)).filter(Boolean);
            const otherUser = participants.find((p)=>p.id !== userId);
            const unreadCount = unreadCountMap.get(conv.id) || 0;
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
        });
        // Get total count
        const total = await _database.default.conversation.count({
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
        res.status(500).json({
            error: 'Failed to fetch conversations'
        });
    }
};
const getMessages = async (req, res)=>{
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;
        const { page = 1, limit = 50 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        // Verify user is part of the conversation
        const conversation = await _database.default.conversation.findFirst({
            where: {
                id: conversationId,
                participants: {
                    has: userId
                }
            }
        });
        if (!conversation) {
            return res.status(403).json({
                error: 'Access denied'
            });
        }
        // Get messages
        const messages = await _database.default.message.findMany({
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
        await _database.default.message.updateMany({
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
        const total = await _database.default.message.count({
            where: {
                conversationId
            }
        });
        res.json({
            messages: messages.reverse(),
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({
            error: 'Failed to fetch messages'
        });
    }
};
const sendMessage = async (req, res)=>{
    try {
        const { conversationId, content, receiverId } = req.body;
        const senderId = req.user.id;
        if (!conversationId || !content || !receiverId) {
            return res.status(400).json({
                error: 'Missing required fields'
            });
        }
        // Resolve receiverId to internal ObjectID if it's a human-readable ID
        const resolvedReceiverId = await _usermodel.default.resolveId(receiverId);
        // Verify user is part of the conversation
        const conversation = await _database.default.conversation.findFirst({
            where: {
                id: conversationId,
                participants: {
                    has: senderId
                }
            }
        });
        if (!conversation) {
            return res.status(403).json({
                error: 'Access denied'
            });
        }
        // Check if users have blocked each other
        const [senderBlockedReceiver, receiverBlockedSender] = await Promise.all([
            _database.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId: senderId,
                        blockedUserId: resolvedReceiverId
                    }
                }
            }),
            _database.default.userBlock.findUnique({
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
        console.log('[Chat] Sending message:', {
            conversationId,
            senderId,
            receiverId,
            contentLength: content.length
        });
        const savedMessage = await (0, _kafka.sendMessageToKafka)({
            conversationId,
            senderId,
            receiverId: resolvedReceiverId,
            content,
            timestamp: new Date()
        });
        console.log('[Chat] Message sent successfully:', savedMessage?.id);
        // Return the saved message
        res.json(savedMessage || {
            success: true,
            message: 'Message queued for delivery'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            error: 'Failed to send message'
        });
    }
};
const getUnreadCount = async (req, res)=>{
    try {
        const userId = req.user.id;
        // Get distinct conversation IDs that have unread messages for this user
        const unreadConversations = await _database.default.message.findMany({
            where: {
                receiverId: userId,
                isRead: false
            },
            select: {
                conversationId: true
            },
            distinct: [
                'conversationId'
            ]
        });
        // Count the number of conversations with unread messages
        const unreadCount = unreadConversations.length;
        res.json({
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            error: 'Failed to fetch unread count'
        });
    }
};
const deleteConversation = async (req, res)=>{
    try {
        const { conversationId } = req.params;
        const userId = req.user.id;
        if (!conversationId) {
            return res.status(400).json({
                error: 'Conversation ID is required'
            });
        }
        // Verify user is part of the conversation
        const conversation = await _database.default.conversation.findFirst({
            where: {
                id: conversationId,
                participants: {
                    has: userId
                }
            }
        });
        if (!conversation) {
            return res.status(404).json({
                error: 'Conversation not found'
            });
        }
        // Delete all messages in the conversation
        await _database.default.message.deleteMany({
            where: {
                conversationId
            }
        });
        // Delete the conversation
        await _database.default.conversation.delete({
            where: {
                id: conversationId
            }
        });
        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({
            error: 'Failed to delete conversation'
        });
    }
};
const getUnreadConversationsCount = async (req, res)=>{
    try {
        const userId = req.user.id;
        // Get all conversations for the user
        const conversations = await _database.default.conversation.findMany({
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
        const conversationIds = conversations.map((conv)=>conv.id);
        if (conversationIds.length === 0) {
            return res.json({
                success: true,
                unreadConversationsCount: 0
            });
        }
        // Find unique conversations with unread messages
        const conversationsWithUnread = await _database.default.message.groupBy({
            by: [
                'conversationId'
            ],
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

//# sourceMappingURL=chat.controller.js.map