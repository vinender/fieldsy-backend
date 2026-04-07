//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = require("express");
const _bookingcontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/booking.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
const _rateLimitermiddleware = require("../middleware/rateLimiter.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes to check availability
router.get('/availability', _rateLimitermiddleware.searchLimiter, _bookingcontroller.default.checkAvailability);
router.get('/recurring-conflicts', _bookingcontroller.default.checkRecurringConflicts);
router.get('/fields/:fieldId/slot-availability', _bookingcontroller.default.getSlotAvailability);
router.post('/check-slots-availability', _bookingcontroller.default.checkSelectedSlotsAvailability);
// All routes below require authentication
router.use(_authmiddleware.protect);
// Dog owner and field owner routes
router.get('/my-bookings', _bookingcontroller.default.getMyBookings);
router.get('/my-recurring', _bookingcontroller.default.getMyRecurringBookings);
router.get('/cancelled', (0, _authmiddleware.restrictTo)('FIELD_OWNER'), _bookingcontroller.default.getCancelledBookings);
router.get('/stats', _bookingcontroller.default.getBookingStats);
router.get('/fields/:fieldId/has-completed', _bookingcontroller.default.hasCompletedBookingsForField);
router.post('/', _bookingcontroller.default.createBooking);
router.post('/:id/cancel-recurring', _bookingcontroller.default.cancelRecurringBooking);
// Admin routes
router.get('/', (0, _authmiddleware.restrictTo)('ADMIN'), _bookingcontroller.default.getAllBookings);
router.post('/mark-completed', (0, _authmiddleware.restrictTo)('ADMIN'), _bookingcontroller.default.markPastBookingsAsCompleted);
// Booking specific routes
router.route('/:id').get(_bookingcontroller.default.getBooking).patch(_bookingcontroller.default.updateBooking).delete((0, _authmiddleware.restrictTo)('ADMIN'), _bookingcontroller.default.deleteBooking);
// Booking status management
router.patch('/:id/status', _bookingcontroller.default.updateBookingStatus);
router.get('/:id/refund-eligibility', _bookingcontroller.default.checkRefundEligibility);
router.patch('/:id/cancel', _bookingcontroller.default.cancelBooking);
const _default = router;

//# sourceMappingURL=booking.routes.js.map