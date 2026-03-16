//@ts-nocheck
import mongoose, { Document, Schema, Model } from 'mongoose'

export interface IAboutPage extends Document {
  heroSection: {
    sectionTitle: string
    mainTitle: string
    subtitle: string
    description: string
    buttonText: string
    image: string
    stats: Array<{
      value: string
      label: string
      order: number
    }>
  }
  missionSection: {
    title: string
    description: string
    buttonText: string
    image?: string
  }
  whoWeAreSection: {
    title: string
    description: string
    mainImage?: string
    rightCardImage?: string
    rightCardTitle?: string
    rightCardDescription?: string
    features: Array<{
      icon: string
      title: string
      description: string
      order: number
    }>
  }
  whatWeDoSection: {
    title: string
    subtitle: string
    description: string
    image: string
    features: Array<{
      title: string
      description: string
      order: number
    }>
  }
  whyFieldsySection: {
    title: string
    subtitle: string
    image?: string
    boxTitle?: string
    boxDescription?: string
    buttonText?: string
    features: Array<{
      icon: string
      title: string
      description: string
      order: number
    }>
  }
  createdAt: Date
  updatedAt: Date
}

const AboutPageSchema = new Schema(
  {
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
  },
  {
    timestamps: true
  }
)

// Ensure only one document exists
AboutPageSchema.statics.findOneOrCreate = async function() {
  let aboutPage = await this.findOne()
  if (!aboutPage) {
    aboutPage = await this.create({
      heroSection: {
        sectionTitle: 'About Us',
        mainTitle: 'All-in-One Platform for Smarter Field Operations',
        description: 'Fieldsy brings every aspect of field operations into a single, easy-to-use platform. From property claims and terrain tracking to team coordination and document management—we help you digitize, streamline, and scale your fieldwork with confidence. No more juggling spreadsheets, paperwork, or disconnected tools. With Fieldsy, everything you need is at your fingertips, wherever the field takes you.',
        buttonText: 'Download App',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
        stats: []
      },
      missionSection: {
        title: '',
        description: '',
        image: ''
      },
      whoWeAreSection: {
        title: '',
        description: '',
        features: []
      },
      whatWeDoSection: {
        title: '',
        subtitle: '',
        description: '',
        image: '',
        features: []
      },
      whyFieldsySection: {
        title: '',
        subtitle: '',
        features: []
      }
    })
  }
  return aboutPage
}

export const AboutPage = mongoose.model<IAboutPage>('AboutPage', AboutPageSchema)
