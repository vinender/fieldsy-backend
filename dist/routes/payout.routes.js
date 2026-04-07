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
const _express = /*#__PURE__*/ _interop_require_default(require("express"));
const _payoutcontroller = require("../controllers/payout.controller");
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = _express.default.Router();
// All routes require authentication
router.use(_authmiddleware.protect);
// Get earnings history with pagination
router.get('/earnings/history', _payoutcontroller.getEarningsHistory);
// Get earnings summary
router.get('/earnings/summary', _payoutcontroller.getEarningsSummary);
// Get specific transaction details
router.get('/transactions/:transactionId', _payoutcontroller.getTransactionDetails);
// Process pending payouts for field owner (after Stripe setup)
router.post('/process-pending', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _payoutcontroller.processPendingPayouts);
// Get payout history
router.get('/history', _payoutcontroller.getPayoutHistory);
// Manually trigger payout for a booking (Admin only)
router.post('/trigger/:bookingId', (0, _authmiddleware.restrictTo)('ADMIN'), _payoutcontroller.triggerBookingPayout);
const _default = router;

//# sourceMappingURL=payout.routes.js.map