"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../controllers/auth.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const rateLimiter_middleware_1 = require("../middleware/rateLimiter.middleware");
const router = (0, express_1.Router)();
// Test route
router.get('/test', (req, res) => {
    res.json({ message: 'Auth routes working' });
});
// Public routes
router.post('/register', auth_controller_1.default.register);
router.post('/login', auth_controller_1.default.login);
router.post('/refresh-token', auth_controller_1.default.refreshToken);
router.post('/social-login', rateLimiter_middleware_1.socialAuthLimiter, auth_controller_1.default.socialLogin);
router.post('/apple-signin', rateLimiter_middleware_1.socialAuthLimiter, auth_controller_1.default.appleSignIn);
// Protected routes
router.get('/me', auth_middleware_1.protect, auth_controller_1.default.getMe);
router.post('/logout', auth_middleware_1.protect, auth_controller_1.default.logout);
router.patch('/update-role', auth_middleware_1.protect, auth_controller_1.default.updateRole);
exports.default = router;
