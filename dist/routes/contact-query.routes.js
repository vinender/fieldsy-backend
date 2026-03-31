"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const contact_query_controller_1 = require("../controllers/contact-query.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const router = (0, express_1.Router)();
// Public route - anyone can submit a contact query
router.post('/', contact_query_controller_1.createContactQuery);
// Admin only routes
router.get('/', admin_middleware_1.authenticateAdmin, contact_query_controller_1.getAllContactQueries);
router.get('/:id', admin_middleware_1.authenticateAdmin, contact_query_controller_1.getContactQueryById);
router.put('/:id', admin_middleware_1.authenticateAdmin, contact_query_controller_1.updateContactQuery);
router.delete('/:id', admin_middleware_1.authenticateAdmin, contact_query_controller_1.deleteContactQuery);
exports.default = router;
