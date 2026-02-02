/**
 * Convert json_fields_data.json (Dog Walking Fields) into structured format
 * and merge into fields-data.json
 */

const fs = require('fs');
const path = require('path');

const rawData = require('../json_fields_data.json');
const fieldsDataPath = path.resolve(__dirname, 'fields-data.json');
const fieldsData = require(fieldsDataPath);

function extractFromFeatures(features) {
  const result = {
    size: null,
    sizeAcres: null,
    fenceSize: null,
    fenceType: null,
    parking: null,
    fieldType: [],
    amenities: [],
    buggyAccessible: null,
    reactiveDogFriendly: null,
    onlineBooking: false,
    discountsAvailable: false,
    acceptsExemptDogs: null,
    lighting: null,
    livestockNearby: null,
  };

  if (!features) return result;

  for (const f of features) {
    const fl = f.toLowerCase().trim();

    // Size
    if (fl.includes('acre')) {
      result.sizeAcres = f.trim();
      if (fl.includes('less than 1') || fl.includes('under 1')) result.size = 'small';
      else if (fl.includes('1 -') || fl.includes('1-2') || fl.includes('1 to 2')) result.size = 'small';
      else if (fl.includes('2 -') || fl.includes('2-4') || fl.includes('2 to 4')) result.size = 'medium';
      else if (fl.includes('4 -') || fl.includes('4-10') || fl.includes('4 to 10')) result.size = 'large';
      else if (fl.includes('10') || fl.includes('20') || fl.includes('50')) result.size = 'extra-large';
    }

    // Fence height
    if (fl.includes('fence height') || (fl.includes('feet') && fl.includes('fence'))) {
      if (fl.includes('6 feet') || fl.includes('6ft')) result.fenceSize = '6ft';
      else if (fl.includes('5 feet') || fl.includes('5ft')) result.fenceSize = '5ft';
      else if (fl.includes('4 feet') || fl.includes('4ft')) result.fenceSize = '4ft';
      else result.fenceSize = f.trim();
    }
    // Also check direct "6 Feet Plus" format
    if (fl === '6 feet plus fence height') result.fenceSize = '6ft+';
    if (fl === '5 feet plus fence height') result.fenceSize = '5ft+';
    if (fl === '4 feet or just under fence height') result.fenceSize = '4ft';

    // Fence type
    if (fl.includes('deer fencing')) result.fenceType = result.fenceType ? result.fenceType + ', Deer' : 'Deer Fencing';
    if (fl.includes('stock fencing')) result.fenceType = result.fenceType ? result.fenceType + ', Stock' : 'Stock Fencing';
    if (fl.includes('chain link')) result.fenceType = result.fenceType ? result.fenceType + ', Chain Link' : 'Chain Link';

    // Parking
    if (fl.match(/\d.*car/) || (fl.includes('parking') && fl.includes('car'))) {
      result.parking = f.trim();
    } else if (fl.includes('parking') && !result.parking) {
      result.parking = f.trim();
    }

    // Field type
    if (fl === 'paddock' || fl === 'meadow' || fl === 'open field' || fl.includes('woodland') || fl.includes('moorland')) {
      result.fieldType.push(f.trim());
    }

    // Amenities
    if (fl.includes('shelter') && !fl.includes('shade')) result.amenities.push('Shelter');
    if (fl === 'toilet') result.amenities.push('Toilet');
    if (fl.includes('seating') || fl.includes('bench')) result.amenities.push('Seating/Benches');
    if (fl.includes('water supply')) result.amenities.push('Fresh Water');
    if (fl.includes('agility')) result.amenities.push('Agility Equipment');
    if (fl.includes('obstacle')) result.amenities.push('Obstacles');
    if (fl.includes('shade by trees')) result.amenities.push('Shade Trees');
    if (fl.includes('child friendly')) result.amenities.push('Child Friendly');
    if (fl.includes('flood lit') || fl.includes('floodlit')) result.lighting = 'Flood Lit';
    if (fl.includes('natural light only')) result.lighting = result.lighting || 'Natural';

    // Booking
    if (fl.includes('online booking')) result.onlineBooking = true;
    if (fl.includes('discount')) result.discountsAvailable = true;

    // Exempt dogs
    if (fl.includes('accepts exempt dogs')) result.acceptsExemptDogs = f.trim();

    // Livestock
    if (fl.includes('no livestock')) result.livestockNearby = 'No';
    else if (fl.includes('livestock') && fl.includes('not in view')) result.livestockNearby = 'Adjacent - not in view';
    else if (fl.includes('livestock') && fl.includes('in view')) result.livestockNearby = 'Adjacent - in view';

    // Exclusive use
    if (fl === 'exclusive use') result.amenities.push('Exclusive Use');
  }

  result.amenities = [...new Set(result.amenities)];
  result.fieldType = [...new Set(result.fieldType)];

  return result;
}

