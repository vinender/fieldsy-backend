
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Cleaning up localhost/dev tokens...');

    // Option 1: Delete tokens explicitly marked as from localhost dev environment if you can identify them
    // Since we don't track "origin" in the schema, we rely on the fact that you want to clear specific tokens 
    // or just clear ALL tokens for your user to reset the state.

    // Let's first list tokens for your user
    const email = 'chandel.vinender@gmail.com';
    const user = await prisma.user.findFirst({ where: { email } });

    if (!user) {
        console.error('User not found');
        return;
    }

    const tokens = await prisma.deviceToken.findMany({
        where: { userId: user.id }
    });

    console.log(`Found ${tokens.length} tokens for ${email}:`);
    tokens.forEach(t => console.log(`- [${t.platform}] ${t.token.substring(0, 20)}... (Active: ${t.isActive})`));

    // ASK: Do you want to delete all? 
    // Since we can't distinguish "localhost" tokens from "prod" tokens just by looking at the string (they are standard FCM tokens),
    // the safest way to stop "localhost" duplicates is to delete ALL tokens for your user.
    // Your production browser will simply re-register a fresh token next time you visit the site.

    const deleteResult = await prisma.deviceToken.deleteMany({
        where: { userId: user.id }
    });

    console.log(`✅ Deleted ${deleteResult.count} tokens. Please refresh the page on Production to re-register.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
