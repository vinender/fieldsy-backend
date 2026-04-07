# Mobile App Integration Guide

A complete guide for native iOS/Android developers integrating Fieldsy's payment, payout, and booking system.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Authentication](#authentication)
- [Payment Flow — Dog Owners](#payment-flow--dog-owners)
- [Stripe Connect — Field Owners](#stripe-connect--field-owners)
- [Bookings](#bookings)
- [Earnings & Payouts — Field Owners](#earnings--payouts--field-owners)
- [Subscriptions (Recurring Bookings)](#subscriptions-recurring-bookings)
- [Webhooks & Real-Time Updates](#webhooks--real-time-updates)
- [Complete API Reference](#complete-api-reference)
- [Error Handling](#error-handling)
- [Integration Checklist](#integration-checklist)

---

## Architecture Overview

The mobile app communicates with the Fieldsy REST API. The payout engine runs server-side — the mobile app never interacts with it directly.

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────┐
│   Mobile App     │──────>│   Fieldsy API    │──────>│   Stripe     │
│  (iOS/Android)   │  REST │  (Express/Node)  │       │   (Payments) │
│                  │<──────│                  │<──────│              │
│  Stripe SDK      │───────│  Payout Engine   │       │   Connect    │
│  (card capture)  │direct │  (runs in-proc)  │       │   (payouts)  │
└──────────────────┘       └──────────────────┘       └──────────────┘
```

### What the mobile app does:
- Calls REST API for business logic (bookings, payments, earnings)
- Uses Stripe Mobile SDK for secure card capture and 3D Secure confirmation
- Displays payment/booking/earning data from API responses

### What the mobile app does NOT do:
- Install the payout engine package (server-only)
- Handle webhooks (server-side only)
- Access Stripe API directly (except via Stripe SDK for card capture)

---

## Prerequisites

### Stripe Mobile SDK

**iOS (Swift):**
```ruby
# Podfile
pod 'StripePaymentSheet'
```

**Android (Kotlin):**
```groovy
// build.gradle
implementation 'com.stripe:stripe-android:20.+'
```

**React Native:**
```bash
npm install @stripe/stripe-react-native
```

**Flutter:**
```yaml
# pubspec.yaml
dependencies:
  flutter_stripe: ^10.0.0
```

### API Base URL

```
Production: https://api.fieldsy.co.uk/api
Development: http://localhost:5000/api
```

### Stripe Publishable Key

Retrieve from the payment intent response or hardcode per environment:
```
Test: pk_test_...
Live: pk_live_...
```

---

## Authentication

All authenticated endpoints require a JWT Bearer token.

### Login

```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "user@example.com",
    "role": "DOG_OWNER"
  }
}
```

### Using the Token

Include in every authenticated request:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Social Login (Google/Apple)

```
POST /api/auth/google   → { idToken }
POST /api/auth/apple    → { identityToken, fullName }
```

Both return the same `{ token, user }` structure.

---

## Payment Flow — Dog Owners

This is the core flow for booking and paying for a field.

### Step 1: Check Slot Availability

```
POST /api/bookings/check-slots-availability
Content-Type: application/json

{
  "fieldId": "field_abc123",
  "date": "2025-03-25",
  "timeSlots": ["9:00AM - 10:00AM", "10:00AM - 11:00AM"]
}
```

**Response:**
```json
{
  "fieldId": "field_abc123",
  "date": "2025-03-25",
  "timeSlots": [
    { "slot": "9:00AM - 10:00AM", "available": true },
    { "slot": "10:00AM - 11:00AM", "available": false, "reason": "already_booked" }
  ]
}
```

### Step 2: Create Payment Intent

```
POST /api/payment/create-payment-intent
Authorization: Bearer <token>
Content-Type: application/json

{
  "fieldId": "field_abc123",
  "numberOfDogs": 1,
  "date": "2025-03-25",
  "timeSlots": ["9:00AM - 10:00AM"],
  "repeatBooking": "none",
  "amount": 15.00,
  "duration": "60min"
}
```

**Response:**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "bookingId": "booking_id",
  "publishableKey": "pk_live_xxx"
}
```

### Step 3: Confirm Payment with Stripe SDK

Use the `clientSecret` with the Stripe Mobile SDK to present the payment sheet or card form.

**iOS (Swift):**
```swift
import StripePaymentSheet

var paymentSheet: PaymentSheet?

func preparePaymentSheet(clientSecret: String) {
    var config = PaymentSheet.Configuration()
    config.merchantDisplayName = "Fieldsy"
    config.allowsDelayedPaymentMethods = false

    paymentSheet = PaymentSheet(
        paymentIntentClientSecret: clientSecret,
        configuration: config
    )
}

func presentPaymentSheet() {
    paymentSheet?.present(from: self) { result in
        switch result {
        case .completed:
            // Payment succeeded — call confirm endpoint
            confirmPayment(paymentIntentId: "pi_xxx", bookingId: "booking_id")
        case .failed(let error):
            showError(error.localizedDescription)
        case .canceled:
            // User dismissed the sheet
            break
        }
    }
}
```

**Android (Kotlin):**
```kotlin
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult

private lateinit var paymentSheet: PaymentSheet

fun setupPaymentSheet(clientSecret: String) {
    val config = PaymentSheet.Configuration(
        merchantDisplayName = "Fieldsy"
    )
    paymentSheet = PaymentSheet(this, ::onPaymentSheetResult)
    paymentSheet.presentWithPaymentIntent(clientSecret, config)
}

fun onPaymentSheetResult(result: PaymentSheetResult) {
    when (result) {
        is PaymentSheetResult.Completed -> {
            // Payment succeeded — call confirm endpoint
            confirmPayment(paymentIntentId, bookingId)
        }
        is PaymentSheetResult.Failed -> {
            showError(result.error.localizedMessage)
        }
        is PaymentSheetResult.Canceled -> { /* User dismissed */ }
    }
}
```

**React Native:**
```tsx
import { useStripe } from '@stripe/stripe-react-native';

const { initPaymentSheet, presentPaymentSheet } = useStripe();

// After getting clientSecret from API
await initPaymentSheet({
  paymentIntentClientSecret: clientSecret,
  merchantDisplayName: 'Fieldsy',
});

const { error } = await presentPaymentSheet();
if (!error) {
  // Payment succeeded — call confirm endpoint
  await confirmPayment(paymentIntentId, bookingId);
}
```

**Flutter:**
```dart
import 'package:flutter_stripe/flutter_stripe.dart';

// After getting clientSecret from API
await Stripe.instance.initPaymentSheet(
  paymentSheetParameters: SetupPaymentSheetParameters(
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Fieldsy',
  ),
);

await Stripe.instance.presentPaymentSheet();
// If no exception, payment succeeded — call confirm endpoint
await confirmPayment(paymentIntentId, bookingId);
```

### Step 4: Confirm Payment on Backend

```
POST /api/payment/confirm-payment
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentIntentId": "pi_xxx",
  "bookingId": "booking_id"
}
```

**Response:**
```json
{
  "success": true,
  "booking": {
    "id": "booking_id",
    "status": "CONFIRMED",
    "paymentStatus": "PAID",
    "totalPrice": 15.00,
    "date": "2025-03-25T00:00:00Z",
    "startTime": "9:00AM",
    "endTime": "10:00AM"
  },
  "message": "Payment confirmed successfully"
}
```

### Using a Saved Card

If the user has saved cards, include `paymentMethodId` in step 2. The backend will attempt to charge it immediately:

```
POST /api/payment/create-payment-intent
{
  "fieldId": "field_abc123",
  "amount": 15.00,
  "paymentMethodId": "pm_xxx",
  ...
}
```

**Response (auto-confirmed):**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "bookingId": "booking_id",
  "paymentSucceeded": true
}
```

If `paymentSucceeded: true`, skip steps 3-4 — the payment is already confirmed.

If `paymentSucceeded: false` (e.g., 3D Secure required), present the Stripe SDK with the `clientSecret` and proceed with steps 3-4.

---

## Saved Cards Management

### List Saved Cards

```
GET /api/payment/payment-methods
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "paymentMethods": [
    {
      "id": "pm_db_id",
      "stripePaymentMethodId": "pm_xxx",
      "brand": "visa",
      "last4": "4242",
      "expiryMonth": 12,
      "expiryYear": 2025,
      "isDefault": true
    }
  ]
}
```

### Add a New Card

**Step 1:** Create a Setup Intent:
```
POST /api/payment-method/setup-intent
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "clientSecret": "seti_xxx_secret_xxx",
  "customerId": "cus_xxx"
}
```

**Step 2:** Use the Stripe SDK to collect card details and confirm the SetupIntent with the `clientSecret`.

**Step 3:** Save the card:
```
POST /api/payment-method/
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentMethodId": "pm_xxx",
  "isDefault": true
}
```

### Set Default Card

```
PATCH /api/payment-method/:paymentMethodId/set-default
Authorization: Bearer <token>
```

### Delete a Card

```
DELETE /api/payment-method/:paymentMethodId
Authorization: Bearer <token>
```

---

## Stripe Connect — Field Owners

Field owners need a Stripe Connect account to receive payouts. The mobile app handles the onboarding flow using a WebView.

### Check Account Status

Call this on the earnings/payouts screen to determine what to show:

```
GET /api/stripe-connect/account-status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "hasAccount": true,
    "stripeAccountId": "acct_xxx",
    "chargesEnabled": true,
    "payoutsEnabled": true,
    "detailsSubmitted": true,
    "isFullySetup": true,
    "requirements": {
      "currentlyDue": [],
      "pastDue": []
    }
  }
}
```

**UI Logic:**
- `hasAccount: false` → Show "Set Up Payouts" button
- `hasAccount: true, isFullySetup: false` → Show "Complete Setup" with requirements
- `isFullySetup: true` → Show earnings dashboard

### Create Connect Account

```
POST /api/stripe-connect/create-account
Authorization: Bearer <token>
```

### Get Onboarding URL

```
POST /api/stripe-connect/onboarding-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "https://fieldsy.co.uk/mobile-redirect?status=success",
  "refreshUrl": "https://fieldsy.co.uk/mobile-redirect?status=refresh",
  "isMobile": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://connect.stripe.com/setup/s/xxx",
    "isMobile": true
  }
}
```

**Mobile Implementation:**
1. Open the URL in an in-app browser / WebView
2. Stripe collects bank details and identity verification
3. When done, Stripe redirects to your `returnUrl`
4. Intercept the redirect URL and close the WebView
5. Call `GET /api/stripe-connect/account-status` to check the result

### Get Balance

```
GET /api/stripe-connect/balance
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "available": 1250.50,
    "pending": 350.00,
    "currency": "GBP"
  }
}
```

### Request Manual Payout

```
POST /api/stripe-connect/payout
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 100.00,
  "currency": "gbp"
}
```

---

## Bookings

### Create Booking (without payment — use Payment Flow instead)

The normal flow is to use the [Payment Flow](#payment-flow--dog-owners) which creates the booking AND processes payment in one step.

### Get My Bookings

```
GET /api/bookings/my-bookings?page=1&limit=10&status=upcoming
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` — Page number (default 1)
- `limit` — Results per page (default 10)
- `status` — `upcoming`, `completed`, `cancelled` (optional)

**Response:**
```json
{
  "bookings": [
    {
      "id": "booking_id",
      "fieldName": "Sunny Meadow Field",
      "fieldAddress": "123 Green Lane, London",
      "fieldImages": ["https://..."],
      "date": "2025-03-25T00:00:00Z",
      "startTime": "9:00AM",
      "endTime": "10:00AM",
      "totalPrice": 15.00,
      "numberOfDogs": 1,
      "status": "CONFIRMED",
      "paymentStatus": "PAID",
      "bookingId": "5316"
    }
  ],
  "pagination": {
    "total": 25,
    "page": 1,
    "limit": 10,
    "totalPages": 3
  }
}
```

### Get Booking Details

```
GET /api/bookings/:id
Authorization: Bearer <token>
```

### Cancel Booking

```
PATCH /api/bookings/:id/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "Change of plans"
}
```

**Response:**
```json
{
  "id": "booking_id",
  "status": "CANCELLED",
  "refundEligible": true,
  "refundAmount": 15.00,
  "refundProcessed": true,
  "message": "Booking cancelled. Full refund of £15.00 initiated."
}
```

**Refund Rules:**
- **24+ hours before booking** → 100% refund
- **12-24 hours before** → 50% refund
- **Less than 12 hours** → No refund

### Check Refund Eligibility (before showing cancel button)

```
GET /api/bookings/:id/refund-eligibility
Authorization: Bearer <token>
```

**Response:**
```json
{
  "bookingId": "booking_id",
  "isEligible": true,
  "refundPercentage": 100,
  "hoursUntilBooking": 48,
  "requiredHoursInAdvance": 24,
  "message": "Eligible for full refund"
}
```

---

## Earnings & Payouts — Field Owners

### Earnings Dashboard

```
GET /api/earnings/dashboard
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalEarnings": 1500.00,
      "thisMonth": 250.50,
      "thisWeek": 50.00,
      "pendingPayout": 350.00,
      "lastPayoutDate": "2025-03-15T00:00:00Z"
    },
    "recentTransactions": [
      {
        "id": "txn_id",
        "date": "2025-03-16T10:30:00Z",
        "fieldName": "Sunny Field",
        "amount": 50.00,
        "status": "completed"
      }
    ],
    "payoutStatus": {
      "connectedAccount": true,
      "chargesEnabled": true,
      "payoutsEnabled": true
    }
  }
}
```

### Earnings Summary

```
GET /api/payouts/earnings/summary?period=month
Authorization: Bearer <token>
```

### Earnings History (Transactions)

```
GET /api/payouts/earnings/history?page=1&limit=10&status=&startDate=&endDate=
Authorization: Bearer <token>
```

**Response:**
```json
{
  "transactions": [
    {
      "id": "txn_id",
      "orderId": "#5316",
      "date": "2025-03-15T10:30:00Z",
      "amount": 50.00,
      "netAmount": 40.00,
      "platformFee": 10.00,
      "status": "completed",
      "type": "PAYMENT",
      "fieldName": "Sunny Field",
      "customerName": "Jane Doe"
    }
  ],
  "totalEarnings": 1250.50,
  "pagination": { "total": 27, "page": 1, "limit": 10, "totalPages": 3 }
}
```

### Transaction Details

```
GET /api/payouts/transactions/:transactionId
Authorization: Bearer <token>
```

### Payout History

```
GET /api/stripe-connect/payout-history?page=1&limit=10
Authorization: Bearer <token>
```

### Held Payouts

```
GET /api/earnings/held-payouts
Authorization: Bearer <token>
```

### Payout Summary (Auto-Payout Engine)

```
GET /api/auto-payout/summary
Authorization: Bearer <token>
```

---

## Subscriptions (Recurring Bookings)

### View My Recurring Bookings

```
GET /api/bookings/my-recurring
Authorization: Bearer <token>
```

### Cancel Recurring Booking

```
POST /api/bookings/:id/cancel-recurring
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "No longer need weekly booking"
}
```

**Response:**
```json
{
  "success": true,
  "subscriptionId": "sub_id",
  "message": "Recurring booking cancelled. Future bookings will not be created."
}
```

### Creating a Recurring Booking

Use the standard [Payment Flow](#payment-flow--dog-owners) with `repeatBooking` set:

```
POST /api/payment/create-payment-intent
{
  "fieldId": "field_abc123",
  "amount": 15.00,
  "timeSlots": ["9:00AM - 10:00AM"],
  "date": "2025-03-25",
  "repeatBooking": "weekly",
  "numberOfDogs": 1,
  "duration": "60min"
}
```

Valid `repeatBooking` values: `"none"`, `"everyday"`, `"weekly"`, `"monthly"`

The engine automatically:
- Creates a Stripe subscription for recurring payments
- Generates new bookings each billing cycle
- Retries failed payments up to 3 times
- Sends notifications on renewal/failure

---

## Webhooks & Real-Time Updates

The mobile app does NOT handle webhooks. Webhooks are processed server-side by the payout engine.

### Push Notifications

The server emits events when important things happen. Your mobile app should register for push notifications via Firebase Cloud Messaging (FCM):

```
POST /api/notifications/register-device
Authorization: Bearer <token>
Content-Type: application/json

