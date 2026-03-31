"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const faq_controller_1 = require("../controllers/faq.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const cache_middleware_1 = require("../middleware/cache.middleware");
const router = (0, express_1.Router)();
// Public routes (cached 5 min)
router.get('/', (0, cache_middleware_1.cacheMiddleware)(300), faq_controller_1.getFAQs);
router.get('/public', (0, cache_middleware_1.cacheMiddleware)(300), faq_controller_1.getFAQs);
// Admin routes (invalidate cache on write)
router.get('/admin', admin_middleware_1.authenticateAdmin, faq_controller_1.getAllFAQs);
router.get('/admin/:id', admin_middleware_1.authenticateAdmin, faq_controller_1.getFAQ);
router.post('/admin', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/faqs'), faq_controller_1.createFAQ);
router.put('/admin/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/faqs'), faq_controller_1.updateFAQ);
router.delete('/admin/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/faqs'), faq_controller_1.deleteFAQ);
router.post('/admin/bulk', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/faqs'), faq_controller_1.bulkUpsertFAQs);
router.put('/admin/reorder', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/faqs'), faq_controller_1.reorderFAQs);
exports.default = router;
