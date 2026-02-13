//@ts-nocheck
import { Router } from 'express';
import fieldController from '../controllers/field.controller';
import { protect, restrictTo } from '../middleware/auth.middleware';
import { optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// Public routes (with optional auth for better data)
router.get('/', optionalAuth, fieldController.getAllFields);
router.get('/active', optionalAuth, fieldController.getActiveFields); // Public endpoint for active fields only (with isLiked if authenticated)
router.get('/price-range', fieldController.getPriceRange); // Get min and max prices
router.get('/suggestions', fieldController.getFieldSuggestions);
router.get('/search/location', fieldController.searchByLocation);
router.get('/nearby', optionalAuth, fieldController.getNearbyFields); // With isLiked if authenticated
router.get('/popular', optionalAuth, fieldController.getPopularFields); // With isLiked if authenticated

// Field ownership claiming routes (for field owners to claim unclaimed fields)
// These are NOT for booking - they're for claiming ownership of unclaimed fields
router.get('/unclaimed', protect, restrictTo('FIELD_OWNER'), fieldController.getFieldForClaim);
router.post('/claim-ownership', protect, restrictTo('FIELD_OWNER'), fieldController.claimField);

// My fields route (must come before /:id to avoid conflict)
router.get('/my-fields', protect, restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.getMyFields);

// Optimized minimal field data endpoint (for SSG/ISR builds)
router.get('/:id/minimal', fieldController.getFieldMinimal);

// Public route with ID parameter (must come after specific routes)
router.get('/:id', optionalAuth, fieldController.getField);

// All remaining routes require authentication
router.use(protect);

// Field owner routes
router.get('/owner/field', restrictTo('FIELD_OWNER'), fieldController.getOwnerField);
router.get('/owner/bookings', restrictTo('FIELD_OWNER'), fieldController.getFieldBookings);
router.get('/owner/bookings/recent', restrictTo('FIELD_OWNER'), fieldController.getRecentBookings);
router.get('/owner/bookings/today', restrictTo('FIELD_OWNER'), fieldController.getTodayBookings);
router.get('/owner/bookings/upcoming', restrictTo('FIELD_OWNER'), fieldController.getUpcomingBookings);
router.get('/owner/bookings/completed', restrictTo('FIELD_OWNER'), fieldController.getCompletedBookings);
router.post('/save-progress', restrictTo('FIELD_OWNER'), fieldController.saveFieldProgress);
router.put('/save-progress', restrictTo('FIELD_OWNER'), fieldController.saveFieldProgress);
router.post('/submit-for-review', restrictTo('FIELD_OWNER'), fieldController.submitFieldForReview);
router.post('/', restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.createField);

// Field management routes
router
  .route('/:id')
  .put(restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.updateField)
  .patch(restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.updateField)
  .delete(restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.deleteField);

// Toggle field active status
router.patch('/:id/toggle-status', restrictTo('FIELD_OWNER', 'ADMIN'), fieldController.toggleFieldStatus);

// Toggle field blocked status (admin only)
router.patch('/:id/toggle-blocked', restrictTo('ADMIN'), fieldController.toggleFieldBlocked);

// Toggle field approved status (admin only)
router.patch('/:id/toggle-approved', restrictTo('ADMIN'), fieldController.toggleFieldApproved);

// Update entry code (field owner only)
router.patch('/:fieldId/entry-code', restrictTo('FIELD_OWNER'), fieldController.updateEntryCode);

// Admin approval routes
router.get('/admin/pending-approval', restrictTo('ADMIN'), fieldController.getPendingFields);
router.patch('/:fieldId/approve', restrictTo('ADMIN'), fieldController.approveField);
router.patch('/:fieldId/reject', restrictTo('ADMIN'), fieldController.rejectField);

export default router;