{
  "fcmToken": "firebase_cloud_messaging_token",
  "platform": "ios"
}
```

### Events That Trigger Push Notifications

**Dog Owner receives:**
- `payment:succeeded` — "Booking confirmed at [field name]"
- `refund:processed` — "Refund of £X.XX processed"
- `subscription:renewed` — "Weekly booking renewed"
- `subscription:payment_failed` — "Payment failed for recurring booking"
- `order:confirmed` — "Your booking is confirmed"

**Field Owner receives:**
- `payout:completed` — "£X.XX has been sent to your bank"
- `payout:failed` — "Payout failed — please check your Stripe account"
- `payout:processing` — "Transfer of £X.XX initiated"
- `payout:pending_account` — "Set up Stripe to receive payouts"
- `connect:requirements_due` — "Stripe needs additional information"
- `order:new` — "New booking received for [field name]"
- `admin:earnings_update` — Earnings summary

### Polling for Updates (alternative to push)

If push notifications aren't available, poll these endpoints:

```
GET /api/notifications?page=1&limit=20&unreadOnly=true
Authorization: Bearer <token>
```

---

## Complete API Reference

### Payment Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payment/create-payment-intent` | Yes | Create Stripe payment + booking |
| POST | `/api/payment/confirm-payment` | Yes | Confirm after Stripe SDK |
| GET | `/api/payment/payment-methods` | Yes | List saved cards |

