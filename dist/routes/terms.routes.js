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
const _termscontroller = require("../controllers/terms.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
const _cachemiddleware = require("../middleware/cache.middleware");
const router = (0, _express.Router)();
// Public route (cached 5 min)
router.get('/', (0, _cachemiddleware.cacheMiddleware)(300), _termscontroller.getTerms);
// Admin routes (invalidate cache on write)
router.post('/', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/terms'), _termscontroller.createTerm);
router.put('/bulk', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/terms'), _termscontroller.bulkUpdateTerms);
router.put('/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/terms'), _termscontroller.updateTerm);
router.delete('/:id', _adminmiddleware.authenticateAdmin, (0, _cachemiddleware.invalidateCacheMiddleware)('/api/terms'), _termscontroller.deleteTerm);
const _default = router;

//# sourceMappingURL=terms.routes.js.map