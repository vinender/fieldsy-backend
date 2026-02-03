//@ts-nocheck
import { Router } from 'express';
import userController from '../controllers/user.controller';
import { protect, restrictTo } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(protect);

// User routes
router.get('/stats', userController.getUserStats);
router.patch('/change-password', userController.changePassword);
router.post('/request-email-change', userController.requestEmailChange);
router.post('/verify-email-change', userController.verifyEmailChange);

// Admin only routes
router.get('/', restrictTo('ADMIN'), userController.getAllUsers);

// User profile routes
router
  .route('/:id')
  .get(userController.getUser)
  .patch(userController.updateUser)
  .delete(userController.deleteUser);

export default router;
