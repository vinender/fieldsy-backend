"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.otpService = exports.OtpService = void 0;
//@ts-nocheck
const client_1 = require("@prisma/client");
const otpGenerator = __importStar(require("otp-generator"));
const email_service_1 = require("./email.service");
const prisma = new client_1.PrismaClient();
class OtpService {
    OTP_LENGTH = 6;
    OTP_EXPIRY_MINUTES = 10;
    MAX_OTP_ATTEMPTS = 3;
    // Generate a 6-digit OTP
    generateOtp() {
        return otpGenerator.generate(this.OTP_LENGTH, {
            digits: true,
            lowerCaseAlphabets: false,
            upperCaseAlphabets: false,
            specialChars: false,
        });
    }
    // Create and save OTP to database
    async createOtp(email, type) {
        try {
            // Delete any existing OTPs for this email and type
            await prisma.otpVerification.deleteMany({
                where: {
                    email,
                    type,
                    verified: false,
                },
            });
            // Generate new OTP
            const otp = this.generateOtp();
            // Calculate expiry time
            const expiresAt = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes() + this.OTP_EXPIRY_MINUTES);
            // Save OTP to database
            await prisma.otpVerification.create({
                data: {
                    email,
                    otp,
                    type,
                    expiresAt,
                },
            });
            return otp;
        }
        catch (error) {
            console.error('Error creating OTP:', error);
            throw new Error('Failed to create OTP');
        }
    }
    // Check if OTP is valid without marking as verified
    async checkOtpValidity(email, otp, type) {
        try {
            const otpRecord = await prisma.otpVerification.findFirst({
                where: {
                    email,
                    otp,
                    type,
                    verified: false,
                    expiresAt: {
                        gt: new Date(), // Not expired
                    },
                },
            });
            return !!otpRecord;
        }
        catch (error) {
            console.error('Error checking OTP:', error);
            return false;
        }
    }
    // Verify OTP and mark as used
    async verifyOtp(email, otp, type) {
        try {
            // Find the OTP record
            const otpRecord = await prisma.otpVerification.findFirst({
                where: {
                    email,
                    otp,
                    type,
                    verified: false,
                    expiresAt: {
                        gt: new Date(), // Not expired
                    },
                },
            });
            if (!otpRecord) {
                return false;
            }
            // Mark OTP as verified
            await prisma.otpVerification.update({
                where: {
                    id: otpRecord.id,
                },
                data: {
                    verified: true,
                },
            });
            return true;
        }
        catch (error) {
            console.error('Error verifying OTP:', error);
            return false;
        }
    }
    // Send OTP via email
    async sendOtp(email, type, name) {
        try {
            // Create OTP
            const otp = await this.createOtp(email, type);
            // Send email with OTP
            await email_service_1.emailService.sendOtpEmail(email, otp, type, name);
        }
        catch (error) {
            console.error('Error sending OTP:', error);
            throw new Error('Failed to send OTP');
        }
    }
    // Resend OTP
    async resendOtp(email, type, name) {
        try {
            // Check if there's a recent OTP (prevent spam)
            const recentOtp = await prisma.otpVerification.findFirst({
                where: {
                    email,
                    type,
                    verified: false,
                    createdAt: {
                        gt: new Date(Date.now() - 60 * 1000), // Within last minute
                    },
                },
            });
            if (recentOtp) {
                throw new Error('Please wait a minute before requesting a new OTP');
            }
            // Send new OTP
            await this.sendOtp(email, type, name);
        }
        catch (error) {
            console.error('Error resending OTP:', error);
            throw error;
        }
    }
    // Clean up expired OTPs (can be run as a cron job)
    async cleanupExpiredOtps() {
        try {
            await prisma.otpVerification.deleteMany({
                where: {
                    OR: [
                        {
                            expiresAt: {
                                lt: new Date(),
                            },
                        },
                        {
                            verified: true,
                            updatedAt: {
                                lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours old
                            },
                        },
                    ],
                },
            });
        }
        catch (error) {
            console.error('Error cleaning up expired OTPs:', error);
        }
    }
    // Check if email has pending verification
    async hasPendingVerification(email, type) {
        const otpRecord = await prisma.otpVerification.findFirst({
            where: {
                email,
                type,
                verified: false,
                expiresAt: {
                    gt: new Date(),
                },
            },
        });
        return !!otpRecord;
    }
}
exports.OtpService = OtpService;
exports.otpService = new OtpService();
