"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFieldClaims = exports.checkClaimEligibility = exports.updateClaimStatus = exports.getClaimById = exports.getAllClaims = exports.submitFieldClaim = void 0;
const client_1 = require("@prisma/client");
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const email_service_1 = require("../services/email.service");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const constants_1 = require("../config/constants");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
// Submit a field claim
exports.submitFieldClaim = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { fieldId, fullName, email, phoneCode, phoneNumber, isLegalOwner, documents } = req.body;
    // Validate required fields
    if (!fieldId || !fullName || !email || !phoneNumber || isLegalOwner === undefined || !documents || documents.length === 0) {
        throw new AppError_1.AppError('All fields are required', 400);
    }
    // Check if field exists and get owner info
    const field = await prisma.field.findUnique({
        where: { id: fieldId },
        include: {
            owner: {
                select: {
                    id: true,
                    email: true,
                    name: true
                }
            }
        }
    });
    if (!field) {
        throw new AppError_1.AppError('Field not found', 404);
    }
    // Check if field is already claimed
    // isClaimed on the Field model is the source of truth for whether a field has been claimed
    if (field.isClaimed) {
        throw new AppError_1.AppError('This field has already been claimed and verified', 400);
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
        throw new AppError_1.AppError('You already have a pending claim for this field. Please wait for the review to complete.', 400);
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
        await email_service_1.emailService.sendFieldClaimEmail({
            fullName,
            email,
            phoneNumber: fullPhoneNumber,
            fieldName: field.name || 'Unnamed Field',
            fieldAddress: fieldAddress,
            isLegalOwner,
            submittedAt: claim.createdAt,
            documents: documents // Pass the documents array
        });
    }
    catch (emailError) {
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
exports.getAllClaims = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = {};
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
exports.getClaimById = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
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
        throw new AppError_1.AppError('Claim not found', 404);
    }
    res.json({
        success: true,
        data: claim
    });
});
// Update claim status (admin only)
exports.updateClaimStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { claimId } = req.params;
    const { status, reviewNotes } = req.body;
    const reviewerId = req.user._id || req.user.id;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
        throw new AppError_1.AppError('Invalid status', 400);
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
        throw new AppError_1.AppError('Claim not found', 404);
    }
    // Variables for credentials (used if approved)
    let generatedPassword;
    let fieldOwner = null;
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
    // If approved, get the field's existing owner account and generate new password
    if (status === 'APPROVED') {
        try {
            // Get the field with its current owner
            const fieldWithOwner = await prisma.field.findUnique({
                where: { id: claim.fieldId },
                include: {
                    owner: true
                }
            });
            if (fieldWithOwner?.owner) {
                // Field has an existing owner - generate new password for them
                fieldOwner = fieldWithOwner.owner;
                // Generate a new password for the existing owner
                generatedPassword = crypto_1.default.randomBytes(8).toString('hex');
                const hashedPassword = await bcryptjs_1.default.hash(generatedPassword, constants_1.BCRYPT_ROUNDS);
                // Update the owner's password and mark email as verified
                await prisma.user.update({
                    where: { id: fieldOwner.id },
                    data: {
                        password: hashedPassword,
                        emailVerified: new Date(), // DateTime field
                        provider: 'general' // Update provider to general since they now have password login
                    }
                });
                // Mark the field as claimed
                await prisma.field.update({
                    where: { id: claim.fieldId },
                    data: {
                        isClaimed: true
                    }
                });
                console.log(`✅ Updated password for existing field owner: ${fieldOwner.email}`);
            }
            else {
                // Field has no owner - create a new owner account using claimer's details
                generatedPassword = crypto_1.default.randomBytes(8).toString('hex');
                const hashedPassword = await bcryptjs_1.default.hash(generatedPassword, constants_1.BCRYPT_ROUNDS);
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
                    fieldOwner = await prisma.user.create({
                        data: {
                            email: claim.email,
                            name: claim.fullName,
                            password: hashedPassword,
                            role: 'FIELD_OWNER',
                            phone: claim.phoneCode && claim.phoneNumber ? `${claim.phoneCode}${claim.phoneNumber}` : null,
                            provider: 'general',
                            hasField: true,
                            emailVerified: new Date() // DateTime field
                        }
                    });
                    console.log(`✅ Created new field owner account for ${claim.email}`);
                }
                else {
                    fieldOwner = existingFieldOwner;
                    // Update password for existing user
                    await prisma.user.update({
                        where: { id: existingFieldOwner.id },
                        data: {
                            password: hashedPassword,
                            emailVerified: new Date() // DateTime field
                        }
                    });
                    console.log(`✅ Updated password for existing field owner: ${existingFieldOwner.email}`);
                }
                // Update the field with the owner
                await prisma.field.update({
                    where: { id: claim.fieldId },
                    data: {
                        isClaimed: true,
                        ownerId: fieldOwner.id
                    }
                });
            }
        }
        catch (accountError) {
            console.error('Failed to process field owner account:', accountError);
            throw new AppError_1.AppError('Failed to process field owner account', 500);
        }
    }
    // Send email notification about status update
    try {
        const fieldAddress = claim.field.address ?
            `${claim.field.address}${claim.field.city ? ', ' + claim.field.city : ''}${claim.field.state ? ', ' + claim.field.state : ''}` :
            'Address not specified';
        // Comprehensive logging for debugging email issues
        console.log('========================================');
        console.log('📧 CLAIM STATUS EMAIL - DEBUG START');
        console.log('========================================');
        console.log('📧 Notification email (claimer):', claim.email);
        console.log('📧 Claimer name:', claim.fullName);
        console.log('📧 Field name:', claim.field.name || 'Unnamed Field');
        console.log('📧 Field address:', fieldAddress);
        console.log('📧 Claim status:', status);
        console.log('📧 Review notes:', reviewNotes || 'None');
        console.log('📧 Has credentials:', !!generatedPassword);
        if (fieldOwner) {
            console.log('📧 Field owner ID:', fieldOwner.id);
            console.log('📧 Field owner email (for login):', fieldOwner.email);
            console.log('📧 Field owner provider:', fieldOwner.provider);
        }
        if (generatedPassword) {
            console.log('📧 Generated password length:', generatedPassword.length);
        }
        console.log('📧 Calling emailService.sendFieldClaimStatusEmail...');
        const emailResult = await email_service_1.emailService.sendFieldClaimStatusEmail({
            email: claim.email, // Send notification to claimer's email
            fullName: claim.fullName,
            fieldName: claim.field.name || 'Unnamed Field',
            fieldAddress: fieldAddress,
            status: status,
            reviewNotes: reviewNotes,
            documents: claim.documents,
            // Credentials are for the FIELD OWNER's account (not the claim email)
            credentials: status === 'APPROVED' && generatedPassword && fieldOwner ? {
                email: fieldOwner.email, // Use field owner's email for login credentials
                password: generatedPassword
            } : undefined
        });
        console.log('📧 Email send result:', emailResult ? 'SUCCESS' : 'FAILED');
        console.log('========================================');
        console.log('📧 CLAIM STATUS EMAIL - DEBUG END');
        console.log('========================================');
    }
    catch (emailError) {
        // Log error but don't fail the status update
        console.error('========================================');
        console.error('❌ CLAIM STATUS EMAIL - ERROR');
        console.error('========================================');
        console.error('❌ Error message:', emailError?.message || 'Unknown error');
        console.error('❌ Error name:', emailError?.name);
        console.error('❌ Error code:', emailError?.code);
        console.error('❌ Error stack:', emailError?.stack);
        console.error('❌ Full error object:', JSON.stringify(emailError, Object.getOwnPropertyNames(emailError), 2));
        console.error('========================================');
    }
    res.json({
        success: true,
        message: `Claim ${status.toLowerCase()} successfully. An email notification has been sent to the claimer.`,
        data: updatedClaim
    });
});
// Check if a user can claim a field
exports.checkClaimEligibility = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { fieldId } = req.params;
    const { email } = req.query;
    // Check if field exists
    const field = await prisma.field.findUnique({
        where: { id: fieldId }
    });
    if (!field) {
        throw new AppError_1.AppError('Field not found', 404);
    }
    // Check if field is already claimed
    // isClaimed on the Field model is the source of truth
    if (field.isClaimed) {
        return res.json({
            success: true,
            canClaim: false,
            reason: 'This field has already been claimed and verified'
        });
    }
    // If email is provided, check if this user already has a pending claim
    if (email) {
        const userClaim = await prisma.fieldClaim.findFirst({
            where: {
                fieldId,
                email: email,
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
exports.getFieldClaims = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
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
