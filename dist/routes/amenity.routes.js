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
const _amenitycontroller = require("../controllers/amenity.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
console.log('🔍 Amenity routes file loaded');
const router = (0, _express.Router)();
console.log('🔍 Amenity router created');
// Public routes
router.get('/', _amenitycontroller.getAmenities); // Get all amenities (with optional activeOnly filter)
router.get('/:id', _amenitycontroller.getAmenityById); // Get single amenity
// Admin routes
router.post('/', _adminmiddleware.authenticateAdmin, _amenitycontroller.createAmenity); // Create amenity
router.put('/:id', _adminmiddleware.authenticateAdmin, _amenitycontroller.updateAmenity); // Update amenity
router.delete('/:id', _adminmiddleware.authenticateAdmin, _amenitycontroller.deleteAmenity); // Delete amenity
router.post('/reorder', _adminmiddleware.authenticateAdmin, _amenitycontroller.reorderAmenities); // Reorder amenities
const _default = router;

//# sourceMappingURL=amenity.routes.js.map