import { Router } from 'express';
import {
    getTerms,
    createTerm,
    updateTerm,
    deleteTerm,
    bulkUpdateTerms
} from '../controllers/terms.controller';
import { authenticateAdmin } from '../middleware/admin.middleware';
import { cacheMiddleware, invalidateCacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Public route (cached 5 min)
router.get('/', cacheMiddleware(300), getTerms);

// Admin routes (invalidate cache on write)
router.post('/', authenticateAdmin, invalidateCacheMiddleware('/api/terms'), createTerm);
router.put('/bulk', authenticateAdmin, invalidateCacheMiddleware('/api/terms'), bulkUpdateTerms);
router.put('/:id', authenticateAdmin, invalidateCacheMiddleware('/api/terms'), updateTerm);
router.delete('/:id', authenticateAdmin, invalidateCacheMiddleware('/api/terms'), deleteTerm);

export default router;
