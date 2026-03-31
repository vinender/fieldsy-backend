"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AboutPage = void 0;
//@ts-nocheck
const mongoose_1 = __importStar(require("mongoose"));
const AboutPageSchema = new mongoose_1.Schema({
    heroSection: {
        sectionTitle: { type: String, default: 'About Us' },
        mainTitle: { type: String, required: true },
        subtitle: { type: String },
        description: { type: String, required: true },
        buttonText: { type: String, default: 'Download App' },
        image: { type: String, required: true },
        stats: [
            {
                value: { type: String, required: true },
                label: { type: String, required: true },
                order: { type: Number, default: 0 }
            }
        ]
    },
    missionSection: {
        title: { type: String, required: true },
        description: { type: String, required: true },
        buttonText: { type: String },
        image: { type: String }
    },
    whoWeAreSection: {
        title: { type: String, required: true },
        description: { type: String, required: true },
        mainImage: { type: String },
        rightCardImage: { type: String },
        rightCardTitle: { type: String },
        rightCardDescription: { type: String },
        features: [
            {
                icon: { type: String },
                title: { type: String, required: true },
                description: { type: String, required: true },
                order: { type: Number, default: 0 }
            }
        ]
    },
    whatWeDoSection: {
        title: { type: String, required: true },
        subtitle: { type: String },
        description: { type: String, required: true },
        image: { type: String },
        features: [
            {
                title: { type: String, required: true },
                description: { type: String, required: true },
                order: { type: Number, default: 0 }
            }
        ]
    },
    whyFieldsySection: {
        title: { type: String, required: true },
        subtitle: { type: String },
        image: { type: String },
        boxTitle: { type: String },
        boxDescription: { type: String },
        buttonText: { type: String },
        features: [
            {
                icon: { type: String },
                title: { type: String, required: true },
                description: { type: String, required: true },
                order: { type: Number, default: 0 }
            }
        ]
    }
}, {
    timestamps: true
});
// Ensure only one document exists
AboutPageSchema.statics.findOneOrCreate = async function () {
    let aboutPage = await this.findOne();
    if (!aboutPage) {
        aboutPage = await this.create({
            heroSection: {
                sectionTitle: 'About Us',
                mainTitle: 'Safe, Private Fields Where Every Dog Can Run Free',
                description: 'Fieldsy is the UK\'s marketplace for private dog walking fields. We connect dog owners who need secure, enclosed spaces with landowners who have the land to offer. Whether your dog is reactive, in training, or simply loves to sprint -- Fieldsy makes it easy to find, book, and enjoy a peaceful off-lead session near you.',
                buttonText: 'Download the App',
                image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
                stats: [
                    { value: '500+', label: 'Dog Owners Signed Up', order: 1 },
                    { value: '200+', label: 'Private Fields Listed', order: 2 },
                    { value: '50+', label: 'Towns & Cities Across the UK', order: 3 },
                    { value: '100%', label: 'Secure, Fenced Spaces', order: 4 }
                ]
            },
            missionSection: {
                title: 'Our Mission',
                description: 'At Fieldsy, we are on a mission to give every dog the freedom to explore off-lead -- safely. We connect dog owners with private, fully enclosed fields across the UK, making it simple to find, book, and enjoy peaceful walks away from busy parks, unpredictable dogs, and crowded spaces. Because every dog deserves room to run, and every owner deserves peace of mind.',
                image: ''
            },
            whoWeAreSection: {
                title: 'Who We Are',
                description: 'We are a small, passionate team of dog lovers, developers, and outdoor enthusiasts based in the UK. We built Fieldsy because we know first-hand how hard it can be to find a safe, enclosed space for reactive, nervous, or high-energy dogs. Our combined love for technology and animals drives everything we do -- and we will not stop until every dog owner in the UK has a private field within easy reach.',
                features: []
            },
            whatWeDoSection: {
                title: 'What We Do',
                subtitle: '',
                description: 'Fieldsy brings dog owners and landowners together on one simple platform. Dog owners browse and book secure, private fields. Landowners list their land and earn income. Everyone benefits -- especially the dogs.',
                image: '',
                features: [
                    { title: 'Browse Fields Near You', description: 'Explore a growing network of private, secure dog walking fields across the UK. Filter by size, amenities, and distance.', order: 1 },
                    { title: 'Book Instantly', description: 'Reserve your time slot in a few taps -- no waiting, no back-and-forth with the host.', order: 2 },
                    { title: 'Enjoy Peace of Mind', description: 'Let your dog run free in a fully enclosed, verified space. No unexpected dogs, no distractions.', order: 3 },
                    { title: 'List Your Land', description: 'Turn unused or underused land into a steady source of income by hosting dog owners.', order: 4 },
                    { title: 'Set Your Own Schedule', description: 'Control exactly when your field is available. Block dates, set opening hours, adjust as you go.', order: 5 },
                    { title: 'Get Paid Automatically', description: 'Receive secure payouts directly to your bank account after each completed booking. Powered by Stripe.', order: 6 }
                ]
            },
            whyFieldsySection: {
                title: 'Why Fieldsy?',
                subtitle: 'Choosing Fieldsy means choosing peace of mind for you and real freedom for your dog.',
                features: [
                    { icon: 'CheckCircle', title: 'Secure & Private', description: 'Every field is enclosed and verified. You and your dog have the space entirely to yourselves during your booking.', order: 1 },
                    { icon: 'MapPin', title: 'Local & Convenient', description: 'Find fields close to home with postcode or GPS search. No long drives -- just easy access to safe spaces nearby.', order: 2 },
                    { icon: 'Calendar', title: 'Flexible Booking', description: 'Book by the hour, at a time that suits you. Cancel within the window if plans change -- no penalty.', order: 3 },
                    { icon: 'Shield', title: 'Trusted Community', description: 'Verified hosts, real reviews, and responsive support. We take safety and trust seriously.', order: 4 }
                ]
            }
        });
    }
    return aboutPage;
};
exports.AboutPage = mongoose_1.default.model('AboutPage', AboutPageSchema);
