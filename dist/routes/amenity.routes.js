"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const amenity_controller_1 = require("../controllers/amenity.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
console.log('🔍 Amenity routes file loaded');
const router = (0, express_1.Router)();
console.log('🔍 Amenity router created');
// Public routes
router.get('/', amenity_controller_1.getAmenities); // Get all amenities (with optional activeOnly filter)
router.get('/:id', amenity_controller_1.getAmenityById); // Get single amenity
// Admin routes
router.post('/', admin_middleware_1.authenticateAdmin, amenity_controller_1.createAmenity); // Create amenity
router.put('/:id', admin_middleware_1.authenticateAdmin, amenity_controller_1.updateAmenity); // Update amenity
router.delete('/:id', admin_middleware_1.authenticateAdmin, amenity_controller_1.deleteAmenity); // Delete amenity
router.post('/reorder', admin_middleware_1.authenticateAdmin, amenity_controller_1.reorderAmenities); // Reorder amenities
exports.default = router;
