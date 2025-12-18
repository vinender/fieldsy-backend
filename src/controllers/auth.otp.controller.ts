//@ts-nocheck
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { otpService } from '../services/otp.service';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/constants';

const prisma = new PrismaClient();

// Generate JWT token
const generateToken = (userId: string) => {
  return jwt.sign({ id: userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

// Register new user with OTP
export const registerWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, role = 'DOG_OWNER', phone } = req.body;

  // Validate input
  if (!name || !email || !password) {
    throw new AppError('Missing required fields', 400);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Invalid email format', 400);
  }

  // Validate password strength
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  // Check if user already exists with this email (regardless of role)
  const existingUser = await prisma.user.findFirst({
    where: {
      email,
    },
  });

  if (existingUser) {
    // Check if the existing user has a different role
    if (existingUser.role !== role) {
      throw new AppError(`An account already exists with this email as a ${existingUser.role.replace('_', ' ').toLowerCase()}. Each email can only have one account.`, 409);
    }

    if (existingUser.emailVerified) {
      throw new AppError('User already exists with this email', 409);
    }
    // If user exists with same role but not verified, allow them to re-register (update their data)
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create or update user (but not verified yet)
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name,
          password: hashedPassword,
          phone,
          emailVerified: null, // Reset verification
        },
      })
    : await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
          phone,
          emailVerified: null,
        },
      });

  // Send OTP
  try {
    await otpService.sendOtp(email, 'SIGNUP', name);
  } catch (error) {
    // Delete user if OTP sending fails (only if newly created)
    if (!existingUser) {
      await prisma.user.delete({
        where: { id: user.id },
      });
    }
    throw new AppError('Failed to send verification email. Please try again.', 500);
  }

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please check your email for the verification code.',
    data: {
      email,
      role,
    },
  });
});

// Verify OTP and complete registration
export const verifySignupOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp, role = 'DOG_OWNER' } = req.body;

  if (!email || !otp) {
    throw new AppError('Email and OTP are required', 400);
  }

  // Verify OTP
  const isValid = await otpService.verifyOtp(email, otp, 'SIGNUP');
  
  if (!isValid) {
    throw new AppError('Invalid or expired OTP', 400);
  }

  // Update user as verified
  const user = await prisma.user.update({
    where: {
      email_role: {
        email,
        role,
      },
    },
    data: {
      emailVerified: new Date(),
    },
  });

  // Generate token
  const token = generateToken(user.id);

  res.json({
    success: true,
    message: 'Email verified successfully',
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
      token,
    },
  });
});

// Resend OTP
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, type = 'SIGNUP' } = req.body;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  // Get user name for email
  const user = await prisma.user.findFirst({
    where: { email },
  });

  try {
    await otpService.resendOtp(
      email,
      type as 'SIGNUP' | 'RESET_PASSWORD' | 'EMAIL_VERIFICATION' | 'SOCIAL_LOGIN',
      user?.name || undefined
    );
  } catch (error: any) {
    throw new AppError(error.message || 'Failed to resend OTP', 400);
  }

  res.json({
    success: true,
    message: 'OTP sent successfully',
  });
});

// Request password reset OTP
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  // Check if user exists
  const user = await prisma.user.findFirst({
    where: { email },
  });

  if (!user) {
    throw new AppError('No account found with this email address', 404);
  }

  // Send OTP
  try {
    await otpService.sendOtp(email, 'RESET_PASSWORD', user.name || undefined);
  } catch (error) {
    throw new AppError('Failed to send reset email. Please try again.', 500);
  }

  res.json({
    success: true,
    message: 'If an account exists with this email, you will receive a password reset code.',
  });
});

// Verify password reset OTP (marks OTP as verified)
export const verifyPasswordResetOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new AppError('Email and OTP are required', 400);
  }

  // Verify OTP and mark as used
  const isValid = await otpService.verifyOtp(email, otp, 'RESET_PASSWORD');

  if (!isValid) {
    throw new AppError('Invalid or expired OTP', 400);
  }

  // Generate a temporary token for password reset (valid for 10 minutes)
  const resetToken = jwt.sign(
    { email, purpose: 'password-reset', otpVerified: true },
    process.env.JWT_SECRET as string,
    { expiresIn: '10m' }
  );

  res.json({
    success: true,
    message: 'OTP verified successfully. You can now reset your password.',
    data: {
      email,
      otpVerified: true,
      resetToken, // Send token to be used in password reset
    },
  });
});

// Reset password after OTP verification
export const resetPasswordWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    throw new AppError('Reset token and new password are required', 400);
  }

  // Validate password strength
  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  // Verify reset token
  let decoded: any;
  try {
    decoded = jwt.verify(resetToken, process.env.JWT_SECRET as string);
  } catch (error) {
    throw new AppError('Invalid or expired reset token', 401);
  }

  // Check if token is for password reset
  if (decoded.purpose !== 'password-reset' || !decoded.otpVerified) {
    throw new AppError('Invalid reset token', 401);
  }

  const email = decoded.email;

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update user password
  await prisma.user.updateMany({
    where: { email },
    data: {
      password: hashedPassword,
    },
  });

  res.json({
    success: true,
    message: 'Password reset successfully',
  });
});

// Verify OTP for social login
export const verifySocialLoginOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new AppError('Email and OTP are required', 400);
  }

  // Verify OTP
  const isValid = await otpService.verifyOtp(email, otp, 'SOCIAL_LOGIN');

  if (!isValid) {
    throw new AppError('Invalid or expired OTP', 400);
  }

  // Update user as verified
  const user = await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });

  // Generate token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    success: true,
    message: 'Email verified successfully',
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        image: user.image,
        googleImage: user.googleImage,
      },
      token,
    },
  });
});

// Login with email verification check
export const loginWithOtpCheck = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  // Find user by email - prioritize users with password set (for email/password login)
  // This handles the case where same email has DOG_OWNER (google) and FIELD_OWNER (password)
  let user;

  try {
    // First, try to find a user with this email who has a password set
    user = await prisma.user.findFirst({
      where: {
        email,
        password: { not: null },
      },
    });

    // If no user with password found, try to find any user with this email
    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          email,
        },
      });
    }
  } catch (error: any) {
    // Log the Prisma error for debugging
    console.error('[Login] Database query error:', error.message);

    // Return a user-friendly error message instead of exposing database internals
    throw new AppError('Invalid credentials', 401);
  }

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check if email is verified
  if (!user.emailVerified) {
    // Send new OTP
    await otpService.sendOtp(email, 'EMAIL_VERIFICATION', user.name || undefined);

    res.status(403).json({
      success: false,
      message: 'Email not verified. We have sent you a verification code.',
      data: {
        requiresVerification: true,
        email,
        role: user.role,
      },
    });
    return;
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password || '');
  
  if (!isPasswordValid) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate token
  const token = generateToken(user.id);

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        image: user.image,
      },
      token,
    },
  });
});
