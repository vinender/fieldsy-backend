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
const _claimcontroller = require("../controllers/claim.controller");
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = _express.default.Router();
// Public routes
router.post('/submit', _claimcontroller.submitFieldClaim);
router.get('/check-eligibility/:fieldId', _claimcontroller.checkClaimEligibility);
// Protected routes
router.use(_authmiddleware.protect);
// Get claims for a specific field
router.get('/field/:fieldId', _claimcontroller.getFieldClaims);
// Admin only routes
router.get('/', (0, _authmiddleware.restrictTo)('ADMIN'), _claimcontroller.getAllClaims);
router.get('/:claimId', (0, _authmiddleware.restrictTo)('ADMIN'), _claimcontroller.getClaimById);
router.patch('/:claimId/status', (0, _authmiddleware.restrictTo)('ADMIN'), _claimcontroller.updateClaimStatus);
const _default = router;

//# sourceMappingURL=claim.routes.js.map