//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get checkClaimEligibility () {
        return checkClaimEligibility;
    },
    get getAllClaims () {
        return getAllClaims;
    },
    get getClaimById () {
        return getClaimById;
    },
    get getFieldClaims () {
        return getFieldClaims;
    },
    get submitFieldClaim () {
        return submitFieldClaim;
    },
    get updateClaimStatus () {
        return updateClaimStatus;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
const _emailservice = require("../services/email.service");
const _bcryptjs = /*#__PURE__*/ _interop_require_default(require("bcryptjs"));
const _constants = require("../config/constants");
const _crypto = /*#__PURE__*/ _interop_require_default(require("crypto"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const submitFieldClaim = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { fieldId, fullName, email, phoneCode, phoneNumber, isLegalOwner, documents } = req.body;
    // Validate required fields
    if (!fieldId || !fullName || !email || !phoneNumber || isLegalOwner === undefined || !documents || documents.length === 0) {
        throw new _AppError.AppError('All fields are required', 400);
    }
    // Support both internal ID and human-readable fieldId
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    const where = isObjectId ? {
        id: fieldId
    } : {
        fieldId
    };
    // Check if field exists and get owner info
    const field = await _database.default.field.findUnique({
        where,
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
        throw new _AppError.AppError('Field not found', 404);
    }
    // Check if field is already claimed
    // isClaimed on the Field model is the source of truth for whether a field has been claimed
    if (field.isClaimed) {
        throw new _AppError.AppError('This field has already been claimed and verified', 400);
    }
    // Check if this specific user already has a pending claim for this field
    const existingUserClaim = await _database.default.fieldClaim.findFirst({
        where: {
            fieldId: field.id,
            email,
            status: 'PENDING'
        }
    });
    if (existingUserClaim) {
        throw new _AppError.AppError('You already have a pending claim for this field. Please wait for the review to complete.', 400);
    }
    // Create the claim
    const claim = await _database.default.fieldClaim.create({
        data: {
            fieldId: field.id,
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
        const fieldAddress = field.address ? `${field.address}${field.city ? ', ' + field.city : ''}${field.state ? ', ' + field.state : ''}` : 'Address not specified';
        const fullPhoneNumber = `${phoneCode} ${phoneNumber}`;
        await _emailservice.emailService.sendFieldClaimEmail({
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
const getAllClaims = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = {};
    if (status) {
        where.status = status;
    }
    const [claims, total] = await Promise.all([
        _database.default.fieldClaim.findMany({
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
        _database.default.fieldClaim.count({
            where
        })
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
const getClaimById = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { claimId } = req.params;
    const claim = await _database.default.fieldClaim.findUnique({
        where: {
            id: claimId
        },
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
        throw new _AppError.AppError('Claim not found', 404);
    }
    res.json({
        success: true,
        data: claim
    });
});
const updateClaimStatus = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { claimId } = req.params;
    const { status, reviewNotes } = req.body;
    const reviewerId = req.user._id || req.user.id;
    if (![
        'APPROVED',
        'REJECTED'
    ].includes(status)) {
        throw new _AppError.AppError('Invalid status', 400);
    }
    const claim = await _database.default.fieldClaim.findUnique({
        where: {
            id: claimId
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
    if (!claim) {
        throw new _AppError.AppError('Claim not found', 404);
    }
    // Variables for credentials (used if approved)
    let generatedPassword;
    let fieldOwner = null;
    // Update the claim
    const updatedClaim = await _database.default.fieldClaim.update({
        where: {
            id: claimId
        },
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
            const fieldWithOwner = await _database.default.field.findUnique({
                where: {
                    id: claim.fieldId
                },
                include: {
                    owner: true
                }
            });
            if (fieldWithOwner?.owner) {
                // Field has an existing owner - generate new password for them
                fieldOwner = fieldWithOwner.owner;
                // Generate a new password for the existing owner
                generatedPassword = _crypto.default.randomBytes(8).toString('hex');
                const hashedPassword = await _bcryptjs.default.hash(generatedPassword, _constants.BCRYPT_ROUNDS);
                // Update the owner's password and mark email as verified
                await _database.default.user.update({
                    where: {
                        id: fieldOwner.id
                    },
                    data: {
                        password: hashedPassword,
                        emailVerified: new Date(),
                        provider: 'general' // Update provider to general since they now have password login
                    }
                });
                // Mark the field as claimed
                await _database.default.field.update({
                    where: {
                        id: claim.fieldId
                    },
                    data: {
                        isClaimed: true
                    }
                });
                console.log(`✅ Updated password for existing field owner: ${fieldOwner.email}`);
            } else {
                // Field has no owner - create a new owner account using claimer's details
                generatedPassword = _crypto.default.randomBytes(8).toString('hex');
                const hashedPassword = await _bcryptjs.default.hash(generatedPassword, _constants.BCRYPT_ROUNDS);
                // Check if user already exists with this email (any role)
                const existingFieldOwner = await _database.default.user.findFirst({
                    where: {
                        email: claim.email
                    }
                });
                if (!existingFieldOwner) {
                    // Generate human-readable userId
                    const userCounter = await _database.default.counter.upsert({
                        where: {
                            name: 'user'
                        },
                        update: {
                            value: {
                                increment: 1
                            }
                        },
                        create: {
                            name: 'user',
                            value: 7777
                        }
                    });
                    const userId = userCounter.value.toString();
                    fieldOwner = await _database.default.user.create({
                        data: {
                            email: claim.email,
                            name: claim.fullName,
                            password: hashedPassword,
                            role: 'FIELD_OWNER',
                            phone: claim.phoneCode && claim.phoneNumber ? `${claim.phoneCode}${claim.phoneNumber}` : null,
                            provider: 'general',
                            hasField: true,
                            userId,
                            emailVerified: new Date() // DateTime field
                        }
                    });
                    console.log(`✅ Created new field owner account for ${claim.email}`);
                } else {
                    fieldOwner = existingFieldOwner;
                    // Update password for existing user
                    await _database.default.user.update({
                        where: {
                            id: existingFieldOwner.id
                        },
                        data: {
                            password: hashedPassword,
                            emailVerified: new Date() // DateTime field
                        }
                    });
                    console.log(`✅ Updated password for existing field owner: ${existingFieldOwner.email}`);
                }
                // Update the field with the owner
                await _database.default.field.update({
                    where: {
                        id: claim.fieldId
                    },
                    data: {
                        isClaimed: true,
                        ownerId: fieldOwner.id
                    }
                });
            }
        } catch (accountError) {
            console.error('Failed to process field owner account:', accountError);
            throw new _AppError.AppError('Failed to process field owner account', 500);
        }
    }
    // Send email notification about status update
    try {
        const fieldAddress = claim.field.address ? `${claim.field.address}${claim.field.city ? ', ' + claim.field.city : ''}${claim.field.state ? ', ' + claim.field.state : ''}` : 'Address not specified';
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
        const emailResult = await _emailservice.emailService.sendFieldClaimStatusEmail({
            email: claim.email,
            fullName: claim.fullName,
            fieldName: claim.field.name || 'Unnamed Field',
            fieldAddress: fieldAddress,
            status: status,
            reviewNotes: reviewNotes,
            documents: claim.documents,
            // Credentials are for the FIELD OWNER's account (not the claim email)
            credentials: status === 'APPROVED' && generatedPassword && fieldOwner ? {
                email: fieldOwner.email,
                password: generatedPassword
            } : undefined
        });
        console.log('📧 Email send result:', emailResult ? 'SUCCESS' : 'FAILED');
        console.log('========================================');
        console.log('📧 CLAIM STATUS EMAIL - DEBUG END');
        console.log('========================================');
    } catch (emailError) {
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
const checkClaimEligibility = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { fieldId } = req.params;
    const { email } = req.query;
    // Support both internal ID and human-readable fieldId
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    const where = isObjectId ? {
        id: fieldId
    } : {
        fieldId
    };
    // Check if field exists - only select fields we need
    const field = await _database.default.field.findUnique({
        where,
        select: {
            id: true,
            name: true,
            isClaimed: true
        }
    });
    if (!field) {
        throw new _AppError.AppError('Field not found', 404);
    }
    // Check if field is already claimed
    // isClaimed on the Field model is the source of truth
    if (field.isClaimed) {
        return res.json({
            success: true,
            canClaim: false,
            reason: 'This field has already been claimed and verified',
            fieldName: field.name
        });
    }
    // If email is provided, check if this user already has a pending claim
    if (email) {
        const userClaim = await _database.default.fieldClaim.findFirst({
            where: {
                fieldId: field.id,
                email: email,
                status: 'PENDING'
            }
        });
        if (userClaim) {
            return res.json({
                success: true,
                canClaim: false,
                reason: 'You already have a pending claim for this field',
                userHasPendingClaim: true,
                fieldName: field.name
            });
        }
    }
    // Count total pending claims for this field
    const pendingClaimsCount = await _database.default.fieldClaim.count({
        where: {
            fieldId: field.id,
            status: 'PENDING'
        }
    });
    res.json({
        success: true,
        canClaim: true,
        pendingClaimsCount,
        fieldName: field.name,
        message: pendingClaimsCount > 0 ? `This field has ${pendingClaimsCount} pending claim(s) under review. You can still submit your claim.` : 'You can claim this field'
    });
});
const getFieldClaims = (0, _asyncHandler.asyncHandler)(async (req, res)=>{
    const { fieldId } = req.params;
    const claims = await _database.default.fieldClaim.findMany({
        where: {
            fieldId
        },
        orderBy: {
            createdAt: 'desc'
        }
    });
    res.json({
        success: true,
        data: claims
    });
});

//# sourceMappingURL=claim.controller.js.map