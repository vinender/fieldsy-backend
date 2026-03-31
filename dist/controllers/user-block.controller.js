"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userBlockController = void 0;
const database_1 = __importDefault(require("../config/database"));
exports.userBlockController = {
    async blockUser(req, res) {
        try {
            const blockerId = req.user?.id;
            const { blockedUserId, reason } = req.body;
            if (!blockerId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            if (!blockedUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID to block is required'
                });
            }
            if (blockerId === blockedUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'You cannot block yourself'
                });
            }
            // Check if user exists
            const userToBlock = await database_1.default.user.findUnique({
                where: { id: blockedUserId }
            });
            if (!userToBlock) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }
            // Check if already blocked
            const existingBlock = await database_1.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId,
                        blockedUserId
                    }
                }
            });
            if (existingBlock) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already blocked this user'
                });
            }
            // Create the block
            const block = await database_1.default.userBlock.create({
                data: {
                    blockerId,
                    blockedUserId,
                    reason
                },
                include: {
                    blockedUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            image: true
                        }
                    }
                }
            });
            res.status(201).json({
                success: true,
                message: 'User blocked successfully',
                data: block
            });
        }
        catch (error) {
            console.error('Block user error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to block user'
            });
        }
    },
    async unblockUser(req, res) {
        try {
            const blockerId = req.user?.id;
            const { blockedUserId } = req.body;
            if (!blockerId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            if (!blockedUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID to unblock is required'
                });
            }
            // Check if block exists
            const existingBlock = await database_1.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId,
                        blockedUserId
                    }
                }
            });
            if (!existingBlock) {
                return res.status(404).json({
                    success: false,
                    message: 'Block not found'
                });
            }
            // Delete the block
            await database_1.default.userBlock.delete({
                where: {
                    blockerId_blockedUserId: {
                        blockerId,
                        blockedUserId
                    }
                }
            });
            res.json({
                success: true,
                message: 'User unblocked successfully'
            });
        }
        catch (error) {
            console.error('Unblock user error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to unblock user'
            });
        }
    },
    async getBlockedUsers(req, res) {
        try {
            const userId = req.user?.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            const [blocks, total] = await Promise.all([
                database_1.default.userBlock.findMany({
                    where: { blockerId: userId },
                    include: {
                        blockedUser: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                image: true,
                                role: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    skip,
                    take: limit
                }),
                database_1.default.userBlock.count({ where: { blockerId: userId } })
            ]);
            res.json({
                success: true,
                data: blocks,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            });
        }
        catch (error) {
            console.error('Get blocked users error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch blocked users'
            });
        }
    },
    async checkBlockStatus(req, res) {
        try {
            const userId = req.user?.id;
            const { otherUserId } = req.params;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            if (!otherUserId) {
                return res.status(400).json({
                    success: false,
                    message: 'Other user ID is required'
                });
            }
            // Check if current user has blocked the other user
            const userBlockedOther = await database_1.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId: userId,
                        blockedUserId: otherUserId
                    }
                }
            });
            // Check if other user has blocked the current user
            const otherBlockedUser = await database_1.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId: otherUserId,
                        blockedUserId: userId
                    }
                }
            });
            res.json({
                success: true,
                data: {
                    isBlocked: !!userBlockedOther,
                    isBlockedBy: !!otherBlockedUser,
                    canChat: !userBlockedOther && !otherBlockedUser
                }
            });
        }
        catch (error) {
            console.error('Check block status error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check block status'
            });
        }
    },
    async getBlockedByUsers(req, res) {
        try {
            const userId = req.user?.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }
            const [blocks, total] = await Promise.all([
                database_1.default.userBlock.findMany({
                    where: { blockedUserId: userId },
                    include: {
                        blocker: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                image: true,
                                role: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    skip,
                    take: limit
                }),
                database_1.default.userBlock.count({ where: { blockedUserId: userId } })
            ]);
            res.json({
                success: true,
                data: blocks,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit)
                }
            });
        }
        catch (error) {
            console.error('Get blocked by users error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch users who blocked you'
            });
        }
    }
};
