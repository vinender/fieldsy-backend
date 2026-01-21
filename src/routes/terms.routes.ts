import { Router } from 'express';
import {
    getTerms,
    createTerm,
    updateTerm,
    deleteTerm,
    bulkUpdateTerms
} from '../controllers/terms.controller';
import { authenticateAdmin } from '../middleware/admin.middleware';

const router = Router();

// Public route
router.get('/', getTerms);

// Admin routes
router.post('/', authenticateAdmin, createTerm);
router.put('/bulk', authenticateAdmin, bulkUpdateTerms);
router.put('/:id', authenticateAdmin, updateTerm);
router.delete('/:id', authenticateAdmin, deleteTerm);

export default router;
