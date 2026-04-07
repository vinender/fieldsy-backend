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
const _discountcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/discount.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes
router.get('/:fieldId/discounts', _discountcontroller.default.getFieldDiscounts);
router.get('/:fieldId/active-discounts', _discountcontroller.default.getActiveDiscounts);
// Protected routes - require authentication
router.use(_authmiddleware.protect);
// Field owner routes
router.post('/', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _discountcontroller.default.createDiscount);
router.patch('/:discountId/toggle', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _discountcontroller.default.toggleDiscount);
router.delete('/:discountId', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _discountcontroller.default.deleteDiscount);
const _default = router;

//# sourceMappingURL=discount.routes.js.map