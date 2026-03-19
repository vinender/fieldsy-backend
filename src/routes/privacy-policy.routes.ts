import { Router } from 'express';
import {
    getPrivacyPolicies,
    createPrivacyPolicy,
    updatePrivacyPolicy,
    deletePrivacyPolicy,
    bulkUpdatePrivacyPolicies
} from '../controllers/privacy-policy.controller';
import { authenticateAdmin } from '../middleware/admin.middleware';
import { cacheMiddleware, invalidateCacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Public route (cached 5 min)
router.get('/', cacheMiddleware(300), getPrivacyPolicies);

// Admin routes (invalidate cache on write)
router.post('/', authenticateAdmin, invalidateCacheMiddleware('/api/privacy-policy'), createPrivacyPolicy);
router.put('/bulk', authenticateAdmin, invalidateCacheMiddleware('/api/privacy-policy'), bulkUpdatePrivacyPolicies);
router.put('/:id', authenticateAdmin, invalidateCacheMiddleware('/api/privacy-policy'), updatePrivacyPolicy);
router.delete('/:id', authenticateAdmin, invalidateCacheMiddleware('/api/privacy-policy'), deletePrivacyPolicy);

export default router;
