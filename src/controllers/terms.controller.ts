//@ts-nocheck
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TERMS = [
    {
        title: "1. About Fieldsy",
        content: "Fieldsy connects dog owners with private, secure dog walking fields offered by landowners. Users can search, book, and review fields, while landowners can list, manage, and earn from their land."
    },
    {
        title: "2. User Accounts",
        isList: true,
        content: [
            "You must be 18+ to create an account.",
            "All information provided must be accurate and up-to-date.",
            "You are responsible for maintaining the security of your account and password."
        ]
    },
    {
        title: "3. Booking Fields (For Dog Owners)",
        isList: true,
        content: [
            "You agree to follow the field owner's rules and the booking time strictly.",
            "Payment must be made in full at the time of booking.",
            "Fields are intended for private, non-commercial use unless otherwise agreed upon.",
            "Always pick up after your dog and leave the field as you found it."
        ]
    },
    {
        title: "4. Listing Fields (For Landowners)",
        isList: true,
        content: [
            "You must have legal rights to list the field for use.",
            "Your listing must include accurate information about fencing, access, pricing, and availability.",
            "Fieldsy reserves the right to review, edit, or reject any listing that doesn't meet platform standards.",
            "Landowners are responsible for ensuring the safety, cleanliness, and accessibility of their fields."
        ]
    },
    {
        title: "5. Payments & Fees",
        isList: true,
        content: [
            "Fieldsy securely processes payments on behalf of field owners.",
            "A small service fee may apply to each transaction.",
            "Landowners will receive payouts via the selected method (e.g., bank transfer, PayPal).",
            "All earnings must be reported in accordance with local tax laws."
        ]
    },
    {
        title: "6. Cancellations & Refunds",
        isList: true,
        content: [
            "Users can cancel up to 24 hours before the booking for a full refund.",
            "Late cancellations may not be eligible for a refund.",
            "Landowners can set custom cancellation policies, which must be clearly stated in the listing."
        ]
    },
    {
        title: "7. Field Access & Conduct",
        isList: true,
        content: [
            "Fieldsy is not responsible for the condition of the field or the behavior of users.",
            "Aggressive or unsafe behavior by dogs or humans may result in account suspension.",
            "Trespassing outside of the booked time is strictly prohibited."
        ]
    },
    {
        title: "8. Liability",
        isList: true,
        content: [
            "Users enter fields at their own risk.",
            "Fieldsy is not liable for any injury, damage, or loss resulting from bookings, dog behavior, or field conditions.",
            "Field owners must have appropriate insurance for their land use."
        ]
    },
    {
        title: "9. Platform Rules",
        isList: true,
        content: [
            "No illegal activity is permitted on or through Fieldsy.",
            "Do not use the platform to harass, spam, or misrepresent others.",
            "Violation of these terms may lead to account termination."
        ]
    },
    {
        title: "10. Changes to Terms",
        content: "We may update these Terms at any time. Continued use of Fieldsy after changes means you accept the updated Terms."
    },
    {
        title: "11. Contact Us",
        content: `For any questions, contact us at:
📧 fieldsyz@gmail.com
📍 Camden Town, London NW1 0LT, United Kingdom`
    }
];

// Get all terms (public)
export const getTerms = async (req: Request, res: Response) => {
    try {
        const terms = await prisma.term.findMany({
            orderBy: { order: 'asc' }
        });

        // If no terms exist, seed default terms
        if (terms.length === 0) {
            const createdTerms = await Promise.all(
                DEFAULT_TERMS.map((term, index) =>
                    prisma.term.create({
                        data: {
                            ...term,
                            order: index
                        }
                    })
                )
            );
            return res.json({
                success: true,
                data: createdTerms
            });
        }

        res.json({
            success: true,
            data: terms
        });
    } catch (error) {
        console.error('Error fetching terms:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch terms and conditions'
        });
    }
};

// Create Term (Admin)
export const createTerm = async (req: Request, res: Response) => {
    try {
        const { title, content, isList, order } = req.body;

        const term = await prisma.term.create({
            data: {
                title,
                content,
                isList: isList || false,
                order: order || 0
            }
        });

        res.status(201).json({
            success: true,
            data: term,
            message: 'Term section created successfully'
        });
    } catch (error) {
        console.error('Error creating term:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create term section'
        });
    }
};

// Update Term (Admin)
export const updateTerm = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { title, content, isList, order } = req.body;

        const term = await prisma.term.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(content !== undefined && { content }),
                ...(isList !== undefined && { isList }),
                ...(order !== undefined && { order })
            }
        });

        res.json({
            success: true,
            data: term,
            message: 'Term section updated successfully'
        });
    } catch (error) {
        console.error('Error updating term:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update term section'
        });
    }
};

// Delete Term (Admin)
export const deleteTerm = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await prisma.term.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'Term section deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting term:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete term section'
        });
    }
};

// Bulk Update Terms (Admin) - mainly for reordering or full replacement
export const bulkUpdateTerms = async (req: Request, res: Response) => {
    try {
        const { terms } = req.body; // Array of terms

        if (!Array.isArray(terms)) {
            return res.status(400).json({
                success: false,
                message: 'Terms must be an array'
            });
        }

        // This is a simple implementation: delete all and recreate
        // A better approach would be to upsert based on ID

        // For now, let's just handle updates/creates
        const results = await Promise.all(
            terms.map(async (term, index) => {
                if (term.id) {
                    // Update existing
                    return await prisma.term.update({
                        where: { id: term.id },
                        data: {
                            title: term.title,
                            content: term.content,
                            isList: term.isList,
                            order: index
                        }
                    });
                } else {
                    // Create new
                    return await prisma.term.create({
                        data: {
                            title: term.title,
                            content: term.content,
                            isList: term.isList,
                            order: index
                        }
                    })
                }
            })
        );

        // TODO: Handle deletions if necessary (terms not in the list should be deleted?)
        // For now, explicit delete endpoint handles deletions.

        res.json({
            success: true,
            data: results,
            message: 'Terms updated successfully'
        });
    } catch (error) {
        console.error('Error bulk updating terms:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update terms'
        });
    }
};
