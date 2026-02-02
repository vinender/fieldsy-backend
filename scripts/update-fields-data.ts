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
  // GPS coordinates
  lat?: number;
  lng?: number;
  // Schema fields
  fenceSize?: string;
  size?: string;
  price30min?: number | null;
  price1hr?: number | null;
  maxDogs?: number;
  amenities?: string[];
  // fieldFeatures JSON for extra data
  fieldFeatures?: Record<string, any>;
  // Tag for categorization
  tag?: string;
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
    const countyKeywords = ['Essex', 'Somerset', 'Kent', 'Surrey', 'Lancashire', 'Devon', 'Norfolk', 'Suffolk', 'Yorkshire', 'Dumfries', 'Glasgow', 'Canterbury'];
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
    address: "Hugo's, Bridge, Canterbury, CT4 6EQ",
    phone: '07453 328586',
    email: 'contact@hugosfundogfield.com',
    description: 'Large secure dog field near Canterbury, Kent. Private hire sessions with 6ft fencing around the perimeter. Spacious open paddock (~3.5 acres) ideal for dogs needing off-lead exercise in a safe environment.',
    lat: 51.205231532993,
    lng: 1.0964081561153,
    fenceSize: '6ft',
    size: 'medium',
    ...parsePrice('From £7/ session'),
    amenities: ['Secure Car Park'],
    tag: 'British Dog Fields',
    fieldFeatures: {
      reactiveDogFriendly: 'No nearby distractions',
      secureInFieldParking: true,
      parking: 'Dedicated on-site parking',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'More than 10 min',
      buggyAccessible: true,
      maxNumberDogsNote: 'TBC',
      fieldType: 'Paddock',
      what3words: '///soaps.fidget.untruth',
      website: 'hugosfundogfield.com',
    },
  },

  // 2. Spring Rise Canine Care Secure Dog Field
  {
    name: 'Spring Rise Canine Care Secure Dog Field',
    address: 'Maple Cottage, Westfield Lane, Etchinghill, Folkestone, Kent, CT18 8BZ',
    phone: '07510 547287',
    email: 'springrise.bookings@gmail.com',
    description: 'A 1-acre secure dog walking field in Etchinghill, Folkestone, Kent. Fully fenced with 6ft fencing. Features agility equipment and is available for private hire sessions and training classes.',
    lat: 51.11004211456,
    lng: 1.0887892017527,
    fenceSize: '6ft',
    size: 'small',
    ...parsePrice('From £10 / hour'),
    tag: 'British Dog Fields',
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      secureOnlineBooking: true,
      parking: 'On-site (5 small cars)',
      agility: true,
      privateHire: true,
    },
  },

  // 3. Smithvale Kennels
  {
    name: 'Smithvale Kennels',
    address: '110 Lisburn Road, Glenavy, Crumlin, BT29 4NY',
    phone: '07710682242',
    email: 'kennyjohn54@icloud.com',
    description: 'Located in Glenavy, Northern Ireland. Offers 3 secure grass paddocks and an all-weather facility. Note: dogs in separate paddocks may have visibility of one another. Ideal for exercise and socialisation in a controlled environment.',
    fenceSize: '6ft',
    size: 'small',
    ...parsePrice('From £6'),
    tag: 'British Dog Fields',
    fieldFeatures: {
      parking: 'On-site',
      buggyAccessible: true,
      numberOfPaddocks: 3,
      allWeatherFacility: true,
      dogVisibilityNote: 'Dogs have visibility of one another between paddocks',
    },
  },

  // 4. Kirkgunzeon Freedom Field
  {
    name: 'Kirkguzeon Freedom Field',
    address: 'Kirkgunzeon Canines, Little, Breconside, Kirkgunzeon, Dumfries DG2 8JW',
    phone: '07834 217 734',
    email: 'kirkgunzeoncanines@gmail.com',
    description: 'Kirkgunzeon Freedom Field is 9 miles south west of Dumfries in Scotland. This is a secure, 2 acre grass paddock with 6ft chain link fencing all round and the benefit of a dog shower facility! Features agility equipment, on-site café ("The Pup Hut"), and a raw meats and treats shop. Open 7 days, 8am-8pm.',
    fenceSize: '6ft',
    size: 'medium',
    ...parsePrice('From £5 / 30 minutes'),
    amenities: ['Fresh Water', 'Dog Shower'],
    tag: 'British Dog Fields',
    fieldFeatures: {
      parking: '3 designated spaces',
      secureOnlineBooking: true,
      buggyAccessible: true,
      agility: true,
      dogShower: true,
      cafe: 'The Pup Hut',
      shop: 'Raw Meats and Treats',
      operatingHours: '7 days, 8am-8pm',
      website: 'kirkgunzeoncanines.co.uk',
    },
  },

  // 5. Foxes Farm Dog Fields (Colne Engaine)
  {
    name: 'Foxes Farm Dog Fields',
    address: 'Mill Lane, Colne Engaine, Halstead, Essex, CO6 2HX',
    phone: '01206 481 984',
    email: 'bookings@foxesfarmfields.co.uk',
    description: 'Foxes Farm Fields is an exclusive, fully enclosed and secure dog walking facility available for private hire. The Colne Engaine location is a 6-acre enclosed paddock set in the countryside between Colchester and Halstead, enjoying views of the Colne Valley. Run by Guy and Emily French.',
    lat: 51.934984497928,
    lng: 0.70900461743027,
    fenceSize: '4ft',
    size: 'extra-large',
    maxDogs: 8,
    ...parsePrice('From £13 / 55 minutes'),
    amenities: ['Fresh Water', 'Field Shelter', 'Picnic Bench'],
    tag: 'British Dog Fields',
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      parkingArrangements: 'Parking outside field gate (~2 cars)',
      parking: 'On site parking, outside the field entrance gate',
      secureOnlineBooking: true,
      regularUserDiscounts: true,
      buggyAccessible: true,
      maxNumberDogsNote: 'Up to 3 dogs included, max 8 with extra fee',
      fieldType: 'Paddock',
      bufferBetweenCustomers: '5 minutes',
      sessionDuration: '55 minutes',
      weekendPrice: '£15/session',
      what3words: '///dressings.steroids.galleries',
      website: 'foxesfarmfields.co.uk',
    },
  },

  // 6. Bold Bark Secure Dog Runs
  {
    name: 'Bold Bark Secure Dog Runs',
    address: 'Redshell Lane, Belthorn, Blackburn, Lancashire, BB1 2PH',
    phone: '07902312172',
    email: 'boldbark@yahoo.com',
    description: '2 secure fields set within 200 acres of family farmland near Belthorn, Blackburn. "The Big Field" features agility equipment and panoramic views (see Blackpool Tower on clear days). "The In and Out Field" has a purpose-built polytunnel with agility equipment and an outdoor scent work area. Also offers doggy day care and bespoke grooming.',
    lat: 53.716328,
    lng: -2.411153,
    fenceSize: '6ft',
    ...parsePrice('From £10/ hour'),
    tag: 'British Dog Fields',
    fieldFeatures: {
      parkingArrangements: 'Shared parking',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock, Moorland',
      numberOfFields: 2,
      fieldNames: 'The Big Field, The In and Out Field',
      agility: true,
      polytunnel: true,
      operatingHours: '7 days, 07:30-18:00',
      website: 'boldbark.co.uk',
    },
  },

  // 7. K9 Rec Secure Dog Field
  {
    name: 'K9 Rec Secure Dog Field',
    address: 'K9 Rec, Creech Heathfield Road, Creech St Michael, Taunton, Somerset, TA3 5ER',
    email: 'K9rec19@gmail.com',
    description: 'A private, secure dog exercise facility in Creech Heathfield, Taunton. Just under 3 acres, secured by a 6ft deer fence with rabbit wire. Features natural terrain with lumps and bumps, agility obstacles, climbing structures, fenced sandpit, seasonal pool, dog shower, and weather shelter. Great for reactive, nervous, young, or older dogs.',
    lat: 51.04373,
    lng: -3.03095,
    fenceSize: '6ft',
    size: 'medium',
    maxDogs: 8,
    ...parsePrice('From £6.50 / 30 minutes'),
    amenities: ['Secure Car Park', 'Dog Shower', 'Weather Shelter'],
    tag: 'British Dog Fields',
    fieldFeatures: {
      secureInFieldParking: true,
      parking: 'Space for 4 external to field + in-field parking with coded gate',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock',
      reactiveDogFriendly: 'Yes - great for reactive, nervous, young, older dogs',
      agility: true,
      sandpit: true,
      seasonalPool: true,
      dogShower: true,
      operatingHours: '7 days, 6:00 AM - 10:00 PM',
      what3words: '///spends.mural.brushing',
      website: 'k9rec.co.uk',
      price1hr: 10.50,
    },
  },

  // 8. Houndsville Secure Dog Field
  {
    name: 'Houndsville Secure Dog Field',
    address: 'Houndsville, Monument Road, Wellington, Somerset, TA21 9PW',
    phone: '07946 554210',
    email: 'houndsville@itsallaboutdogs.org.uk',
    description: 'Large, well-maintained, and highly secure exclusive-use dog walking space (3.5-4.5 acres) on the edge of the Blackdown Hills in Wellington, Somerset. Features a large fenced pond for dog swimming (safe blue treatment), warm dog shower, picnic shelter, and timed lighting. Entry via automated electronic keypad system. Operated by It\'s All About Dogs.',
    lat: 50.964458117491,
    lng: -3.218216112598,
    fenceSize: '4ft',
    size: 'large',
    maxDogs: 8,
    ...parsePrice('From £9 / 30 minutes'),
    amenities: ['Fresh Water', 'Dog Shower', 'Picnic Shelter', 'Lighting', 'Fenced Pond'],
    tag: 'British Dog Fields',
    fieldFeatures: {
      fencingNotes: 'Mixed fencing, rabbit-proof, secured deep below ground',
      secureInFieldParking: true,
      parking: 'In-field secure parking, wheelchair accessible',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      regularUserDiscounts: true,
      fieldType: 'Pond or Stream, Paddock, Activities',
      reactiveDogFriendly: 'Yes - popular with owners of reactive or nervous dogs',
      warmDogShower: true,
      fencedPond: true,
      electronicKeypad: true,
      additionalDogPrice: '£2 per extra dog',
      seasonalHours: 'Oct-Mar: 7AM-7PM, Apr-Sep: 6:30AM-9PM',
      what3words: '///rise.flick.widgets',
      website: 'itsallaboutdogs.uk',
    },
  },

  // 9. Runfree Bargeddie
  {
    name: 'Runfree Bargeddie',
    address: 'Gartcosh Road, Bargeddie, Glasgow, G69 6UF',
    phone: '07717 162879',
    email: 'hello@runfreedogfields.co.uk',
    description: 'Run Free Dog Fields Bargeddie, established 2017, offers 3 secure enclosed fields: Freedom Field (1-2 acres), Jumbo Field (2-4 acres), and Mezzo Field (2-4 acres). All fields have 6ft fencing dug into the ground. Exclusive use per booking. Located between Bargeddie and Gartcosh, opposite Drumpellier Country Park, with easy access to M8 and M73.',
    lat: 55.8643425,
    lng: -4.0802607,
    fenceSize: '6ft',
    size: 'small',
    maxDogs: 8,
    ...parsePrice('From £7 for 30min'),
    tag: 'British Dog Fields',
    fieldFeatures: {
      reactiveDogFriendly: 'TBC - private exclusive use supports reactive dogs',
      parkingArrangements: 'Exclusive In-field Parking (Freedom & Mezzo), Shared car park with 100m walk (Jumbo)',
      parking: 'In-field parking (Freedom & Mezzo fields)',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      maxNumberDogsNote: 'Up to 4 dogs: £7, up to 6: £8.50, up to 8: £10 per 30min',
      fieldType: 'Paddock',
      numberOfFields: 3,
      fieldNames: 'Freedom Field, Jumbo Field, Mezzo Field',
      operatingHours: '7 days, 07:00-21:30',
      website: 'runfreedogfields.co.uk',
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

  // 1. Find the field by name (exact match, then fallback to contains)
  let existingField = await prisma.field.findFirst({
    where: { name: fieldData.name },
    include: { owner: true },
  });

  if (!existingField) {
    // Fallback: search by contains (strip parenthetical suffixes)
    const baseName = fieldData.name.replace(/\s*\(.*?\)\s*$/, '').trim();
    existingField = await prisma.field.findFirst({
      where: { name: { contains: baseName, mode: 'insensitive' } },
      include: { owner: true },
    });
  }

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

  // 3. Parse address and inject GPS if available
  const parsedAddr = parseAddress(fieldData.address);
  if (fieldData.lat !== undefined && fieldData.lng !== undefined) {
    parsedAddr.location.lat = fieldData.lat;
    parsedAddr.location.lng = fieldData.lng;
  }

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
    owner: { connect: { id: ownerId } },
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
  // Store tag in fieldFeatures (no dedicated schema field)
  if (fieldData.tag) {
    updateData.fieldFeatures = { ...updateData.fieldFeatures, tag: fieldData.tag };
  }

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
