"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const payment_method_controller_1 = require("../controllers/payment-method.controller");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
// Create setup intent for adding a new card
router.post('/setup-intent', payment_method_controller_1.paymentMethodController.createSetupIntent);
// Get all payment methods for the user
router.get('/', payment_method_controller_1.paymentMethodController.getPaymentMethods);
// Save payment method after successful setup (RESTful: POST to collection endpoint)
router.post('/', payment_method_controller_1.paymentMethodController.savePaymentMethod);
// DEPRECATED: Backward compatibility for old /save endpoint (remove after frontend migration)
router.post('/save', payment_method_controller_1.paymentMethodController.savePaymentMethod);
// Set a payment method as default (supports both PATCH and PUT)
router.patch('/:paymentMethodId/set-default', payment_method_controller_1.paymentMethodController.setDefaultPaymentMethod);
router.put('/:paymentMethodId/set-default', payment_method_controller_1.paymentMethodController.setDefaultPaymentMethod);
// Delete a payment method
router.delete('/:paymentMethodId', payment_method_controller_1.paymentMethodController.deletePaymentMethod);
exports.default = router;