### Payment Method Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payment-method/setup-intent` | Yes | Start adding a new card |
| POST | `/api/payment-method/` | Yes | Save card after setup |
| PATCH | `/api/payment-method/:id/set-default` | Yes | Set default card |
| DELETE | `/api/payment-method/:id` | Yes | Remove saved card |

### Booking Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/bookings/my-bookings` | Yes | List user's bookings |
| GET | `/api/bookings/:id` | Yes | Booking details |
| PATCH | `/api/bookings/:id/cancel` | Yes | Cancel a booking |
| GET | `/api/bookings/:id/refund-eligibility` | Yes | Check refund eligibility |
| POST | `/api/bookings/check-slots-availability` | No | Check slot availability |
| GET | `/api/bookings/my-recurring` | Yes | List recurring bookings |
| POST | `/api/bookings/:id/cancel-recurring` | Yes | Cancel recurring booking |

### Stripe Connect Endpoints (Field Owners)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/stripe-connect/create-account` | Yes | Create Connect account |
| POST | `/api/stripe-connect/onboarding-link` | Yes | Get Stripe onboarding URL |
| GET | `/api/stripe-connect/account-status` | Yes | Check account status |
| GET | `/api/stripe-connect/balance` | Yes | Get account balance |
| POST | `/api/stripe-connect/payout` | Yes | Request manual payout |
| GET | `/api/stripe-connect/payout-history` | Yes | View payout history |
| POST | `/api/stripe-connect/update-bank` | Yes | Update bank details |
| DELETE | `/api/stripe-connect/disconnect` | Yes | Disconnect Stripe |

