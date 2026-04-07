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
    get loginWithOtpCheck () {
        return loginWithOtpCheck;
    },
    get registerWithOtp () {
        return registerWithOtp;
    },
    get requestPasswordReset () {
        return requestPasswordReset;
    },
    get resendOtp () {
        return resendOtp;
    },
    get resetPasswordWithOtp () {
        return resetPasswordWithOtp;
    },
    get verifyPasswordResetOtp () {
        return verifyPasswordResetOtp;
    },
    get verifySignupOtp () {
        return verifySignupOtp;
    },
    get verifySocialLoginOtp () {
        return verifySocialLoginOtp;
    }
});
const _bcryptjs = /*#__PURE__*/ _interop_require_default(require("bcryptjs"));
const _jsonwebtoken = /*#__PURE__*/ _interop_require_default(require("jsonwebtoken"));
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
const _otpservice = require("../services/otp.service");
const _constants = require("../config/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Helper to generate unique userId (same logic as UserModel)
const generateUserId = async ()=>{
    const counter = await _database.default.counter.upsert({
        where: {
            name: 'user'
        },
        update: {
            value: {
                increment: 1
            }
        },
        create: {
            name: 'user',
            value: 7777
        }
    });
    return counter.value.toString();
};
// Generate JWT token
const generateToken = (user)=>{
    return _jsonwebtoken.default.sign({
        id: user.id,
        email: user.email,
        role: user.role
    }, _constants.JWT_SECRET, {
        expiresIn: _constants.JWT_EXPIRES_IN
    });
};
const registerWithOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { name, email, password, role = 'DOG_OWNER', phone } = req.body;
    // Validate input
    if (!name || !email || !password) {
        throw new _AppError.AppError('Missing required fields', 400);
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new _AppError.AppError('Invalid email format', 400);
    }
    // Validate password strength
    if (password.length < 8) {
        throw new _AppError.AppError('Password must be at least 8 characters long', 400);
    }
    // Check if user already exists with this email (regardless of role)
    const existingUser = await _database.default.user.findFirst({
        where: {
            email
        }
    });
    if (existingUser) {
        // Check if the existing user has a different role
        if (existingUser.role !== role) {
            throw new _AppError.AppError(`An account already exists with this email as a ${existingUser.role.replace('_', ' ').toLowerCase()}. Each email can only have one account.`, 409);
        }
        if (existingUser.emailVerified) {
            throw new _AppError.AppError('User already exists with this email', 409);
        }
    // If user exists with same role but not verified, allow them to re-register (update their data)
    }
    // Hash password
    const hashedPassword = await _bcryptjs.default.hash(password, 10);
    // Generate userId for new users
    const userId = existingUser ? undefined : await generateUserId();
    // Create or update user (but not verified yet)
    const user = existingUser ? await _database.default.user.update({
        where: {
            id: existingUser.id
        },
        data: {
            name,
            password: hashedPassword,
            phone,
            emailVerified: null
        }
    }) : await _database.default.user.create({
        data: {
            name,
            email,
            password: hashedPassword,
            role,
            phone,
            userId,
            emailVerified: null
        }
    });
    // Send OTP
    try {
        await _otpservice.otpService.sendOtp(email, 'SIGNUP', name);
    } catch (error) {
        // Delete user if OTP sending fails (only if newly created)
        if (!existingUser) {
            await _database.default.user.delete({
                where: {
                    id: user.id
                }
            });
        }
        throw new _AppError.AppError('Failed to send verification email. Please try again.', 500);
    }
    res.status(201).json({
        success: true,
        message: 'Registration successful. Please check your email for the verification code.',
        data: {
            email,
            role
        }
    });
});
const verifySignupOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email, otp, role = 'DOG_OWNER' } = req.body;
    if (!email || !otp) {
        throw new _AppError.AppError('Email and OTP are required', 400);
    }
    // Verify OTP
    const isValid = await _otpservice.otpService.verifyOtp(email, otp, 'SIGNUP');
    if (!isValid) {
        throw new _AppError.AppError('Invalid or expired OTP', 400);
    }
    // Update user as verified
    const user = await _database.default.user.update({
        where: {
            email_role: {
                email,
                role
            }
        },
        data: {
            emailVerified: new Date()
        }
    });
    // Generate token
    const token = generateToken(user);
    res.json({
        success: true,
        message: 'Email verified successfully',
        data: {
            user: {
                id: user.id,
                userId: user.userId,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone
            },
            token
        }
    });
});
const resendOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email, type = 'SIGNUP' } = req.body;
    if (!email) {
        throw new _AppError.AppError('Email is required', 400);
    }
    // Get user name for email
    const user = await _database.default.user.findFirst({
        where: {
            email
        }
    });
    try {
        await _otpservice.otpService.resendOtp(email, type, user?.name || undefined);
    } catch (error) {
        throw new _AppError.AppError(error.message || 'Failed to resend OTP', 400);
    }
    res.json({
        success: true,
        message: 'OTP sent successfully'
    });
});
const requestPasswordReset = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email } = req.body;
    if (!email) {
        throw new _AppError.AppError('Email is required', 400);
    }
    // Check if user exists
    const user = await _database.default.user.findFirst({
        where: {
            email
        }
    });
    if (!user) {
        throw new _AppError.AppError('No account found with this email address', 404);
    }
    // Send OTP
    try {
        await _otpservice.otpService.sendOtp(email, 'RESET_PASSWORD', user.name || undefined);
    } catch (error) {
        throw new _AppError.AppError('Failed to send reset email. Please try again.', 500);
    }
    res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset code.'
    });
});
const verifyPasswordResetOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email, otp } = req.body;
    if (!email || !otp) {
        throw new _AppError.AppError('Email and OTP are required', 400);
    }
    // Verify OTP and mark as used
    const isValid = await _otpservice.otpService.verifyOtp(email, otp, 'RESET_PASSWORD');
    if (!isValid) {
        throw new _AppError.AppError('Invalid or expired OTP', 400);
    }
    // Generate a temporary token for password reset (valid for 10 minutes)
    const resetToken = _jsonwebtoken.default.sign({
        email,
        purpose: 'password-reset',
        otpVerified: true
    }, process.env.JWT_SECRET, {
        expiresIn: '10m'
    });
    res.json({
        success: true,
        message: 'OTP verified successfully. You can now reset your password.',
        data: {
            email,
            otpVerified: true,
            resetToken
        }
    });
});
const resetPasswordWithOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
        throw new _AppError.AppError('Reset token and new password are required', 400);
    }
    // Validate password strength
    if (newPassword.length < 8) {
        throw new _AppError.AppError('Password must be at least 8 characters long', 400);
    }
    // Verify reset token
    let decoded;
    try {
        decoded = _jsonwebtoken.default.verify(resetToken, process.env.JWT_SECRET);
    } catch (error) {
        throw new _AppError.AppError('Invalid or expired reset token', 401);
    }
    // Check if token is for password reset
    if (decoded.purpose !== 'password-reset' || !decoded.otpVerified) {
        throw new _AppError.AppError('Invalid reset token', 401);
    }
    const email = decoded.email;
    // Hash new password
    const hashedPassword = await _bcryptjs.default.hash(newPassword, 10);
    // Update user password
    await _database.default.user.updateMany({
        where: {
            email
        },
        data: {
            password: hashedPassword
        }
    });
    res.json({
        success: true,
        message: 'Password reset successfully'
    });
});
const verifySocialLoginOtp = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email, otp } = req.body;
    if (!email || !otp) {
        throw new _AppError.AppError('Email and OTP are required', 400);
    }
    // Verify OTP
    const isValid = await _otpservice.otpService.verifyOtp(email, otp, 'SOCIAL_LOGIN');
    if (!isValid) {
        throw new _AppError.AppError('Invalid or expired OTP', 400);
    }
    // Update user as verified
    const user = await _database.default.user.update({
        where: {
            email
        },
        data: {
            emailVerified: new Date()
        }
    });
    // Generate token
    const token = _jsonwebtoken.default.sign({
        id: user.id,
        email: user.email,
        role: user.role
    }, _constants.JWT_SECRET, {
        expiresIn: _constants.JWT_EXPIRES_IN
    });
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
                googleImage: user.googleImage
            },
            token
        }
    });
});
const loginWithOtpCheck = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { email, password } = req.body;
    if (!email || !password) {
        throw new _AppError.AppError('Email and password are required', 400);
    }
    // Find user by email - prioritize users with password set (for email/password login)
    // This handles the case where same email has DOG_OWNER (google) and FIELD_OWNER (password)
    let user;
    try {
        // First, try to find a user with this email who has a password set
        user = await _database.default.user.findFirst({
            where: {
                email,
                password: {
                    not: null
                }
            }
        });
        // If no user with password found, try to find any user with this email
        if (!user) {
            user = await _database.default.user.findFirst({
                where: {
                    email
                }
            });
        }
    } catch (error) {
        // Log the Prisma error for debugging
        console.error('[Login] Database query error:', error.message);
        // Return a user-friendly error message instead of exposing database internals
        throw new _AppError.AppError('Invalid credentials', 401);
    }
    if (!user) {
        throw new _AppError.AppError('Invalid credentials', 401);
    }
    // Check if email is verified
    if (!user.emailVerified) {
        // Send new OTP
        await _otpservice.otpService.sendOtp(email, 'EMAIL_VERIFICATION', user.name || undefined);
        res.status(403).json({
            success: false,
            message: 'Email not verified. We have sent you a verification code.',
            data: {
                requiresVerification: true,
                email,
                role: user.role
            }
        });
        return;
    }
    // Verify password
    const isPasswordValid = await _bcryptjs.default.compare(password, user.password || '');
    if (!isPasswordValid) {
        throw new _AppError.AppError('Invalid credentials', 401);
    }
    // Generate token
    const token = generateToken(user);
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
                image: user.image
            },
            token
        }
    });
});

//# sourceMappingURL=auth.otp.controller.js.map