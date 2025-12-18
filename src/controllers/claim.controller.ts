//@ts-nocheck
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { emailService } from '../services/email.service';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config/constants';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Submit a field claim
export const submitFieldClaim = asyncHandler(async (req: Request, res: Response) => {
  const {
    fieldId,
    fullName,
    email,
    phoneCode,
    phoneNumber,
    isLegalOwner,
    documents
  } = req.body;

  // Validate required fields
  if (!fieldId || !fullName || !email || !phoneNumber || isLegalOwner === undefined || !documents || documents.length === 0) {
    throw new AppError('All fields are required', 400);
  }

  // Check if field exists
  const field = await prisma.field.findUnique({
    where: { id: fieldId }
  });

  if (!field) {
    throw new AppError('Field not found', 404);
  }

  // Check if field is already claimed (approved)
  if (field.isClaimed) {
    throw new AppError('This field has already been claimed and verified', 400);
  }

  // Check if there's already an APPROVED claim for this field
  const approvedClaim = await prisma.fieldClaim.findFirst({
    where: {
      fieldId,
      status: 'APPROVED'
    }
  });

  if (approvedClaim) {
    throw new AppError('This field has already been claimed and approved', 400);
  }

  // Check if this specific user already has a pending claim for this field
  const existingUserClaim = await prisma.fieldClaim.findFirst({
    where: {
      fieldId,
      email,
      status: 'PENDING'
    }
  });

  if (existingUserClaim) {
    throw new AppError('You already have a pending claim for this field. Please wait for the review to complete.', 400);
  }

  // Create the claim
  const claim = await prisma.fieldClaim.create({
    data: {
      fieldId,
      fullName,
      email,
      phoneCode,
      phoneNumber,
      isLegalOwner,
      documents,
      status: 'PENDING'
    },
    include: {
      field: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true
        }
      }
    }
  });

  // Send confirmation email to the claimer
  try {
    const fieldAddress = field.address ? 
      `${field.address}${field.city ? ', ' + field.city : ''}${field.state ? ', ' + field.state : ''}` : 
      'Address not specified';
    
    const fullPhoneNumber = `${phoneCode} ${phoneNumber}`;
    
    await emailService.sendFieldClaimEmail({
      fullName,
      email,
      phoneNumber: fullPhoneNumber,
      fieldName: field.name || 'Unnamed Field',
      fieldAddress: fieldAddress,
      isLegalOwner,
      submittedAt: claim.createdAt,
      documents: documents // Pass the documents array
    });
  } catch (emailError) {
    // Log error but don't fail the claim submission
    console.error('Failed to send field claim email:', emailError);
  }

  res.status(201).json({
    success: true,
    message: 'Claim submitted successfully. A confirmation email has been sent to your registered email address.',
    data: claim
  });
});

// Get all claims (admin only)
export const getAllClaims = asyncHandler(async (req: Request, res: Response) => {
  const { status, page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = {};
  if (status) {
    where.status = status;
  }

  const [claims, total] = await Promise.all([
    prisma.fieldClaim.findMany({
      where,
      include: {
        field: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: Number(limit)
    }),
    prisma.fieldClaim.count({ where })
  ]);

  res.json({
    success: true,
    data: claims,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit))
    }
  });
});

// Get claim by ID
export const getClaimById = asyncHandler(async (req: Request, res: Response) => {
  const { claimId } = req.params;

  const claim = await prisma.fieldClaim.findUnique({
    where: { id: claimId },
    include: {
      field: {
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      }
    }
  });

  if (!claim) {
    throw new AppError('Claim not found', 404);
  }

  res.json({
    success: true,
    data: claim
  });
});

