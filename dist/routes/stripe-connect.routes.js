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
const _authmiddleware = require("../middleware/auth.middleware");
const _stripeconnectcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/stripe-connect.controller"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// All routes require authentication and field owner role
router.use(_authmiddleware.protect);
router.use((0, _authmiddleware.restrictTo)('FIELD_OWNER'));
// Stripe Connect account management
router.post('/create-account', _stripeconnectcontroller.default.createConnectAccount);
router.post('/onboarding-link', _stripeconnectcontroller.default.getOnboardingLink);
router.get('/account-status', _stripeconnectcontroller.default.getAccountStatus);
router.get('/balance', _stripeconnectcontroller.default.getBalance);
// Bank account management  
router.post('/update-bank', _stripeconnectcontroller.default.updateBankAccount);
router.delete('/disconnect', _stripeconnectcontroller.default.disconnectAccount);
// Payouts
router.post('/payout', _stripeconnectcontroller.default.createPayout);
router.get('/payout-history', _stripeconnectcontroller.default.getPayoutHistory);
const _default = router;

//# sourceMappingURL=stripe-connect.routes.js.map