#!/bin/bash

# Scrape Google Reviews for Field Day Dog Field
# Field ID: F1916

echo "🔍 Scraping Google Reviews for Field Day Dog Field (F1916)..."
echo ""

cd "$(dirname "$0")/.."

node scripts/scrape-google-reviews.js F1916 "https://www.google.com/maps/place/Field+Day+Dog+Field/@52.0183678,-1.3740883,18z/data=!4m8!3m7!1s0x4876d75dae275d47:0x141dfd18f15308c6!8m2!3d52.0057838!4d-1.3711252!9m1!1b1!16s%2Fg%2F11wh5lkd9h!5m1!1e1?entry=ttu&g_ep=EgoyMDI2MDIxMC4wIKXMDSoASAFQAw%3D%3D"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Reviews scraped successfully!"
  echo "📱 Visit the field page to see the Google reviews"
else
  echo ""
  echo "❌ Failed to scrape reviews"
  echo "💡 Make sure:"
  echo "   - You've run 'npm run prisma:generate' first"
  echo "   - Puppeteer is installed (npm install)"
  echo "   - MongoDB is running"
fi
