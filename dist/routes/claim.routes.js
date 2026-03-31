"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = __importDefault(require("express"));
const claim_controller_1 = require("../controllers/claim.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
// Public routes
router.post('/submit', claim_controller_1.submitFieldClaim);
router.get('/check-eligibility/:fieldId', claim_controller_1.checkClaimEligibility);
// Protected routes
router.use(auth_middleware_1.protect);
// Get claims for a specific field
router.get('/field/:fieldId', claim_controller_1.getFieldClaims);
// Admin only routes
router.get('/', (0, auth_middleware_1.restrictTo)('ADMIN'), claim_controller_1.getAllClaims);
router.get('/:claimId', (0, auth_middleware_1.restrictTo)('ADMIN'), claim_controller_1.getClaimById);
router.patch('/:claimId/status', (0, auth_middleware_1.restrictTo)('ADMIN'), claim_controller_1.updateClaimStatus);
exports.default = router;
