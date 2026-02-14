//@ts-nocheck
import { Request, Response } from 'express';
import prisma from '../config/database';
import { createNotification } from './notification.controller';

// Extend Request type to include user
interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    email: string;
    name?: string;
  };
}

// Generate human-readable review ID using counter
async function generateReviewId(): Promise<string> {
  const counter = await prisma.counter.upsert({
    where: { name: 'review' },
    update: { value: { increment: 1 } },
    create: { name: 'review', value: 1001 }, // Start from 1001 for reviews
  });
  return counter.value.toString();
}

// Helper to check if ID is MongoDB ObjectId format
function isObjectId(id: string): boolean {
  return id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
}

// Helper to find review by either ObjectId or human-readable reviewId
async function findReviewById(id: string, include?: any) {
  if (isObjectId(id)) {
    return prisma.fieldReview.findUnique({
      where: { id },
      include,
    });
  }
  // Search by human-readable reviewId
  return prisma.fieldReview.findFirst({
    where: { reviewId: id },
    include,
  });
}

// Helper to update field stats with combined Fieldsy + Google reviews
async function updateFieldStats(fieldId: string) {
  // Get Fieldsy reviews stats
  const fieldsyStats = await prisma.fieldReview.aggregate({
    where: { fieldId },
    _avg: { rating: true },
    _count: { rating: true },
    _sum: { rating: true },
  });

  // Get Google reviews stats
  const googleStats = await prisma.googleReview.aggregate({
    where: { fieldId },
    _avg: { rating: true },
    _count: { rating: true },
    _sum: { rating: true },
  });

  const fieldsyCount = fieldsyStats._count.rating || 0;
  const googleCount = googleStats._count.rating || 0;
  const totalCount = fieldsyCount + googleCount;

  const fieldsySum = fieldsyStats._sum.rating || 0;
  const googleSum = googleStats._sum.rating || 0;
  const totalSum = fieldsySum + googleSum;

  const averageRating = totalCount > 0 ? totalSum / totalCount : 0;

  // Update field with combined stats
  await prisma.field.update({
    where: { id: fieldId },
    data: {
      averageRating,
      totalReviews: totalCount,
    },
  });

  return { averageRating, totalReviews: totalCount };
}

