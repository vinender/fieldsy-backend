//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "authenticateAdmin", {
    enumerable: true,
    get: function() {
        return authenticateAdmin;
    }
});
const _jsonwebtoken = /*#__PURE__*/ _interop_require_default(require("jsonwebtoken"));
const _client = require("@prisma/client");
const _constants = require("../config/constants");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const prisma = new _client.PrismaClient();
const authenticateAdmin = async (req, res, next)=>{
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({
                error: 'Authentication required'
            });
        }
        // SECURITY FIX: Use consistent JWT_SECRET from constants
        const decoded = _jsonwebtoken.default.verify(token, _constants.JWT_SECRET);
        const admin = await prisma.user.findUnique({
            where: {
                id: decoded.userId
            }
        });
        if (!admin || admin.role !== 'ADMIN') {
            return res.status(403).json({
                error: 'Admin access required'
            });
        }
        req.userId = admin.id;
        req.admin = admin;
        next();
    } catch (error) {
        return res.status(401).json({
            error: 'Invalid token'
        });
    }
};

//# sourceMappingURL=admin.middleware.js.map