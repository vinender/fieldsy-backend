"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const earnings_controller_1 = __importDefault(require("../controllers/earnings.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
// Field owner routes
router.get('/dashboard', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), earnings_controller_1.default.getEarningsDashboard);
router.get('/payout-history', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), earnings_controller_1.default.getPayoutHistory);
router.get('/held-payouts', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), earnings_controller_1.default.getHeldPayouts);
router.get('/export', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), earnings_controller_1.default.exportPayoutHistory);
router.post('/sync-payouts', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), earnings_controller_1.default.syncPayoutsFromStripe);
exports.default = router;
