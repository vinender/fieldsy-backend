"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const user_report_controller_1 = require("../controllers/user-report.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post('/report', auth_middleware_1.protect, user_report_controller_1.userReportController.createReport);
router.get('/reports', auth_middleware_1.protect, user_report_controller_1.userReportController.getReports);
router.get('/reports/my-reports', auth_middleware_1.protect, user_report_controller_1.userReportController.getMyReportsMade);
router.get('/reports/:reportId', auth_middleware_1.protect, user_report_controller_1.userReportController.getReportDetails);
router.put('/reports/:reportId/status', auth_middleware_1.protect, user_report_controller_1.userReportController.updateReportStatus);
exports.default = router;