// Update claim status (admin only)
export const updateClaimStatus = asyncHandler(async (req: Request, res: Response) => {
  const { claimId } = req.params;
  const { status, reviewNotes } = req.body;
  const reviewerId = (req as any).user._id || (req as any).user.id;

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const claim = await prisma.fieldClaim.findUnique({
    where: { id: claimId },
    include: {
      field: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true
        }
      }
    }
  });

  if (!claim) {
    throw new AppError('Claim not found', 404);
  }

  // Variables for credentials (used if approved)
  let generatedPassword: string | undefined;
  let fieldOwner: any = null;

  // Update the claim
  const updatedClaim = await prisma.fieldClaim.update({
    where: { id: claimId },
    data: {
      status,
      reviewNotes,
      reviewedAt: new Date(),
      reviewedBy: reviewerId
    }
  });

  // If approved, create field owner account and update field
  if (status === 'APPROVED') {
    try {
      // Check if user already exists with FIELD_OWNER role
      const existingFieldOwner = await prisma.user.findUnique({
        where: {
          email_role: {
            email: claim.email,
            role: 'FIELD_OWNER'
          }
        }
      });

      if (!existingFieldOwner) {
        // Generate a random password
        generatedPassword = crypto.randomBytes(8).toString('hex');
        const hashedPassword = await bcrypt.hash(generatedPassword, BCRYPT_ROUNDS);

        // Create the field owner account
        fieldOwner = await prisma.user.create({
          data: {
            email: claim.email,
            name: claim.fullName,
            password: hashedPassword,
            role: 'FIELD_OWNER',
            phone: claim.phoneCode && claim.phoneNumber ? `${claim.phoneCode}${claim.phoneNumber}` : null,
            provider: 'general',
            hasField: true
          }
        });

        // Update the field with the new owner
        await prisma.field.update({
          where: { id: claim.fieldId },
          data: {
            isClaimed: true,
            ownerId: fieldOwner.id
          }
        });

        console.log(`✅ Created field owner account for ${claim.email}`);
      } else {
        // User already exists, just update the field
        fieldOwner = existingFieldOwner;

        await prisma.field.update({
          where: { id: claim.fieldId },
          data: {
            isClaimed: true,
            ownerId: existingFieldOwner.id
          }
        });

        console.log(`ℹ️ Field owner account already exists for ${claim.email}, assigned field to existing account`);
        console.log(`ℹ️ Existing user provider: ${existingFieldOwner.provider}`);
      }
    } catch (accountError) {
      console.error('Failed to create field owner account:', accountError);
      throw new AppError('Failed to create field owner account', 500);
    }
  }

  // Send email notification about status update
  try {
    const fieldAddress = claim.field.address ?
      `${claim.field.address}${claim.field.city ? ', ' + claim.field.city : ''}${claim.field.state ? ', ' + claim.field.state : ''}` :
      'Address not specified';

    // Log email sending attempt for debugging
    console.log('📧 Sending claim status email to:', claim.email);
    console.log('📧 Status:', status);
    console.log('📧 Has credentials:', !!generatedPassword);
    if (generatedPassword) {
      console.log('📧 Generated password length:', generatedPassword.length);
    }

    const emailResult = await emailService.sendFieldClaimStatusEmail({
      email: claim.email,
      fullName: claim.fullName,
      fieldName: claim.field.name || 'Unnamed Field',
      fieldAddress: fieldAddress,
      status: status as 'APPROVED' | 'REJECTED',
      reviewNotes: reviewNotes,
      documents: claim.documents, // Include the documents array
      credentials: status === 'APPROVED' && generatedPassword ? {
        email: claim.email,
        password: generatedPassword
      } : undefined,
      // Pass existing account info for users who already have accounts
      existingAccount: status === 'APPROVED' && !generatedPassword && fieldOwner ? {
        email: claim.email,
        provider: fieldOwner.provider || 'general',
        isGoogleAccount: fieldOwner.provider === 'google'
      } : undefined
    });

    console.log('📧 Email send result:', emailResult ? 'SUCCESS' : 'FAILED');
  } catch (emailError: any) {
    // Log error but don't fail the status update
    console.error('❌ Failed to send field claim status email:', emailError?.message || emailError);
    console.error('❌ Full error:', JSON.stringify(emailError, null, 2));
  }

  res.json({
    success: true,
    message: `Claim ${status.toLowerCase()} successfully. An email notification has been sent to the claimer.`,
    data: updatedClaim
  });
});

// Check if a user can claim a field
export const checkClaimEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { fieldId } = req.params;
  const { email } = req.query;

  // Check if field exists
  const field = await prisma.field.findUnique({
    where: { id: fieldId }
  });

  if (!field) {
    throw new AppError('Field not found', 404);
  }

  // Check if field is already claimed
  if (field.isClaimed) {
    return res.json({
      success: true,
      canClaim: false,
      reason: 'This field has already been claimed and verified'
    });
  }

  // Check if there's an approved claim
  const approvedClaim = await prisma.fieldClaim.findFirst({
    where: {
      fieldId,
      status: 'APPROVED'
    }
  });

  if (approvedClaim) {
    return res.json({
      success: true,
      canClaim: false,
      reason: 'This field has already been claimed and approved'
    });
  }

  // If email is provided, check if this user already has a pending claim
  if (email) {
    const userClaim = await prisma.fieldClaim.findFirst({
      where: {
        fieldId,
        email: email as string,
        status: 'PENDING'
      }
    });

    if (userClaim) {
      return res.json({
        success: true,
        canClaim: false,
        reason: 'You already have a pending claim for this field',
        userHasPendingClaim: true
      });
    }
  }

  // Count total pending claims for this field
  const pendingClaimsCount = await prisma.fieldClaim.count({
    where: {
      fieldId,
      status: 'PENDING'
    }
  });

  res.json({
    success: true,
    canClaim: true,
    pendingClaimsCount,
    message: pendingClaimsCount > 0 
      ? `This field has ${pendingClaimsCount} pending claim(s) under review. You can still submit your claim.`
      : 'You can claim this field'
  });
});

// Get claims for a specific field
export const getFieldClaims = asyncHandler(async (req: Request, res: Response) => {
  const { fieldId } = req.params;

  const claims = await prisma.fieldClaim.findMany({
    where: { fieldId },
    orderBy: {
      createdAt: 'desc'
    }
  });

  res.json({
    success: true,
    data: claims
  });
});
