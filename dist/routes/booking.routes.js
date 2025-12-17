"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const booking_controller_1 = __importDefault(require("../controllers/booking.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Public routes to check availability
router.get('/availability', booking_controller_1.default.checkAvailability);
router.get('/recurring-conflicts', booking_controller_1.default.checkRecurringConflicts);
router.get('/fields/:fieldId/slot-availability', booking_controller_1.default.getSlotAvailability);
router.post('/check-slots-availability', booking_controller_1.default.checkSelectedSlotsAvailability);
// All routes below require authentication
router.use(auth_middleware_1.protect);
// Dog owner and field owner routes
router.get('/my-bookings', booking_controller_1.default.getMyBookings);
router.get('/my-recurring', booking_controller_1.default.getMyRecurringBookings);
router.get('/cancelled', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), booking_controller_1.default.getCancelledBookings);
router.get('/stats', booking_controller_1.default.getBookingStats);
router.get('/fields/:fieldId/has-completed', booking_controller_1.default.hasCompletedBookingsForField);
router.post('/', booking_controller_1.default.createBooking);
router.post('/:id/cancel-recurring', booking_controller_1.default.cancelRecurringBooking);
// Admin routes
router.get('/', (0, auth_middleware_1.restrictTo)('ADMIN'), booking_controller_1.default.getAllBookings);
router.post('/mark-completed', (0, auth_middleware_1.restrictTo)('ADMIN'), booking_controller_1.default.markPastBookingsAsCompleted);
// Booking specific routes
router
    .route('/:id')
    .get(booking_controller_1.default.getBooking)
    .patch(booking_controller_1.default.updateBooking)
    .delete((0, auth_middleware_1.restrictTo)('ADMIN'), booking_controller_1.default.deleteBooking);
// Booking status management
router.patch('/:id/status', booking_controller_1.default.updateBookingStatus);
router.get('/:id/refund-eligibility', booking_controller_1.default.checkRefundEligibility);
router.patch('/:id/cancel', booking_controller_1.default.cancelBooking);
exports.default = router;
