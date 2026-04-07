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
const _contactquerycontroller = require("../controllers/contact-query.controller");
const _adminmiddleware = require("../middleware/admin.middleware");
const router = (0, _express.Router)();
// Public route - anyone can submit a contact query
router.post('/', _contactquerycontroller.createContactQuery);
// Admin only routes
router.get('/', _adminmiddleware.authenticateAdmin, _contactquerycontroller.getAllContactQueries);
router.get('/:id', _adminmiddleware.authenticateAdmin, _contactquerycontroller.getContactQueryById);
router.put('/:id', _adminmiddleware.authenticateAdmin, _contactquerycontroller.updateContactQuery);
router.delete('/:id', _adminmiddleware.authenticateAdmin, _contactquerycontroller.deleteContactQuery);
const _default = router;

//# sourceMappingURL=contact-query.routes.js.map