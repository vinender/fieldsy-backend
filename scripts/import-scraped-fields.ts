/**
 * Utility script to parse scraped dog field JSON data and upload to MongoDB using Prisma
 *
 * Usage:
 *   npx ts-node scripts/import-scraped-fields.ts <json-file-path> [--dry-run] [--owner-id <id>]
 *
 * Options:
 *   --dry-run     Preview what would be imported without actually saving to database
 *   --owner-id    Specify a field owner ID to assign all fields to (required if no system owner exists)
 *   --skip-existing  Skip fields that already exist (matched by name + postcode)
 *
 * Example:
 *   npx ts-node scripts/import-scraped-fields.ts ./data/scraped-fields.json --dry-run
 *   npx ts-node scripts/import-scraped-fields.ts ./data/scraped-fields.json --owner-id 507f1f77bcf86cd799439011
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Type definitions for scraped data
interface ScrapedField {
  name: string;
  url?: string;
  address?: string;
  postcode?: string;
  county?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  what3words?: string;
  area_types?: string[];
  size?: string;
  customers_welcome?: string[];
  exempt_dogs?: string;
  image_alt?: string;
  page?: number;
  page_num?: number;
  tags?: string[];
  images?: string[];
}

interface ScrapedData {
  metadata: {
    source: string;
    total_pages: number;
    pages_scraped: number[];
    scraped_at: string;
    status: string;
    last_updated: string;
    total_fields: number;
  };
  fields: ScrapedField[];
}

// Map scraped size to our size format
function mapSize(scrapedSize?: string): string | undefined {
  if (!scrapedSize) return undefined;

  const sizeLower = scrapedSize.toLowerCase();

  if (sizeLower.includes('less than 1') || sizeLower.includes('< 1') || sizeLower.includes('under 1')) {
    return 'Small (1 acre or less)';
  }
  if (sizeLower.includes('1 – 2') || sizeLower.includes('1-2') || sizeLower.includes('1 to 2')) {
    return 'Medium (1-2 acres)';
  }
  if (sizeLower.includes('2 – 4') || sizeLower.includes('2-4') || sizeLower.includes('2 to 4')) {
    return 'Large (2-4 acres)';
  }
  if (sizeLower.includes('4+') || sizeLower.includes('over 4') || sizeLower.includes('more than 4')) {
    return 'Extra Large (4+ acres)';
  }

  // Return original if no match
  return scrapedSize;
}

// Map area types to amenities/terrain
function mapAreaTypesToAmenities(areaTypes?: string[]): { amenities: string[], terrainType?: string } {
  if (!areaTypes || areaTypes.length === 0) {
    return { amenities: [] };
  }

  const amenities: string[] = [];
  let terrainType: string | undefined;

  for (const type of areaTypes) {
    const typeLower = type.toLowerCase();

    // Map to terrain type
    if (typeLower.includes('meadow') || typeLower.includes('field')) {
      terrainType = 'Grass';
    } else if (typeLower.includes('woodland') || typeLower.includes('forest') || typeLower.includes('trees')) {
      terrainType = terrainType || 'Mixed';
      amenities.push('Wooded areas');
    } else if (typeLower.includes('paddock')) {
      terrainType = terrainType || 'Grass';
    } else if (typeLower.includes('sand') || typeLower.includes('beach')) {
      terrainType = 'Sand';
    }

    // Map to amenities
    if (typeLower.includes('agility')) {
      amenities.push('Agility equipment');
    }
    if (typeLower.includes('water') || typeLower.includes('pond') || typeLower.includes('stream')) {
      amenities.push('Water feature');
    }
  }

  return { amenities, terrainType };
}

// Map customer types to field type
function mapCustomersToFieldType(customers?: string[]): 'PRIVATE' | 'PUBLIC' | 'TRAINING' {
  if (!customers || customers.length === 0) {
    return 'PRIVATE';
  }

  const customersLower = customers.map(c => c.toLowerCase());

  if (customersLower.some(c => c.includes('trainer') || c.includes('training'))) {
    return 'TRAINING';
  }

  // Default to PRIVATE for secure dog walking fields
  return 'PRIVATE';
}

// Parse country to state format
function parseCountryToState(county?: string, country?: string): string | undefined {
  if (county) return county;
  if (country) return country;
  return undefined;
}

// Extract city from address
function extractCity(address?: string): string | undefined {
  if (!address) return undefined;

  // Try to extract the last part before postcode as city
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }

  return undefined;
}

// Generate default operating hours
function getDefaultOperatingHours(): { openingTime: string, closingTime: string, operatingDays: string[] } {
  return {
    openingTime: '07:00',
    closingTime: '20:00',
    operatingDays: ['everyday']
  };
}

// Convert scraped field to Prisma field format
function convertToFieldData(scraped: ScrapedField, ownerId: string) {
  const { amenities, terrainType } = mapAreaTypesToAmenities(scraped.area_types);
  const { openingTime, closingTime, operatingDays } = getDefaultOperatingHours();

  // Build location JSON object
  const location = {
    streetAddress: scraped.address || '',
    city: extractCity(scraped.address) || '',
    county: scraped.county || '',
    postalCode: scraped.postcode || '',
    country: scraped.country || 'England',
    formatted_address: [
      scraped.address,
      scraped.county,
      scraped.postcode,
      scraped.country
    ].filter(Boolean).join(', ')
  };

  // Build field features JSON
  const fieldFeatures: Record<string, any> = {};

  if (scraped.website) fieldFeatures.website = scraped.website;
  if (scraped.facebook) fieldFeatures.facebook = scraped.facebook;
  if (scraped.instagram) fieldFeatures.instagram = scraped.instagram;
  if (scraped.what3words) fieldFeatures.what3words = scraped.what3words;
  if (scraped.url) fieldFeatures.sourceUrl = scraped.url;
  if (scraped.exempt_dogs) fieldFeatures.exemptDogs = scraped.exempt_dogs;
  if (scraped.customers_welcome) fieldFeatures.customersWelcome = scraped.customers_welcome;
  if (scraped.tags) fieldFeatures.tags = scraped.tags;

  // Build description from available data
  const descriptionParts: string[] = [];
  if (scraped.area_types && scraped.area_types.length > 0) {
    descriptionParts.push(`Area types: ${scraped.area_types.join(', ')}`);
  }
  if (scraped.size) {
    descriptionParts.push(`Size: ${scraped.size}`);
  }
  if (scraped.customers_welcome && scraped.customers_welcome.length > 0) {
    descriptionParts.push(`Welcome: ${scraped.customers_welcome.join(', ')}`);
  }
  if (scraped.exempt_dogs) {
    descriptionParts.push(scraped.exempt_dogs);
  }

  return {
    name: scraped.name || 'Unnamed Field',
    description: descriptionParts.join('. ') || undefined,

    // Location fields (legacy)
    address: scraped.address || undefined,
    city: extractCity(scraped.address) || undefined,
    state: parseCountryToState(scraped.county, scraped.country),
    zipCode: scraped.postcode || undefined,

    // Location JSON object
    location,

    // Owner
    ownerId,

    // Field properties
    type: mapCustomersToFieldType(scraped.customers_welcome),
    size: mapSize(scraped.size),
    terrainType: terrainType || 'Grass',

    // Images
    images: scraped.images || [],

    // Amenities
    amenities,

    // Operating hours
    openingTime,
    closingTime,
    operatingDays,

    // Status flags - these are scraped/unclaimed fields
    isActive: true,
    isSubmitted: true,
    isApproved: true, // Auto-approve scraped fields
    isClaimed: false, // Not claimed yet

    // Step completion (mark as complete for scraped fields)
    fieldDetailsCompleted: true,
    uploadImagesCompleted: scraped.images && scraped.images.length > 0,
    pricingAvailabilityCompleted: false, // No pricing data from scrape
    bookingRulesCompleted: true,

    // Additional features
    fieldFeatures,

    // Default values
    maxDogs: 6,
    instantBooking: false,

    // Submission timestamp
    submittedAt: new Date(),
  };
}

// Main import function
async function importScrapedFields(
  jsonFilePath: string,
  options: {
    dryRun?: boolean;
    ownerId?: string;
    skipExisting?: boolean;
  } = {}
) {
  const { dryRun = false, skipExisting = true } = options;
  let { ownerId } = options;

  console.log('\n========================================');
  console.log('  Scraped Dog Fields Import Utility');
  console.log('========================================\n');

  // Read and parse JSON file
  const absolutePath = path.resolve(jsonFilePath);
  console.log(`Reading file: ${absolutePath}`);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const rawData = fs.readFileSync(absolutePath, 'utf-8');
  const data: ScrapedData = JSON.parse(rawData);

  console.log(`\nMetadata:`);
  console.log(`  Source: ${data.metadata.source}`);
  console.log(`  Total fields in file: ${data.fields.length}`);
  console.log(`  Scraped at: ${data.metadata.scraped_at}`);
  console.log(`  Last updated: ${data.metadata.last_updated}`);

  // Get or create system owner for scraped fields
  if (!ownerId) {
    // Try to find existing system owner
    let systemOwner = await prisma.user.findFirst({
      where: {
        email: 'scraped-fields@fieldsy.com',
        role: 'FIELD_OWNER'
      }
    });

    if (!systemOwner) {
      if (dryRun) {
        console.log('\n[DRY RUN] Would create system owner: scraped-fields@fieldsy.com');
        ownerId = 'dry-run-owner-id';
      } else {
        // Create system owner for scraped fields
        systemOwner = await prisma.user.create({
          data: {
            email: 'scraped-fields@fieldsy.com',
            name: 'Scraped Fields Owner',
            role: 'FIELD_OWNER',
            provider: 'general',
            hasField: true
          }
        });
        console.log(`\nCreated system owner: ${systemOwner.id}`);
        ownerId = systemOwner.id;
      }
    } else {
      ownerId = systemOwner.id;
      console.log(`\nUsing existing system owner: ${ownerId}`);
    }
  } else {
    // Verify provided owner exists
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      throw new Error(`Owner not found with ID: ${ownerId}`);
    }
    console.log(`\nUsing provided owner: ${owner.name || owner.email} (${ownerId})`);
  }

  // Process fields
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Processing ${data.fields.length} fields...\n`);

  const results = {
    total: data.fields.length,
    created: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [] as string[]
  };

  for (const scraped of data.fields) {
    try {
      // Check if field already exists (by name + postcode)
      if (skipExisting && scraped.name && scraped.postcode) {
        const existing = await prisma.field.findFirst({
          where: {
            name: scraped.name,
            zipCode: scraped.postcode
          }
        });

        if (existing) {
          console.log(`  ⏭️  Skipped (exists): ${scraped.name} - ${scraped.postcode}`);
          results.skipped++;
          continue;
        }
      }

      // Convert to field data
      const fieldData = convertToFieldData(scraped, ownerId!);

      if (dryRun) {
        console.log(`  ✓ Would create: ${fieldData.name}`);
        console.log(`      Address: ${fieldData.address || 'N/A'}`);
        console.log(`      Postcode: ${fieldData.zipCode || 'N/A'}`);
        console.log(`      Size: ${fieldData.size || 'N/A'}`);
        console.log(`      Images: ${fieldData.images.length}`);
        results.created++;
      } else {
        // Create field in database
        const field = await prisma.field.create({
          data: fieldData as any
        });
        console.log(`  ✓ Created: ${field.name} (${field.id})`);
        results.created++;
      }
    } catch (error: any) {
      console.log(`  ✗ Error: ${scraped.name} - ${error.message}`);
      results.errors++;
      results.errorDetails.push(`${scraped.name}: ${error.message}`);
    }
  }

  // Print summary
  console.log('\n========================================');
  console.log('  Import Summary');
  console.log('========================================');
  console.log(`  Total fields processed: ${results.total}`);
  console.log(`  Created: ${results.created}`);
  console.log(`  Skipped (already exist): ${results.skipped}`);
  console.log(`  Errors: ${results.errors}`);

  if (results.errorDetails.length > 0) {
    console.log('\n  Error details:');
    results.errorDetails.forEach(err => console.log(`    - ${err}`));
  }

  if (dryRun) {
    console.log('\n  [DRY RUN] No changes were made to the database.');
  }

  console.log('\n');

  return results;
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx ts-node scripts/import-scraped-fields.ts <json-file-path> [options]

Options:
  --dry-run         Preview what would be imported without saving to database
  --owner-id <id>   Specify a field owner ID to assign all fields to
  --skip-existing   Skip fields that already exist (matched by name + postcode) [default: true]
  --no-skip         Import all fields even if they already exist
  -h, --help        Show this help message

Examples:
  npx ts-node scripts/import-scraped-fields.ts ./data/scraped-fields.json --dry-run
  npx ts-node scripts/import-scraped-fields.ts ./data/scraped-fields.json --owner-id 507f1f77bcf86cd799439011
  npx ts-node scripts/import-scraped-fields.ts ./data/scraped-fields.json --no-skip
`);
    process.exit(0);
  }

  const jsonFilePath = args[0];
  const dryRun = args.includes('--dry-run');
  const skipExisting = !args.includes('--no-skip');

  let ownerId: string | undefined;
  const ownerIdIndex = args.indexOf('--owner-id');
  if (ownerIdIndex !== -1 && args[ownerIdIndex + 1]) {
    ownerId = args[ownerIdIndex + 1];
  }

  try {
    await importScrapedFields(jsonFilePath, { dryRun, ownerId, skipExisting });
  } catch (error: any) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
