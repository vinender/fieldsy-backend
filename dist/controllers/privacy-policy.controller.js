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
    get bulkUpdatePrivacyPolicies () {
        return bulkUpdatePrivacyPolicies;
    },
    get createPrivacyPolicy () {
        return createPrivacyPolicy;
    },
    get deletePrivacyPolicy () {
        return deletePrivacyPolicy;
    },
    get getPrivacyPolicies () {
        return getPrivacyPolicies;
    },
    get updatePrivacyPolicy () {
        return updatePrivacyPolicy;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const DEFAULT_PRIVACY_SECTIONS = [
    {
        title: "1. Who We Are",
        content: "Fieldsy connects dog owners with secure, private dog walking fields listed by landowners across the UK. This policy applies to all users of our platform."
    },
    {
        title: "2. What Information We Collect",
        isList: true,
        content: [
            "Name, email address, and contact details",
            "Password (encrypted)",
            "Payment information (handled securely via third-party processors)",
            "Field listing details (if you're a landowner)",
            "Profile photo or dog info (optional)",
            "IP address and device data",
            "Location (via GPS if enabled)",
            "Pages viewed, actions taken, time on site",
            "Cookies and similar tracking technologies"
        ]
    },
    {
        title: "3. How We Use Your Information",
        isList: true,
        content: [
            "Provide and manage bookings",
            "Process payments securely",
            "Communicate with you (notifications, updates)",
            "Improve our services and personalize your experience",
            "Enforce platform policies and prevent fraud"
        ]
    },
    {
        title: "4. Sharing Your Information",
        isList: true,
        content: [
            "We do not sell your personal data. We may share limited data with:",
            "Payment processors (e.g., Stripe)",
            "Field owners (for confirmed bookings only)",
            "Service providers (hosting, analytics)",
            "Law enforcement or regulators if legally required"
        ]
    },
    {
        title: "5. How We Protect Your Data",
        content: "We use industry-standard encryption, secure servers, and access controls to protect your information. All payment data is handled through PCI-compliant processors."
    },
    {
        title: "6. Your Rights",
        isList: true,
        content: [
            "Access your personal data",
            "Request correction or deletion",
            "Withdraw consent at any time",
            "Object to or restrict processing",
            "Request a copy of your data (data portability)"
        ]
    },
    {
        title: "7. Data Retention",
        content: "We keep your data only as long as necessary to provide our services or as required by law."
    },
    {
        title: "8. Cookies",
        content: "Fieldsy uses cookies to enhance functionality and understand user behavior. You can manage cookie preferences through your browser settings."
    },
    {
        title: "9. Children's Privacy",
        content: "Fieldsy is intended for users aged 18 and older. We do not knowingly collect data from children."
    },
    {
        title: "10. Changes to This Policy",
        content: "We may update this policy to reflect changes in law or our services. We will notify users of significant updates via email or app notification."
    },
    {
        title: "11. Contact Us",
        content: `For any questions, contact us at:\ninfo@fieldsy.co.uk`
    }
];
const getPrivacyPolicies = async (req, res)=>{
    try {
        const policies = await _database.default.privacyPolicy.findMany({
            orderBy: {
                order: 'asc'
            }
        });
        // If no sections exist, seed defaults
        if (policies.length === 0) {
            const created = await Promise.all(DEFAULT_PRIVACY_SECTIONS.map((section, index)=>_database.default.privacyPolicy.create({
                    data: {
                        ...section,
                        order: index
                    }
                })));
            return res.json({
                success: true,
                data: created
            });
        }
        res.json({
            success: true,
            data: policies
        });
    } catch (error) {
        console.error('Error fetching privacy policies:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch privacy policy'
        });
    }
};
const createPrivacyPolicy = async (req, res)=>{
    try {
        const { title, content, isList, order } = req.body;
        const policy = await _database.default.privacyPolicy.create({
            data: {
                title,
                content,
                isList: isList || false,
                order: order || 0
            }
        });
        res.status(201).json({
            success: true,
            data: policy,
            message: 'Privacy policy section created'
        });
    } catch (error) {
        console.error('Error creating privacy policy:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create privacy policy section'
        });
    }
};
const updatePrivacyPolicy = async (req, res)=>{
    try {
        const { id } = req.params;
        const { title, content, isList, order } = req.body;
        const policy = await _database.default.privacyPolicy.update({
            where: {
                id
            },
            data: {
                ...title && {
                    title
                },
                ...content !== undefined && {
                    content
                },
                ...isList !== undefined && {
                    isList
                },
                ...order !== undefined && {
                    order
                }
            }
        });
        res.json({
            success: true,
            data: policy,
            message: 'Privacy policy section updated'
        });
    } catch (error) {
        console.error('Error updating privacy policy:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update privacy policy section'
        });
    }
};
const deletePrivacyPolicy = async (req, res)=>{
    try {
        const { id } = req.params;
        await _database.default.privacyPolicy.delete({
            where: {
                id
            }
        });
        res.json({
            success: true,
            message: 'Privacy policy section deleted'
        });
    } catch (error) {
        console.error('Error deleting privacy policy:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete privacy policy section'
        });
    }
};
const bulkUpdatePrivacyPolicies = async (req, res)=>{
    try {
        const { policies } = req.body;
        if (!Array.isArray(policies)) {
            return res.status(400).json({
                success: false,
                message: 'Policies must be an array'
            });
        }
        const results = await Promise.all(policies.map(async (policy, index)=>{
            if (policy.id) {
                return _database.default.privacyPolicy.update({
                    where: {
                        id: policy.id
                    },
                    data: {
                        title: policy.title,
                        content: policy.content,
                        isList: policy.isList,
                        order: index
                    }
                });
            } else {
                return _database.default.privacyPolicy.create({
                    data: {
                        title: policy.title,
                        content: policy.content,
                        isList: policy.isList,
                        order: index
                    }
                });
            }
        }));
        res.json({
            success: true,
            data: results,
            message: 'Privacy policy updated'
        });
    } catch (error) {
        console.error('Error bulk updating privacy policies:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update privacy policy'
        });
    }
};

//# sourceMappingURL=privacy-policy.controller.js.map