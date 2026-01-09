// List fields from pages 114-123 (assuming 10 per page) that have no valid images
// Pages 114-123 = skip 1130 fields, take 100 fields

const skipCount = (114 - 1) * 10; // 1130
const takeCount = 10 * 10; // 100

print("Fetching fields from pages 114-123...");
print("Skip: " + skipCount + ", Limit: " + takeCount);
print("");

const fields = db.fields.find({})
  .sort({ createdAt: -1 })
  .skip(skipCount)
  .limit(takeCount)
  .toArray();

print("Total fields fetched: " + fields.length);
print("");

const fieldsWithoutImages = [];

fields.forEach((f, i) => {
  const img = f.images && f.images.length > 0 ? f.images[0] : f.image;
  let hasValidImage = false;

  if (img && img !== "null" && img !== "") {
    const lowerImg = img.toLowerCase();
    // Valid if starts with http and is not a map image
    if (lowerImg.startsWith("http")) {
      const isMapImage = lowerImg.includes("maps.google") ||
        lowerImg.includes("google.com/maps") ||
        lowerImg.includes("maps.googleapis.com") ||
        lowerImg.includes("staticmap") ||
        lowerImg.includes("street_view") ||
        lowerImg.includes("streetview") ||
        lowerImg.includes("openstreetmap") ||
        lowerImg.includes("mapbox");

      const isPlaceholder = lowerImg.includes("placeholder") || lowerImg.includes("/fields/field");

      if (!isMapImage && !isPlaceholder) {
        hasValidImage = true;
      }
    }
  }

  if (!hasValidImage) {
    fieldsWithoutImages.push({
      index: skipCount + i + 1,
      id: f._id.toString(),
      name: f.name,
      location: f.location && f.location.formatted_address
        ? f.location.formatted_address
        : (f.address ? f.address : "N/A"),
      image: img || "NONE"
    });
  }
});

print("=== FIELDS WITHOUT VALID IMAGES (Pages 114-123) ===");
print("Total without images: " + fieldsWithoutImages.length);
print("");

fieldsWithoutImages.forEach((f, i) => {
  print((i + 1) + ". " + f.name);
  print("   Position: #" + f.index);
  print("   ID: " + f.id);
  print("   Location: " + f.location);
  print("   Image: " + f.image);
  print("");
});
