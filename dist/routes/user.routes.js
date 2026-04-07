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
const _usercontroller = /*#__PURE__*/ _interop_require_default(require("../controllers/user.controller"));
const _authmiddleware = require("../middleware/auth.middleware");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const router = (0, _express.Router)();
// All routes require authentication
router.use(_authmiddleware.protect);
// User routes
router.get('/stats', _usercontroller.default.getUserStats);
router.patch('/change-password', _usercontroller.default.changePassword);
router.post('/request-email-change', _usercontroller.default.requestEmailChange);
router.post('/verify-email-change', _usercontroller.default.verifyEmailChange);
// Admin only routes
router.get('/', (0, _authmiddleware.restrictTo)('ADMIN'), _usercontroller.default.getAllUsers);
// User profile routes
router.route('/:id').get(_usercontroller.default.getUser).patch(_usercontroller.default.updateUser).delete(_usercontroller.default.deleteUser);
const _default = router;

//# sourceMappingURL=user.routes.js.map