/**
 * Replace Fields Without Images
 *
 * This script:
 * 1. Finds all fields in DB that have no images
 * 2. Deletes them
 * 3. Re-imports from scraped data if we have a version with images
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const SCRAPED_FILE = path.join(__dirname, 'scraped-fields.json');

// Helper to clean field name (remove "REVIEW: " prefix and location suffix)
function cleanFieldName(name) {
  if (!name) return 'Unnamed Field';
  let cleaned = name.replace(/^REVIEW:\s*/i, '');
  const parts = cleaned.split(',');
  if (parts.length > 1) {
    cleaned = parts.slice(0, -1).join(',').trim();
  }
  return cleaned || 'Unnamed Field';
}

// Helper to extract location details from scraped data
function extractLocation(scrapedField) {
  const location = {
    streetAddress: '',
    city: '',
    county: '',
    postalCode: '',
    country: 'United Kingdom',
    lat: null,
    lng: null,
    formatted_address: ''
  };

  if (scrapedField.location) {
    const locText = scrapedField.location.replace(/Address\s*/i, '').trim();
    const postcodeMatch = locText.match(/([A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2})/i);
    if (postcodeMatch) {
      location.postalCode = postcodeMatch[1].toUpperCase();
    }
    location.formatted_address = locText;
  }

  if (scrapedField.description) {
    const coordMatch = scrapedField.description.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (coordMatch) {
      location.lat = parseFloat(coordMatch[1]);
      location.lng = parseFloat(coordMatch[2]);
    }
  }

  const name = scrapedField.name || '';
  const nameParts = name.split(',');
  if (nameParts.length > 1) {
    location.city = nameParts[nameParts.length - 1].trim();
  }

  return location;
}

// Helper to extract price from pricing string
function extractPrice(pricing) {
  if (!pricing) return null;
  const priceMatch = pricing.match(/£(\d+(?:\.\d{2})?)/);
  if (priceMatch) {
    return parseFloat(priceMatch[1]);
  }
  return null;
}

// Helper to filter valid images
function filterValidImages(images) {
  if (!images || !Array.isArray(images)) return [];

  return images.filter(img => {
    if (!img) return false;
    const lowerImg = img.toLowerCase();
    if (lowerImg.includes('map.png')) return false;
    if (lowerImg.includes('search.png')) return false;
    if (lowerImg.includes('checklist')) return false;
    if (lowerImg.includes('logo')) return false;
    if (lowerImg.includes('icon')) return false;
    if (lowerImg.includes('avatar')) return false;
    if (lowerImg.includes('gravatar')) return false;
    if (lowerImg.includes('placeholder')) return false;
    if (!lowerImg.startsWith('http')) return false;
    return true;
  });
}

// Helper to clean description
function cleanDescription(description) {
  if (!description) return '';
  let cleaned = description.replace(/-?\d+\.\d+,\s*-?\d+\.\d+/g, '').trim();
  const lines = cleaned.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i.test(trimmed)) return false;
    if (trimmed.length < 10) return false;
    return true;
  });
  return lines.join('\n\n').trim();
}

// Helper to extract field size
function extractFieldSize(sizeText) {
  if (!sizeText) return 'Medium';
  const lowerSize = sizeText.toLowerCase();
  const acresMatch = lowerSize.match(/(\d+(?:\.\d+)?)\s*acres?/);
  if (acresMatch) {
    const acres = parseFloat(acresMatch[1]);
    if (acres <= 1) return 'Small';
    if (acres <= 2) return 'Medium';
    if (acres <= 5) return 'Large';
    return 'Extra Large';
  }
  return 'Medium';
}

async function getOrCreateSystemUser() {
  const systemEmail = 'imported@fieldsy.com';
  let systemUser = await prisma.user.findFirst({
    where: { email: systemEmail, role: 'FIELD_OWNER' }
  });

  if (!systemUser) {
    console.log('Creating system user for imported fields...');
    systemUser = await prisma.user.create({
      data: {
        email: systemEmail,
        name: 'British Dog Fields Import',
        role: 'FIELD_OWNER',
        provider: 'general',
        hasField: true
      }
    });
  }
  return systemUser;
}

