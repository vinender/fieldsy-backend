"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const payment_controller_1 = require("../controllers/payment.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const rateLimiter_middleware_1 = require("../middleware/rateLimiter.middleware");
const express_2 = __importDefault(require("express"));
const router = (0, express_1.Router)();
const paymentController = new payment_controller_1.PaymentController();
// Webhook endpoint (no authentication, raw body needed)
router.post('/webhook', express_2.default.raw({ type: 'application/json' }), paymentController.handleWebhook);
// Protected routes
router.use(auth_middleware_1.protect);
// Create payment intent
router.post('/create-payment-intent', rateLimiter_middleware_1.paymentLimiter, paymentController.createPaymentIntent);
// Confirm payment
router.post('/confirm-payment', paymentController.confirmPayment);
// Get user's payment methods
router.get('/payment-methods', paymentController.getPaymentMethods);
exports.default = router;
