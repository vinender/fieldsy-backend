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

const router = Router();

// Public route - get settings needed for frontend (no auth required)
router.get('/public', getPublicSettings);
router.post('/verify-access', verifySiteAccess);

// Admin routes
router.get('/admin', authenticateAdmin, getSystemSettings);
router.put('/admin', authenticateAdmin, updateSystemSettings);
router.put('/admin/platform-images', authenticateAdmin, updatePlatformImages);

// Authenticated route for logged-in users to get certain settings
router.get('/user', protect, getPublicSettings);

export default router;
