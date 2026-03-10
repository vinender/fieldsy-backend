//@ts-nocheck
import { Request, Response } from 'express'
import prisma from '../config/database'

// Create a new contact query (public endpoint)
export const createContactQuery = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, subject, message } = req.body

    // Validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, subject, and message are required',
      })
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      })
    }

    // Create the contact query
    const contactQuery = await prisma.contactQuery.create({
      data: {
        name,
        email,
        phone: phone || null,
        subject,
        message,
        status: 'new',
      },
    })

    res.status(201).json({
      success: true,
      message: 'Your query has been submitted successfully. We will get back to you soon.',
      data: contactQuery,
    })
  } catch (error) {
    console.error('Error creating contact query:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to submit query. Please try again later.',
      error: error.message,
    })
  }
}

// Get all contact queries (admin only)
export const getAllContactQueries = async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '10',
      status,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query

    const pageNum = parseInt(page as string)
    const limitNum = parseInt(limit as string)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {}

    if (status && status !== 'all') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { subject: { contains: search as string, mode: 'insensitive' } },
        { message: { contains: search as string, mode: 'insensitive' } },
      ]
    }

    // Get total count
    const total = await prisma.contactQuery.count({ where })

    // Get queries with pagination
    const queries = await prisma.contactQuery.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: {
        [sortBy as string]: order === 'asc' ? 'asc' : 'desc',
      },
    })

    // Get status counts
    const statusCounts = await prisma.contactQuery.groupBy({
      by: ['status'],
      _count: true,
    })

    const counts = {
      all: total,
      new: 0,
      'in-progress': 0,
      resolved: 0,
    }

    statusCounts.forEach((item) => {
      counts[item.status] = item._count
    })

    res.status(200).json({
      success: true,
      data: queries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      counts,
    })
  } catch (error) {
    console.error('Error fetching contact queries:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch queries',
      error: error.message,
    })
  }
}

// Get single contact query by ID (admin only)
export const getContactQueryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const query = await prisma.contactQuery.findUnique({
      where: { id },
    })

    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found',
      })
    }

    res.status(200).json({
      success: true,
      data: query,
    })
  } catch (error) {
    console.error('Error fetching contact query:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch query',
      error: error.message,
    })
  }
}

// Update contact query status (admin only)
export const updateContactQuery = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { status, adminNotes } = req.body

    // Validation
    if (status && !['new', 'in-progress', 'resolved'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: new, in-progress, or resolved',
      })
    }

    const updateData: any = {}
    if (status) updateData.status = status
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes

    const query = await prisma.contactQuery.update({
      where: { id },
      data: updateData,
    })

    res.status(200).json({
      success: true,
      message: 'Query updated successfully',
      data: query,
    })
  } catch (error) {
    console.error('Error updating contact query:', error)

    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Query not found',
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update query',
      error: error.message,
    })
  }
}

// Delete contact query (admin only)
export const deleteContactQuery = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await prisma.contactQuery.delete({
      where: { id },
    })

    res.status(200).json({
      success: true,
      message: 'Query deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting contact query:', error)

    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Query not found',
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete query',
      error: error.message,
    })
  }
}
