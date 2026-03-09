import prisma from '../src/config/database';
import axios from 'axios';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_PAYMENT_WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 5000;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('Missing Stripe env vars');
    process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-07-30.basil' as any,
});

async function testSelfHealingWebhook() {
    console.log('🧪 Testing Self-Healing Payout Webhook...');

    // 1. Create a dummy user
    const user = await prisma.user.create({
        data: {
            email: `self-heal-${Date.now()}@example.com`,
            name: 'Self Heal User',
            role: 'FIELD_OWNER'
        }
    });

    console.log(`Created test user ${user.id}`);

    // 2. Create a REAL Stripe Connect Account via API
    const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: user.email,
        metadata: {
            userId: user.id // CRITICAL: This is what the backend uses to link
        }
    });

    console.log(`Created REAL Stripe Account: ${account.id}`);

    // 3. Ensure it is NOT in the DB
    const existing = await prisma.stripeAccount.findUnique({
        where: { stripeAccountId: account.id }
    });
    if (existing) {
        await prisma.stripeAccount.delete({ where: { id: existing.id } });
        console.log('Deleted existing local record to force self-healing');
    }

    // 4. Construct a dummy payout event
    const payoutId = `po_heal_${Date.now()}`;
    const payoutPayload = {
        id: payoutId,
        object: 'payout',
        amount: 7500, // £75.00
        currency: 'gbp',
        status: 'paid',
        arrival_date: Math.floor(Date.now() / 1000),
        metadata: {}
    };

    // Construct the event
    const event = {
        id: `evt_heal_${Date.now()}`,
        object: 'event',
        api_version: '2025-07-30.basil',
        created: Math.floor(Date.now() / 1000),
        data: {
            object: payoutPayload
        },
        livemode: false,
        pending_webhooks: 1,
        request: {
            id: `req_heal_${Date.now()}`,
            idempotency_key: `idem_heal_${Date.now()}`
        },
        type: 'payout.paid',
        account: account.id // The real account ID
    };

    // 5. Generate Signature
    const payloadString = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({
        payload: payloadString,
        secret: STRIPE_WEBHOOK_SECRET,
    });

    // 6. Send Webhook Request
    try {
        console.log('Sending webhook...');
        const response = await axios.post(`http://localhost:${PORT}/api/payments/webhook`, event, {
            headers: {
                'stripe-signature': header,
                'Content-Type': 'application/json'
            }
        });

        console.log('Webhook Response:', response.status, response.data);
    } catch (error: any) {
        console.error('Webhook Request Failed:', error.response ? error.response.data : error.message);
    }

    // 7. Verify DB - Account should be restored
    const restoredAccount = await prisma.stripeAccount.findUnique({
        where: { stripeAccountId: account.id }
    });

    if (restoredAccount) {
        console.log('✅ Success! Stripe Account record RESTORED in DB:', restoredAccount.id);
        if (restoredAccount.userId === user.id) {
            console.log('   - Linked to correct user');
        } else {
            console.error('   ❌ Linked to WRONG user:', restoredAccount.userId);
        }
    } else {
        console.error('❌ Failed! Stripe Account record NOT restored.');
    }

    // 8. Verify Payout
    const payout = await prisma.payout.findUnique({
        where: { stripePayoutId: payoutId }
    });

    if (payout) {
        console.log('✅ Success! Payout record created in DB:', payout.id);
    } else {
        console.error('❌ Failed! Payout record NOT found in DB.');
    }

    // Cleanup
    await prisma.payout.deleteMany({ where: { stripePayoutId: payoutId } });
    if (restoredAccount) {
        await prisma.stripeAccount.delete({ where: { id: restoredAccount.id } });
    }
    await prisma.user.delete({ where: { id: user.id } });
    // We can't delete the Stripe account easily via API without more permissions, but it's fine in Test mode
}

testSelfHealingWebhook()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
