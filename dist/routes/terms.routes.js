"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const terms_controller_1 = require("../controllers/terms.controller");
const admin_middleware_1 = require("../middleware/admin.middleware");
const router = (0, express_1.Router)();
// Public route
router.get('/', terms_controller_1.getTerms);
// Admin routes
router.post('/', admin_middleware_1.authenticateAdmin, terms_controller_1.createTerm);
router.put('/bulk', admin_middleware_1.authenticateAdmin, terms_controller_1.bulkUpdateTerms);
router.put('/:id', admin_middleware_1.authenticateAdmin, terms_controller_1.updateTerm);
router.delete('/:id', admin_middleware_1.authenticateAdmin, terms_controller_1.deleteTerm);
exports.default = router;
