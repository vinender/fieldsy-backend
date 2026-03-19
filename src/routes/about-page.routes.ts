//@ts-nocheck
import { Router } from 'express'
import { getAboutPage, updateAboutPage, updateAboutSection } from '../controllers/about-page.controller'
import { authenticateAdmin } from '../middleware/admin.middleware'
import { cacheMiddleware, invalidateCacheMiddleware } from '../middleware/cache.middleware'

const router = Router()

// Public route (cached 5 min)
router.get('/', cacheMiddleware(300), getAboutPage)

// Admin routes (invalidate cache on write)
router.put('/', authenticateAdmin, invalidateCacheMiddleware('/api/about-page'), updateAboutPage)
router.put('/section/:section', authenticateAdmin, invalidateCacheMiddleware('/api/about-page'), updateAboutSection)

export default router
