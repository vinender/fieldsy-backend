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
const _notificationcontroller = require("../controllers/notification.controller");
const _authmiddleware = require("../middleware/auth.middleware");
const router = (0, _express.Router)();
// All routes require authentication
router.use(_authmiddleware.protect);
// Get user notifications
router.get('/', _notificationcontroller.notificationController.getUserNotifications);
// Get unread notification count
router.get('/unread-count', _notificationcontroller.notificationController.getUnreadCount);
// Mark notification as read
router.patch('/:id/read', _notificationcontroller.notificationController.markAsRead);
// Mark all notifications as read
router.patch('/read-all', _notificationcontroller.notificationController.markAllAsRead);
// Delete a notification
router.delete('/:id', _notificationcontroller.notificationController.deleteNotification);
// Clear all notifications
router.delete('/clear-all', _notificationcontroller.notificationController.clearAllNotifications);
const _default = router;

//# sourceMappingURL=notification.routes.js.map