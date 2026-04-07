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
const _aboutpagecontroller = require("../controllers/about-page.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
const _cachemiddleware = require("../middleware/cache.middleware");
const router = (0, _express.Router)();
// Public route (cached 5 min)
router.get('/', (0, _cachemiddleware.cacheMiddleware)(300), _aboutpagecontroller.getAboutPage);
// Admin routes (invalidate cache on write)
router.put('/', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/about-page'), _aboutpagecontroller.updateAboutPage);
router.put('/section/:section', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/about-page'), _aboutpagecontroller.updateAboutSection);
const _default = router;

//# sourceMappingURL=about-page.routes.js.map