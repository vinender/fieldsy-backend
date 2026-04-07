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
const _fieldpropertiescontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/field-properties.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// Public routes - Get all field properties with their options
router.get('/', _fieldpropertiescontroller.default.getAllFieldProperties); // GET /field-properties - returns all properties
router.get('/:property', _fieldpropertiescontroller.default.getFieldOptionsByProperty); // GET /field-properties/:property
// Admin routes - Manage field properties
router.get('/admin/all', _authmiddleware.protect, _fieldpropertiescontroller.default.getAllFieldPropertiesAdmin);
router.post('/admin', _authmiddleware.protect, _fieldpropertiescontroller.default.createFieldOption);
router.put('/admin/:id', _authmiddleware.protect, _fieldpropertiescontroller.default.updateFieldOption);
router.delete('/admin/:id', _authmiddleware.protect, _fieldpropertiescontroller.default.deleteFieldOption);
router.post('/admin/bulk-order', _authmiddleware.protect, _fieldpropertiescontroller.default.updateFieldPropertiesOrder);
const _default = router;

//# sourceMappingURL=field-properties.routes.js.map