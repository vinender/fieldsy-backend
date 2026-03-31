"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const stripe_connect_controller_1 = __importDefault(require("../controllers/stripe-connect.controller"));
const router = (0, express_1.Router)();
// All routes require authentication and field owner role
router.use(auth_middleware_1.protect);
router.use((0, auth_middleware_1.restrictTo)('FIELD_OWNER'));
// Stripe Connect account management
router.post('/create-account', stripe_connect_controller_1.default.createConnectAccount);
router.post('/onboarding-link', stripe_connect_controller_1.default.getOnboardingLink);
router.get('/account-status', stripe_connect_controller_1.default.getAccountStatus);
router.get('/balance', stripe_connect_controller_1.default.getBalance);
// Bank account management  
router.post('/update-bank', stripe_connect_controller_1.default.updateBankAccount);
router.delete('/disconnect', stripe_connect_controller_1.default.disconnectAccount);
// Payouts
router.post('/payout', stripe_connect_controller_1.default.createPayout);
router.get('/payout-history', stripe_connect_controller_1.default.getPayoutHistory);
exports.default = router;
