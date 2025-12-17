//@ts-nocheck
import { Router } from 'express';
import bookingController from '../controllers/booking.controller';
import { protect, restrictTo } from '../middleware/auth.middleware';

const router = Router();

// Public routes to check availability
router.get('/availability', bookingController.checkAvailability);
router.get('/recurring-conflicts', bookingController.checkRecurringConflicts);
router.get('/fields/:fieldId/slot-availability', bookingController.getSlotAvailability);
router.post('/check-slots-availability', bookingController.checkSelectedSlotsAvailability);

// All routes below require authentication
router.use(protect);

// Dog owner and field owner routes
router.get('/my-bookings', bookingController.getMyBookings);
router.get('/my-recurring', bookingController.getMyRecurringBookings);
router.get('/cancelled', restrictTo('FIELD_OWNER'), bookingController.getCancelledBookings);
router.get('/stats', bookingController.getBookingStats);
router.get('/fields/:fieldId/has-completed', bookingController.hasCompletedBookingsForField);
router.post('/', bookingController.createBooking);
router.post('/:id/cancel-recurring', bookingController.cancelRecurringBooking);

// Admin routes
router.get('/', restrictTo('ADMIN'), bookingController.getAllBookings);
router.post('/mark-completed', restrictTo('ADMIN'), bookingController.markPastBookingsAsCompleted);

// Booking specific routes
router
  .route('/:id')
  .get(bookingController.getBooking)
  .patch(bookingController.updateBooking)
  .delete(restrictTo('ADMIN'), bookingController.deleteBooking);

// Booking status management
router.patch('/:id/status', bookingController.updateBookingStatus);
router.get('/:id/refund-eligibility', bookingController.checkRefundEligibility);
router.patch('/:id/cancel', bookingController.cancelBooking);

export default router;
