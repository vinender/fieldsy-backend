"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const field_properties_controller_1 = __importDefault(require("../controllers/field-properties.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Public routes - Get all field properties with their options
router.get('/', field_properties_controller_1.default.getAllFieldProperties); // GET /field-properties - returns all properties
router.get('/:property', field_properties_controller_1.default.getFieldOptionsByProperty); // GET /field-properties/:property
// Admin routes - Manage field properties
router.get('/admin/all', auth_middleware_1.protect, field_properties_controller_1.default.getAllFieldPropertiesAdmin);
router.post('/admin', auth_middleware_1.protect, field_properties_controller_1.default.createFieldOption);
router.put('/admin/:id', auth_middleware_1.protect, field_properties_controller_1.default.updateFieldOption);
router.delete('/admin/:id', auth_middleware_1.protect, field_properties_controller_1.default.deleteFieldOption);
router.post('/admin/bulk-order', auth_middleware_1.protect, field_properties_controller_1.default.updateFieldPropertiesOrder);
exports.default = router;
