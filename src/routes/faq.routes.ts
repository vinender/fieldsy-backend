//@ts-nocheck
import { Router } from 'express';
import {
  getFAQs,
  getAllFAQs,
  getFAQ,
  createFAQ,
  updateFAQ,
  deleteFAQ,
  bulkUpsertFAQs,
  reorderFAQs
} from '../controllers/faq.controller';
import { authenticateAdmin } from '../middleware/admin.middleware';
import { cacheMiddleware, invalidateCacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Public routes (cached 5 min)
router.get('/', cacheMiddleware(300), getFAQs);
router.get('/public', cacheMiddleware(300), getFAQs);

// Admin routes (invalidate cache on write)
router.get('/admin', authenticateAdmin, getAllFAQs);
router.get('/admin/:id', authenticateAdmin, getFAQ);
router.post('/admin', authenticateAdmin, invalidateCacheMiddleware('/api/faqs'), createFAQ);
router.put('/admin/:id', authenticateAdmin, invalidateCacheMiddleware('/api/faqs'), updateFAQ);
router.delete('/admin/:id', authenticateAdmin, invalidateCacheMiddleware('/api/faqs'), deleteFAQ);
router.post('/admin/bulk', authenticateAdmin, invalidateCacheMiddleware('/api/faqs'), bulkUpsertFAQs);
router.put('/admin/reorder', authenticateAdmin, invalidateCacheMiddleware('/api/faqs'), reorderFAQs);

export default router;
