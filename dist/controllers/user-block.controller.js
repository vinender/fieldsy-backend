//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "userBlockController", {
    enumerable: true,
    get: function() {
        return userBlockController;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const userBlockController = {
    async blockUser (req, res) {
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
            const userToBlock = await _database.default.user.findUnique({
                where: {
                    id: blockedUserId
                }
            });
            if (!userToBlock) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }
            // Check if already blocked
            const existingBlock = await _database.default.userBlock.findUnique({
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
            const block = await _database.default.userBlock.create({
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
        } catch (error) {
            console.error('Block user error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to block user'
            });
        }
    },
    async unblockUser (req, res) {
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
            const existingBlock = await _database.default.userBlock.findUnique({
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
            await _database.default.userBlock.delete({
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
        } catch (error) {
            console.error('Unblock user error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to unblock user'
            });
        }
    },
    async getBlockedUsers (req, res) {
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
                _database.default.userBlock.findMany({
                    where: {
                        blockerId: userId
                    },
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
                _database.default.userBlock.count({
                    where: {
                        blockerId: userId
                    }
                })
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
        } catch (error) {
            console.error('Get blocked users error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch blocked users'
            });
        }
    },
    async checkBlockStatus (req, res) {
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
            const userBlockedOther = await _database.default.userBlock.findUnique({
                where: {
                    blockerId_blockedUserId: {
                        blockerId: userId,
                        blockedUserId: otherUserId
                    }
                }
            });
            // Check if other user has blocked the current user
            const otherBlockedUser = await _database.default.userBlock.findUnique({
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
        } catch (error) {
            console.error('Check block status error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check block status'
            });
        }
    },
    async getBlockedByUsers (req, res) {
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
                _database.default.userBlock.findMany({
                    where: {
                        blockedUserId: userId
                    },
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
                _database.default.userBlock.count({
                    where: {
                        blockedUserId: userId
                    }
                })
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
        } catch (error) {
            console.error('Get blocked by users error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch users who blocked you'
            });
        }
    }
};

//# sourceMappingURL=user-block.controller.js.map