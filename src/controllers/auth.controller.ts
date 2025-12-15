//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import UserModel from '../models/user.model';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/constants';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

class AuthController {
  // Register new user
  register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    console.log('Registration request body:', req.body);
    const { name, email, password, role, phone } = req.body;

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

    // Check if user already exists with same email (regardless of role)
    const userRole = role || 'DOG_OWNER';
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      // Check if the existing user has a different role
      if (existingUser.role !== userRole) {
        throw new AppError(`An account already exists with this email.`, 409);
      }

      // Check if user has OAuth accounts
      const hasOAuthAccount = await UserModel.hasOAuthAccount(existingUser.id);
      const hasPassword = !!existingUser.password;

      if (hasOAuthAccount && !hasPassword) {
        // User exists with OAuth only
        throw new AppError('This account is already registered with Google/Apple. Please sign in using the social login option.', 409);
      } else if (hasPassword) {
        // User exists with email/password
        throw new AppError(`An account with this email already exists. Please sign in instead.`, 409);
      } else {
        // Generic message
        throw new AppError(`User already exists with this email`, 409);
      }
    }

    // Check if phone number already exists
    if (phone) {
      const existingUserByPhone = await UserModel.findByPhone(phone);
      if (existingUserByPhone) {
        throw new AppError('This phone number is already registered with another account. Please use a different phone number or sign in to your existing account.', 409);
      }
    }

    // Validate role
    const validRoles = ['DOG_OWNER', 'FIELD_OWNER', 'ADMIN'];
    if (role && !validRoles.includes(role)) {
      throw new AppError('Invalid role specified', 400);
    }

    // Create user
    const user = await UserModel.create({
      name,
      email,
      password,
      role: userRole,
      phone,
    });

    // NOTE: Empty field creation removed - fields are now created dynamically
    // when the field owner first saves their field details.
    // This prevents orphaned field documents and handles cases where
    // fields are deleted from the database.

    // Old code kept for reference:
    // if (user.role === 'FIELD_OWNER') {
    //   try {
    //     const FieldModel = require('../models/field.model').default;
    //     await FieldModel.create({
    //       ownerId: user.id,
    //       fieldDetailsCompleted: false,
    //       uploadImagesCompleted: false,
    //       pricingAvailabilityCompleted: false,
    //       bookingRulesCompleted: false,
    //       isActive: false,
    //       amenities: [],
    //       rules: [],
    //       images: [],
    //       operatingDays: []
    //     });
    //   } catch (error) {
    //     console.error('Error creating empty field for field owner:', error);
    //   }
    // }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET as jwt.Secret,
      {
        expiresIn: JWT_EXPIRES_IN as string | number
      }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user,
        token,
      },
    });
  });

  // Login user
  login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, role } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Find user by email only (since email is unique across all roles now)
    const user = await UserModel.findByEmail(email);
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    // If role is specified, verify it matches the user's role
    if (role && user.role !== role) {
      throw new AppError(`This account is registered as a ${user.role.replace('_', ' ').toLowerCase()}. Please use the correct login form.`, 401);
    }

    // Check if user has password (they might only have OAuth)
    if (!user.password) {
      const hasOAuthAccount = await UserModel.hasOAuthAccount(user.id);
      if (hasOAuthAccount) {
        const providers = await UserModel.getOAuthProviders(user.id);
        const providerList = providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' or ');
        throw new AppError(`This account uses ${providerList} sign-in. Please use the social login button to sign in.`, 401);
      } else {
        throw new AppError('Invalid email or password', 401);
      }
    }

    // Verify password
    const isPasswordValid = await UserModel.verifyPassword(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET as jwt.Secret,
      {
        expiresIn: JWT_EXPIRES_IN as string | number
      }
    );

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token,
      },
    });
  });

  // Get current user
  getMe = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.id;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      success: true,
      data: user,
    });
  });

  // Logout (if using sessions/cookies)
  logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // If using cookies, clear them here
    res.clearCookie('token');

    res.json({
      success: true,
      message: 'Logout successful',
    });
  });

  // Refresh token
  refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;

      // SECURITY FIX: Verify user still exists and is active
      const user = await UserModel.findById(decoded.id);

      if (!user) {
        throw new AppError('User no longer exists', 401);
      }

      // Check if user account is blocked or deleted
      if (user.isBlocked) {
        throw new AppError('Your account has been blocked', 403);
      }

      // Generate new access token with current user data (in case role changed)
      const newToken = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role
        },
        JWT_SECRET as jwt.Secret,
        { expiresIn: JWT_EXPIRES_IN as string | number }
      );

      res.json({
        success: true,
        data: {
          token: newToken,
        },
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid refresh token', 401);
    }
  });

  // Social login (Google/Apple)
  // For Google: requires idToken to be verified server-side
  // For Apple: use the dedicated appleSignIn endpoint instead
  socialLogin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, name, image, provider, providerId, role, idToken } = req.body;

    // Comprehensive logging for social login payload
    console.log('==================== SOCIAL LOGIN PAYLOAD ====================');
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));
    console.log('Individual Fields:');
    console.log('  - Email:', email);
    console.log('  - Name:', name);
    console.log('  - Image:', image);
    console.log('  - Provider:', provider);
    console.log('  - Provider ID:', providerId);
    console.log('  - ID Token present:', !!idToken);
    console.log('  - Role:', role);
    console.log('==============================================================');

    // Validate provider first
    const validProviders = ['google', 'apple'];
    if (!provider || !validProviders.includes(provider)) {
      console.log('❌ VALIDATION FAILED: Invalid provider -', provider);
      throw new AppError('Invalid provider', 400);
    }
    console.log('✅ Provider validation passed:', provider);

    // For Google, we MUST verify the ID token server-side
    // This prevents attackers from sending fake providerId values
    let verifiedEmail = email;
    let verifiedProviderId = providerId;
    let verifiedName = name;
    let verifiedImage = image;

    if (provider === 'google') {
      // Google requires idToken verification
      if (!idToken) {
        console.log('❌ VALIDATION FAILED: Google login requires idToken');
        throw new AppError('Google ID token is required for Google login', 400);
      }

      try {
        // Verify the Google ID token
        console.log('🔐 Verifying Google ID token...');
        const { googleSignInService } = require('../services/google-signin.service');
        const googleUser = await googleSignInService.verifyIdToken(idToken);

        // Use verified values from the token (not from request body)
        verifiedEmail = googleUser.email;
        verifiedProviderId = googleUser.sub;
        verifiedName = googleUser.name || name;
        verifiedImage = googleUser.picture || image;

        console.log('✅ Google token verified successfully');
        console.log('  - Verified Email:', verifiedEmail);
        console.log('  - Verified Provider ID:', verifiedProviderId);
        console.log('  - Verified Name:', verifiedName);

        // Check if the email matches (if provided in body)
        if (email && email !== verifiedEmail) {
          console.log('⚠️ Email mismatch - using verified email from token');
        }
      } catch (error: any) {
        console.error('❌ Google token verification failed:', error.message);
        throw new AppError(error.message || 'Invalid Google ID token', 401);
      }
    } else if (provider === 'apple') {
      // SECURITY FIX: Apple Sign-In must provide idToken for verification
      // Do not allow unverified providerId/email (prevents account takeover)
      if (!idToken) {
        console.log('❌ VALIDATION FAILED: Apple login missing idToken');
        throw new AppError('Apple Sign In requires idToken for verification. Please use the /auth/apple endpoint', 400);
      }

      try {
        // Verify the Apple ID token
        console.log('🔐 Verifying Apple ID token...');
        const { appleSignInService } = require('../services/apple-signin.service');
        const appleUser = await appleSignInService.verifyIdToken(idToken);

        // Use verified values from the token (not from request body)
        verifiedEmail = appleUser.email;
        verifiedProviderId = appleUser.sub;
        verifiedName = appleUser.name || name || verifiedEmail.split('@')[0];
        verifiedImage = image; // Apple doesn't provide profile pictures

        console.log('✅ Apple token verified successfully');
        console.log('  - Verified Email:', verifiedEmail);
        console.log('  - Verified Provider ID:', verifiedProviderId);
        console.log('  - Verified Name:', verifiedName);

        // Check if the email matches (if provided in body)
        if (email && email !== verifiedEmail) {
          console.log('⚠️ Email mismatch - using verified email from token');
        }
      } catch (error: any) {
        console.error('❌ Apple token verification failed:', error.message);
        throw new AppError(error.message || 'Invalid Apple ID token', 401);
      }
    }

    // Validate that we have required fields after verification
    if (!verifiedEmail || !verifiedProviderId) {
      console.log('❌ VALIDATION FAILED: Missing required fields after verification');
      throw new AppError('Missing required fields', 400);
    }

    // Validate role if provided
    const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
    if (role && !validRoles.includes(role)) {
      console.log('❌ VALIDATION FAILED: Invalid role -', role);
      throw new AppError('Invalid role specified', 400);
    }
    console.log('✅ Role validation passed:', role || 'DOG_OWNER (default)');

    // Check if user already exists AND is verified (using verified email)
    console.log('🔍 Checking for existing user with email:', verifiedEmail);
    const existingUser = await UserModel.findByEmail(verifiedEmail);

    if (existingUser && existingUser.emailVerified) {
      console.log('✅ Existing verified user found');
      console.log('  - User ID:', existingUser.id);
      console.log('  - User Role:', existingUser.role);
      console.log('  - Selected Role:', role || 'DOG_OWNER');
      console.log('  - Provider:', existingUser.provider);

      // Check if the selected role matches the user's registered role
      const selectedRole = role || 'DOG_OWNER';
      if (existingUser.role !== selectedRole) {
        const roleNames = {
          DOG_OWNER: 'Dog Owner',
          FIELD_OWNER: 'Field Owner',
          ADMIN: 'Admin'
        };
        const errorMessage = `This email is already registered as a ${roleNames[existingUser.role]}. Please select ${roleNames[existingUser.role]} to continue.`;
        console.log('❌ Role mismatch:', errorMessage);
        throw new AppError(errorMessage, 400);
      }

      // User exists, is verified, and role matches - log them in immediately
      console.log('✅ Role matches - logging in immediately');
      const token = jwt.sign(
        {
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role,
          provider: existingUser.provider
        },
        JWT_SECRET as jwt.Secret,
        {
          expiresIn: JWT_EXPIRES_IN as string | number
        }
      );

      console.log('✅ Token generated for existing user');
      return res.json({
        success: true,
        message: 'Social login successful',
        data: {
          user: existingUser,
          token,
        },
      });
    }


    // Create or update user (AUTOMATICALLY VERIFIED for social logins)
    // Use VERIFIED values from token, not from request body
    console.log('📝 Creating or updating social user...');
    console.log('  - Email (verified):', verifiedEmail);
    console.log('  - Name (verified):', verifiedName);
    console.log('  - Image (verified):', verifiedImage);
    console.log('  - Provider:', provider);
    console.log('  - Provider ID (verified):', verifiedProviderId);
    console.log('  - Role:', role || 'DOG_OWNER');

    const user = await UserModel.createOrUpdateSocialUser({
      email: verifiedEmail,
      name: verifiedName,
      image: verifiedImage,
      provider,
      providerId: verifiedProviderId,
      role: role || 'DOG_OWNER',
    });

    console.log('✅ User created/updated successfully');
    console.log('  - User ID:', user.id);
    console.log('  - Email Verified:', user.emailVerified);

    // NOTE: Empty field creation removed - fields are now created dynamically
    // when the field owner first saves their field details.
    // See comment in register method for more details.

    // Social login users are automatically verified - no OTP needed
    // Generate token and log them in immediately
    console.log('✅ Social login user - auto-verifying and logging in');

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        provider: user.provider
      },
      JWT_SECRET as jwt.Secret,
      {
        expiresIn: JWT_EXPIRES_IN as string | number
      }
    );

    console.log('✅ Token generated for new social user');
    res.status(200).json({
      success: true,
      message: 'Social login successful',
      data: {
        user,
        token,
      },
    });
    console.log('==================== SOCIAL LOGIN COMPLETE ====================');
  });

  // Update user role (for OAuth users who selected role after account creation)
  updateRole = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, role } = req.body;
    const userId = (req as any).user?.id;

    // Validate input
    if (!email || !role) {
      throw new AppError('Email and role are required', 400);
    }

    // Validate role
    const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
    if (!validRoles.includes(role)) {
      throw new AppError('Invalid role specified', 400);
    }

    // Verify the user is updating their own role
    const user = await UserModel.findByEmail(email);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.id !== userId) {
      throw new AppError('You can only update your own role', 403);
    }

    // Update the user's role
    const updatedUser = await UserModel.updateRole(user.id, role);

    // NOTE: Empty field creation removed - fields are now created dynamically
    // when the field owner first saves their field details.
    // See comment in register method for more details.

    // Generate new token with updated role
    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role
      },
      JWT_SECRET as jwt.Secret,
      {
        expiresIn: JWT_EXPIRES_IN as string | number
      }
    );

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: {
        user: updatedUser,
        token,
      },
    });
  });

  // Apple Sign In - Mobile & Web friendly
  // Handles Apple ID token verification on backend
  appleSignIn = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { idToken, name, role } = req.body;

    console.log('==================== APPLE SIGN IN ====================');
    console.log('Request Body:', { hasIdToken: !!idToken, name, role });

    // Validate input
    if (!idToken) {
      console.log('❌ VALIDATION FAILED: Missing ID token');
      throw new AppError('Apple ID token is required', 400);
    }

    // Validate role if provided
    const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
    if (role && !validRoles.includes(role)) {
      console.log('❌ VALIDATION FAILED: Invalid role -', role);
      throw new AppError('Invalid role specified', 400);
    }
    console.log('✅ Role validation passed:', role || 'DOG_OWNER (default)');

    try {
      // Verify Apple ID token using backend service
      console.log('🔐 Verifying Apple ID token...');
      const { appleSignInService } = require('../services/apple-signin.service');
      const appleUser = await appleSignInService.verifyIdToken(idToken);

      console.log('✅ Apple token verified successfully');
      console.log('  - Apple User ID:', appleUser.sub);
      console.log('  - Email:', appleUser.email);
      console.log('  - Email Verified:', appleUser.emailVerified);

      // Check if user already exists AND is verified
      console.log('🔍 Checking for existing user with email:', appleUser.email);
      const existingUser = await UserModel.findByEmail(appleUser.email);

      if (existingUser && existingUser.emailVerified) {
        console.log('✅ Existing verified user found');
        console.log('  - User ID:', existingUser.id);
        console.log('  - User Role:', existingUser.role);
        console.log('  - Selected Role:', role || 'DOG_OWNER');

        // Check if the selected role matches the user's registered role
        const selectedRole = role || 'DOG_OWNER';
        if (existingUser.role !== selectedRole) {
          const roleNames = {
            DOG_OWNER: 'Dog Owner',
            FIELD_OWNER: 'Field Owner',
            ADMIN: 'Admin'
          };
          const errorMessage = `This email is already registered as a ${roleNames[existingUser.role]}. Please select ${roleNames[existingUser.role]} to continue.`;
          console.log('❌ Role mismatch:', errorMessage);
          throw new AppError(errorMessage, 400);
        }

        // User exists, is verified, and role matches - log them in immediately
        console.log('✅ Role matches - logging in immediately');
        const token = jwt.sign(
          {
            id: existingUser.id,
            email: existingUser.email,
            role: existingUser.role,
            provider: 'apple'
          },
          JWT_SECRET as jwt.Secret,
          {
            expiresIn: JWT_EXPIRES_IN as string | number
          }
        );

        console.log('✅ Token generated for existing user');
        return res.json({
          success: true,
          message: 'Apple sign in successful',
          data: {
            user: existingUser,
            token,
          },
        });
      }

      // Create or update user (NOT VERIFIED YET)
      console.log('📝 Creating or updating Apple user...');
      console.log('  - Email:', appleUser.email);
      console.log('  - Name:', name || appleUser.name);
      console.log('  - Provider ID:', appleUser.sub);
      console.log('  - Role:', role || 'DOG_OWNER');

      const user = await UserModel.createOrUpdateSocialUser({
        email: appleUser.email,
        name: name || (appleUser.name ? `${appleUser.name.firstName || ''} ${appleUser.name.lastName || ''}`.trim() : undefined),
        image: undefined, // Apple doesn't provide profile images
        provider: 'apple',
        providerId: appleUser.sub,
        role: role || 'DOG_OWNER',
      });

      console.log('✅ User created/updated successfully');
      console.log('  - User ID:', user.id);
      console.log('  - Email Verified:', user.emailVerified);

      // Send OTP for verification
      console.log('📧 Sending OTP for email verification...');
      const { otpService } = require('../services/otp.service');
      await otpService.sendOtp(appleUser.email, 'SOCIAL_LOGIN', name || user.name);
      console.log('✅ OTP sent successfully to:', appleUser.email);

      console.log('📤 Sending response - OTP verification required');
      res.status(200).json({
        success: true,
        requiresVerification: true,
        message: 'Please check your email for verification code',
        data: {
          email: appleUser.email,
          role: user.role,
        },
      });
      console.log('==================== APPLE SIGN IN COMPLETE ====================');
    } catch (error: any) {
      console.error('❌ Apple Sign In failed:', error);

      // Handle specific Apple Sign In errors
      if (error.message && error.message.includes('Invalid Apple ID token')) {
        throw new AppError('Invalid or expired Apple ID token', 401);
      }

      // Re-throw other errors
      throw error;
    }
  });
}

export default new AuthController();
