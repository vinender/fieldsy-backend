//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _usermodel = /*#__PURE__*/ _interop_require_default(require("../models/user.model"));
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
const _bcryptjs = /*#__PURE__*/ _interop_require_default(require("bcryptjs"));
const _constants = require("../config/constants");
const _otpservice = require("../services/otp.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class UserController {
    // Get all users (admin only)
    getAllUsers = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const users = await _usermodel.default.findAll(skip, limit);
        res.json({
            success: true,
            data: users.map((u)=>_usermodel.default.stripInternalId(u)),
            pagination: {
                page,
                limit,
                total: users.length
            }
        });
    });
    // Get user by ID
    getUser = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { id } = req.params;
        const requestingUserId = req.user.id;
        const requestingUserRole = req.user.role;
        const user = await _usermodel.default.findById(id);
        if (!user) {
            throw new _AppError.AppError('User not found', 404);
        }
        // SECURITY FIX: Only allow users to view their own profile or admins to view any profile
        if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
            throw new _AppError.AppError('You can only view your own profile', 403);
        }
        res.json({
            success: true,
            data: _usermodel.default.stripInternalId(user)
        });
    });
    // Update user profile
    updateUser = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { id } = req.params;
        const requestingUserId = req.user.id;
        const requestingUserRole = req.user.role;
        // Check if user is updating their own profile or is admin
        if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
            throw new _AppError.AppError('You can only update your own profile', 403);
        }
        // SECURITY FIX: Use whitelist approach - only allow specific safe fields to be updated
        const allowedFields = [
            'name',
            'phone',
            'image',
            'googleImage',
            'bio',
            'address'
        ];
        const updates = {};
        // Only copy whitelisted fields from request body
        for (const field of allowedFields){
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }
        // Validate that at least one field is being updated
        if (Object.keys(updates).length === 0) {
            throw new _AppError.AppError('No valid fields to update', 400);
        }
        const updatedUser = await _usermodel.default.update(id, updates);
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: _usermodel.default.stripInternalId(updatedUser)
        });
    });
    // Delete user (admin only or self)
    deleteUser = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { id } = req.params;
        // Check if user is deleting their own account or is admin
        if (req.user.id !== id && req.user.role !== 'ADMIN') {
            throw new _AppError.AppError('You can only delete your own account', 403);
        }
        await _usermodel.default.delete(id);
        res.status(204).json({
            success: true,
            message: 'User deleted successfully'
        });
    });
    // Change password
    changePassword = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            throw new _AppError.AppError('Current password and new password are required', 400);
        }
        const user = await _usermodel.default.findByEmail(req.user.email);
        if (!user || !user.password) {
            throw new _AppError.AppError('User not found', 404);
        }
        // Verify current password
        const isPasswordValid = await _usermodel.default.verifyPassword(currentPassword, user.password);
        if (!isPasswordValid) {
            throw new _AppError.AppError('Current password is incorrect', 401);
        }
        // Hash the new password before updating
        const hashedPassword = await _bcryptjs.default.hash(newPassword, _constants.BCRYPT_ROUNDS);
        // Update password with hashed version
        await _usermodel.default.update(userId, {
            password: hashedPassword
        });
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    });
    // Get user stats (for dashboard)
    getUserStats = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const userRole = req.user.role;
        // This would be more complex with actual database queries
        const stats = {
            userId,
            role: userRole,
            ...userRole === 'DOG_OWNER' && {
                totalBookings: 0,
                upcomingBookings: 0,
                savedFields: 0,
                totalSpent: 0
            },
            ...userRole === 'FIELD_OWNER' && {
                totalFields: 0,
                activeFields: 0,
                totalBookings: 0,
                totalRevenue: 0,
                averageRating: 0
            }
        };
        res.json({
            success: true,
            data: stats
        });
    });
    // Request email change - sends OTP to new email
    requestEmailChange = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const userEmail = req.user.email;
        const userRole = req.user.role;
        const userName = req.user.name;
        const { newEmail } = req.body;
        if (!newEmail) {
            throw new _AppError.AppError('New email address is required', 400);
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            throw new _AppError.AppError('Invalid email format', 400);
        }
        if (newEmail.toLowerCase() === userEmail.toLowerCase()) {
            throw new _AppError.AppError('New email must be different from your current email', 400);
        }
        // Check if email already taken by any user (regardless of role)
        const existingUser = await _usermodel.default.findByEmail(newEmail.toLowerCase());
        if (existingUser) {
            throw new _AppError.AppError('This email is already registered with another account', 409);
        }
        // Send OTP to the new email
        await _otpservice.otpService.sendOtp(newEmail.toLowerCase(), 'EMAIL_CHANGE', userName);
        res.json({
            success: true,
            message: 'Verification code sent to your new email address'
        });
    });
    // Verify email change OTP and update email
    verifyEmailChange = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const userRole = req.user.role;
        const { newEmail, otp } = req.body;
        if (!newEmail || !otp) {
            throw new _AppError.AppError('New email and verification code are required', 400);
        }
        // Re-check uniqueness (race condition protection)
        const existingUser = await _usermodel.default.findByEmail(newEmail.toLowerCase());
        if (existingUser) {
            throw new _AppError.AppError('This email is already registered with another account', 409);
        }
        // Verify OTP
        const isValid = await _otpservice.otpService.verifyOtp(newEmail.toLowerCase(), otp, 'EMAIL_CHANGE');
        if (!isValid) {
            throw new _AppError.AppError('Invalid or expired verification code', 400);
        }
        // Update the user's email
        const updatedUser = await _usermodel.default.update(userId, {
            email: newEmail.toLowerCase()
        });
        res.json({
            success: true,
            message: 'Email updated successfully',
            data: _usermodel.default.stripInternalId(updatedUser)
        });
    });
}
const _default = new UserController();

//# sourceMappingURL=user.controller.js.map