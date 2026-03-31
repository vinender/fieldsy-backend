"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const about_page_controller_1 = require("../controllers/about-page.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const cache_middleware_1 = require("../middleware/cache.middleware");
const router = (0, express_1.Router)();
// Public route (cached 5 min)
router.get('/', (0, cache_middleware_1.cacheMiddleware)(300), about_page_controller_1.getAboutPage);
// Admin routes (invalidate cache on write)
router.put('/', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/about-page'), about_page_controller_1.updateAboutPage);
router.put('/section/:section', admin_middleware_1.authenticateAdmin, (0, cache_middleware_1.invalidateCacheMiddleware)('/api/about-page'), about_page_controller_1.updateAboutSection);
exports.default = router;
