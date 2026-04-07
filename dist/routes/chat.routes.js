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
const _authmiddleware = require("../middleware/auth.middleware");
const _chatcontroller = require("../controllers/chat.controller");
const router = (0, _express.Router)();
// All chat routes require authentication
router.use(_authmiddleware.protect);
// Conversation routes
router.post('/conversations', _chatcontroller.getOrCreateConversation);
router.get('/conversations', _chatcontroller.getConversations);
router.delete('/conversations/:conversationId', _chatcontroller.deleteConversation);
// Message routes
router.get('/conversations/:conversationId/messages', _chatcontroller.getMessages);
router.post('/messages', _chatcontroller.sendMessage);
// Unread counts
router.get('/unread-count', _chatcontroller.getUnreadCount); // Total unread messages count
router.get('/unread-conversations-count', _chatcontroller.getUnreadConversationsCount); // Count of conversations with unread messages
const _default = router;

//# sourceMappingURL=chat.routes.js.map