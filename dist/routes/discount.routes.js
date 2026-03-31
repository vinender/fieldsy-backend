"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const discount_controller_1 = __importDefault(require("../controllers/discount.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Public routes
router.get('/:fieldId/discounts', discount_controller_1.default.getFieldDiscounts);
router.get('/:fieldId/active-discounts', discount_controller_1.default.getActiveDiscounts);
// Protected routes - require authentication
router.use(auth_middleware_1.protect);
// Field owner routes
router.post('/', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), discount_controller_1.default.createDiscount);
router.patch('/:discountId/toggle', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), discount_controller_1.default.toggleDiscount);
router.delete('/:discountId', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), discount_controller_1.default.deleteDiscount);
exports.default = router;
