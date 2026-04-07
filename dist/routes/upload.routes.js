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
const _uploadcontroller = require("../controllers/upload.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const _adminmiddleware = require("../middleware/admin.middleware");
const router = (0, _express.Router)();
// Upload single file - generic endpoint (accepts both user and admin auth)
router.post('/single', _adminmiddleware.authenticateAdmin, _uploadcontroller.upload.single('file'), _uploadcontroller.uploadDirect);
// Upload single file - for regular users
router.post('/direct', _authmiddleware.protect, _uploadcontroller.upload.single('file'), _uploadcontroller.uploadDirect);
// Upload single file - for admin users
router.post('/admin/direct', _adminmiddleware.authenticateAdmin, _uploadcontroller.upload.single('file'), _uploadcontroller.uploadDirect);
// Upload multiple files - for regular users
router.post('/multiple', _authmiddleware.protect, _uploadcontroller.upload.array('files', 10), _uploadcontroller.uploadMultiple);
// Upload multiple files - for admin users
router.post('/admin/multiple', _adminmiddleware.authenticateAdmin, _uploadcontroller.upload.array('files', 10), _uploadcontroller.uploadMultiple);
// Generate presigned URL for direct browser upload
router.post('/presigned-url', _authmiddleware.protect, _uploadcontroller.getPresignedUrl);
// Generate presigned URL for admin
router.post('/admin/presigned-url', _adminmiddleware.authenticateAdmin, _uploadcontroller.getPresignedUrl);
// Delete file from S3 - for regular users
router.delete('/delete', _authmiddleware.protect, _uploadcontroller.deleteFile);
// Delete file from S3 - for admin users
router.delete('/admin/delete', _adminmiddleware.authenticateAdmin, _uploadcontroller.deleteFile);
const _default = router;

//# sourceMappingURL=upload.routes.js.map