//@ts-nocheck
import { Router } from 'express';
import deviceTokenController from '../controllers/device-token.controller';
import { protect } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(protect);

/**
 * @route   POST /api/device-tokens
 * @desc    Register a device token for push notifications
 * @access  Private
 * @body    { token: string, platform: "web"|"ios"|"android", deviceName?: string }
 */
router.post('/', deviceTokenController.registerToken);

/**
 * @route   DELETE /api/device-tokens
 * @desc    Remove a specific device token (logout/unsubscribe)
 * @access  Private
 * @body    { token: string }
 */
router.delete('/', deviceTokenController.removeToken);

/**
 * @route   GET /api/device-tokens
 * @desc    Get user's registered devices
 * @access  Private
 */
router.get('/', deviceTokenController.getUserTokens);

/**
 * @route   DELETE /api/device-tokens/all
 * @desc    Remove all device tokens for user (logout from all devices)
 * @access  Private
 */
router.delete('/all', deviceTokenController.removeAllTokens);

export default router;