### Earnings & Payout Endpoints (Field Owners)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/earnings/dashboard` | Yes | Earnings overview |
| GET | `/api/payouts/earnings/history` | Yes | Transaction history |
| GET | `/api/payouts/earnings/summary` | Yes | Earnings summary |
| GET | `/api/payouts/transactions/:id` | Yes | Transaction details |
| GET | `/api/earnings/held-payouts` | Yes | View held payouts |
| GET | `/api/auto-payout/summary` | Yes | Auto-payout summary |
| POST | `/api/earnings/sync-payouts` | Yes | Sync from Stripe |

### Refund Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auto-payout/refund/:bookingId` | Yes | Process refund |

### Commission Endpoints (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/commission/settings` | Admin | Get commission rate |
| PUT | `/api/commission/settings` | Admin | Update commission rate |
| GET | `/api/commission/field-owner/:id` | Admin | Get merchant rate |
| PUT | `/api/commission/field-owner/:id` | Admin | Set merchant rate |

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad request | Show error message to user |
| 401 | Unauthorized | Redirect to login |
| 403 | Forbidden | Show "access denied" |
| 404 | Not found | Show "not found" |
| 409 | Conflict (slot taken) | Refresh availability, show message |
| 500 | Server error | Show generic error, retry |

### Payment-Specific Error Codes

