"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const notification_controller_1 = require("../controllers/notification.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.protect);
// Get user notifications
router.get('/', notification_controller_1.notificationController.getUserNotifications);
// Get unread notification count
router.get('/unread-count', notification_controller_1.notificationController.getUnreadCount);
// Mark notification as read
router.patch('/:id/read', notification_controller_1.notificationController.markAsRead);
// Mark all notifications as read
router.patch('/read-all', notification_controller_1.notificationController.markAllAsRead);
// Delete a notification
router.delete('/:id', notification_controller_1.notificationController.deleteNotification);
// Clear all notifications
router.delete('/clear-all', notification_controller_1.notificationController.clearAllNotifications);
exports.default = router;
