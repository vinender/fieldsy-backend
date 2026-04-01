"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateAdmin = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const constants_1 = require("../config/constants");
const prisma = new client_1.PrismaClient();
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        // SECURITY FIX: Use consistent JWT_SECRET from constants
        const decoded = jsonwebtoken_1.default.verify(token, constants_1.JWT_SECRET);
        const admin = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });
        if (!admin || admin.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.userId = admin.id;
        req.admin = admin;
        next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};
exports.authenticateAdmin = authenticateAdmin;
