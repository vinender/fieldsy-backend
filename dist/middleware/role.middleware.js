"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = void 0;
const AppError_1 = require("../utils/AppError");
const requireRole = (...roles) => {
    return (req, res, next) => {
        const user = req.user;
        if (!user) {
            return next(new AppError_1.AppError('User not authenticated', 401));
        }
        if (!roles.includes(user.role)) {
            return next(new AppError_1.AppError(`Access denied. Required role: ${roles.join(' or ')}`, 403));
        }
        next();
    };
};
exports.requireRole = requireRole;
