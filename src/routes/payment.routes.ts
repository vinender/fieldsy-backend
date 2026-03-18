//@ts-nocheck
import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { protect } from '../middleware/auth.middleware';
import { paymentLimiter } from '../middleware/rateLimiter.middleware';
import express from 'express';

const router = Router();
const paymentController = new PaymentController();

// Webhook endpoint (no authentication, raw body needed)
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  paymentController.handleWebhook
);

// Protected routes
router.use(protect);

// Create payment intent
router.post('/create-payment-intent', paymentLimiter, paymentController.createPaymentIntent);

// Confirm payment
router.post('/confirm-payment', paymentController.confirmPayment);

// Get user's payment methods
router.get('/payment-methods', paymentController.getPaymentMethods);

export default router;
