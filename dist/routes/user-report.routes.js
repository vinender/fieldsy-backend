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
const _userreportcontroller = require("../controllers/user-report.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const router = (0, _express.Router)();
router.post('/report', _authmiddleware.protect, _userreportcontroller.userReportController.createReport);
router.get('/reports', _authmiddleware.protect, _userreportcontroller.userReportController.getReports);
router.get('/reports/my-reports', _authmiddleware.protect, _userreportcontroller.userReportController.getMyReportsMade);
router.get('/reports/:reportId', _authmiddleware.protect, _userreportcontroller.userReportController.getReportDetails);
router.put('/reports/:reportId/status', _authmiddleware.protect, _userreportcontroller.userReportController.updateReportStatus);
const _default = router;

//# sourceMappingURL=user-report.routes.js.map