class ReviewController {
  // Get all reviews for a field with pagination (blended Fieldsy + Google reviews)
  async getFieldReviews(req: Request, res: Response) {
    try {
      const { fieldId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const sortBy = req.query.sortBy as string || 'recent';
      const rating = req.query.rating ? parseInt(req.query.rating as string) : undefined;

      const skip = (page - 1) * limit;

      // Support both internal ID and human-readable fieldId
      const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
      const whereClause = isObjectId ? { fieldId } : { field: { fieldId } };

      // Get the field's internal ObjectId for Google reviews lookup
      let internalFieldId = fieldId;
      if (!isObjectId) {
        const field = await prisma.field.findFirst({
          where: { fieldId },
          select: { id: true }
        });
        if (field) {
          internalFieldId = field.id;
        }
      }

      // Build where clause for Fieldsy reviews
      const where: any = { ...whereClause };
      if (rating) {
        where.rating = rating;
      }

      // Fetch Fieldsy reviews
      const fieldsyReviews = await prisma.fieldReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      });

      // Fetch Google reviews
      const googleReviews = await prisma.googleReview.findMany({
        where: { fieldId: internalFieldId },
        orderBy: { createdAt: 'desc' },
      });

      // Transform Google reviews to match Fieldsy review format
      const transformedGoogleReviews = googleReviews.map(gr => ({
        id: gr.id,
        reviewId: `G${gr.id.substring(0, 8)}`, // Prefix with 'G' for Google
        fieldId: gr.fieldId,
        userId: null,
        bookingId: null,
        userName: gr.authorName,
        userImage: gr.authorPhoto,
        rating: gr.rating,
        title: null,
        comment: gr.text,
        images: [],
        verified: true, // Google reviews are verified
        helpfulCount: 0,
        response: null,
        respondedAt: null,
        createdAt: gr.createdAt,
        updatedAt: gr.updatedAt,
        user: {
          id: null,
          name: gr.authorName,
          image: gr.authorPhoto,
        },
        isGoogleReview: true, // Flag to identify Google reviews
        reviewTime: gr.reviewTime, // Keep original Google time format
      }));

      // Merge and sort all reviews
      let allReviews = [...fieldsyReviews, ...transformedGoogleReviews];

      // Apply rating filter to Google reviews if needed
      if (rating) {
        allReviews = allReviews.filter(r => r.rating === rating);
      }

      // Sort combined reviews
      if (sortBy === 'helpful') {
        allReviews.sort((a, b) => (b.helpfulCount || 0) - (a.helpfulCount || 0));
      } else if (sortBy === 'rating_high') {
        allReviews.sort((a, b) => b.rating - a.rating);
      } else if (sortBy === 'rating_low') {
        allReviews.sort((a, b) => a.rating - b.rating);
      } else {
        // Default: sort by createdAt desc (most recent first)
        allReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      // Paginate combined reviews
      const total = allReviews.length;
      const paginatedReviews = allReviews.slice(skip, skip + limit);

      // Calculate combined rating distribution
      const ratingDistribution: Record<number, number> = {};
      allReviews.forEach(review => {
        ratingDistribution[review.rating] = (ratingDistribution[review.rating] || 0) + 1;
      });

      // Calculate combined average rating
      const totalRatings = allReviews.length;
      const sumRatings = allReviews.reduce((sum, review) => sum + review.rating, 0);
      const averageRating = totalRatings > 0 ? sumRatings / totalRatings : 0;

      res.json({
        success: true,
        data: {
          reviews: paginatedReviews,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
          stats: {
            averageRating,
            totalReviews: totalRatings,
            ratingDistribution,
            fieldsyReviewsCount: fieldsyReviews.length,
            googleReviewsCount: googleReviews.length,
          },
        },
      });
    } catch (error) {
      console.error('Error fetching field reviews:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch reviews',
      });
    }
  }

  // Create a new review
  async createReview(req: AuthRequest, res: Response) {
    try {
      const { fieldId: providedFieldId } = req.params;
      const userId = req.user?.id;
      const { rating, title, comment, images = [], bookingId } = req.body;

      // Support both internal ID and human-readable fieldId
      const isObjectId = providedFieldId.length === 24 && /^[0-9a-fA-F]+$/.test(providedFieldId);
      const whereField = isObjectId ? { id: providedFieldId } : { fieldId: providedFieldId };

      // Find the field to get its canonical ID and owner info
      const field = await prisma.field.findUnique({
        where: whereField,
        select: { id: true, ownerId: true, name: true }
      });

      if (!field) {
        return res.status(404).json({
          success: false,
          message: 'Field not found',
        });
      }

      const fieldId = field.id; // Use canonical ID

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      // If bookingId provided, validate it
      let completedBooking;
      if (bookingId) {
        // Support both internal ObjectId and human-readable bookingId
        const isBookingObjectId = bookingId.length === 24 && /^[0-9a-fA-F]+$/.test(bookingId);
        const bookingWhere = isBookingObjectId
          ? { id: bookingId, fieldId, userId, status: 'COMPLETED' }
          : { bookingId: bookingId, fieldId, userId, status: 'COMPLETED' };

        // Check if this specific booking exists, belongs to user, and is completed
        completedBooking = await prisma.booking.findFirst({
          where: bookingWhere,
        });

        if (!completedBooking) {
          return res.status(403).json({
            success: false,
            message: 'Invalid booking or booking not completed.',
            code: 'INVALID_BOOKING',
          });
        }

        // Check if this booking already has a review
        // Use completedBooking.id (internal ObjectId) since FieldReview.bookingId stores ObjectId, not human-readable bookingId
        const existingReviewForBooking = await prisma.fieldReview.findFirst({
          where: {
            bookingId: completedBooking.id,
          },
        });

        if (existingReviewForBooking) {
          return res.status(409).json({
            success: false,
            message: 'You have already reviewed this booking.',
            code: 'BOOKING_ALREADY_REVIEWED',
          });
        }
      } else {
        // No bookingId provided - find any completed booking without a review
        // First get all completed bookings for this field by this user
        const completedBookings = await prisma.booking.findMany({
          where: {
            fieldId,
            userId,
            status: 'COMPLETED',
          },
          orderBy: {
            date: 'desc',
          },
        });

        if (completedBookings.length === 0) {
          return res.status(403).json({
            success: false,
            message: 'You can only review fields you have booked and visited.',
            code: 'NO_COMPLETED_BOOKING',
          });
        }

        // Find a booking that hasn't been reviewed yet
        const bookingIds = completedBookings.map(b => b.id);
        const existingReviews = await prisma.fieldReview.findMany({
          where: {
            bookingId: {
              in: bookingIds,
            },
          },
          select: {
            bookingId: true,
          },
        });

        const reviewedBookingIds = new Set(existingReviews.map(r => r.bookingId));
        const unreviewedBooking = completedBookings.find(b => !reviewedBookingIds.has(b.id));

        if (!unreviewedBooking) {
          return res.status(409).json({
            success: false,
            message: 'You have already reviewed all your bookings for this field.',
            code: 'ALL_BOOKINGS_REVIEWED',
          });
        }

        completedBooking = unreviewedBooking;
      }

      // Check if the booking date has passed
      const bookingDate = new Date(completedBooking.date);
      const bookingEndTimeStr = completedBooking.endTime; // e.g., "16:00"

      // Combine booking date with end time to get the full booking end datetime
      const [hours, minutes] = bookingEndTimeStr.split(':').map(Number);
      const bookingEndDateTime = new Date(bookingDate);
      bookingEndDateTime.setHours(hours, minutes, 0, 0);

      const now = new Date();

      if (bookingEndDateTime > now) {
        return res.status(403).json({
          success: false,
          message: 'You can only submit a review after your booking has ended.',
          code: 'BOOKING_NOT_ENDED',
          data: {
            bookingDate: bookingDate.toISOString(),
            bookingEndTime: bookingEndTimeStr,
            bookingEndDateTime: bookingEndDateTime.toISOString(),
          },
        });
      }

      // Get user info for denormalization
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, image: true },
      });

      // Generate human-readable review ID
      const reviewId = await generateReviewId();

      // Create the review
      const review = await prisma.fieldReview.create({
        data: {
          fieldId,
          userId,
          reviewId, // Human-readable ID
          bookingId: completedBooking.id, // Link review to specific booking
          userName: user?.name,
          userImage: user?.image,
          rating,
          title,
          comment,
          images,
          verified: true, // Always true since we validated the booking
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      });

      // Update field's average rating and total reviews (including Google reviews)
      await updateFieldStats(fieldId);

      console.log('=== Review Notification Debug ===');
      console.log('- Reviewer userId:', userId);
      console.log('- Field ownerId:', field?.ownerId);
      console.log('- Are they the same?', field?.ownerId === userId);

      // Send notification to field owner (if not reviewing their own field)
      if (field?.ownerId && field.ownerId !== userId) {
        console.log('Sending "new review" notification to field owner:', field.ownerId);
        try {
          await createNotification({
            userId: field.ownerId,
            type: 'new_review_received',
            title: "You've got a new review!",
            message: `See what a recent visitor had to say about their experience at ${field.name}.`,
            data: {
              reviewId: review.reviewId, // Human-readable ID
              fieldId,
              fieldName: field.name,
              rating,
              reviewerName: user?.name,
              comment: comment?.substring(0, 100), // Include preview of the comment
            },
          });
          console.log('Field owner review notification sent successfully');
        } catch (error) {
          console.error('Failed to send field owner review notification:', error);
        }
      } else {
        console.log('Skipping field owner notification - reviewer is the field owner');
      }

      // Send confirmation notification to the reviewer
      console.log('Sending "review posted" confirmation to reviewer:', userId);
      try {
        await createNotification({
          userId: userId,
          type: 'review_posted_success',
          title: 'Review Posted Successfully',
          message: `Your ${rating} star review for ${field?.name} has been posted successfully.`,
          data: {
            reviewId: review.reviewId, // Human-readable ID
            fieldId,
            fieldName: field?.name,
            rating,
          },
        });
        console.log('Reviewer confirmation notification sent successfully');
      } catch (error) {
        console.error('Failed to send reviewer notification:', error);
      }

      res.status(201).json({
        success: true,
        data: review,
      });
    } catch (error) {
      console.error('Error creating review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create review',
      });
    }
  }

  // Update a review
  async updateReview(req: AuthRequest, res: Response) {
    try {
      const { reviewId: reviewIdParam } = req.params;
      const userId = req.user?.id;
      const { rating, title, comment, images } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Find review by ObjectId or human-readable reviewId
      const review = await findReviewById(reviewIdParam);

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Check if user owns the review
      if (review.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to edit this review',
        });
      }

      // Update the review using the actual ObjectId
      const updatedReview = await prisma.fieldReview.update({
        where: { id: review.id },
        data: {
          rating,
          title,
          comment,
          images,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      });

      // Update field's average rating and total reviews (including Google reviews)
      await updateFieldStats(review.fieldId);

      res.json({
        success: true,
        data: updatedReview,
      });
    } catch (error) {
      console.error('Error updating review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update review',
      });
    }
  }

  // Delete a review
  async deleteReview(req: AuthRequest, res: Response) {
    try {
      const { reviewId: reviewIdParam } = req.params;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Find review by ObjectId or human-readable reviewId
      const review = await findReviewById(reviewIdParam);

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Check permission (owner or admin can delete)
      if (review.userId !== userId && userRole !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this review',
        });
      }

      // Delete the review using the actual ObjectId
      await prisma.fieldReview.delete({
        where: { id: review.id },
      });

      // Update field's average rating and total reviews (including Google reviews)
      await updateFieldStats(review.fieldId);

      res.json({
        success: true,
        message: 'Review deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete review',
      });
    }
  }

  // Mark review as helpful
  async markHelpful(req: AuthRequest, res: Response) {
    try {
      const { reviewId: reviewIdParam } = req.params;

      // Find review by ObjectId or human-readable reviewId
      const existingReview = await findReviewById(reviewIdParam);

      if (!existingReview) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Increment helpful count using the actual ObjectId
      const review = await prisma.fieldReview.update({
        where: { id: existingReview.id },
        data: {
          helpfulCount: {
            increment: 1,
          },
        },
      });

      res.json({
        success: true,
        data: review,
      });
    } catch (error) {
      console.error('Error marking review as helpful:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark review as helpful',
      });
    }
  }

  // Field owner response to review
  async respondToReview(req: AuthRequest, res: Response) {
    try {
      const { reviewId: reviewIdParam } = req.params;
      const { response } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      // Find review by ObjectId or human-readable reviewId, including field info
      const review = await findReviewById(reviewIdParam, {
        field: {
          select: {
            ownerId: true,
          },
        },
      });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Check if user is the field owner
      if (review.field.ownerId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Only field owner can respond to reviews',
        });
      }

      // Update review with response using the actual ObjectId
      const updatedReview = await prisma.fieldReview.update({
        where: { id: review.id },
        data: {
          response,
          respondedAt: new Date(),
        },
      });

      res.json({
        success: true,
        data: updatedReview,
      });
    } catch (error) {
      console.error('Error responding to review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to respond to review',
      });
    }
  }

  // Get user's reviews
  async getUserReviews(req: AuthRequest, res: Response) {
    try {
      const userId = req.params.userId || req.user?.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const [reviews, total] = await Promise.all([
        prisma.fieldReview.findMany({
          where: { userId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            field: {
              select: {
                id: true,
                name: true,
                images: true,
                city: true,
                state: true,
              },
            },
          },
        }),
        prisma.fieldReview.count({ where: { userId } }),
      ]);

      res.json({
        success: true,
        data: {
          reviews,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      console.error('Error fetching user reviews:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch user reviews',
      });
    }
  }
}

export default new ReviewController();
