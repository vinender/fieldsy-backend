//@ts-nocheck
import { Router } from 'express';
import {
  getSystemSettings,
  updateSystemSettings,
  getPublicSettings,
  updatePlatformImages,
  verifySiteAccess
} from '../controllers/settings.controller';
import { protect } from '../middleware/auth.middleware';
import { authenticateAdmin } from '../middleware/admin.middleware';
import { cacheMiddleware, invalidateCacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Public route — NOT cached because response includes per-user hasAccess field
router.get('/public', getPublicSettings);
router.post('/verify-access', invalidateCacheMiddleware('/api/settings'), verifySiteAccess);

// Admin routes (invalidate public settings cache on update)
router.get('/admin', authenticateAdmin, getSystemSettings);
router.put('/admin', authenticateAdmin, invalidateCacheMiddleware('/api/settings'), updateSystemSettings);
router.put('/admin/platform-images', authenticateAdmin, invalidateCacheMiddleware('/api/settings'), updatePlatformImages);

// Authenticated route
router.get('/user', protect, getPublicSettings);

export default router;
