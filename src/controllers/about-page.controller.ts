//@ts-nocheck
import { Request, Response } from 'express'
import prisma from '../config/database'

export const getAboutPage = async (req: Request, res: Response) => {
  try {
    // Get the first (and should be only) about page record
    let aboutPage = await prisma.aboutPage.findFirst()
    
    // If no about page exists, create one with default values
    if (!aboutPage) {
      aboutPage = await prisma.aboutPage.create({
        data: {
          heroSectionTitle: 'About Us',
          heroMainTitle: 'Safe, Private Fields Where Every Dog Can Run Free',
          heroDescription: 'Fieldsy is the UK\'s marketplace for private dog walking fields. We connect dog owners who need secure, enclosed spaces with landowners who have the land to offer. Whether your dog is reactive, in training, or simply loves to sprint -- Fieldsy makes it easy to find, book, and enjoy a peaceful off-lead session near you.',
          heroButtonText: 'Download the App',
          heroImage: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
          heroStats: [
            { value: '500+', label: 'Dog Owners Signed Up', order: 1 },
            { value: '200+', label: 'Private Fields Listed', order: 2 },
            { value: '50+', label: 'Towns & Cities Across the UK', order: 3 },
            { value: '100%', label: 'Secure, Fenced Spaces', order: 4 }
          ]
        }
      })
    }
    
    // Transform the flat structure to nested structure for frontend compatibility
    const transformedData = {
      heroSection: {
        sectionTitle: aboutPage.heroSectionTitle || '',
        mainTitle: aboutPage.heroMainTitle || '',
        subtitle: aboutPage.heroSubtitle || '',
        description: aboutPage.heroDescription || '',
        buttonText: aboutPage.heroButtonText || '',
        image: aboutPage.heroImage || '',
        stats: aboutPage.heroStats || []
      },
      missionSection: {
        title: aboutPage.missionTitle || '',
        description: aboutPage.missionDescription || '',
        buttonText: aboutPage.missionButtonText || '',
        image: aboutPage.missionImage || ''
      },
      whoWeAreSection: {
        title: aboutPage.whoWeAreTitle || '',
        description: aboutPage.whoWeAreDescription || '',
        mainImage: aboutPage.whoWeAreMainImage || '',
        rightCardImage: aboutPage.whoWeAreRightCardImage || '',
        rightCardTitle: aboutPage.whoWeAreRightCardTitle || '',
        rightCardDescription: aboutPage.whoWeAreRightCardDescription || '',
        features: aboutPage.whoWeAreFeatures || []
      },
      whatWeDoSection: {
        title: aboutPage.whatWeDoTitle || '',
        subtitle: aboutPage.whatWeDoSubtitle || '',
        description: aboutPage.whatWeDoDescription || '',
        image: aboutPage.whatWeDoImage || '',
        features: aboutPage.whatWeDoFeatures || []
      },
      whyFieldsySection: {
        title: aboutPage.whyFieldsyTitle || '',
        subtitle: aboutPage.whyFieldsySubtitle || '',
        image: aboutPage.whyFieldsyImage || '',
        boxTitle: aboutPage.whyFieldsyBoxTitle || '',
        boxDescription: aboutPage.whyFieldsyBoxDescription || '',
        buttonText: aboutPage.whyFieldsyButtonText || '',
        features: aboutPage.whyFieldsyFeatures || []
      },
      _id: aboutPage.id,
      createdAt: aboutPage.createdAt,
      updatedAt: aboutPage.updatedAt
    }
    
    res.status(200).json({
      success: true,
      data: transformedData
    })
  } catch (error: any) {
    console.error('Error fetching about page:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch about page content',
      error: error.message
    })
  }
}

