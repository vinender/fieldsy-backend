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

// Public route - cached 5 min
router.get('/public', cacheMiddleware(300), getPublicSettings);
router.post('/verify-access', verifySiteAccess);

// Admin routes (invalidate public settings cache on update)
router.get('/admin', authenticateAdmin, getSystemSettings);
router.put('/admin', authenticateAdmin, invalidateCacheMiddleware('/api/settings'), updateSystemSettings);
router.put('/admin/platform-images', authenticateAdmin, invalidateCacheMiddleware('/api/settings'), updatePlatformImages);

// Authenticated route
router.get('/user', protect, getPublicSettings);

export default router;