function extractPostcode(location) {
  if (!location) return null;
  const match = location.match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})/i);
  return match ? match[1].toUpperCase() : null;
}

function cleanName(name) {
  return name
    .replace(/&#8211;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

function cleanDescription(desc) {
  if (!desc) return null;
  return desc
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Score a field entry for deduplication (higher = more data)
function scoreField(f) {
  let score = 0;
  if (f.description) score += f.description.length;
  if (f.features) score += f.features.length * 5;
  if (f.price) score += 20;
  if (f.images && f.images.length > 0) {
    const realImages = f.images.filter(img => !img.includes('dwfs-small-logo'));
    score += realImages.length * 10;
  }
  if (f.location) score += f.location.length;
  return score;
}

// Deduplicate: keep the entry with the most data for each name
const deduped = new Map();
rawData.forEach(f => {
  const key = cleanName(f.field_name).toLowerCase().trim();
  const score = scoreField(f);
  if (!deduped.has(key) || score > deduped.get(key).score) {
    deduped.set(key, { data: f, score });
  }
});

// Process deduplicated fields
const dogWalkingFields = Array.from(deduped.values()).map(({ data: f }) => {
  const extracted = extractFromFeatures(f.features);
  const postcode = extractPostcode(f.location);

  return {
    name: cleanName(f.field_name),
    tag: 'Dog Walking Fields',
    address: f.location || null,
    postcode: postcode,
    phone: null,
    email: null,
    website: f.contact_or_booking_link || null,
    lat: null,
    lng: null,
    description: cleanDescription(f.description),
    size: extracted.size,
    sizeAcres: extracted.sizeAcres,
    fenceSize: extracted.fenceSize,
    fenceType: extracted.fenceType,
    price: f.price || null,
    price30min: null,
    price1hr: null,
    maxDogs: null,
    parking: extracted.parking,
    buggyAccessible: extracted.buggyAccessible,
    reactiveDogFriendly: extracted.reactiveDogFriendly,
    bufferBetweenCustomers: null,
    fieldType: extracted.fieldType.length > 0 ? extracted.fieldType.join(', ') : null,
    amenities: extracted.amenities,
    operatingHours: null,
    onlineBooking: extracted.onlineBooking,
    discountsAvailable: extracted.discountsAvailable,
    acceptsExemptDogs: extracted.acceptsExemptDogs,
    lighting: extracted.lighting,
    livestockNearby: extracted.livestockNearby,
    images: (f.images || []).filter(img => !img.includes('dwfs-small-logo')),
  };
});

// Update fields-data.json
fieldsData.dogWalkingFields = dogWalkingFields;
fs.writeFileSync(fieldsDataPath, JSON.stringify(fieldsData, null, 2));

// Stats
const withDesc = dogWalkingFields.filter(f => f.description).length;
const withSize = dogWalkingFields.filter(f => f.size).length;
const withFence = dogWalkingFields.filter(f => f.fenceSize).length;
const withParking = dogWalkingFields.filter(f => f.parking).length;
const withPostcode = dogWalkingFields.filter(f => f.postcode).length;
const withImages = dogWalkingFields.filter(f => f.images.length > 0).length;

console.log('=== Dog Walking Fields Conversion Summary ===');
console.log('Raw entries:', rawData.length);
console.log('After deduplication:', dogWalkingFields.length);
console.log('Duplicates removed:', rawData.length - dogWalkingFields.length);
console.log('With description:', withDesc);
console.log('With size:', withSize);
console.log('With fence height:', withFence);
console.log('With parking info:', withParking);
console.log('With postcode:', withPostcode);
console.log('With images:', withImages);
console.log('---');
console.log('Without description:', dogWalkingFields.length - withDesc);
console.log('---');
console.log('fields-data.json updated successfully!');
console.log('British Dog Fields:', fieldsData.britishDogFields.length);
console.log('Dog Walking Fields:', fieldsData.dogWalkingFields.length);
