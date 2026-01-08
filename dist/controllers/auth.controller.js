"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_model_1 = __importDefault(require("../models/user.model"));
const constants_1 = require("../config/constants");
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
class AuthController {
    // Register new user
    register = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        console.log('Registration request body:', req.body);
        const { name, email, password, role, phone } = req.body;
        // Validate input
        if (!name || !email || !password) {
            throw new AppError_1.AppError('Missing required fields', 400);
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new AppError_1.AppError('Invalid email format', 400);
        }
        // Validate password strength
        if (password.length < 8) {
            throw new AppError_1.AppError('Password must be at least 8 characters long', 400);
        }
        // Check if user already exists with same email (regardless of role)
        const userRole = role || 'DOG_OWNER';
        const existingUser = await user_model_1.default.findByEmail(email);
        if (existingUser) {
            // Check if the existing user has a different role
            if (existingUser.role !== userRole) {
                throw new AppError_1.AppError(`An account already exists with this email.`, 409);
            }
            // Check if user has OAuth accounts
            const hasOAuthAccount = await user_model_1.default.hasOAuthAccount(existingUser.id);
            const hasPassword = !!existingUser.password;
            if (hasOAuthAccount && !hasPassword) {
                // User exists with OAuth only
                throw new AppError_1.AppError('This account is already registered with Google/Apple. Please sign in using the social login option.', 409);
            }
            else if (hasPassword) {
                // User exists with email/password
                throw new AppError_1.AppError(`An account with this email already exists. Please sign in instead.`, 409);
            }
            else {
                // Generic message
                throw new AppError_1.AppError(`User already exists with this email`, 409);
            }
        }
        // Check if phone number already exists
        if (phone) {
            const existingUserByPhone = await user_model_1.default.findByPhone(phone);
            if (existingUserByPhone) {
                throw new AppError_1.AppError('This phone number is already registered with another account. Please use a different phone number or sign in to your existing account.', 409);
            }
        }
        // Validate role
        const validRoles = ['DOG_OWNER', 'FIELD_OWNER', 'ADMIN'];
        if (role && !validRoles.includes(role)) {
            throw new AppError_1.AppError('Invalid role specified', 400);
        }
        // Create user
        const user = await user_model_1.default.create({
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
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role
        }, constants_1.JWT_SECRET, {
            expiresIn: constants_1.JWT_EXPIRES_IN
        });
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
    login = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { email, password, role } = req.body;
        // Validate input
        if (!email || !password) {
            throw new AppError_1.AppError('Email and password are required', 400);
        }
        // Find user by email only (since email is unique across all roles now)
        const user = await user_model_1.default.findByEmail(email);
        if (!user) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        // If role is specified, verify it matches the user's role
        if (role && user.role !== role) {
            throw new AppError_1.AppError(`This account is registered as a ${user.role.replace('_', ' ').toLowerCase()}. Please use the correct login form.`, 401);
        }
        // Check if user has password (they might only have OAuth)
        if (!user.password) {
            const hasOAuthAccount = await user_model_1.default.hasOAuthAccount(user.id);
            if (hasOAuthAccount) {
                const providers = await user_model_1.default.getOAuthProviders(user.id);
                const providerList = providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' or ');
                throw new AppError_1.AppError(`This account uses ${providerList} sign-in. Please use the social login button to sign in.`, 401);
            }
            else {
                throw new AppError_1.AppError('Invalid email or password', 401);
            }
        }
        // Verify password
        const isPasswordValid = await user_model_1.default.verifyPassword(password, user.password);
        if (!isPasswordValid) {
            throw new AppError_1.AppError('Invalid email or password', 401);
        }
        // Generate JWT token
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role
        }, constants_1.JWT_SECRET, {
            expiresIn: constants_1.JWT_EXPIRES_IN
        });
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
    getMe = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user?.id;
        if (!userId) {
            throw new AppError_1.AppError('User not authenticated', 401);
        }
        const user = await user_model_1.default.findById(userId);
        if (!user) {
            throw new AppError_1.AppError('User not found', 404);
        }
        res.json({
            success: true,
            data: user,
        });
    });
    // Logout (if using sessions/cookies)
    logout = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        // If using cookies, clear them here
        res.clearCookie('token');
        res.json({
            success: true,
            message: 'Logout successful',
        });
    });
    // Refresh token
    refreshToken = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            throw new AppError_1.AppError('Refresh token is required', 400);
        }
        try {
            // Verify refresh token
            const decoded = jsonwebtoken_1.default.verify(refreshToken, constants_1.JWT_SECRET);
            // SECURITY FIX: Verify user still exists and is active
            const user = await user_model_1.default.findById(decoded.id);
            if (!user) {
                throw new AppError_1.AppError('User no longer exists', 401);
            }
            // Check if user account is blocked or deleted
            if (user.isBlocked) {
                throw new AppError_1.AppError('Your account has been blocked', 403);
            }
            // Generate new access token with current user data (in case role changed)
            const newToken = jsonwebtoken_1.default.sign({
                id: user.id,
                email: user.email,
                role: user.role
            }, constants_1.JWT_SECRET, { expiresIn: constants_1.JWT_EXPIRES_IN });
            res.json({
                success: true,
                data: {
                    token: newToken,
                },
            });
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError('Invalid refresh token', 401);
        }
    });
    // Social login (Google/Apple)
    // For Google: requires idToken to be verified server-side
    // For Apple: use the dedicated appleSignIn endpoint instead
    socialLogin = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
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
            throw new AppError_1.AppError('Invalid provider', 400);
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
                throw new AppError_1.AppError('Google ID token is required for Google login', 400);
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
            }
            catch (error) {
                console.error('❌ Google token verification failed:', error.message);
                throw new AppError_1.AppError(error.message || 'Invalid Google ID token', 401);
            }
        }
        else if (provider === 'apple') {
            // SECURITY FIX: Apple Sign-In must provide idToken for verification
            // Do not allow unverified providerId/email (prevents account takeover)
            if (!idToken) {
                console.log('❌ VALIDATION FAILED: Apple login missing idToken');
                throw new AppError_1.AppError('Apple Sign In requires idToken for verification. Please use the /auth/apple endpoint', 400);
            }
            try {
                // Verify the Apple ID token
                console.log('🔐 Verifying Apple ID token...');
                const { appleSignInService } = require('../services/apple-signin.service');
                const appleUser = await appleSignInService.verifyIdToken(idToken);
                // Use verified values from the token (not from request body)
                verifiedEmail = appleUser.email;
                verifiedProviderId = appleUser.sub;
                // IMPORTANT: Apple only provides name on FIRST sign-in
                // Priority: 1) name from request body, 2) name from Apple token, 3) email prefix
                if (name) {
                    verifiedName = name;
                }
                else if (appleUser.name) {
                    const firstName = appleUser.name.firstName || '';
                    const lastName = appleUser.name.lastName || '';
                    verifiedName = `${firstName} ${lastName}`.trim();
                }
                // Fallback to email prefix if no name available
                if (!verifiedName) {
                    verifiedName = verifiedEmail.split('@')[0];
                    console.log('  ⚠️ No name provided - using email prefix:', verifiedName);
                }
                verifiedImage = image; // Apple doesn't provide profile pictures
                console.log('✅ Apple token verified successfully');
                console.log('  - Verified Email:', verifiedEmail);
                console.log('  - Verified Provider ID:', verifiedProviderId);
                console.log('  - Verified Name:', verifiedName);
                // Check if the email matches (if provided in body)
                if (email && email !== verifiedEmail) {
                    console.log('⚠️ Email mismatch - using verified email from token');
                }
            }
            catch (error) {
                console.error('❌ Apple token verification failed:', error.message);
                throw new AppError_1.AppError(error.message || 'Invalid Apple ID token', 401);
            }
        }
        // Validate that we have required fields after verification
        if (!verifiedEmail || !verifiedProviderId) {
            console.log('❌ VALIDATION FAILED: Missing required fields after verification');
            throw new AppError_1.AppError('Missing required fields', 400);
        }
        // Validate role if provided
        const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
        if (role && !validRoles.includes(role)) {
            console.log('❌ VALIDATION FAILED: Invalid role -', role);
            throw new AppError_1.AppError('Invalid role specified', 400);
        }
        console.log('✅ Role validation passed:', role || 'DOG_OWNER (default)');
        // Check if user already exists AND is verified (using verified email)
        console.log('🔍 Checking for existing user with email:', verifiedEmail);
        const existingUser = await user_model_1.default.findByEmail(verifiedEmail);
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
                throw new AppError_1.AppError(errorMessage, 400);
            }
            // User exists, is verified, and role matches - log them in immediately
            console.log('✅ Role matches - logging in immediately');
            const token = jsonwebtoken_1.default.sign({
                id: existingUser.id,
                email: existingUser.email,
                role: existingUser.role,
                provider: existingUser.provider
            }, constants_1.JWT_SECRET, {
                expiresIn: constants_1.JWT_EXPIRES_IN
            });
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
        const user = await user_model_1.default.createOrUpdateSocialUser({
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
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role,
            provider: user.provider
        }, constants_1.JWT_SECRET, {
            expiresIn: constants_1.JWT_EXPIRES_IN
        });
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
    updateRole = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { email, role } = req.body;
        const userId = req.user?.id;
        // Validate input
        if (!email || !role) {
            throw new AppError_1.AppError('Email and role are required', 400);
        }
        // Validate role
        const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
        if (!validRoles.includes(role)) {
            throw new AppError_1.AppError('Invalid role specified', 400);
        }
        // Verify the user is updating their own role
        const user = await user_model_1.default.findByEmail(email);
        if (!user) {
            throw new AppError_1.AppError('User not found', 404);
        }
        if (user.id !== userId) {
            throw new AppError_1.AppError('You can only update your own role', 403);
        }
        // Update the user's role
        const updatedUser = await user_model_1.default.updateRole(user.id, role);
        // NOTE: Empty field creation removed - fields are now created dynamically
        // when the field owner first saves their field details.
        // See comment in register method for more details.
        // Generate new token with updated role
        const token = jsonwebtoken_1.default.sign({
            id: updatedUser.id,
            email: updatedUser.email,
            role: updatedUser.role
        }, constants_1.JWT_SECRET, {
            expiresIn: constants_1.JWT_EXPIRES_IN
        });
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
    appleSignIn = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { idToken, name, role, clientId: providedClientId, source } = req.body;
        const timestamp = new Date().toISOString();
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║              APPLE SIGN IN ENDPOINT - DEBUG LOG                  ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log(`[${timestamp}] Request received`);
        // Log request details
        console.log('\n📋 REQUEST DETAILS:');
        console.log('─────────────────────────────────────');
        console.log(`   Endpoint: POST /api/auth/apple-signin`);
        console.log(`   Source: ${source || 'not specified (likely mobile)'}`);
        console.log(`   User-Agent: ${req.headers['user-agent'] || 'N/A'}`);
        console.log(`   Content-Type: ${req.headers['content-type'] || 'N/A'}`);
        console.log(`   IP Address: ${req.ip || req.connection?.remoteAddress || 'N/A'}`);
        console.log('\n📦 REQUEST BODY:');
        console.log('─────────────────────────────────────');
        console.log(`   Has idToken: ${!!idToken}`);
        console.log(`   idToken length: ${idToken ? idToken.length : 0} characters`);
        console.log(`   Name: ${name || 'not provided'}`);
        console.log(`   Role: ${role || 'not provided (will default to DOG_OWNER)'}`);
        console.log(`   Provided clientId: ${providedClientId || 'not provided'}`);
        // Validate input
        if (!idToken) {
            console.log('\n❌ VALIDATION FAILED: Missing ID token');
            console.log('   The mobile app must send the identityToken from Apple Sign In');
            throw new AppError_1.AppError('Apple ID token is required', 400);
        }
        // Log token preview (safely)
        console.log('\n🔑 TOKEN PREVIEW:');
        console.log('─────────────────────────────────────');
        console.log(`   First 50 chars: ${idToken.substring(0, 50)}...`);
        console.log(`   Last 20 chars: ...${idToken.substring(idToken.length - 20)}`);
        // Validate role if provided
        const validRoles = ['DOG_OWNER', 'FIELD_OWNER'];
        if (role && !validRoles.includes(role)) {
            console.log(`\n❌ VALIDATION FAILED: Invalid role - ${role}`);
            throw new AppError_1.AppError('Invalid role specified', 400);
        }
        console.log(`\n✅ Input validation passed`);
        console.log(`   Role to use: ${role || 'DOG_OWNER (default)'}`);
        try {
            // Verify Apple ID token using backend service
            console.log('\n🔐 Calling Apple Sign In Service...');
            console.log('─────────────────────────────────────');
            const { appleSignInService } = require('../services/apple-signin.service');
            const requestSource = source || 'mobile';
            const appleUser = await appleSignInService.verifyIdToken(idToken, providedClientId, requestSource);
            console.log('✅ Apple token verified successfully');
            console.log('  - Apple User ID:', appleUser.sub);
            console.log('  - Email:', appleUser.email);
            console.log('  - Email Verified:', appleUser.emailVerified);
            // Check if user already exists AND is verified
            console.log('🔍 Checking for existing user with email:', appleUser.email);
            const existingUser = await user_model_1.default.findByEmail(appleUser.email);
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
                    throw new AppError_1.AppError(errorMessage, 400);
                }
                // User exists, is verified, and role matches - log them in immediately
                console.log('✅ Role matches - logging in immediately');
                const token = jsonwebtoken_1.default.sign({
                    id: existingUser.id,
                    email: existingUser.email,
                    role: existingUser.role,
                    provider: 'apple'
                }, constants_1.JWT_SECRET, {
                    expiresIn: constants_1.JWT_EXPIRES_IN
                });
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
            // Create or update user (AUTO-VERIFIED - Apple already verified the email)
            // IMPORTANT: Apple only provides name on FIRST sign-in, so we must save it then
            // The mobile app should send the name from the Apple credential response
            let userName = name;
            // If name not provided directly, try to get from appleUser (usually undefined after first login)
            if (!userName && appleUser.name) {
                const firstName = appleUser.name.firstName || '';
                const lastName = appleUser.name.lastName || '';
                userName = `${firstName} ${lastName}`.trim();
            }
            // If still no name, use email prefix as fallback (model also does this, but let's be explicit)
            if (!userName) {
                userName = appleUser.email.split('@')[0];
                console.log('  ⚠️ No name provided - using email prefix as fallback:', userName);
            }
            console.log('📝 Creating or updating Apple user...');
            console.log('  - Email:', appleUser.email);
            console.log('  - Name to save:', userName);
            console.log('  - Provider ID:', appleUser.sub);
            console.log('  - Role:', role || 'DOG_OWNER');
            const user = await user_model_1.default.createOrUpdateSocialUser({
                email: appleUser.email,
                name: userName,
                image: undefined, // Apple doesn't provide profile images
                provider: 'apple',
                providerId: appleUser.sub,
                role: role || 'DOG_OWNER',
            });
            console.log('  ✅ User saved with name:', user.name);
            console.log('✅ User created/updated successfully');
            console.log('  - User ID:', user.id);
            console.log('  - Email Verified:', user.emailVerified);
            // Apple Sign In users are AUTO-VERIFIED (Apple already verified their email)
            // No OTP needed - log them in immediately (same as Google Sign In)
            console.log('✅ Apple Sign In - Auto-verifying user (Apple verified email)');
            const token = jsonwebtoken_1.default.sign({
                id: user.id,
                email: user.email,
                role: user.role,
                provider: 'apple'
            }, constants_1.JWT_SECRET, {
                expiresIn: constants_1.JWT_EXPIRES_IN
            });
            console.log('✅ Token generated for new Apple user');
            console.log('\n📤 Sending response - Login successful (no OTP required)');
            res.status(200).json({
                success: true,
                message: 'Apple sign in successful',
                data: {
                    user,
                    token,
                },
            });
            console.log('╔══════════════════════════════════════════════════════════════════╗');
            console.log('║              APPLE SIGN IN ENDPOINT - COMPLETE                   ║');
            console.log('╚══════════════════════════════════════════════════════════════════╝');
            console.log('\n');
        }
        catch (error) {
            console.log('\n');
            console.log('╔══════════════════════════════════════════════════════════════════╗');
            console.log('║              APPLE SIGN IN ENDPOINT - ERROR                      ║');
            console.log('╚══════════════════════════════════════════════════════════════════╝');
            console.error('❌ Apple Sign In failed');
            console.error(`   Error Type: ${error.name || 'Unknown'}`);
            console.error(`   Error Message: ${error.message}`);
            // Provide detailed error information for debugging
            console.log('\n🔍 ERROR ANALYSIS:');
            console.log('─────────────────────────────────────');
            // Handle specific Apple Sign In errors
            if (error.message && error.message.includes('Invalid Apple ID token')) {
                console.log('   Issue: Token verification failed');
                console.log('   Possible causes:');
                console.log('     1. Token has expired (Apple tokens are short-lived, ~5-10 min)');
                console.log('     2. Client ID mismatch (mobile app uses Bundle ID, not Service ID)');
                console.log('     3. Token was issued for a different app');
                console.log('     4. Token is malformed or corrupted');
                console.log('\n   🛠️  FIXES TO TRY:');
                console.log('     - Add APPLE_MOBILE_CLIENT_ID=<your-bundle-id> to .env');
                console.log('     - Or add APPLE_BUNDLE_ID=<your-bundle-id> to .env');
                console.log('     - Ensure mobile app sends token immediately after receiving it');
                console.log('     - Check that device time is synchronized');
                throw new AppError_1.AppError('Invalid or expired Apple ID token. Check server logs for details.', 401);
            }
            if (error.message && error.message.includes('expired')) {
                console.log('   Issue: Token has expired');
                console.log('   Apple ID tokens are only valid for about 5-10 minutes');
                console.log('   Ensure the mobile app sends the token immediately');
                throw new AppError_1.AppError('Apple ID token has expired. Please try signing in again.', 401);
            }
            if (error.message && (error.message.includes('audience') || error.message.includes('aud'))) {
                console.log('   Issue: Client ID / Audience mismatch');
                console.log('   The token was issued for a different app identifier');
                console.log('   Mobile apps use Bundle ID, web apps use Service ID');
                throw new AppError_1.AppError('Apple ID token audience mismatch. Check APPLE_MOBILE_CLIENT_ID configuration.', 401);
            }
            console.log('\n');
            // Re-throw other errors
            throw error;
        }
    });
}
exports.default = new AuthController();
