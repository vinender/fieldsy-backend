"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const terms_controller_1 = require("../controllers/terms.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const cache_middleware_1 = require("../middleware/cache.middleware");
const router = (0, express_1.Router)();
// Public route (cached 5 min)
router.get('/', (0, cache_middleware_1.cacheMiddleware)(300), terms_controller_1.getTerms);
// Admin routes (invalidate cache on write)
router.post('/', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/terms'), terms_controller_1.createTerm);
router.put('/bulk', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/terms'), terms_controller_1.bulkUpdateTerms);
router.put('/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/terms'), terms_controller_1.updateTerm);
router.delete('/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/terms'), terms_controller_1.deleteTerm);
exports.default = router;
