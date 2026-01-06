/**
 * Script to import fields from JSON file into the database
 *
 * Usage:
 *   npx ts-node scripts/import-fields.ts <json-file-path> [owner-email]
 *
 * Examples:
 *   npx ts-node scripts/import-fields.ts ./json_fields_data.json
 *   npx ts-node scripts/import-fields.ts ./json_fields_data.json admin@fieldsy.com
 *
 * The script will:
 * 1. Read the JSON file containing field data
 * 2. Create/find an owner account for the imported fields
 * 3. Parse and transform the data to match the Field schema
 * 4. Import the fields into the database
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Interface for the incoming JSON data
interface ImportedField {
  field_name: string;
  location: string;
  price: string | null;
  description: string;
  features: string[];
  contact_or_booking_link?: string;
  images: string[];
  source_url?: string;
}

// Helper function to parse price from string like "From £6.50 for 30min"
function parsePrice(priceStr: string | null): { price30min: number | null; price1hr: number | null } {
  const result = { price30min: null as number | null, price1hr: null as number | null };

  if (!priceStr) {
    // Default prices if not provided
    result.price30min = 8;
    result.price1hr = 15;
    return result;
  }

  // Extract numeric value - handle various formats
  const priceMatch = priceStr.match(/[£$€]?([\d.]+)/);
  if (!priceMatch) {
    result.price30min = 8;
    result.price1hr = 15;
    return result;
  }

  const price = parseFloat(priceMatch[1]);

  // Check if it's for 30min or 1hr
  if (priceStr.toLowerCase().includes('30min') || priceStr.toLowerCase().includes('30 min')) {
    result.price30min = price;
    result.price1hr = price * 2; // Estimate 1hr price
  } else if (priceStr.toLowerCase().includes('1hr') || priceStr.toLowerCase().includes('1 hour') || priceStr.toLowerCase().includes('hour')) {
    result.price1hr = price;
    result.price30min = price / 2; // Estimate 30min price
  } else {
    // Default to 1hr pricing
    result.price1hr = price;
    result.price30min = price / 2;
  }

  return result;
}

// Helper function to parse location string into structured location object
function parseLocation(locationStr: string): {
  location: any;
  address: string;
  city: string;
  state: string;
  zipCode: string;
} {
  // Try to extract postcode (UK format: e.g., NN6 9NQ)
  const postcodeMatch = locationStr.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})/i);
  const postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : '';

  // Remove postcode from location to get address parts
  let addressParts = locationStr.replace(postcodeMatch ? postcodeMatch[0] : '', '').trim();

  // Split by comma
  const parts = addressParts.split(',').map(p => p.trim()).filter(p => p);

  // Try to identify city (usually last part before postcode)
  const city = parts.length > 1 ? parts[parts.length - 1] : parts[0] || 'Unknown';
  const streetAddress = parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0] || locationStr;

  return {
    location: {
      streetAddress,
      city,
      county: '', // Not available in source data
      postalCode: postcode,
      country: 'United Kingdom',
      lat: null, // Would need geocoding
      lng: null,
      formatted_address: locationStr
    },
    address: streetAddress,
    city,
    state: '', // County not available
    zipCode: postcode
  };
}

// Helper function to parse features into structured data
function parseFeatures(features: string[]): {
  size: string | null;
  fenceSize: string | null;
  fenceType: string | null;
  terrainType: string | null;
  surfaceType: string | null;
  maxDogs: number;
  amenities: string[];
  fieldFeatures: any;
} {
  const result = {
    size: null as string | null,
    fenceSize: null as string | null,
    fenceType: null as string | null,
    terrainType: null as string | null,
    surfaceType: null as string | null,
    maxDogs: 10,
    amenities: [] as string[],
    fieldFeatures: {} as any
  };

  const amenities: string[] = [];
  const otherFeatures: string[] = [];

  for (const feature of features) {
    const lowerFeature = feature.toLowerCase();

    // Parse size - handle formats like "1 - 2 Acres", "2 to 4 acres"
    if (lowerFeature.includes('acre')) {
      if (lowerFeature.includes('under 1') || lowerFeature.includes('less than 1') || lowerFeature.includes('half')) {
        result.size = 'small';
      } else if (lowerFeature.includes('1 -') || lowerFeature.includes('1-2') || lowerFeature.includes('1 to 2')) {
        result.size = 'small';
      } else if (lowerFeature.includes('2 -') || lowerFeature.includes('2-3') || lowerFeature.includes('2 to') || lowerFeature.includes('3 acre')) {
        result.size = 'medium';
      } else if (lowerFeature.includes('4') || lowerFeature.includes('5')) {
        result.size = 'large';
      } else if (lowerFeature.includes('6') || lowerFeature.includes('7') || lowerFeature.includes('8') || lowerFeature.includes('10')) {
        result.size = 'extra-large';
      }
    }

    // Parse fence size - handle "6 Feet Plus Fence Height", "4 feet or just under fence height"
    if (lowerFeature.includes('fence height') || lowerFeature.includes('feet fence') || lowerFeature.includes('ft fence')) {
      if (lowerFeature.includes('6 feet plus') || lowerFeature.includes('6ft+') || lowerFeature.includes('7') || lowerFeature.includes('8')) {
        result.fenceSize = '6ft+';
      } else if (lowerFeature.includes('6 feet') || lowerFeature.includes('6ft') || lowerFeature.includes('1.8m')) {
        result.fenceSize = '6ft';
      } else if (lowerFeature.includes('5 feet') || lowerFeature.includes('5ft') || lowerFeature.includes('1.5m')) {
        result.fenceSize = '5ft';
      } else if (lowerFeature.includes('4 feet') || lowerFeature.includes('4ft') || lowerFeature.includes('1.2m')) {
        result.fenceSize = '4ft';
      }
    }

    // Parse fence type
    if (lowerFeature.includes('deer fencing')) {
      result.fenceType = 'mesh';
    } else if (lowerFeature.includes('stock fencing')) {
      result.fenceType = 'mesh';
    } else if (lowerFeature.includes('wooden') || lowerFeature.includes('wood fence')) {
      result.fenceType = 'wooden';
    } else if (lowerFeature.includes('metal') || lowerFeature.includes('chain link')) {
      result.fenceType = 'metal';
    }

    // Parse terrain/surface type
    if (lowerFeature === 'meadow' || lowerFeature.includes('meadow')) {
      result.terrainType = 'grass';
      result.surfaceType = 'meadow';
    } else if (lowerFeature === 'paddock' || lowerFeature.includes('paddock')) {
      result.terrainType = 'grass';
      result.surfaceType = 'grass';
    } else if (lowerFeature === 'open field' || lowerFeature.includes('open field')) {
      result.terrainType = 'grass';
    } else if (lowerFeature.includes('woodland') || lowerFeature.includes('forest')) {
      result.terrainType = 'mixed';
      result.surfaceType = 'forest-floor';
    } else if (lowerFeature.includes('sand')) {
      result.surfaceType = 'sand';
    }

    // Parse max dogs
    if (lowerFeature.includes('max dogs:')) {
      const dogsMatch = feature.match(/max dogs:\s*(\d+)/i);
      if (dogsMatch) {
        result.maxDogs = parseInt(dogsMatch[1], 10);
      }
    }

    // Map to amenities
    if (lowerFeature.includes('water supply') || lowerFeature.includes('fresh water') || lowerFeature === 'water') {
      amenities.push('Water bowls');
    }
    if (lowerFeature.includes('parking') || lowerFeature.includes('cars')) {
      amenities.push('Parking');
    }
    if (lowerFeature.includes('seating') || lowerFeature.includes('bench')) {
      amenities.push('Seating');
    }
    if (lowerFeature.includes('shelter')) {
      amenities.push('Shelter');
    }
    if (lowerFeature.includes('obstacle') || lowerFeature.includes('agility')) {
      amenities.push('Agility equipment');
    }
    if (lowerFeature.includes('shade') || lowerFeature.includes('trees')) {
      amenities.push('Shade areas');
    }
    if (lowerFeature.includes('bin') || lowerFeature.includes('waste') || lowerFeature.includes('poo')) {
      amenities.push('Waste bins');
    }
    if (lowerFeature.includes('toilet')) {
      amenities.push('Toilets');
    }
    if (lowerFeature.includes('flood lit') || lowerFeature.includes('lighting') || lowerFeature.includes('lights')) {
      amenities.push('Lighting');
    }
    if (lowerFeature.includes('reactive') || lowerFeature.includes('exempt dogs')) {
      amenities.push('Reactive dog friendly');
    }
    if (lowerFeature.includes('child friendly') || lowerFeature.includes('children')) {
      amenities.push('Child friendly');
    }
    if (lowerFeature.includes('airlock')) {
      amenities.push('Double gate airlock');
    }
    if (lowerFeature.includes('dog walker') || lowerFeature.includes('dog walkers')) {
      amenities.push('Dog walkers welcome');
    }

    // Store all features for reference
    otherFeatures.push(feature);
  }

  result.amenities = [...new Set(amenities)]; // Remove duplicates
  result.fieldFeatures = {
    originalFeatures: features,
    parsedFeatures: otherFeatures
  };

  return result;
}

// Main import function
async function importFields(jsonFilePath: string, ownerEmail?: string) {
  console.log('Starting field import...');
  console.log(`JSON file: ${jsonFilePath}`);

  // Read and parse JSON file
  const absolutePath = path.resolve(jsonFilePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const jsonData = fs.readFileSync(absolutePath, 'utf-8');
  let fields: ImportedField[];

  try {
    fields = JSON.parse(jsonData);
    if (!Array.isArray(fields)) {
      fields = [fields]; // Handle single object
    }
  } catch (error) {
    console.error('Failed to parse JSON file:', error);
    process.exit(1);
  }

  console.log(`Found ${fields.length} fields to import`);

  // Find or create owner account for imported fields
  let owner = await prisma.user.findFirst({
    where: ownerEmail
      ? { email: ownerEmail }
      : { email: 'imported-fields@fieldsy.com' }
  });

  if (!owner) {
    console.log('Creating system owner account for imported fields...');
    owner = await prisma.user.create({
      data: {
        email: ownerEmail || 'imported-fields@fieldsy.com',
        name: 'Imported Fields',
        role: 'FIELD_OWNER',
        emailVerified: new Date(),
        password: 'IMPORTED_NO_LOGIN', // Cannot login with this
      }
    });
    console.log(`Created owner account: ${owner.email} (ID: ${owner.id})`);
  } else {
    console.log(`Using existing owner: ${owner.email} (ID: ${owner.id})`);
  }

  // Track import statistics
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  // Import each field
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const index = i + 1;

    try {
      // Check if field already exists by name and location
      const existingField = await prisma.field.findFirst({
        where: {
          name: field.field_name,
          ownerId: owner.id
        }
      });

      if (existingField) {
        console.log(`[${index}/${fields.length}] Skipping existing field: ${field.field_name}`);
        skipped++;
        continue;
      }

      // Parse the data
      const { price30min, price1hr } = parsePrice(field.price);
      const locationData = parseLocation(field.location);
      const featuresData = parseFeatures(field.features || []);

      // Clean up field name (remove "REVIEW:" prefix if present)
      let fieldName = field.field_name;
      if (fieldName.startsWith('REVIEW:')) {
        fieldName = fieldName.replace('REVIEW:', '').trim();
      }

      // Filter out placeholder images
      const validImages = (field.images || []).filter(img =>
        img && !img.includes('dwfs-small-logo') && !img.includes('placeholder')
      );

      // Create the field
      const createdField = await prisma.field.create({
        data: {
          name: fieldName,
          description: field.description || '',

          // Location data
          location: locationData.location,
          address: locationData.address,
          city: locationData.city,
          state: locationData.state,
          zipCode: locationData.zipCode,

          // Pricing
          price30min: price30min,
          price1hr: price1hr,
          price: price1hr || price30min, // Legacy field
          bookingDuration: '60min', // Default

          // Features - use parsed values with fallbacks
          size: featuresData.size || 'medium',
          fenceSize: featuresData.fenceSize || '6ft',
          fenceType: featuresData.fenceType || 'mesh',
          terrainType: featuresData.terrainType || 'grass',
          surfaceType: featuresData.surfaceType || 'grass',
          maxDogs: featuresData.maxDogs,
          amenities: featuresData.amenities,
          fieldFeatures: {
            ...featuresData.fieldFeatures,
            sourceUrl: field.source_url,
            bookingLink: field.contact_or_booking_link
          },

          // Images
          images: validImages,

          // Default values
          rules: [],
          operatingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          openingTime: '07:00',
          closingTime: '20:00',

          // Status - mark as active but needs approval
          isActive: true,
          fieldDetailsCompleted: true,
          uploadImagesCompleted: validImages.length > 0,
          pricingAvailabilityCompleted: true,
          bookingRulesCompleted: true,
          isSubmitted: true,
          submittedAt: new Date(),
          isApproved: false, // Admin needs to review
          isClaimed: false, // Not claimed yet

          // Owner
          ownerId: owner.id,
          ownerName: owner.name || 'Imported Fields',
          joinedOn: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),

          // Review stats
          averageRating: 0,
          totalReviews: 0,
        }
      });

      console.log(`[${index}/${fields.length}] Imported: ${fieldName} (ID: ${createdField.id})`);
      imported++;

    } catch (error) {
      console.error(`[${index}/${fields.length}] Error importing "${field.field_name}":`, error);
      errors++;
    }
  }

  // Print summary
  console.log('\n========================================');
  console.log('Import Summary:');
  console.log(`  Total fields in file: ${fields.length}`);
  console.log(`  Successfully imported: ${imported}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log('========================================\n');

  // Note about approval
  if (imported > 0) {
    console.log('NOTE: Imported fields are set to isApproved=false.');
    console.log('An admin needs to review and approve them before they appear in listings.');
    console.log('To bulk approve, run: npx ts-node scripts/approve-imported-fields.ts');
  }
}

// Run the script
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: npx ts-node scripts/import-fields.ts <json-file-path> [owner-email]');
  console.log('Example: npx ts-node scripts/import-fields.ts ./data/fields.json admin@fieldsy.com');
  process.exit(1);
}

const jsonFilePath = args[0];
const ownerEmail = args[1];

importFields(jsonFilePath, ownerEmail)
  .then(() => {
    console.log('Import completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
