import { Router } from 'express';
import {
    getPrivacyPolicies,
    createPrivacyPolicy,
    updatePrivacyPolicy,
    deletePrivacyPolicy,
    bulkUpdatePrivacyPolicies
} from '../controllers/privacy-policy.controller';
import { authenticateAdmin } from '../middleware/admin.middleware';

const router = Router();

// Public route
router.get('/', getPrivacyPolicies);

// Admin routes
router.post('/', authenticateAdmin, createPrivacyPolicy);
router.put('/bulk', authenticateAdmin, bulkUpdatePrivacyPolicies);
router.put('/:id', authenticateAdmin, updatePrivacyPolicy);
router.delete('/:id', authenticateAdmin, deletePrivacyPolicy);

export default router;
