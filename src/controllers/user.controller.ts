//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import UserModel from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config/constants';
import { otpService } from '../services/otp.service';

class UserController {
  // Get all users (admin only)
  getAllUsers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const users = await UserModel.findAll(skip, limit);

    res.json({
      success: true,
      data: users.map(u => UserModel.stripInternalId(u)),
      pagination: {
        page,
        limit,
        total: users.length,
      },
    });
  });

  // Get user by ID
  getUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const requestingUserId = (req as any).user.id;
    const requestingUserRole = (req as any).user.role;

    const user = await UserModel.findById(id);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // SECURITY FIX: Only allow users to view their own profile or admins to view any profile
    if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
      throw new AppError('You can only view your own profile', 403);
    }

    res.json({
      success: true,
      data: UserModel.stripInternalId(user),
    });
  });

  // Update user profile
  updateUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const requestingUserId = (req as any).user.id;
    const requestingUserRole = (req as any).user.role;

    // Check if user is updating their own profile or is admin
    if (requestingUserId !== id && requestingUserRole !== 'ADMIN') {
      throw new AppError('You can only update your own profile', 403);
    }

    // SECURITY FIX: Use whitelist approach - only allow specific safe fields to be updated
    const allowedFields = ['name', 'phone', 'image', 'googleImage', 'bio', 'address'];
    const updates: any = {};

    // Only copy whitelisted fields from request body
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Validate that at least one field is being updated
    if (Object.keys(updates).length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    const updatedUser = await UserModel.update(id, updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: UserModel.stripInternalId(updatedUser),
    });
  });

  // Delete user (admin only or self)
  deleteUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    // Check if user is deleting their own account or is admin
    if ((req as any).user.id !== id && (req as any).user.role !== 'ADMIN') {
      throw new AppError('You can only delete your own account', 403);
    }

    await UserModel.delete(id);

    res.status(204).json({
      success: true,
      message: 'User deleted successfully',
    });
  });

  // Change password
  changePassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    const user = await UserModel.findByEmail((req as any).user.email);
    if (!user || !user.password) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isPasswordValid = await UserModel.verifyPassword(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Hash the new password before updating
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Update password with hashed version
    await UserModel.update(userId, { password: hashedPassword } as any);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  });

  // Get user stats (for dashboard)
  getUserStats = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

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

  // Request email change - sends OTP to new email
  requestEmailChange = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userEmail = (req as any).user.email;
    const userRole = (req as any).user.role;
    const userName = (req as any).user.name;
    const { newEmail } = req.body;

    if (!newEmail) {
      throw new AppError('New email address is required', 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      throw new AppError('Invalid email format', 400);
    }

    if (newEmail.toLowerCase() === userEmail.toLowerCase()) {
      throw new AppError('New email must be different from your current email', 400);
    }

    // Check if email already taken for the same role
    const existingUser = await UserModel.findByEmailAndRole(newEmail.toLowerCase(), userRole);
    if (existingUser) {
      throw new AppError('This email is already registered', 409);
    }

    // Send OTP to the new email
    await otpService.sendOtp(newEmail.toLowerCase(), 'EMAIL_CHANGE', userName);

    res.json({
      success: true,
      message: 'Verification code sent to your new email address',
    });
  });

  // Verify email change OTP and update email
  verifyEmailChange = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { newEmail, otp } = req.body;

    if (!newEmail || !otp) {
      throw new AppError('New email and verification code are required', 400);
    }

    // Re-check uniqueness (race condition protection)
    const existingUser = await UserModel.findByEmailAndRole(newEmail.toLowerCase(), userRole);
    if (existingUser) {
      throw new AppError('This email is already registered', 409);
    }

    // Verify OTP
    const isValid = await otpService.verifyOtp(newEmail.toLowerCase(), otp, 'EMAIL_CHANGE');
    if (!isValid) {
      throw new AppError('Invalid or expired verification code', 400);
    }

    // Update the user's email
    const updatedUser = await UserModel.update(userId, { email: newEmail.toLowerCase() });

    res.json({
      success: true,
      message: 'Email updated successfully',
      data: UserModel.stripInternalId(updatedUser),
    });
  });
}

export default new UserController();
