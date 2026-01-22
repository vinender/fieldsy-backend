"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const user_model_1 = __importDefault(require("../models/user.model"));
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const constants_1 = require("../config/constants");
class UserController {
    // Get all users (admin only)
    getAllUsers = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const users = await user_model_1.default.findAll(skip, limit);
        res.json({
            success: true,
            data: users.map(u => user_model_1.default.stripInternalId(u)),
            pagination: {
                page,
                limit,
                total: users.length,
            },
        });
    });
    // Get user by ID
    getUser = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const requestingUserId = req.user.id;
        const requestingUserRole = req.user.role;
        const user = await user_model_1.default.findById(id);
        if (!user) {
            throw new AppError_1.AppError('User not found', 404);
        }
        // SECURITY FIX: Only allow users to view their own profile or admins to view any profile
        if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
            throw new AppError_1.AppError('You can only view your own profile', 403);
        }
        res.json({
            success: true,
            data: user_model_1.default.stripInternalId(user),
        });
    });
    // Update user profile
    updateUser = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const requestingUserId = req.user.id;
        const requestingUserRole = req.user.role;
        // Check if user is updating their own profile or is admin
        if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
            throw new AppError_1.AppError('You can only update your own profile', 403);
        }
        // SECURITY FIX: Use whitelist approach - only allow specific safe fields to be updated
        const allowedFields = ['name', 'phone', 'image', 'googleImage', 'bio', 'address'];
        const updates = {};
        // Only copy whitelisted fields from request body
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }
        // Validate that at least one field is being updated
        if (Object.keys(updates).length === 0) {
            throw new AppError_1.AppError('No valid fields to update', 400);
        }
        const updatedUser = await user_model_1.default.update(id, updates);
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: user_model_1.default.stripInternalId(updatedUser),
        });
    });
    // Delete user (admin only or self)
    deleteUser = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        // Check if user is deleting their own account or is admin
        if (req.user.id !== id && req.user.role !== 'ADMIN') {
            throw new AppError_1.AppError('You can only delete your own account', 403);
        }
        await user_model_1.default.delete(id);
        res.status(204).json({
            success: true,
            message: 'User deleted successfully',
        });
    });
    // Change password
    changePassword = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            throw new AppError_1.AppError('Current password and new password are required', 400);
        }
        const user = await user_model_1.default.findByEmail(req.user.email);
        if (!user || !user.password) {
            throw new AppError_1.AppError('User not found', 404);
        }
        // Verify current password
        const isPasswordValid = await user_model_1.default.verifyPassword(currentPassword, user.password);
        if (!isPasswordValid) {
            throw new AppError_1.AppError('Current password is incorrect', 401);
        }
        // Hash the new password before updating
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, constants_1.BCRYPT_ROUNDS);
        // Update password with hashed version
        await user_model_1.default.update(userId, { password: hashedPassword });
        res.json({
            success: true,
            message: 'Password changed successfully',
        });
    });
    // Get user stats (for dashboard)
    getUserStats = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const userRole = req.user.role;
        // This would be more complex with actual database queries
        const stats = {
            userId,
            role: userRole,
            ...(userRole === 'DOG_OWNER' && {
                totalBookings: 0,
                upcomingBookings: 0,
                savedFields: 0,
                totalSpent: 0,
            }),
            ...(userRole === 'FIELD_OWNER' && {
                totalFields: 0,
                activeFields: 0,
                totalBookings: 0,
                totalRevenue: 0,
                averageRating: 0,
            }),
        };
        res.json({
            success: true,
            data: stats,
        });
    });
}
exports.default = new UserController();
