"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const chat_controller_1 = require("../controllers/chat.controller");
const router = (0, express_1.Router)();
// All chat routes require authentication
router.use(auth_middleware_1.protect);
// Conversation routes
router.post('/conversations', chat_controller_1.getOrCreateConversation);
router.get('/conversations', chat_controller_1.getConversations);
router.delete('/conversations/:conversationId', chat_controller_1.deleteConversation);
// Message routes
router.get('/conversations/:conversationId/messages', chat_controller_1.getMessages);
router.post('/messages', chat_controller_1.sendMessage);
// Unread counts
router.get('/unread-count', chat_controller_1.getUnreadCount); // Total unread messages count
router.get('/unread-conversations-count', chat_controller_1.getUnreadConversationsCount); // Count of conversations with unread messages
exports.default = router;
