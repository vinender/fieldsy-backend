"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const offer_controller_1 = __importDefault(require("../controllers/offer.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Public routes
router.get('/:fieldId/offers', offer_controller_1.default.getFieldOffers);
// Protected routes - require authentication
router.use(auth_middleware_1.protect);
// Dog owner routes
router.get('/my-credits', (0, auth_middleware_1.restrictTo)('DOG_OWNER'), offer_controller_1.default.getMyCredits);
router.get('/credits/:fieldId', (0, auth_middleware_1.restrictTo)('DOG_OWNER'), offer_controller_1.default.getFieldCredits);
router.post('/:offerId/purchase', (0, auth_middleware_1.restrictTo)('DOG_OWNER'), offer_controller_1.default.purchaseOffer);
router.post('/:offerId/confirm', (0, auth_middleware_1.restrictTo)('DOG_OWNER'), offer_controller_1.default.confirmOfferPurchase);
router.post('/use-credit', (0, auth_middleware_1.restrictTo)('DOG_OWNER'), offer_controller_1.default.useCredit);
// Field owner routes
router.post('/', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), offer_controller_1.default.createOffer);
router.patch('/:offerId/toggle', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), offer_controller_1.default.toggleOffer);
router.delete('/:offerId', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), offer_controller_1.default.deleteOffer);
exports.default = router;
