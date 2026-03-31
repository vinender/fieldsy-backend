"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const privacy_policy_controller_1 = require("../controllers/privacy-policy.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const cache_middleware_1 = require("../middleware/cache.middleware");
const router = (0, express_1.Router)();
// Public route (cached 5 min)
router.get('/', (0, cache_middleware_1.cacheMiddleware)(300), privacy_policy_controller_1.getPrivacyPolicies);
// Admin routes (invalidate cache on write)
router.post('/', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/privacy-policy'), privacy_policy_controller_1.createPrivacyPolicy);
router.put('/bulk', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/privacy-policy'), privacy_policy_controller_1.bulkUpdatePrivacyPolicies);
router.put('/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/privacy-policy'), privacy_policy_controller_1.updatePrivacyPolicy);
router.delete('/:id', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/privacy-policy'), privacy_policy_controller_1.deletePrivacyPolicy);
exports.default = router;
