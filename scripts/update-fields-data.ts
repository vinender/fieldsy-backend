/**
 * Script to update existing field data and reassign owners if emails differ.
 *
 * Usage:
 *   cd backend && npx ts-node scripts/update-fields-data.ts
 *
 * For each field:
 *  1. Find the field by name
 *  2. Check if the owner email matches
 *  3. If different, find or create a FIELD_OWNER user with the given email/phone
 *  4. Update the field data
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';

console.log('MONGODB_URI loaded:', process.env.MONGODB_URI ? 'Yes (length: ' + process.env.MONGODB_URI.length + ')' : 'NO — .env not loaded!');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.MONGODB_URI,
    },
  },
});

interface FieldUpdateData {
  name: string;
  address: string;
  phone?: string;
  email: string;
  description?: string;
  // Schema fields
  fenceSize?: string;
  size?: string;
  price30min?: number | null;
  price1hr?: number | null;
  maxDogs?: number;
  amenities?: string[];
  // fieldFeatures JSON for extra data
  fieldFeatures?: Record<string, any>;
}

// Helper: parse price string to numeric values
function parsePrice(priceStr: string): { price30min: number | null; price1hr: number | null } {
  const result = { price30min: null as number | null, price1hr: null as number | null };

  const priceMatch = priceStr.match(/[£$€]?([\d.]+)/);
  if (!priceMatch) return result;

  const price = parseFloat(priceMatch[1]);
  const lower = priceStr.toLowerCase();

  if (lower.includes('30 min') || lower.includes('30min')) {
    result.price30min = price;
    result.price1hr = Math.round(price * 2 * 100) / 100;
  } else if (lower.includes('hour') || lower.includes('1hr') || lower.includes('1 hr')) {
    result.price1hr = price;
    result.price30min = Math.round((price / 2) * 100) / 100;
  } else if (lower.includes('55 min')) {
    // Treat 55 minutes as ~1hr pricing
    result.price1hr = price;
    result.price30min = Math.round((price / 2) * 100) / 100;
  } else if (lower.includes('session')) {
    // Ambiguous - treat as 30min session
    result.price30min = price;
    result.price1hr = Math.round(price * 2 * 100) / 100;
  } else {
    // Default: assume it's the base price for 30min
    result.price30min = price;
    result.price1hr = Math.round(price * 2 * 100) / 100;
  }

  return result;
}

// Helper: parse UK address into location object
function parseAddress(addressStr: string): {
  location: any;
  address: string;
  city: string;
  state: string;
  zipCode: string;
} {
  const postcodeMatch = addressStr.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})/i);
  const postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : '';

  let cleanedAddr = addressStr.replace(postcodeMatch ? postcodeMatch[0] : '', '').trim();
  if (cleanedAddr.endsWith(',')) cleanedAddr = cleanedAddr.slice(0, -1).trim();

  const parts = cleanedAddr.split(',').map(p => p.trim()).filter(p => p);
  const city = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
  const streetAddress = parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0] || addressStr;

  // Try to extract county from parts
  let county = '';
  if (parts.length >= 3) {
    // Check if second-to-last part looks like a county
    const possibleCounty = parts[parts.length - 2];
    const countyKeywords = ['Essex', 'Somerset', 'Kent', 'Surrey', 'Lancashire', 'Devon', 'Norfolk', 'Suffolk', 'Yorkshire', 'Dumfries'];
    if (countyKeywords.some(k => possibleCounty.includes(k))) {
      county = possibleCounty;
    }
  }

  return {
    location: {
      streetAddress,
      city,
      county,
      postalCode: postcode,
      country: 'United Kingdom',
      lat: null,
      lng: null,
      formatted_address: addressStr,
    },
    address: streetAddress,
    city,
    state: county,
    zipCode: postcode,
  };
}

// --- FIELD DATA DEFINITIONS ---

const fieldsToUpdate: FieldUpdateData[] = [
  // 1. Hugo's Fun Field (Bridge)
  {
    name: "Hugo's Fun Field (Bridge)",
    address: "Hugo's, Bridge, CT4 6EQ",
    phone: '07453 328586',
    email: 'contact@hugosfundogfield.com',
    fenceSize: '6ft',
    size: 'medium',
    ...parsePrice('From £7/ session'),
    amenities: ['Secure Car Park'],
    fieldFeatures: {
      reactiveDogFriendly: 'No nearby distractions',
      secureInFieldParking: true,
      parking: 'Dedicated on-site parking',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'More than 10 min',
      buggyAccessible: true,
      maxNumberDogsNote: 'TBC',
      fieldType: 'Paddock',
    },
  },

  // 2. Spring Rise Canine Care Secure Dog Field
  {
    name: 'Spring Rise Canine Care Secure Dog Field',
    address: 'CT18 8BZ',
    phone: '07510 547287',
    email: 'springrise.bookings@gmail.com',
    fenceSize: '6ft',
    size: 'small',
    ...parsePrice('From £10'),
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      secureOnlineBooking: true,
    },
  },

  // 3. Smithvale Kennels
  {
    name: 'Smithvale Kennels',
    address: 'Glenavy Lisburn, BT29 4NY',
    phone: '07710682242',
    email: 'kennyjohn54@icloud.com',
    fenceSize: '6ft',
    size: 'small',
    ...parsePrice('From £6'),
    fieldFeatures: {
      parking: 'On-site',
      buggyAccessible: true,
    },
  },

  // 4. Kirkguzeon Freedom Field
  {
    name: 'Kirkguzeon Freedom Field',
    address: 'Kirkgunzeon Canines, Little, Breconside, Kirkgunzeon, Dumfries DG2 8JW',
    phone: '07834 217 734',
    email: 'kirkgunzeoncanines@gmail.com',
    description: 'Kirkguzeon Freedom Field is 9 miles south west of Dumfries in Scotland. This is a secure, 2 acre grass paddock with chain link fencing all round and the benefit of a dog shower facility!',
    fenceSize: '6ft',
    size: 'medium',
    ...parsePrice('From £5 / 30 minutes'),
    amenities: ['Fresh Water'],
    fieldFeatures: {
      parking: 'TBC',
      secureOnlineBooking: true,
      buggyAccessible: true,
    },
  },

  // 5. Foxes Farm Dog Fields
  {
    name: 'Foxes Farm Dog Fields',
    address: 'Mill Lane, Colne Engaine, Halstead, Essex, CO6 2HX',
    phone: '01206 481 984',
    email: 'bookings@foxesfarmfields.co.uk',
    description: 'Colne Engine dog field is one of four dog fields run by Foxes Farm fields and is a 6 acre enclosed paddock, ten miles from central Colchester.',
    fenceSize: '4ft',
    size: 'extra-large',
    ...parsePrice('From £12 / 55 minutes'),
    amenities: ['Fresh Water'],
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      parkingArrangements: 'Parking outside field gate',
      parking: 'On site parking, outside the field entrance gate',
      secureOnlineBooking: true,
      regularUserDiscounts: true,
      buggyAccessible: true,
      maxNumberDogsNote: 'TBC',
      fieldType: 'Paddock',
    },
  },

  // 6. Bold Bark Secure Dog Runs
  {
    name: 'Bold Bark Secure Dog Runs',
    address: 'Redshell Lane, Belthorn, Blackburn, BB1 2PH',
    phone: '07902312172',
    email: 'boldbark@yahoo.com',
    description: '2 Fields on this site. The Big Field',
    fenceSize: '6ft',
    ...parsePrice('From £10/ hour'),
    fieldFeatures: {
      parkingArrangements: 'Shared parking',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock, Moorland',
    },
  },

  // 7. K9 Rec Secure Dog Field
  {
    name: 'K9 Rec Secure Dog Field',
    address: 'Creech Heathfield, Taunton, Somerset, TA3 5ER',
    email: 'K9rec19@gmail.com',
    fenceSize: '6ft',
    size: 'medium',
    maxDogs: 8,
    ...parsePrice('From £6.50 / 30 minutes'),
    amenities: ['Secure Car Park'],
    fieldFeatures: {
      secureInFieldParking: true,
      parking: 'Space for 4 external to field',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock',
    },
  },

  // 8. Houndsville Secure Dog Field
  {
    name: 'Houndsville Secure Dog Field',
    address: 'Monument Road, Wellington, TA21 9PW',
    phone: '07946 554210',
    email: 'houndsville@itsallaboutdogs.org.uk',
    fenceSize: '4ft',
    size: 'medium',
    maxDogs: 8,
    ...parsePrice('From £9 / 30 minutes'),
    amenities: ['Fresh Water'],
    fieldFeatures: {
      fencingNotes: 'Mixed fencing',
      secureInFieldParking: true,
      parking: 'In-field',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      regularUserDiscounts: true,
      fieldType: 'Pond or Stream, Paddock, Activities',
    },
  },

  // 9. Runfree Bargeddie
  {
    name: 'Runfree Bargeddie',
    address: 'Cuilhill Rd Baillieston, Bargeddie, G69 6UF',
    phone: '07717 162879',
    email: 'hello@runfreedogfields.co.uk',
    description: 'Run Free has 3 fields in Bargeddie for hire: Freedom Field, Jumbo Field, Mezzo Field',
    fenceSize: '6ft',
    size: 'small',
    maxDogs: 8,
    ...parsePrice('From £7 for 30min'),
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      parkingArrangements: 'Exclusive In-field Parking',
      parking: 'Parking inside field',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      maxNumberDogsNote: 'Depends on booking but 8 dogs max in total',
      fieldType: 'Paddock',
    },
  },
];


async function findOrCreateOwner(email: string, phone?: string): Promise<string> {
  // Search for existing FIELD_OWNER with this email
  let owner = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
      role: 'FIELD_OWNER',
    },
  });

  if (owner) {
    console.log(`  Found existing owner: ${owner.name || owner.email} (${owner.id})`);
    // Update phone if provided and different
    if (phone && owner.phone !== phone) {
      await prisma.user.update({
        where: { id: owner.id },
        data: { phone },
      });
      console.log(`  Updated owner phone to: ${phone}`);
    }
    return owner.id;
  }

  // Create new FIELD_OWNER
  // Generate a userId
  const counter = await prisma.counter.upsert({
    where: { name: 'user' },
    update: { value: { increment: 1 } },
    create: { name: 'user', value: 7777 },
  });

  const newOwner = await prisma.user.create({
    data: {
      userId: String(counter.value),
      email: email.toLowerCase(),
      name: email.split('@')[0], // Use email prefix as name
      role: 'FIELD_OWNER',
      phone: phone || null,
      provider: 'general',
      emailVerified: new Date(),
      hasField: true,
      isBlocked: false,
      isReported: false,
    },
  });

  console.log(`  Created NEW field owner: ${newOwner.email} (${newOwner.id}), userId: ${newOwner.userId}`);
  return newOwner.id;
}

async function updateField(fieldData: FieldUpdateData) {
  console.log(`\n--- Processing: ${fieldData.name} ---`);

  // 1. Find the field by name
  const existingField = await prisma.field.findFirst({
    where: { name: fieldData.name },
    include: { owner: true },
  });

  if (!existingField) {
    console.log(`  FIELD NOT FOUND: "${fieldData.name}" — skipping`);
    return;
  }

  console.log(`  Found field: ${existingField.name} (${existingField.id}), fieldId: ${existingField.fieldId}`);
  console.log(`  Current owner: ${existingField.owner?.email} (${existingField.ownerId})`);

  // 2. Check if owner email matches
  let ownerId = existingField.ownerId;
  const currentOwnerEmail = existingField.owner?.email?.toLowerCase();
  const newOwnerEmail = fieldData.email.toLowerCase();

  if (currentOwnerEmail !== newOwnerEmail) {
    console.log(`  Owner email DIFFERS: current="${currentOwnerEmail}" → new="${newOwnerEmail}"`);
    ownerId = await findOrCreateOwner(fieldData.email, fieldData.phone);
  } else {
    console.log(`  Owner email matches — keeping current owner`);
    // Still update phone if provided
    if (fieldData.phone && existingField.owner?.phone !== fieldData.phone) {
      await prisma.user.update({
        where: { id: ownerId },
        data: { phone: fieldData.phone },
      });
      console.log(`  Updated owner phone to: ${fieldData.phone}`);
    }
  }

  // 3. Parse address
  const parsedAddr = parseAddress(fieldData.address);

  // 4. Merge fieldFeatures with existing
  const existingFeatures = (existingField.fieldFeatures as any) || {};
  const mergedFeatures = {
    ...existingFeatures,
    ...(fieldData.fieldFeatures || {}),
  };

  // 5. Merge amenities with existing
  const existingAmenities = existingField.amenities || [];
  const newAmenities = fieldData.amenities || [];
  const mergedAmenities = [...new Set([...existingAmenities, ...newAmenities])];

  // 6. Build update data
  const updateData: any = {
    ownerId,
    address: parsedAddr.address,
    city: parsedAddr.city,
    state: parsedAddr.state,
    zipCode: parsedAddr.zipCode,
    location: parsedAddr.location,
    amenities: mergedAmenities,
    fieldFeatures: mergedFeatures,
  };

  // Only update fields that have values
  if (fieldData.description) updateData.description = fieldData.description;
  if (fieldData.fenceSize) updateData.fenceSize = fieldData.fenceSize;
  if (fieldData.size) updateData.size = fieldData.size;
  if (fieldData.price30min !== undefined && fieldData.price30min !== null) updateData.price30min = fieldData.price30min;
  if (fieldData.price1hr !== undefined && fieldData.price1hr !== null) updateData.price1hr = fieldData.price1hr;
  if (fieldData.maxDogs) updateData.maxDogs = fieldData.maxDogs;

  // Update denormalized owner data
  const ownerUser = await prisma.user.findUnique({ where: { id: ownerId } });
  if (ownerUser) {
    updateData.ownerName = ownerUser.name;
    const joinDate = ownerUser.createdAt;
    updateData.joinedOn = joinDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  }

  // 7. Execute update
  const updated = await prisma.field.update({
    where: { id: existingField.id },
    data: updateData,
  });

  console.log(`  UPDATED field: ${updated.name} (${updated.id})`);
  console.log(`  - Address: ${fieldData.address}`);
  console.log(`  - Owner ID: ${ownerId}`);
  if (fieldData.price30min) console.log(`  - Price (30min): £${fieldData.price30min}`);
  if (fieldData.price1hr) console.log(`  - Price (1hr): £${fieldData.price1hr}`);
  if (fieldData.fenceSize) console.log(`  - Fence size: ${fieldData.fenceSize}`);
  if (fieldData.size) console.log(`  - Size: ${fieldData.size}`);
  if (fieldData.maxDogs) console.log(`  - Max dogs: ${fieldData.maxDogs}`);
}


async function main() {
  console.log('=== Field Data Update Script ===');
  console.log(`Processing ${fieldsToUpdate.length} fields...\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const fieldData of fieldsToUpdate) {
    try {
      await updateField(fieldData);
      successCount++;
    } catch (error: any) {
      console.error(`  ERROR updating "${fieldData.name}":`, error.message);
      errorCount++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total fields: ${fieldsToUpdate.length}`);
  console.log(`Updated: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
