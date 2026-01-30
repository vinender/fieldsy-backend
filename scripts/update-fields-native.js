/**
 * Script to update existing field data using native MongoDB driver (via mongoose).
 * Bypasses Prisma connection issues in standalone mode.
 *
 * Usage:
 *   node scripts/update-fields-native.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not found in .env');
  process.exit(1);
}

console.log('MongoDB URI loaded (length:', MONGODB_URI.length, ')');

// --- HELPER FUNCTIONS ---

function parsePrice(priceStr) {
  const result = { price30min: null, price1hr: null };
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
    result.price1hr = price;
    result.price30min = Math.round((price / 2) * 100) / 100;
  } else if (lower.includes('session')) {
    result.price30min = price;
    result.price1hr = Math.round(price * 2 * 100) / 100;
  } else {
    result.price30min = price;
    result.price1hr = Math.round(price * 2 * 100) / 100;
  }

  return result;
}

function parseAddress(addressStr) {
  const postcodeMatch = addressStr.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})/i);
  const postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : '';

  let cleanedAddr = addressStr.replace(postcodeMatch ? postcodeMatch[0] : '', '').trim();
  if (cleanedAddr.endsWith(',')) cleanedAddr = cleanedAddr.slice(0, -1).trim();

  const parts = cleanedAddr.split(',').map(p => p.trim()).filter(p => p);
  const city = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
  const streetAddress = parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0] || addressStr;

  let county = '';
  if (parts.length >= 3) {
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

// --- FIELD DATA ---

const price1 = parsePrice('From £7/ session');
const price2 = parsePrice('From £10');
const price3 = parsePrice('From £6');
const price4 = parsePrice('From £5 / 30 minutes');
const price5 = parsePrice('From £12 / 55 minutes');
const price6 = parsePrice('From £10/ hour');
const price7 = parsePrice('From £6.50 / 30 minutes');
const price8 = parsePrice('From £9 / 30 minutes');
const price9 = parsePrice('From £7 for 30min');

const fieldsToUpdate = [
  {
    name: "Hugo's Fun Field (Bridge)",
    address: "Hugo's, Bridge, CT4 6EQ",
    phone: '07453 328586',
    email: 'contact@hugosfundogfield.com',
    fenceSize: '6ft',
    size: 'medium',
    price30min: price1.price30min,
    price1hr: price1.price1hr,
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
  {
    name: 'Spring Rise Canine Care Secure Dog Field',
    address: 'CT18 8BZ',
    phone: '07510 547287',
    email: 'springrise.bookings@gmail.com',
    fenceSize: '6ft',
    size: 'small',
    price30min: price2.price30min,
    price1hr: price2.price1hr,
    fieldFeatures: {
      reactiveDogFriendly: 'TBC',
      secureOnlineBooking: true,
    },
  },
  {
    name: 'Smithvale Kennels',
    address: 'Glenavy Lisburn, BT29 4NY',
    phone: '07710682242',
    email: 'kennyjohn54@icloud.com',
    fenceSize: '6ft',
    size: 'small',
    price30min: price3.price30min,
    price1hr: price3.price1hr,
    fieldFeatures: {
      parking: 'On-site',
      buggyAccessible: true,
    },
  },
  {
    name: 'Kirkguzeon Freedom Field',
    address: 'Kirkgunzeon Canines, Little, Breconside, Kirkgunzeon, Dumfries DG2 8JW',
    phone: '07834 217 734',
    email: 'kirkgunzeoncanines@gmail.com',
    description: 'Kirkguzeon Freedom Field is 9 miles south west of Dumfries in Scotland. This is a secure, 2 acre grass paddock with chain link fencing all round and the benefit of a dog shower facility!',
    fenceSize: '6ft',
    size: 'medium',
    price30min: price4.price30min,
    price1hr: price4.price1hr,
    amenities: ['Fresh Water'],
    fieldFeatures: {
      parking: 'TBC',
      secureOnlineBooking: true,
      buggyAccessible: true,
    },
  },
  {
    name: 'Foxes Farm Dog Fields',
    address: 'Mill Lane, Colne Engaine, Halstead, Essex, CO6 2HX',
    phone: '01206 481 984',
    email: 'bookings@foxesfarmfields.co.uk',
    description: 'Colne Engine dog field is one of four dog fields run by Foxes Farm fields and is a 6 acre enclosed paddock, ten miles from central Colchester.',
    fenceSize: '4ft',
    size: 'extra-large',
    price30min: price5.price30min,
    price1hr: price5.price1hr,
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
  {
    name: 'Bold Bark Secure Dog Runs',
    address: 'Redshell Lane, Belthorn, Blackburn, BB1 2PH',
    phone: '07902312172',
    email: 'boldbark@yahoo.com',
    description: '2 Fields on this site. The Big Field',
    fenceSize: '6ft',
    price30min: price6.price30min,
    price1hr: price6.price1hr,
    fieldFeatures: {
      parkingArrangements: 'Shared parking',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock, Moorland',
    },
  },
  {
    name: 'K9 Rec Secure Dog Field',
    address: 'Creech Heathfield, Taunton, Somerset, TA3 5ER',
    email: 'K9rec19@gmail.com',
    fenceSize: '6ft',
    size: 'medium',
    maxDogs: 8,
    price30min: price7.price30min,
    price1hr: price7.price1hr,
    amenities: ['Secure Car Park'],
    fieldFeatures: {
      secureInFieldParking: true,
      parking: 'Space for 4 external to field',
      secureOnlineBooking: true,
      bufferBetweenCustomers: 'None',
      fieldType: 'Paddock',
    },
  },
  {
    name: 'Houndsville Secure Dog Field',
    address: 'Monument Road, Wellington, TA21 9PW',
    phone: '07946 554210',
    email: 'houndsville@itsallaboutdogs.org.uk',
    fenceSize: '4ft',
    size: 'medium',
    maxDogs: 8,
    price30min: price8.price30min,
    price1hr: price8.price1hr,
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
  {
    name: 'Runfree Bargeddie',
    address: 'Cuilhill Rd Baillieston, Bargeddie, G69 6UF',
    phone: '07717 162879',
    email: 'hello@runfreedogfields.co.uk',
    description: 'Run Free has 3 fields in Bargeddie for hire: Freedom Field, Jumbo Field, Mezzo Field',
    fenceSize: '6ft',
    size: 'small',
    maxDogs: 8,
    price30min: price9.price30min,
    price1hr: price9.price1hr,
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

// --- MAIN ---

async function main() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
  });

  try {
    await client.connect();
    console.log('Connected to MongoDB!\n');

    const db = client.db(); // uses the DB from URI
    const fieldsCol = db.collection('Field');
    const usersCol = db.collection('User');
    const countersCol = db.collection('Counter');

    let successCount = 0;
    let errorCount = 0;

    for (const fieldData of fieldsToUpdate) {
      try {
        console.log(`\n--- Processing: ${fieldData.name} ---`);

        // 1. Find field by name
        const existingField = await fieldsCol.findOne({ name: fieldData.name });
        if (!existingField) {
          console.log(`  FIELD NOT FOUND: "${fieldData.name}" — skipping`);
          errorCount++;
          continue;
        }

        console.log(`  Found field: ${existingField.name} (${existingField._id}), fieldId: ${existingField.fieldId || 'N/A'}`);

        // 2. Get current owner
        const currentOwner = await usersCol.findOne({ _id: existingField.ownerId });
        console.log(`  Current owner: ${currentOwner?.email || 'unknown'} (${existingField.ownerId})`);

        // 3. Check if owner email matches
        let ownerId = existingField.ownerId;
        const currentOwnerEmail = currentOwner?.email?.toLowerCase();
        const newOwnerEmail = fieldData.email.toLowerCase();

        if (currentOwnerEmail !== newOwnerEmail) {
          console.log(`  Owner email DIFFERS: "${currentOwnerEmail}" → "${newOwnerEmail}"`);

          // Find or create new owner
          let newOwner = await usersCol.findOne({
            email: newOwnerEmail,
            role: 'FIELD_OWNER',
          });

          if (newOwner) {
            console.log(`  Found existing FIELD_OWNER: ${newOwner.email} (${newOwner._id})`);
            ownerId = newOwner._id;

            // Update phone if provided
            if (fieldData.phone && newOwner.phone !== fieldData.phone) {
              await usersCol.updateOne(
                { _id: newOwner._id },
                { $set: { phone: fieldData.phone, updatedAt: new Date() } }
              );
              console.log(`  Updated owner phone to: ${fieldData.phone}`);
            }
          } else {
            // Generate userId
            const counterResult = await countersCol.findOneAndUpdate(
              { name: 'user' },
              { $inc: { value: 1 } },
              { upsert: true, returnDocument: 'after' }
            );
            const userId = String(counterResult.value);

            const newOwnerDoc = {
              userId,
              email: newOwnerEmail,
              name: newOwnerEmail.split('@')[0],
              role: 'FIELD_OWNER',
              phone: fieldData.phone || null,
              provider: 'general',
              emailVerified: new Date(),
              hasField: true,
              isBlocked: false,
              isReported: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            const insertResult = await usersCol.insertOne(newOwnerDoc);
            ownerId = insertResult.insertedId;
            console.log(`  Created NEW field owner: ${newOwnerEmail} (${ownerId}), userId: ${userId}`);
          }
        } else {
          console.log(`  Owner email matches — keeping current owner`);
          // Update phone if provided
          if (fieldData.phone && currentOwner?.phone !== fieldData.phone) {
            await usersCol.updateOne(
              { _id: ownerId },
              { $set: { phone: fieldData.phone, updatedAt: new Date() } }
            );
            console.log(`  Updated owner phone to: ${fieldData.phone}`);
          }
        }

        // 4. Parse address
        const parsedAddr = parseAddress(fieldData.address);

        // 5. Merge fieldFeatures with existing
        const existingFeatures = existingField.fieldFeatures || {};
        const mergedFeatures = {
          ...existingFeatures,
          ...(fieldData.fieldFeatures || {}),
        };

        // 6. Merge amenities with existing
        const existingAmenities = existingField.amenities || [];
        const newAmenities = fieldData.amenities || [];
        const mergedAmenities = [...new Set([...existingAmenities, ...newAmenities])];

        // 7. Build update data
        const updateData = {
          ownerId,
          address: parsedAddr.address,
          city: parsedAddr.city,
          state: parsedAddr.state,
          zipCode: parsedAddr.zipCode,
          location: parsedAddr.location,
          amenities: mergedAmenities,
          fieldFeatures: mergedFeatures,
          updatedAt: new Date(),
        };

        if (fieldData.description) updateData.description = fieldData.description;
        if (fieldData.fenceSize) updateData.fenceSize = fieldData.fenceSize;
        if (fieldData.size) updateData.size = fieldData.size;
        if (fieldData.price30min !== undefined && fieldData.price30min !== null) updateData.price30min = fieldData.price30min;
        if (fieldData.price1hr !== undefined && fieldData.price1hr !== null) updateData.price1hr = fieldData.price1hr;
        if (fieldData.maxDogs) updateData.maxDogs = fieldData.maxDogs;

        // Update owner denormalized data
        const ownerUser = await usersCol.findOne({ _id: ownerId });
        if (ownerUser) {
          updateData.ownerName = ownerUser.name;
          const joinDate = ownerUser.createdAt || new Date();
          updateData.joinedOn = new Date(joinDate).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
        }

        // 8. Execute update
        const result = await fieldsCol.updateOne(
          { _id: existingField._id },
          { $set: updateData }
        );

        if (result.modifiedCount > 0) {
          console.log(`  UPDATED field successfully!`);
        } else {
          console.log(`  Field matched but no changes were needed`);
        }

        console.log(`  - Address: ${fieldData.address}`);
        console.log(`  - Owner ID: ${ownerId}`);
        if (fieldData.price30min) console.log(`  - Price (30min): £${fieldData.price30min}`);
        if (fieldData.price1hr) console.log(`  - Price (1hr): £${fieldData.price1hr}`);
        if (fieldData.fenceSize) console.log(`  - Fence size: ${fieldData.fenceSize}`);
        if (fieldData.size) console.log(`  - Size: ${fieldData.size}`);
        if (fieldData.maxDogs) console.log(`  - Max dogs: ${fieldData.maxDogs}`);

        successCount++;
      } catch (err) {
        console.error(`  ERROR updating "${fieldData.name}":`, err.message);
        errorCount++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total fields: ${fieldsToUpdate.length}`);
    console.log(`Updated: ${successCount}`);
    console.log(`Errors: ${errorCount}`);

  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB.');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
