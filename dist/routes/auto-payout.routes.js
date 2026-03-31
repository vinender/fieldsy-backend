"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auto_payout_controller_1 = __importDefault(require("../controllers/auto-payout.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
// Field owner routes
router.get('/summary', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), auto_payout_controller_1.default.getPayoutSummary);
// Admin routes
router.post('/trigger', (0, auth_middleware_1.restrictTo)('ADMIN'), auto_payout_controller_1.default.triggerPayoutProcessing);
router.post('/process/:bookingId', (0, auth_middleware_1.restrictTo)('ADMIN'), auto_payout_controller_1.default.processBookingPayout);
// Refund with fee adjustment (Admin or booking owner)
router.post('/refund/:bookingId', auto_payout_controller_1.default.processRefundWithFees);
exports.default = router;
