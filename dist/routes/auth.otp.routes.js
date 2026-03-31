"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = __importDefault(require("express"));
const auth_otp_controller_1 = require("../controllers/auth.otp.controller");
const router = express_1.default.Router();
// Registration with OTP
router.post('/register', auth_otp_controller_1.registerWithOtp);
router.post('/verify-signup', auth_otp_controller_1.verifySignupOtp);
// OTP operations
router.post('/resend-otp', auth_otp_controller_1.resendOtp);
// Password reset with OTP
router.post('/forgot-password', auth_otp_controller_1.requestPasswordReset);
router.post('/verify-reset-otp', auth_otp_controller_1.verifyPasswordResetOtp);
router.post('/reset-password', auth_otp_controller_1.resetPasswordWithOtp);
// Login with email verification check
router.post('/login', auth_otp_controller_1.loginWithOtpCheck);
// Social login OTP verification
router.post('/verify-social-login', auth_otp_controller_1.verifySocialLoginOtp);
exports.default = router;
