"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const device_token_controller_1 = __importDefault(require("../controllers/device-token.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
/**
 * @route   POST /api/device-tokens
 * @desc    Register a device token for push notifications
 * @access  Private
 * @body    { token: string, platform: "web"|"ios"|"android", deviceName?: string }
 */
router.post('/', device_token_controller_1.default.registerToken);
/**
 * @route   DELETE /api/device-tokens
 * @desc    Remove a specific device token (logout/unsubscribe)
 * @access  Private
 * @body    { token: string }
 */
router.delete('/', device_token_controller_1.default.removeToken);
/**
 * @route   GET /api/device-tokens
 * @desc    Get user's registered devices
 * @access  Private
 */
router.get('/', device_token_controller_1.default.getUserTokens);
/**
 * @route   DELETE /api/device-tokens/all
 * @desc    Remove all device tokens for user (logout from all devices)
 * @access  Private
 */
router.delete('/all', device_token_controller_1.default.removeAllTokens);
exports.default = router;
