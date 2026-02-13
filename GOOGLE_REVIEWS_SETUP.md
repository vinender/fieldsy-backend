# Google Reviews Setup Guide

This guide explains how to scrape Google reviews from Google Maps and save them to your database.

## Prerequisites

- Puppeteer is already installed in package.json
- Prisma client needs to be regenerated after schema changes

## Step 1: Generate Prisma Client

Run this command from the backend directory to update the Prisma client with the new GoogleReview model:

```bash
cd backend
npm run prisma:generate
```

## Step 2: Scrape Google Reviews for "Field Day Dog Field"

Run the scraper script with the field ID and Google Maps URL:

```bash
node scripts/scrape-google-reviews.js 68e8d3458371de66da4bed51 "https://www.google.com/maps/place/Field+Day+Dog+Field/@52.0183678,-1.3740883,18z/data=!4m8!3m7!1s0x4876d75dae275d47:0x141dfd18f15308c6!8m2!3d52.0057838!4d-1.3711252!9m1!1b1!16s%2Fg%2F11wh5lkd9h!5m1!1e1?entry=ttu&g_ep=EgoyMDI2MDIxMC4wIKXMDSoASAFQAw%3D%3D"
```

### Command Breakdown:
- `68e8d3458371de66da4bed51` - The field ID from your database
- The URL in quotes is the Google Maps page for Field Day Dog Field

## Step 3: Verify Reviews Were Saved

After running the scraper, the reviews will be displayed in the console. You can also verify them in the database:

```bash
npm run prisma:studio
```

Then navigate to the `google_reviews` table to see the scraped reviews.

## How It Works

1. **Scraper Script** (`scripts/scrape-google-reviews.js`):
   - Uses Puppeteer to load the Google Maps page
   - Scrolls to load more reviews
   - Extracts review data (author, rating, text, time)
   - Saves reviews to the `google_reviews` table in MongoDB

2. **API Endpoint** (`/api/fields/:id/google-reviews`):
   - Fetches reviews from the database (not from Google API)
   - Calculates average rating
   - Returns formatted reviews to the frontend

3. **Frontend** (`FieldDetailsLegacy.tsx`):
   - Displays Google reviews below the regular Fieldsy reviews
   - Shows author name, photo, rating, and review text
   - Auto-fetches when the field page loads

## Adding Google Reviews to Other Fields

To add Google reviews for other fields:

1. Find the field ID in your database
2. Get the Google Maps URL for that field
3. Run the scraper script:
   ```bash
   node scripts/scrape-google-reviews.js <fieldId> "<googleMapsUrl>"
   ```

## Re-scraping Reviews

To update reviews (scrape again), just run the same command. The script will:
- Delete all existing Google reviews for that field
- Scrape fresh reviews from Google Maps
- Save the new reviews

## Troubleshooting

### No reviews found
- Check that the Google Maps URL is correct
- Verify the page has visible reviews
- Google's HTML structure may have changed (update selectors in the script)

### Puppeteer errors
- Make sure puppeteer is installed: `npm install`
- Check that you have enough disk space
- On some systems, you may need to install Chromium dependencies

### Database errors
- Ensure Prisma client is generated: `npm run prisma:generate`
- Check that the field ID exists in the database
- Verify MongoDB connection is working

## Notes

- Reviews are stored in the database, not fetched live from Google
- This avoids API rate limits and costs
- You need to re-run the scraper periodically to get new reviews
- The `googleMapsUrl` field in the Field model is optional and for reference only
