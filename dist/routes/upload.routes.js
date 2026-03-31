"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const upload_controller_1 = require("../controllers/upload.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const admin_middleware_1 = require("../middleware/admin.middleware");
const router = (0, express_1.Router)();
// Upload single file - generic endpoint (accepts both user and admin auth)
router.post('/single', admin_middleware_1.authenticateAdmin, // Use admin auth for admin panel
upload_controller_1.upload.single('file'), upload_controller_1.uploadDirect);
// Upload single file - for regular users
router.post('/direct', auth_middleware_1.protect, upload_controller_1.upload.single('file'), upload_controller_1.uploadDirect);
// Upload single file - for admin users
router.post('/admin/direct', admin_middleware_1.authenticateAdmin, upload_controller_1.upload.single('file'), upload_controller_1.uploadDirect);
// Upload multiple files - for regular users
router.post('/multiple', auth_middleware_1.protect, upload_controller_1.upload.array('files', 10), // Max 10 files at once
upload_controller_1.uploadMultiple);
// Upload multiple files - for admin users
router.post('/admin/multiple', admin_middleware_1.authenticateAdmin, upload_controller_1.upload.array('files', 10), // Max 10 files at once
upload_controller_1.uploadMultiple);
// Generate presigned URL for direct browser upload
router.post('/presigned-url', auth_middleware_1.protect, upload_controller_1.getPresignedUrl);
// Generate presigned URL for admin
router.post('/admin/presigned-url', admin_middleware_1.authenticateAdmin, upload_controller_1.getPresignedUrl);
// Delete file from S3 - for regular users
router.delete('/delete', auth_middleware_1.protect, upload_controller_1.deleteFile);
// Delete file from S3 - for admin users
router.delete('/admin/delete', admin_middleware_1.authenticateAdmin, upload_controller_1.deleteFile);
exports.default = router;
