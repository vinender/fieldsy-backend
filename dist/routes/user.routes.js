"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const user_controller_1 = __importDefault(require("../controllers/user.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
// User routes
router.get('/stats', user_controller_1.default.getUserStats);
router.patch('/change-password', user_controller_1.default.changePassword);
router.post('/request-email-change', user_controller_1.default.requestEmailChange);
router.post('/verify-email-change', user_controller_1.default.verifyEmailChange);
// Admin only routes
router.get('/', (0, auth_middleware_1.restrictTo)('ADMIN'), user_controller_1.default.getAllUsers);
// User profile routes
router
    .route('/:id')
    .get(user_controller_1.default.getUser)
    .patch(user_controller_1.default.updateUser)
    .delete(user_controller_1.default.deleteUser);
exports.default = router;
