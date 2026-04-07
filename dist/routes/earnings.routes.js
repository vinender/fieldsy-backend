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
const _earningscontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/earnings.controller"));
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
router.get('/dashboard', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _earningscontroller.default.getEarningsDashboard);
router.get('/payout-history', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _earningscontroller.default.getPayoutHistory);
router.get('/held-payouts', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _earningscontroller.default.getHeldPayouts);
router.get('/export', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _earningscontroller.default.exportPayoutHistory);
router.post('/sync-payouts', (0, _authmiddleware.restrictTo)('FIELD_OWNER', 'ADMIN'), _earningscontroller.default.syncPayoutsFromStripe);
const _default = router;

//# sourceMappingURL=earnings.routes.js.map