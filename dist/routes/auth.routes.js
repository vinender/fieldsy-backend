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
const _express = require("express");
const _authcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/auth.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
const _rateLimitermiddleware = require("../middleware/rateLimiter.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Test route
router.get('/test', (req, res)=>{
    res.json({
        message: 'Auth routes working'
    });
});
// Public routes
router.post('/register', _authcontroller.default.register);
router.post('/login', _authcontroller.default.login);
router.post('/refresh-token', _authcontroller.default.refreshToken);
router.post('/social-login', _rateLimitermiddleware.socialAuthLimiter, _authcontroller.default.socialLogin);
router.post('/apple-signin', _rateLimitermiddleware.socialAuthLimiter, _authcontroller.default.appleSignIn);
// Protected routes
router.get('/me', _authmiddleware.protect, _authcontroller.default.getMe);
router.post('/logout', _authmiddleware.protect, _authcontroller.default.logout);
router.patch('/update-role', _authmiddleware.protect, _authcontroller.default.updateRole);
const _default = router;

//# sourceMappingURL=auth.routes.js.map