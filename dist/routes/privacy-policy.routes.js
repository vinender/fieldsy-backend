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
const _privacypolicycontroller = require("../controllers/privacy-policy.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
const _cachemiddleware = require("../middleware/cache.middleware");
const router = (0, _express.Router)();
// Public route (cached 5 min)
router.get('/', (0, _cachemiddleware.cacheMiddleware)(300), _privacypolicycontroller.getPrivacyPolicies);
// Admin routes (invalidate cache on write)
router.post('/', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/privacy-policy'), _privacypolicycontroller.createPrivacyPolicy);
router.put('/bulk', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/privacy-policy'), _privacypolicycontroller.bulkUpdatePrivacyPolicies);
router.put('/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/privacy-policy'), _privacypolicycontroller.updatePrivacyPolicy);
router.delete('/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/privacy-policy'), _privacypolicycontroller.deletePrivacyPolicy);
const _default = router;

//# sourceMappingURL=privacy-policy.routes.js.map