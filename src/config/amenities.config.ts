/**
 * Amenities Configuration
 * Maps amenity slugs to their display labels and icon URLs
 */

export interface AmenityConfig {
  slug: string;
  label: string;
  iconUrl: string;
  category?: string;
}

export const AMENITIES_CONFIG: AmenityConfig[] = [
  // Safety & Security
  {
    slug: 'secure-fencing-180cm',
    label: 'Secure fencing (180cm)',
    iconUrl: '/field-details/fence.svg',
    category: 'security'
  },
  {
    slug: 'secure-car-park',
    label: 'Secure Car Park',
    iconUrl: '/field-details/home.svg',
    category: 'security'
  },
  {
    slug: 'cctv',
    label: 'CCTV',
    iconUrl: '/add-field/cctv.svg',
    category: 'security'
  },

  // Water & Cleaning
  {
    slug: 'fresh-water',
    label: 'Fresh Water',
    iconUrl: '/field-details/drop.svg',
    category: 'hydration'
  },
  {
    slug: 'hose-pipe-dog-washing',
    label: 'Hose pipe for dog washing',
    iconUrl: '/field-details/drop.svg',
    category: 'hydration'
  },
  {
    slug: 'boot-cleaner',
    label: 'Boot cleaner',
    iconUrl: '/field-details/shield.svg',
    category: 'facilities'
  },
  {
    slug: 'dog-poo-bins',
    label: 'Dog Poo Bins',
    iconUrl: '/field-details/bin.svg',
    category: 'facilities'
  },

  // Activities & Features
  {
    slug: 'agility-equipment',
    label: 'Agility Equipment',
    iconUrl: '/add-field/dog-agility.svg',
    category: 'activities'
  },
  {
    slug: 'contour-graded-terrain',
    label: 'Contour/graded terrain',
    iconUrl: '/field-details/terrain.svg',
    category: 'terrain'
  },
  {
    slug: 'woodland',
    label: 'Woodland',
    iconUrl: '/add-field/tree.svg',
    category: 'terrain'
  },
  {
    slug: 'pond',
    label: 'Pond',
    iconUrl: '/add-field/swimming.svg',
    category: 'terrain'
  },
  {
    slug: 'river',
    label: 'River',
    iconUrl: '/add-field/swimming.svg',
    category: 'terrain'
  },
  {
    slug: 'field-shelter',
    label: 'Field Shelter - protection from rain or sun',
    iconUrl: '/add-field/shelter.svg',
    category: 'comfort'
  },
  {
    slug: 'picnic-bench',
    label: 'Picnic bench',
    iconUrl: '/field-details/home.svg',
    category: 'comfort'
  },
  {
    slug: 'benches-seating',
    label: 'Benches and seating',
    iconUrl: '/field-details/home.svg',
    category: 'comfort'
  },

  // Facilities
  {
    slug: 'hot-drinks-machine',
    label: 'Hot drinks machine',
    iconUrl: '/field-details/home.svg',
    category: 'facilities'
  },
  {
    slug: 'cafe',
    label: 'Cafe',
    iconUrl: '/field-details/home.svg',
    category: 'facilities'
  },
  {
    slug: 'toilets',
    label: 'Toilets',
    iconUrl: '/field-details/home.svg',
    category: 'facilities'
  },
];

/**
 * Get amenity configuration by slug
 */
export function getAmenityBySlug(slug: string): AmenityConfig | undefined {
  if (!slug) return undefined;

  // Normalize slug for lookup
  const normalizedSlug = normalizeAmenitySlug(slug);

  return AMENITIES_CONFIG.find(amenity =>
    amenity.slug === slug ||
    amenity.slug === normalizedSlug ||
    amenity.slug.replace(/-/g, '') === normalizedSlug.replace(/-/g, '')
  );
}

/**
 * Get amenity icon URL by slug
 */
export function getAmenityIcon(slug: string, defaultIcon = '/field-details/shield.svg'): string {
  const amenity = getAmenityBySlug(slug);
  return amenity?.iconUrl || defaultIcon;
}

/**
 * Get amenity label by slug
 */
export function getAmenityLabel(slug: string): string {
  const amenity = getAmenityBySlug(slug);
  if (amenity) return amenity.label;

  // Fallback: format the slug
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Normalize amenity slug for consistent lookup
 */
export function normalizeAmenitySlug(slug: string): string {
  if (!slug) return '';

  return slug
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
}

/**
 * Transform amenities array to include icon URLs and labels
 */
export function transformAmenities(amenities: string[]): Array<{ label: string; iconUrl: string }> {
  if (!Array.isArray(amenities)) return [];

  return amenities
    .filter(amenity => amenity)
    .map(amenity => {
      const config = getAmenityBySlug(amenity);
      return {
        label: config?.label || getAmenityLabel(amenity),
        iconUrl: config?.iconUrl || '/field-details/shield.svg'
      };
    });
}
