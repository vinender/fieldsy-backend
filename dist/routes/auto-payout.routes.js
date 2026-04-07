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
const _autopayoutcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/auto-payout.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// All routes require authentication
router.use(_authmiddleware.protect);
// Field owner routes
router.get('/summary', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _autopayoutcontroller.default.getPayoutSummary);
// Admin routes
router.post('/trigger', (0, _authmiddleware.restrictTo)('ADMIN'), _autopayoutcontroller.default.triggerPayoutProcessing);
router.post('/process/:bookingId', (0, _authmiddleware.restrictTo)('ADMIN'), _autopayoutcontroller.default.processBookingPayout);
// Refund with fee adjustment (Admin or booking owner)
router.post('/refund/:bookingId', _autopayoutcontroller.default.processRefundWithFees);
const _default = router;

//# sourceMappingURL=auto-payout.routes.js.map