//@ts-nocheck
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: { id: string };
}

/**
 * Device Token Controller
 * Handles registration and management of FCM device tokens for push notifications
 */
export const deviceTokenController = {
  /**
   * Register or update a device token
   * POST /api/device-tokens
   *
   * @body token - FCM registration token
   * @body platform - "web", "ios", or "android"
   * @body deviceName - Optional device identifier
   */
  async registerToken(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { token, platform, deviceName } = req.body;

      // Validate required fields
      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token is required',
        });
      }

      if (!platform) {
        return res.status(400).json({
          success: false,
          message: 'Platform is required',
        });
      }

      // Validate platform value
      const validPlatforms = ['web', 'ios', 'android'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({
          success: false,
          message: 'Platform must be one of: web, ios, android',
        });
      }

      console.log(`[DeviceToken] Registering token for user ${userId} (${platform})`);

      // Upsert the token (update if exists, create if not)
      // This handles the case where a user logs in on the same device again
      const deviceToken = await prisma.deviceToken.upsert({
        where: { token },
        update: {
          userId, // Re-associate with current user (in case user changed)
          platform,
          deviceName: deviceName || null,
          lastUsed: new Date(),
          isActive: true,
        },
        create: {
          userId,
          token,
          platform,
          deviceName: deviceName || null,
          isActive: true,
        },
      });

      console.log(`[DeviceToken] Token registered successfully: ${deviceToken.id}`);

      res.json({
        success: true,
        message: 'Device token registered successfully',
        data: { id: deviceToken.id },
      });
    } catch (error: any) {
      console.error('[DeviceToken] Registration error:', error.message);

      // Handle unique constraint violation gracefully
      if (error.code === 'P2002') {
        return res.status(409).json({
          success: false,
          message: 'Token already registered',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to register device token',
      });
    }
  },

  /**
   * Remove a device token (logout or unsubscribe)
   * DELETE /api/device-tokens
   *
   * @body token - FCM registration token to remove
   */
  async removeToken(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token is required',
        });
      }

      console.log(`[DeviceToken] Removing token for user ${userId || 'unknown'}`);

      // Deactivate the token instead of deleting
      // This allows us to track historical tokens
      const result = await prisma.deviceToken.updateMany({
        where: {
          token,
          // Only update if it belongs to the current user (if authenticated)
          ...(userId ? { userId } : {}),
        },
        data: { isActive: false },
      });

      if (result.count === 0) {
        return res.status(404).json({
          success: false,
          message: 'Token not found',
        });
      }

      console.log(`[DeviceToken] Token removed successfully`);

      res.json({
        success: true,
        message: 'Device token removed successfully',
      });
    } catch (error: any) {
      console.error('[DeviceToken] Removal error:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to remove device token',
      });
    }
  },

  /**
   * Get user's registered devices
   * GET /api/device-tokens
   *
   * Returns a list of active devices for the authenticated user
   */
  async getUserTokens(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const tokens = await prisma.deviceToken.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          platform: true,
          deviceName: true,
          lastUsed: true,
          createdAt: true,
        },
        orderBy: { lastUsed: 'desc' },
      });

      res.json({
        success: true,
        data: tokens,
      });
    } catch (error: any) {
      console.error('[DeviceToken] Fetch error:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch device tokens',
      });
    }
  },

  /**
   * Remove all device tokens for a user (logout from all devices)
   * DELETE /api/device-tokens/all
   */
  async removeAllTokens(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      console.log(`[DeviceToken] Removing all tokens for user ${userId}`);

      const result = await prisma.deviceToken.updateMany({
        where: { userId },
        data: { isActive: false },
      });

      console.log(`[DeviceToken] Removed ${result.count} token(s)`);

      res.json({
        success: true,
        message: `Removed ${result.count} device(s)`,
        data: { count: result.count },
      });
    } catch (error: any) {
      console.error('[DeviceToken] Remove all error:', error.message);
      res.status(500).json({
        success: false,
        message: 'Failed to remove device tokens',
      });
    }
  },
};

export default deviceTokenController;
