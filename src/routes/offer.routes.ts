//@ts-nocheck
import { Router } from 'express';
import offerController from '../controllers/offer.controller';
import { protect, restrictTo } from '../middleware/auth.middleware';

const router = Router();

// Public routes
router.get('/:fieldId/offers', offerController.getFieldOffers);

// Protected routes - require authentication
router.use(protect);

// Dog owner routes
router.get('/my-credits', restrictTo('DOG_OWNER'), offerController.getMyCredits);
router.get('/credits/:fieldId', restrictTo('DOG_OWNER'), offerController.getFieldCredits);
router.post('/:offerId/purchase', restrictTo('DOG_OWNER'), offerController.purchaseOffer);
router.post('/:offerId/confirm', restrictTo('DOG_OWNER'), offerController.confirmOfferPurchase);
router.post('/use-credit', restrictTo('DOG_OWNER'), offerController.useCredit);

// Field owner routes
router.post('/', restrictTo('FIELD_OWNER'), offerController.createOffer);
router.patch('/:offerId/toggle', restrictTo('FIELD_OWNER'), offerController.toggleOffer);
router.delete('/:offerId', restrictTo('FIELD_OWNER'), offerController.deleteOffer);

export default router;
