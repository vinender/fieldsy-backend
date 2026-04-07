//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = require("express");
const _faqcontroller = require("../controllers/faq.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
const _cachemiddleware = require("../middleware/cache.middleware");
const router = (0, _express.Router)();
// Public routes (cached 5 min)
router.get('/', (0, _cachemiddleware.cacheMiddleware)(300), _faqcontroller.getFAQs);
router.get('/public', (0, _cachemiddleware.cacheMiddleware)(300), _faqcontroller.getFAQs);
// Admin routes (invalidate cache on write)
router.get('/admin', _adminmiddleware.authenticateAdmin, _faqcontroller.getAllFAQs);
router.get('/admin/:id', _adminmiddleware.authenticateAdmin, _faqcontroller.getFAQ);
router.post('/admin', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/faqs'), _faqcontroller.createFAQ);
router.put('/admin/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/faqs'), _faqcontroller.updateFAQ);
router.delete('/admin/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/faqs'), _faqcontroller.deleteFAQ);
router.post('/admin/bulk', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/faqs'), _faqcontroller.bulkUpsertFAQs);
router.put('/admin/reorder', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/faqs'), _faqcontroller.reorderFAQs);
const _default = router;

//# sourceMappingURL=faq.routes.js.map