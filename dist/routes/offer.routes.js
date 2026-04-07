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
const _offercontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/offer.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes
router.get('/:fieldId/offers', _offercontroller.default.getFieldOffers);
// Protected routes - require authentication
router.use(_authmiddleware.protect);
// Dog owner routes
router.get('/my-credits', (0, _authmiddleware.restrictTo)('DOG_OWNER'), _offercontroller.default.getMyCredits);
router.get('/credits/:fieldId', (0, _authmiddleware.restrictTo)('DOG_OWNER'), _offercontroller.default.getFieldCredits);
router.post('/:offerId/purchase', (0, _authmiddleware.restrictTo)('DOG_OWNER'), _offercontroller.default.purchaseOffer);
router.post('/:offerId/confirm', (0, _authmiddleware.restrictTo)('DOG_OWNER'), _offercontroller.default.confirmOfferPurchase);
router.post('/use-credit', (0, _authmiddleware.restrictTo)('DOG_OWNER'), _offercontroller.default.useCredit);
// Field owner routes
router.post('/', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _offercontroller.default.createOffer);
router.patch('/:offerId/toggle', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _offercontroller.default.toggleOffer);
router.delete('/:offerId', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _offercontroller.default.deleteOffer);
const _default = router;

//# sourceMappingURL=offer.routes.js.map