export const updateAboutPage = async (req: Request, res: Response) => {
  try {
    const updates = req.body
    
    // Transform nested structure to flat structure for database
    const dbUpdates: any = {}
    
    if (updates.heroSection) {
      if (updates.heroSection.sectionTitle !== undefined) dbUpdates.heroSectionTitle = updates.heroSection.sectionTitle
      if (updates.heroSection.mainTitle !== undefined) dbUpdates.heroMainTitle = updates.heroSection.mainTitle
      if (updates.heroSection.subtitle !== undefined) dbUpdates.heroSubtitle = updates.heroSection.subtitle
      if (updates.heroSection.description !== undefined) dbUpdates.heroDescription = updates.heroSection.description
      if (updates.heroSection.buttonText !== undefined) dbUpdates.heroButtonText = updates.heroSection.buttonText
      if (updates.heroSection.image !== undefined) dbUpdates.heroImage = updates.heroSection.image
      if (updates.heroSection.stats !== undefined) dbUpdates.heroStats = updates.heroSection.stats
    }
    
    if (updates.missionSection) {
      if (updates.missionSection.title !== undefined) dbUpdates.missionTitle = updates.missionSection.title
      if (updates.missionSection.description !== undefined) dbUpdates.missionDescription = updates.missionSection.description
      if (updates.missionSection.buttonText !== undefined) dbUpdates.missionButtonText = updates.missionSection.buttonText
      if (updates.missionSection.image !== undefined) dbUpdates.missionImage = updates.missionSection.image
    }
    
    if (updates.whoWeAreSection) {
      if (updates.whoWeAreSection.title !== undefined) dbUpdates.whoWeAreTitle = updates.whoWeAreSection.title
      if (updates.whoWeAreSection.description !== undefined) dbUpdates.whoWeAreDescription = updates.whoWeAreSection.description
      if (updates.whoWeAreSection.features !== undefined) dbUpdates.whoWeAreFeatures = updates.whoWeAreSection.features
    }
    
    if (updates.whatWeDoSection) {
      if (updates.whatWeDoSection.title !== undefined) dbUpdates.whatWeDoTitle = updates.whatWeDoSection.title
      if (updates.whatWeDoSection.subtitle !== undefined) dbUpdates.whatWeDoSubtitle = updates.whatWeDoSection.subtitle
      if (updates.whatWeDoSection.description !== undefined) dbUpdates.whatWeDoDescription = updates.whatWeDoSection.description
      if (updates.whatWeDoSection.image !== undefined) dbUpdates.whatWeDoImage = updates.whatWeDoSection.image
      if (updates.whatWeDoSection.features !== undefined) dbUpdates.whatWeDoFeatures = updates.whatWeDoSection.features
    }
    
    if (updates.whyFieldsySection) {
      if (updates.whyFieldsySection.title !== undefined) dbUpdates.whyFieldsyTitle = updates.whyFieldsySection.title
      if (updates.whyFieldsySection.subtitle !== undefined) dbUpdates.whyFieldsySubtitle = updates.whyFieldsySection.subtitle
      if (updates.whyFieldsySection.features !== undefined) dbUpdates.whyFieldsyFeatures = updates.whyFieldsySection.features
    }
    
    // Get existing about page or create new one
    let aboutPage = await prisma.aboutPage.findFirst()
    
    if (!aboutPage) {
      aboutPage = await prisma.aboutPage.create({ data: dbUpdates })
    } else {
      aboutPage = await prisma.aboutPage.update({
        where: { id: aboutPage.id },
        data: dbUpdates
      })
    }
    
    res.status(200).json({
      success: true,
      message: 'About page updated successfully',
      data: aboutPage
    })
  } catch (error: any) {
    console.error('Error updating about page:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update about page content',
      error: error.message
    })
  }
}

// Update specific section
export const updateAboutSection = async (req: Request, res: Response) => {
  try {
    const { section } = req.params
    const updates = req.body
    
    const validSections = ['heroSection', 'missionSection', 'whoWeAreSection', 'whatWeDoSection', 'whyFieldsySection']
    
    if (!validSections.includes(section)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid section name'
      })
    }
    
    // Get existing about page or create new one
    let aboutPage = await prisma.aboutPage.findFirst()
    
    const updateData: any = {}
    
    // Build the update data based on section
    switch (section) {
      case 'heroSection':
        updateData.heroSectionTitle = updates.sectionTitle
        updateData.heroMainTitle = updates.mainTitle
        updateData.heroSubtitle = updates.subtitle
        updateData.heroDescription = updates.description
        updateData.heroButtonText = updates.buttonText
        updateData.heroImage = updates.image
        updateData.heroStats = updates.stats
        break
      
      case 'missionSection':
        updateData.missionTitle = updates.title
        updateData.missionDescription = updates.description
        updateData.missionButtonText = updates.buttonText
        updateData.missionImage = updates.image
        break
      
      case 'whoWeAreSection':
        updateData.whoWeAreTitle = updates.title
        updateData.whoWeAreDescription = updates.description
        updateData.whoWeAreMainImage = updates.mainImage
        updateData.whoWeAreRightCardImage = updates.rightCardImage
        updateData.whoWeAreRightCardTitle = updates.rightCardTitle
        updateData.whoWeAreRightCardDescription = updates.rightCardDescription
        updateData.whoWeAreFeatures = updates.features
        break
      
      case 'whatWeDoSection':
        updateData.whatWeDoTitle = updates.title
        updateData.whatWeDoSubtitle = updates.subtitle
        updateData.whatWeDoDescription = updates.description
        updateData.whatWeDoImage = updates.image
        updateData.whatWeDoFeatures = updates.features
        break
      
      case 'whyFieldsySection':
        updateData.whyFieldsyTitle = updates.title
        updateData.whyFieldsySubtitle = updates.subtitle
        updateData.whyFieldsyImage = updates.image
        updateData.whyFieldsyBoxTitle = updates.boxTitle
        updateData.whyFieldsyBoxDescription = updates.boxDescription
        updateData.whyFieldsyButtonText = updates.buttonText
        updateData.whyFieldsyFeatures = updates.features
        break
    }
    
    if (!aboutPage) {
      aboutPage = await prisma.aboutPage.create({ data: updateData })
    } else {
      aboutPage = await prisma.aboutPage.update({
        where: { id: aboutPage.id },
        data: updateData
      })
    }
    
    res.status(200).json({
      success: true,
      message: `${section} updated successfully`,
      data: aboutPage
    })
  } catch (error: any) {
    console.error('Error updating about section:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update about section',
      error: error.message
    })
  }
}
