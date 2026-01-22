"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const settings_controller_1 = require("../controllers/settings.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const admin_middleware_1 = require("../middleware/admin.middleware");
const router = (0, express_1.Router)();
// Public route - get settings needed for frontend (no auth required)
router.get('/public', settings_controller_1.getPublicSettings);
router.post('/verify-access', settings_controller_1.verifySiteAccess);
// Admin routes
router.get('/admin', admin_middleware_1.authenticateAdmin, settings_controller_1.getSystemSettings);
router.put('/admin', admin_middleware_1.authenticateAdmin, settings_controller_1.updateSystemSettings);
router.put('/admin/platform-images', admin_middleware_1.authenticateAdmin, settings_controller_1.updatePlatformImages);
// Authenticated route for logged-in users to get certain settings
router.get('/user', auth_middleware_1.protect, settings_controller_1.getPublicSettings);
exports.default = router;
