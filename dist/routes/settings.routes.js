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
const _settingscontroller = require("../controllers/settings.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const _adminmiddleware = require("../middleware/admin.middleware");
const _cachemiddleware = require("../middleware/cache.middleware");
const router = (0, _express.Router)();
// Public route — NOT cached because response includes per-user hasAccess field
router.get('/public', _settingscontroller.getPublicSettings);
router.post('/verify-access', (0, _cachemiddleware.invalidateCacheMiddleware)('/api/settings'), _settingscontroller.verifySiteAccess);
// Admin routes (invalidate public settings cache on update)
router.get('/admin', _adminmiddleware.authenticateAdmin, _settingscontroller.getSystemSettings);
router.put('/admin', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/settings'), _settingscontroller.updateSystemSettings);
router.put('/admin/platform-images', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/settings'), _settingscontroller.updatePlatformImages);
// Authenticated route
router.get('/user', _authmiddleware.protect, _settingscontroller.getPublicSettings);
const _default = router;

//# sourceMappingURL=settings.routes.js.map