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
    get OtpService () {
        return OtpService;
    },
    get otpService () {
        return otpService;
    }
});
const _client = require("@prisma/client");
const _otpgenerator = /*#__PURE__*/ _interop_require_wildcard(require("otp-generator"));
const _emailservice = require("./email.service");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const prisma = new _client.PrismaClient();
class OtpService {
    OTP_LENGTH = 6;
    OTP_EXPIRY_MINUTES = 10;
    MAX_OTP_ATTEMPTS = 3;
    // Generate a 6-digit OTP
    generateOtp() {
        return _otpgenerator.generate(this.OTP_LENGTH, {
            digits: true,
            lowerCaseAlphabets: false,
            upperCaseAlphabets: false,
            specialChars: false
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
                    verified: false
                }
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
                    expiresAt
                }
            });
            return otp;
        } catch (error) {
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
                        gt: new Date()
                    }
                }
            });
            return !!otpRecord;
        } catch (error) {
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
                        gt: new Date()
                    }
                }
            });
            if (!otpRecord) {
                return false;
            }
            // Mark OTP as verified
            await prisma.otpVerification.update({
                where: {
                    id: otpRecord.id
                },
                data: {
                    verified: true
                }
            });
            return true;
        } catch (error) {
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
            await _emailservice.emailService.sendOtpEmail(email, otp, type, name);
        } catch (error) {
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
                        gt: new Date(Date.now() - 60 * 1000)
                    }
                }
            });
            if (recentOtp) {
                throw new Error('Please wait a minute before requesting a new OTP');
            }
            // Send new OTP
            await this.sendOtp(email, type, name);
        } catch (error) {
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
                                lt: new Date()
                            }
                        },
                        {
                            verified: true,
                            updatedAt: {
                                lt: new Date(Date.now() - 24 * 60 * 60 * 1000)
                            }
                        }
                    ]
                }
            });
        } catch (error) {
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
                    gt: new Date()
                }
            }
        });
        return !!otpRecord;
    }
}
const otpService = new OtpService();

//# sourceMappingURL=otp.service.js.map