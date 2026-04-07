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
const _express = /*#__PURE__*/ _interop_require_default(require("express"));
const _authotpcontroller = require("../controllers/auth.otp.controller");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = _express.default.Router();
// Registration with OTP
router.post('/register', _authotpcontroller.registerWithOtp);
router.post('/verify-signup', _authotpcontroller.verifySignupOtp);
// OTP operations
router.post('/resend-otp', _authotpcontroller.resendOtp);
// Password reset with OTP
router.post('/forgot-password', _authotpcontroller.requestPasswordReset);
router.post('/verify-reset-otp', _authotpcontroller.verifyPasswordResetOtp);
router.post('/reset-password', _authotpcontroller.resetPasswordWithOtp);
// Login with email verification check
router.post('/login', _authotpcontroller.loginWithOtpCheck);
// Social login OTP verification
router.post('/verify-social-login', _authotpcontroller.verifySocialLoginOtp);
const _default = router;

//# sourceMappingURL=auth.otp.routes.js.map