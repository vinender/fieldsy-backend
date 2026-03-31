"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const favorite_controller_1 = __importDefault(require("../controllers/favorite.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// All routes require authentication and DOG_OWNER role
router.use(auth_middleware_1.protect);
router.use((0, auth_middleware_1.restrictTo)('DOG_OWNER'));
// Toggle favorite (save/unsave)
router.post('/toggle/:fieldId', favorite_controller_1.default.toggleFavorite);
// Get user's saved fields
router.get('/my-saved-fields', favorite_controller_1.default.getSavedFields);
// Check if field is favorited
router.get('/check/:fieldId', favorite_controller_1.default.checkFavorite);
// Remove from favorites
router.delete('/:fieldId', favorite_controller_1.default.removeFavorite);
exports.default = router;