async function run() {
  console.log('=== Replace Fields Without Images ===\n');

  // Step 1: Find all fields without images
  const fieldsWithoutImages = await prisma.field.findMany({
    where: {
      OR: [
        { images: { isEmpty: true } },
        { images: { equals: [] } }
      ]
    },
    select: { id: true, name: true }
  });

  console.log(`Found ${fieldsWithoutImages.length} fields without images\n`);

  if (fieldsWithoutImages.length === 0) {
    console.log('No fields without images to process.');
    await prisma.$disconnect();
    return;
  }

  // Step 2: Load scraped data
  const scrapedData = JSON.parse(fs.readFileSync(SCRAPED_FILE, 'utf-8'));
  console.log(`Loaded ${scrapedData.length} scraped fields\n`);

  // Create a map of scraped fields by cleaned name (lowercase)
  const scrapedMap = new Map();
  for (const scraped of scrapedData) {
    const cleanedName = cleanFieldName(scraped.name).toLowerCase();
    const validImages = filterValidImages(scraped.images);

    // Only add if it has images
    if (validImages.length > 0) {
      // If we already have this name, keep the one with more images
      if (!scrapedMap.has(cleanedName) || validImages.length > filterValidImages(scrapedMap.get(cleanedName).images).length) {
        scrapedMap.set(cleanedName, scraped);
      }
    }
  }

  console.log(`Scraped fields with images: ${scrapedMap.size}\n`);

  // Step 3: Get system user
  const systemUser = await getOrCreateSystemUser();

  // Step 4: Process each field without images
  const stats = {
    deleted: 0,
    replaced: 0,
    notFound: 0,
    errors: 0
  };

  for (const field of fieldsWithoutImages) {
    const fieldNameLower = field.name?.toLowerCase() || '';

    // Check if we have a scraped version with images
    const scrapedVersion = scrapedMap.get(fieldNameLower);

    if (scrapedVersion) {
      const validImages = filterValidImages(scrapedVersion.images);

      try {
        // Delete the old field
        await prisma.field.delete({ where: { id: field.id } });

        // Create new field with images
        const location = extractLocation(scrapedVersion);
        const cleanedDescription = cleanDescription(scrapedVersion.description);
        const fieldSize = extractFieldSize(scrapedVersion.size);
        const price = extractPrice(scrapedVersion.pricing);

        await prisma.field.create({
          data: {
            name: cleanFieldName(scrapedVersion.name),
            description: cleanedDescription || `Dog walking field. Visit for a safe, enclosed space for your dogs.`,
            location: location,
            address: location.formatted_address || null,
            city: location.city || null,
            zipCode: location.postalCode || null,
            latitude: location.lat,
            longitude: location.lng,
            ownerId: systemUser.id,
            ownerName: 'British Dog Fields',
            type: 'PRIVATE',
            size: fieldSize,
            terrainType: 'Grass',
            fenceType: 'Mesh',
            fenceSize: '6ft',
            surfaceType: 'Grass',
            price: price || 15,
            price30min: price || 15,
            price1hr: price ? price * 1.5 : 25,
            bookingDuration: '1hour',
            images: validImages,
            maxDogs: 4,
            openingTime: '07:00',
            closingTime: '21:00',
            operatingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            instantBooking: false,
            amenities: ['Water bowls', 'Secure fencing', 'Parking'],
            rules: ['Dogs must be under control', 'Clean up after your dog', 'No aggressive dogs'],
            isActive: true,
            isClaimed: false,
            isSubmitted: true,
            isApproved: true,
            fieldDetailsCompleted: true,
            uploadImagesCompleted: true,
            pricingAvailabilityCompleted: true,
            bookingRulesCompleted: true,
            averageRating: 4.5,
            totalReviews: 0
          }
        });

        console.log(`✅ Replaced: ${field.name} (${validImages.length} images)`);
        stats.replaced++;
      } catch (error) {
        console.error(`❌ Error replacing ${field.name}:`, error.message);
        stats.errors++;
      }
    } else {
      // No scraped version with images found - just delete the empty one
      try {
        await prisma.field.delete({ where: { id: field.id } });
        console.log(`🗑️  Deleted (no replacement): ${field.name}`);
        stats.deleted++;
      } catch (error) {
        console.error(`❌ Error deleting ${field.name}:`, error.message);
        stats.errors++;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Replaced with images: ${stats.replaced}`);
  console.log(`Deleted (no replacement): ${stats.deleted}`);
  console.log(`Errors: ${stats.errors}`);

  await prisma.$disconnect();
}

run().catch(console.error);
