"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../config/database"));
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
class FavoriteController {
    // Toggle favorite (save/unsave field)
    toggleFavorite = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId: providedFieldId } = req.params;
        const userId = req.user.id;
        // Support both internal ID and human-readable fieldId
        const isObjectId = providedFieldId.length === 24 && /^[0-9a-fA-F]+$/.test(providedFieldId);
        const where = isObjectId ? { id: providedFieldId } : { fieldId: providedFieldId };
        // Check if field exists
        const field = await database_1.default.field.findUnique({
            where
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Check if already favorited
        const existingFavorite = await database_1.default.favorite.findUnique({
            where: {
                userId_fieldId: {
                    userId,
                    fieldId: field.id
                }
            }
        });
        if (existingFavorite) {
            // Remove from favorites
            await database_1.default.favorite.delete({
                where: {
                    id: existingFavorite.id
                }
            });
            res.json({
                success: true,
                message: 'Field removed from favorites',
                isLiked: false,
                isFavorited: false // Keep for backwards compatibility
            });
        }
        else {
            // Add to favorites
            const favorite = await database_1.default.favorite.create({
                data: {
                    userId,
                    fieldId: field.id
                }
            });
            res.json({
                success: true,
                message: 'Field added to favorites',
                isLiked: true,
                isFavorited: true, // Keep for backwards compatibility
                data: favorite
            });
        }
    });
    // Get user's saved fields
    getSavedFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        // First, clean up any orphaned favorites (where field no longer exists)
        // Get all favorites for the user
        const allFavorites = await database_1.default.favorite.findMany({
            where: { userId },
            include: {
                field: true
            }
        });
        // Find orphaned favorites (where field is null)
        const orphanedFavoriteIds = allFavorites
            .filter(fav => fav.field === null)
            .map(fav => fav.id);
        // Delete orphaned favorites if any exist
        if (orphanedFavoriteIds.length > 0) {
            await database_1.default.favorite.deleteMany({
                where: {
                    id: {
                        in: orphanedFavoriteIds
                    }
                }
            });
        }
        // Now get the valid favorites with pagination (only active fields)
        const favorites = await database_1.default.favorite.findMany({
            where: {
                userId,
                field: {
                    isActive: true // Only include active fields
                }
            },
            include: {
                field: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                image: true
                            }
                        },
                        fieldReviews: {
                            select: {
                                rating: true
                            }
                        },
                        _count: {
                            select: {
                                bookings: true,
                                fieldReviews: true
                            }
                        }
                    }
                }
            },
            skip,
            take: limit,
            orderBy: {
                createdAt: 'desc'
            }
        });
        // Additional safety check to filter out any null or inactive fields
        const validFavorites = favorites.filter(fav => fav.field !== null && fav.field.isActive);
        // Calculate average rating for each field
        const fieldsWithRating = validFavorites.map(fav => {
            const avgRating = fav.field.fieldReviews.length > 0
                ? fav.field.fieldReviews.reduce((sum, review) => sum + review.rating, 0) / fav.field.fieldReviews.length
                : 0;
            return {
                ...fav.field,
                averageRating: avgRating,
                reviewCount: fav.field._count.fieldReviews,
                bookingCount: fav.field._count.bookings,
                isLiked: true,
                isFavorited: true // Keep for backwards compatibility
            };
        });
        // Get total count only for valid favorites with active fields (after cleanup)
        const total = await database_1.default.favorite.count({
            where: {
                userId,
                field: {
                    isActive: true
                }
            }
        });
        res.json({
            success: true,
            data: fieldsWithRating,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    });
    // Check if field is favorited by user
    checkFavorite = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId: providedFieldId } = req.params;
        const userId = req.user.id;
        // Support both internal ID and human-readable fieldId
        const isObjectId = providedFieldId.length === 24 && /^[0-9a-fA-F]+$/.test(providedFieldId);
        let fieldIdToCheck = providedFieldId;
        if (!isObjectId) {
            const field = await database_1.default.field.findUnique({
                where: { fieldId: providedFieldId },
                select: { id: true }
            });
            if (!field) {
                return res.json({
                    success: true,
                    isLiked: false,
                    isFavorited: false
                });
            }
            fieldIdToCheck = field.id;
        }
        const favorite = await database_1.default.favorite.findUnique({
            where: {
                userId_fieldId: {
                    userId,
                    fieldId: fieldIdToCheck
                }
            }
        });
        res.json({
            success: true,
            isLiked: !!favorite,
            isFavorited: !!favorite // Keep for backwards compatibility
        });
    });
    // Remove from favorites
    removeFavorite = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId: providedFieldId } = req.params;
        const userId = req.user.id;
        // Support both internal ID and human-readable fieldId
        const isObjectId = providedFieldId.length === 24 && /^[0-9a-fA-F]+$/.test(providedFieldId);
        let fieldIdToCheck = providedFieldId;
        if (!isObjectId) {
            const field = await database_1.default.field.findUnique({
                where: { fieldId: providedFieldId },
                select: { id: true }
            });
            if (!field) {
                throw new AppError_1.AppError('Field not found', 404);
            }
            fieldIdToCheck = field.id;
        }
        const favorite = await database_1.default.favorite.findUnique({
            where: {
                userId_fieldId: {
                    userId,
                    fieldId: fieldIdToCheck
                }
            }
        });
        if (!favorite) {
            throw new AppError_1.AppError('Field not in favorites', 404);
        }
        await database_1.default.favorite.delete({
            where: {
                id: favorite.id
            }
        });
        res.json({
            success: true,
            message: 'Field removed from favorites'
        });
    });
}
exports.default = new FavoriteController();
