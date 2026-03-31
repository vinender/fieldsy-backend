"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const payment_controller_1 = require("../controllers/payment.controller");
const express_2 = __importDefault(require("express"));
const router = (0, express_1.Router)();
const paymentController = new payment_controller_1.PaymentController();
// Stripe webhook endpoint - raw body needed
router.post('/', express_2.default.raw({ type: 'application/json' }), paymentController.handleWebhook);
exports.default = router;
