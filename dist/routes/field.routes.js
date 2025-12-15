"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const field_controller_1 = __importDefault(require("../controllers/field.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const auth_middleware_2 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Public routes (with optional auth for better data)
router.get('/', auth_middleware_2.optionalAuth, field_controller_1.default.getAllFields);
router.get('/active', field_controller_1.default.getActiveFields); // Public endpoint for active fields only
router.get('/price-range', field_controller_1.default.getPriceRange); // Get min and max prices
router.get('/suggestions', field_controller_1.default.getFieldSuggestions);
router.get('/search/location', field_controller_1.default.searchByLocation);
router.get('/nearby', field_controller_1.default.getNearbyFields);
router.get('/popular', field_controller_1.default.getPopularFields);
// Field ownership claiming routes (for field owners to claim unclaimed fields)
// These are NOT for booking - they're for claiming ownership of unclaimed fields
router.get('/unclaimed', auth_middleware_1.protect, (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getFieldForClaim);
router.post('/claim-ownership', auth_middleware_1.protect, (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.claimField);
// My fields route (must come before /:id to avoid conflict)
router.get('/my-fields', auth_middleware_1.protect, (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.getMyFields);
// Optimized minimal field data endpoint (for SSG/ISR builds)
router.get('/:id/minimal', field_controller_1.default.getFieldMinimal);
// Public route with ID parameter (must come after specific routes)
router.get('/:id', auth_middleware_2.optionalAuth, field_controller_1.default.getField);
// All remaining routes require authentication
router.use(auth_middleware_1.protect);
// Field owner routes
router.get('/owner/field', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getOwnerField);
router.get('/owner/bookings', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getFieldBookings);
router.get('/owner/bookings/recent', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getRecentBookings);
router.get('/owner/bookings/today', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getTodayBookings);
router.get('/owner/bookings/upcoming', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getUpcomingBookings);
router.get('/owner/bookings/completed', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.getCompletedBookings);
router.post('/save-progress', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.saveFieldProgress);
router.post('/submit-for-review', (0, auth_middleware_1.restrictTo)('FIELD_OWNER'), field_controller_1.default.submitFieldForReview);
router.post('/', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.createField);
// Field management routes
router
    .route('/:id')
    .put((0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.updateField)
    .patch((0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.updateField)
    .delete((0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.deleteField);
// Toggle field active status
router.patch('/:id/toggle-status', (0, auth_middleware_1.restrictTo)('FIELD_OWNER', 'ADMIN'), field_controller_1.default.toggleFieldStatus);
// Toggle field blocked status (admin only)
router.patch('/:id/toggle-blocked', (0, auth_middleware_1.restrictTo)('ADMIN'), field_controller_1.default.toggleFieldBlocked);
// Toggle field approved status (admin only)
router.patch('/:id/toggle-approved', (0, auth_middleware_1.restrictTo)('ADMIN'), field_controller_1.default.toggleFieldApproved);
// Admin approval routes
router.get('/admin/pending-approval', (0, auth_middleware_1.restrictTo)('ADMIN'), field_controller_1.default.getPendingFields);
router.patch('/:fieldId/approve', (0, auth_middleware_1.restrictTo)('ADMIN'), field_controller_1.default.approveField);
router.patch('/:fieldId/reject', (0, auth_middleware_1.restrictTo)('ADMIN'), field_controller_1.default.rejectField);
exports.default = router;
