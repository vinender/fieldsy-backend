//@ts-nocheck
import { Request, Response } from 'express';
import prisma from '../config/database';

// In-memory cache for public FAQs (rarely changes)
let faqCache: { data: any; timestamp: number } | null = null;
const FAQ_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Get all FAQs (public)
export const getFAQs = async (req: Request, res: Response) => {
  try {
    const { category } = req.query;

    // Use cache for unfiltered requests
    if (!category && faqCache && (Date.now() - faqCache.timestamp < FAQ_CACHE_TTL)) {
      return res.json(faqCache.data);
    }

    const where: any = { isActive: true };
    if (category) {
      where.category = category;
    }

    const faqs = await prisma.fAQ.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { order: 'asc' },
      ]
    });

    // Group FAQs by category
    const groupedFAQs = faqs.reduce((acc: any, faq) => {
      const cat = faq.category || 'general';
      if (!acc[cat]) {
        acc[cat] = [];
      }
      acc[cat].push(faq);
      return acc;
    }, {});

    const response = {
      success: true,
      data: {
        faqs,
        grouped: groupedFAQs
      }
    };

    // Cache unfiltered results
    if (!category) {
      faqCache = { data: response, timestamp: Date.now() };
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs'
    });
  }
};

// Get all FAQs for admin (including inactive)
export const getAllFAQs = async (req: Request, res: Response) => {
  try {
    const faqs = await prisma.fAQ.findMany({
      orderBy: [
        { category: 'asc' },
        { order: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      data: faqs
    });
  } catch (error) {
    console.error('Error fetching all FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQs'
    });
  }
};

// Get single FAQ
export const getFAQ = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const faq = await prisma.fAQ.findUnique({
      where: { id }
    });

    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    res.json({
      success: true,
      data: faq
    });
  } catch (error) {
    console.error('Error fetching FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQ'
    });
  }
};

// Create FAQ (Admin only)
export const createFAQ = async (req: Request, res: Response) => {
  try {
    const { question, answer, category, order, isActive } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        message: 'Question and answer are required'
      });
    }

    const faq = await prisma.fAQ.create({
      data: {
        question,
        answer,
        category: category || 'general',
        order: order || 0,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    res.status(201).json({
      success: true,
      data: faq,
      message: 'FAQ created successfully'
    });
  } catch (error) {
    console.error('Error creating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create FAQ'
    });
  }
};

// Update FAQ (Admin only)
export const updateFAQ = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question, answer, category, order, isActive } = req.body;

    const existingFAQ = await prisma.fAQ.findUnique({
      where: { id }
    });

    if (!existingFAQ) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    const faq = await prisma.fAQ.update({
      where: { id },
      data: {
        ...(question !== undefined && { question }),
        ...(answer !== undefined && { answer }),
        ...(category !== undefined && { category }),
        ...(order !== undefined && { order }),
        ...(isActive !== undefined && { isActive })
      }
    });

    res.json({
      success: true,
      data: faq,
      message: 'FAQ updated successfully'
    });
  } catch (error) {
    console.error('Error updating FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ'
    });
  }
};

// Delete FAQ (Admin only)
export const deleteFAQ = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingFAQ = await prisma.fAQ.findUnique({
      where: { id }
    });

    if (!existingFAQ) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    await prisma.fAQ.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting FAQ:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ'
    });
  }
};

// Bulk create/update FAQs (Admin only)
export const bulkUpsertFAQs = async (req: Request, res: Response) => {
  try {
    const { faqs } = req.body;

    if (!Array.isArray(faqs)) {
      return res.status(400).json({
        success: false,
        message: 'FAQs must be an array'
      });
    }

    // Process each FAQ
    const results = await Promise.all(
      faqs.map(async (faq) => {
        if (faq.id) {
          // Update existing FAQ
          return await prisma.fAQ.update({
            where: { id: faq.id },
            data: {
              question: faq.question,
              answer: faq.answer,
              category: faq.category || 'general',
              order: faq.order || 0,
              isActive: faq.isActive !== undefined ? faq.isActive : true
            }
          });
        } else {
          // Create new FAQ
          return await prisma.fAQ.create({
            data: {
              question: faq.question,
              answer: faq.answer,
              category: faq.category || 'general',
              order: faq.order || 0,
              isActive: faq.isActive !== undefined ? faq.isActive : true
            }
          });
        }
      })
    );

    res.json({
      success: true,
      data: results,
      message: `${results.length} FAQs processed successfully`
    });
  } catch (error) {
    console.error('Error bulk upserting FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process FAQs'
    });
  }
};

// Reorder FAQs (Admin only)
export const reorderFAQs = async (req: Request, res: Response) => {
  try {
    const { orders } = req.body; // Array of { id, order }

    if (!Array.isArray(orders)) {
      return res.status(400).json({
        success: false,
        message: 'Orders must be an array'
      });
    }

    // Update order for each FAQ
    await Promise.all(
      orders.map(async (item) => {
        await prisma.fAQ.update({
          where: { id: item.id },
          data: { order: item.order }
        });
      })
    );

    res.json({
      success: true,
      message: 'FAQs reordered successfully'
    });
  } catch (error) {
    console.error('Error reordering FAQs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder FAQs'
    });
  }
};
