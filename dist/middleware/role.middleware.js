//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "requireRole", {
    enumerable: true,
    get: function() {
        return requireRole;
    }
});
const _AppError = require("../utils/AppError");
const requireRole = (...roles)=>{
    return (req, res, next)=>{
        const user = req.user;
        if (!user) {
            return next(new _AppError.AppError('User not authenticated', 401));
        }
        if (!roles.includes(user.role)) {
            return next(new _AppError.AppError(`Access denied. Required role: ${roles.join(' or ')}`, 403));
        }
        next();
    };
};

//# sourceMappingURL=role.middleware.js.map