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
const _favoritecontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/favorite.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// All routes require authentication and DOG_OWNER role
router.use(_authmiddleware.protect);
router.use((0, _authmiddleware.restrictTo)('DOG_OWNER'));
// Toggle favorite (save/unsave)
router.post('/toggle/:fieldId', _favoritecontroller.default.toggleFavorite);
// Get user's saved fields
router.get('/my-saved-fields', _favoritecontroller.default.getSavedFields);
// Check if field is favorited
router.get('/check/:fieldId', _favoritecontroller.default.checkFavorite);
// Remove from favorites
router.delete('/:fieldId', _favoritecontroller.default.removeFavorite);
const _default = router;

//# sourceMappingURL=favorite.routes.js.map