| Code | Meaning | User Message |
|------|---------|-------------|
| `SLOT_UNAVAILABLE` | Time slot was just booked | "This slot is no longer available. Please select another." |
| `RECURRING_SLOT_CONFLICT` | Conflicts with recurring booking | "This slot conflicts with an existing recurring booking." |
| `PAYMENT_PROCESSING_ERROR` | Stripe payment failed | "Payment could not be processed. Please try again." |
| `PAYMENT_METHOD_EXPIRED` | Saved card expired | "Your card has expired. Please update your payment method." |
| `INSUFFICIENT_FUNDS` | Card declined | "Payment declined. Please try a different card." |

### Handling 3D Secure / SCA

Some payments require Strong Customer Authentication. When the Stripe SDK returns a `requires_action` status:

1. The Stripe SDK will automatically present the 3D Secure challenge
2. If the user completes it, the SDK returns success
3. If the user cancels, the SDK returns cancelled — show a "Payment cancelled" message
4. Call `POST /api/payment/confirm-payment` only after Stripe SDK confirms success

---

## Integration Checklist

### Dog Owner Features

- [ ] Field search and availability checking
- [ ] Payment flow with Stripe SDK (new card)
- [ ] Payment flow with saved card
- [ ] 3D Secure / SCA handling
- [ ] Saved cards management (add, remove, set default)
- [ ] View bookings (upcoming, completed, cancelled)
- [ ] Cancel booking with refund eligibility check
- [ ] Recurring booking creation (`repeatBooking` param)
- [ ] Cancel recurring booking
- [ ] Push notification registration
- [ ] Booking confirmation display

### Field Owner Features

- [ ] Stripe Connect onboarding (WebView flow)
- [ ] Account status checking
- [ ] Earnings dashboard
- [ ] Transaction history with pagination
- [ ] Payout history
- [ ] Held payouts view
- [ ] Manual payout request
- [ ] Balance display
- [ ] Bank account update
- [ ] Push notification for new bookings and payouts

### General

- [ ] JWT token storage (secure keychain/keystore)
- [ ] Token refresh on 401 responses
- [ ] UK timezone handling for all date/time displays
- [ ] Error handling for all API error codes
- [ ] Offline state handling
- [ ] Pull-to-refresh on list screens
- [ ] Loading states for all API calls

### Timezone Note

All dates from the API are in UTC. The mobile app should convert to UK timezone (`Europe/London`) for display, as all booking times are in UK time.

```swift
// iOS
let formatter = DateFormatter()
formatter.timeZone = TimeZone(identifier: "Europe/London")
```

```kotlin
// Android
val ukZone = ZoneId.of("Europe/London")
val ukTime = instant.atZone(ukZone)
```
