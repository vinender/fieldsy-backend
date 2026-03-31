//@ts-nocheck
import { Router } from 'express';
import discountController from '../controllers/discount.controller';
import { protect, restrictTo } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.get('/:fieldId/discounts', discountController.getFieldDiscounts);
router.get('/:fieldId/active-discounts', discountController.getActiveDiscounts);

// Protected routes - require authentication
router.use(protect);

// Field owner routes
router.post('/', restrictTo('FIELD_OWNER'), discountController.createDiscount);
router.patch('/:discountId/toggle', restrictTo('FIELD_OWNER'), discountController.toggleDiscount);
router.delete('/:discountId', restrictTo('FIELD_OWNER'), discountController.deleteDiscount);

export default router;
