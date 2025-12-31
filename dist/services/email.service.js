"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
//@ts-nocheck
const nodemailer = require('nodemailer');
const dotenv_1 = require("dotenv");
const constants_1 = require("../config/constants");
(0, dotenv_1.config)();
// Email configuration
const EMAIL_HOST = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587');
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const EMAIL_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '"Fieldsy" <noreply@fieldsy.com>';
// Create transporter only if email credentials are provided
let transporter = null;
if (EMAIL_USER && EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_SECURE,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });
    // Verify transporter connection
    transporter.verify((error, success) => {
        if (error) {
            console.warn('Email service not configured properly:', error.message);
            console.warn('Emails will not be sent. Please configure EMAIL_USER and EMAIL_PASS in .env');
        }
        else {
            console.log('✅ Email service is ready to send messages');
        }
    });
}
else {
    console.warn('⚠️ Email service disabled: EMAIL_USER or EMAIL_PASS not configured in .env');
    console.warn('To enable email verification, please set EMAIL_USER and EMAIL_PASS in your .env file');
}
// Email templates
const getOtpEmailTemplate = (otp, name) => {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
            text-align: center;
          }
          .otp-code {
            display: inline-block;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            color: #4CAF50;
            background-color: #f0f8f0;
            padding: 15px 30px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background-color: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 25px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Verify Your Email</h1>
            <p>Hi ${name || 'there'},</p>
            <p>Thank you for signing up with Fieldsy! Please use the following verification code to complete your registration:</p>
            <div class="otp-code">${otp}</div>
            <p><strong>This code will expire in 10 minutes.</strong></p>
            <p>If you didn't request this verification, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getFieldClaimStatusTemplate = (statusData) => {
    const isApproved = statusData.status === 'APPROVED';
    const statusColor = isApproved ? '#4CAF50' : '#f44336';
    const statusText = isApproved ? 'Approved' : 'Rejected';
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Field Claim ${statusText}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid ${statusColor};
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .status-badge {
            display: inline-block;
            background-color: ${statusColor};
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 18px;
            margin: 20px 0;
          }
          .info-box {
            background-color: ${isApproved ? '#f0f8f0' : '#fff5f5'};
            border-left: 4px solid ${statusColor};
            padding: 15px;
            margin: 20px 0;
          }
          .next-steps {
            background-color: #fff7e6;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
          }
          .next-steps h3 {
            color: #ff8c00;
            margin-top: 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background-color: ${statusColor};
            color: white;
            text-decoration: none;
            border-radius: 25px;
            margin-top: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Field Claim ${statusText}</h1>
            <p>Dear ${statusData.fullName},</p>
            
            ${isApproved ? `
              <p>Great news! Your claim for the field has been <strong>approved</strong>. You can now manage your field listing on Fieldsy.</p>
            ` : `
              <p>We regret to inform you that your claim for the field has been <strong>rejected</strong> after careful review.</p>
            `}
            
            <div class="status-badge">Status: ${statusText}</div>

            ${isApproved && statusData.credentials ? `
              <div class="info-box" style="background-color: #fff7e6; border-left-color: #ff8c00;">
                <h3 style="color: #ff8c00; margin-top: 0;">🔐 Your Field Owner Account Credentials</h3>
                <p style="margin-bottom: 15px;">We've created your field owner account. Please use these credentials to log in:</p>
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                  <p style="margin: 5px 0;"><strong>Email:</strong> <code style="background-color: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${statusData.credentials.email}</code></p>
                  <p style="margin: 5px 0;"><strong>Password:</strong> <code style="background-color: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${statusData.credentials.password}</code></p>
                </div>
                <p style="color: #d63031; font-size: 14px; margin-top: 10px;">
                  ⚠️ <strong>Important:</strong> Please save these credentials in a secure location. We recommend changing your password after your first login.
                </p>
              </div>
            ` : ''}

            ${isApproved && statusData.existingAccount ? `
              <div class="info-box" style="background-color: #e3f2fd; border-left-color: #2196F3;">
                <h3 style="color: #2196F3; margin-top: 0;">🔐 Your Existing Account</h3>
                <p style="margin-bottom: 15px;">Good news! You already have a Fieldsy account. Your field has been linked to your existing account.</p>
                <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                  <p style="margin: 5px 0;"><strong>Email:</strong> <code style="background-color: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${statusData.existingAccount.email}</code></p>
                  ${statusData.existingAccount.isGoogleAccount ? `
                    <p style="margin: 10px 0 5px 0;">
                      <span style="display: inline-flex; align-items: center; background-color: #fff; border: 1px solid #ddd; padding: 8px 12px; border-radius: 4px;">
                        <img src="https://www.google.com/favicon.ico" alt="Google" style="width: 16px; height: 16px; margin-right: 8px;" />
                        <strong>Sign in with Google</strong>
                      </span>
                    </p>
                    <p style="margin-top: 10px; font-size: 14px; color: #666;">
                      Your account was created using Google Sign-In. Please use the <strong>"Continue with Google"</strong> button on the login page to access your account.
                    </p>
                  ` : `
                    <p style="margin-top: 10px; font-size: 14px; color: #666;">
                      Log in using your existing password. If you've forgotten your password, use the "Forgot Password" option on the login page.
                    </p>
                  `}
                </div>
              </div>
            ` : ''}

            <div class="info-box">
              <h3>Field Details:</h3>
              <p><strong>Field Name:</strong> ${statusData.fieldName}</p>
              <p><strong>Location:</strong> ${statusData.fieldAddress}</p>
              ${statusData.reviewNotes ? `
                <p><strong>Review Notes:</strong> ${statusData.reviewNotes}</p>
              ` : ''}
            </div>
            
            ${statusData.documents && statusData.documents.length > 0 && isApproved ? `
            <div class="info-box">
              <h3>Your Submitted Documents:</h3>
              <p style="margin-bottom: 10px; color: #666;">For your reference, these were the documents you submitted:</p>
              <ul style="margin: 10px 0; padding-left: 20px;">
                ${statusData.documents.map((doc, index) => {
        const fileName = doc.split('/').pop() || `Document ${index + 1}`;
        const isFullUrl = doc.startsWith('http://') || doc.startsWith('https://');
        return `
                    <li style="margin: 8px 0;">
                      ${isFullUrl ?
            `<a href="${doc}" style="color: #4CAF50; text-decoration: none; font-weight: 500;" target="_blank">${fileName}</a>` :
            `<span style="color: #555;">${fileName}</span>`}
                    </li>
                  `;
    }).join('')}
              </ul>
            </div>
            ` : ''}
            
            ${isApproved ? `
              <div class="next-steps">
                <h3>🎉 What's Next?</h3>
                <ul>
                  <li>Log in to your Fieldsy account to manage your field</li>
                  <li>Update your field details and pricing</li>
                  <li>Add high-quality photos to attract more bookings</li>
                  <li>Set your availability and booking rules</li>
                  <li>Start receiving bookings from dog owners!</li>
                </ul>
              </div>
              
              <p>Congratulations on becoming a Fieldsy field owner! We're excited to have you as part of our community.</p>
            ` : `
              <div class="next-steps">
                <h3>📋 What Can You Do?</h3>
                <ul>
                  <li>Review the rejection reason provided above</li>
                  <li>Gather additional documentation if needed</li>
                  <li>Contact our support team for clarification</li>
                  <li>Submit a new claim with updated information</li>
                </ul>
              </div>
              
              <p>If you believe this decision was made in error or have additional documentation to provide, please contact our support team.</p>
            `}
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getFieldClaimTemplate = (claimData) => {
    const formattedDate = new Date(claimData.submittedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Field Claim Confirmation</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .status-badge {
            display: inline-block;
            background-color: #FFA500;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #f0f8f0;
            border-left: 4px solid #4CAF50;
            padding: 15px;
            margin: 20px 0;
          }
          .info-item {
            margin: 10px 0;
          }
          .info-label {
            font-weight: bold;
            color: #555;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
          .next-steps {
            background-color: #fff7e6;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
          }
          .next-steps h3 {
            color: #ff8c00;
            margin-top: 0;
          }
          .next-steps ul {
            margin: 10px 0;
            padding-left: 20px;
          }
          .next-steps li {
            margin: 8px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Field Claim Submission Received</h1>
            <p>Dear ${claimData.fullName},</p>
            <p>Thank you for submitting your claim for the field. We have successfully received your submission and our team will review it shortly.</p>
            
            <div class="status-badge">Status: Under Review</div>
            
            <div class="info-box">
              <h3>Claim Details:</h3>
              <div class="info-item">
                <span class="info-label">Field Name:</span> ${claimData.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Field Location:</span> ${claimData.fieldAddress}
              </div>
              <div class="info-item">
                <span class="info-label">Submitted By:</span> ${claimData.fullName}
              </div>
              <div class="info-item">
                <span class="info-label">Contact Email:</span> ${claimData.email}
              </div>
              <div class="info-item">
                <span class="info-label">Phone Number:</span> ${claimData.phoneNumber}
              </div>
              <div class="info-item">
                <span class="info-label">Legal Owner:</span> ${claimData.isLegalOwner ? 'Yes' : 'No'}
              </div>
              <div class="info-item">
                <span class="info-label">Submission Date:</span> ${formattedDate}
              </div>
            </div>
            
            ${claimData.documents && claimData.documents.length > 0 ? `
            <div class="info-box">
              <h3>Submitted Documents:</h3>
              <p style="margin-bottom: 10px; color: #666;">The following ownership documents were submitted with your claim:</p>
              <ul style="margin: 10px 0; padding-left: 20px;">
                ${claimData.documents.map((doc, index) => {
        // Extract filename from URL or path
        const fileName = doc.split('/').pop() || `Document ${index + 1}`;
        // Check if it's a full URL or just a path
        const isFullUrl = doc.startsWith('http://') || doc.startsWith('https://');
        return `
                    <li style="margin: 8px 0;">
                      ${isFullUrl ?
            `<a href="${doc}" style="color: #4CAF50; text-decoration: none; font-weight: 500;" target="_blank">${fileName}</a>` :
            `<span style="color: #555;">${fileName}</span>`}
                    </li>
                  `;
    }).join('')}
              </ul>
              <p style="margin-top: 10px; font-size: 12px; color: #888;">
                <em>Note: These documents are securely stored and will be reviewed by our verification team.</em>
              </p>
            </div>
            ` : ''}
            
            <div class="next-steps">
              <h3>📋 What Happens Next?</h3>
              <ul>
                <li>Our verification team will review your submitted documents</li>
                <li>We may contact you if additional information is needed</li>
                <li>You will receive an email notification once your claim is approved or if we need more information</li>
                <li>The typical review process takes 2-3 business days</li>
              </ul>
            </div>
            
            <p><strong>Important:</strong> Please ensure your submitted ownership documents are valid and up-to-date. If we cannot verify your ownership, we may need to request additional documentation.</p>
            
            <p>If you have any questions about your claim or need to provide additional information, please don't hesitate to contact our support team.</p>
            
            <p>Thank you for choosing Fieldsy to list your field!</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
            <p>This is an automated confirmation email. Please do not reply directly to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getPasswordResetTemplate = (otp, name) => {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
            text-align: center;
          }
          .otp-code {
            display: inline-block;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            color: #4CAF50;
            background-color: #f0f8f0;
            padding: 15px 30px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Password Reset Request</h1>
            <p>Hi ${name || 'there'},</p>
            <p>We received a request to reset your password. Please use the following code to proceed:</p>
            <div class="otp-code">${otp}</div>
            <p><strong>This code will expire in 10 minutes.</strong></p>
            <p>If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getBookingConfirmationTemplate = (bookingData) => {
    const formattedDate = new Date(bookingData.date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmed</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .success-badge {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #f0f8f0;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .info-item {
            margin: 12px 0;
            font-size: 15px;
          }
          .info-label {
            font-weight: bold;
            color: #555;
            display: inline-block;
            min-width: 120px;
          }
          .price {
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Booking Confirmed!</h1>
            <div class="success-badge">✓ Payment Successful</div>
            <p>Dear ${bookingData.userName},</p>
            <p>Your booking has been confirmed and paid for successfully! Get ready for a great time with your furry friend.</p>

            <div class="info-box">
              <h3 style="margin-top: 0;">Booking Details</h3>
              <div class="info-item">
                <span class="info-label">Booking ID:</span> #${bookingData.bookingId.slice(-8).toUpperCase()}
              </div>
              <div class="info-item">
                <span class="info-label">Field:</span> ${bookingData.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Location:</span> ${bookingData.fieldAddress}
              </div>
              <div class="info-item">
                <span class="info-label">Date:</span> ${formattedDate}
              </div>
              <div class="info-item">
                <span class="info-label">Time:</span> ${bookingData.startTime} - ${bookingData.endTime}
              </div>
              <div class="info-item">
                <span class="info-label">Field Owner:</span> ${bookingData.fieldOwnerName}
              </div>
              <div class="info-item" style="margin-top: 20px; padding-top: 15px; border-top: 2px dashed #ccc;">
                <span class="info-label">Total Paid:</span> <span class="price">£${bookingData.totalPrice.toFixed(2)}</span>
              </div>
            </div>

            <p><strong>What's Next?</strong></p>
            <ul>
              <li>You'll receive a reminder 24 hours before your booking</li>
              <li>You can contact the field owner through our messaging system</li>
              <li>Please arrive on time to make the most of your booking</li>
              <li>Have fun and enjoy your time at the field!</li>
            </ul>

            <p>If you have any questions or need to make changes to your booking, please contact us through the app.</p>

            <p>Thank you for choosing Fieldsy!</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getNewBookingNotificationTemplate = (bookingData) => {
    const formattedDate = new Date(bookingData.date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Booking Received</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .new-badge {
            display: inline-block;
            background-color: #FF9800;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #fff8e1;
            border-left: 4px solid #FF9800;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .earnings-box {
            background-color: #e8f5e9;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .info-item {
            margin: 12px 0;
            font-size: 15px;
          }
          .info-label {
            font-weight: bold;
            color: #555;
            display: inline-block;
            min-width: 140px;
          }
          .price {
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>New Booking Received!</h1>
            <div class="new-badge">🎉 New Booking</div>
            <p>Dear ${bookingData.ownerName},</p>
            <p>Great news! You have received a new booking for your field.</p>

            <div class="info-box">
              <h3 style="margin-top: 0;">Booking Details</h3>
              <div class="info-item">
                <span class="info-label">Booking ID:</span> #${bookingData.bookingId.slice(-8).toUpperCase()}
              </div>
              <div class="info-item">
                <span class="info-label">Field:</span> ${bookingData.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Customer:</span> ${bookingData.dogOwnerName}
              </div>
              <div class="info-item">
                <span class="info-label">Date:</span> ${formattedDate}
              </div>
              <div class="info-item">
                <span class="info-label">Time:</span> ${bookingData.startTime} - ${bookingData.endTime}
              </div>
            </div>

            <div class="earnings-box">
              <h3 style="margin-top: 0;">💰 Your Earnings</h3>
              <div class="info-item">
                <span class="info-label">Total Booking Price:</span> £${bookingData.totalPrice.toFixed(2)}
              </div>
              <div class="info-item">
                <span class="info-label">Platform Commission:</span> £${bookingData.platformCommission.toFixed(2)}
              </div>
              <div class="info-item" style="margin-top: 15px; padding-top: 15px; border-top: 2px dashed #4CAF50;">
                <span class="info-label">Your Payout:</span> <span class="price">£${bookingData.fieldOwnerAmount.toFixed(2)}</span>
              </div>
            </div>

            <p><strong>What's Next?</strong></p>
            <ul>
              <li>The booking amount has been secured via Stripe</li>
              <li>Your payout will be processed after the booking is completed</li>
              <li>You can message the customer through the app if needed</li>
              <li>Please ensure your field is ready for the booking time</li>
            </ul>

            <p>If you have any questions or concerns, please contact our support team.</p>

            <p>Thank you for being part of Fieldsy!</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getFieldSubmissionTemplate = (data) => {
    const formattedDate = new Date(data.submittedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Field Submitted Successfully</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .success-badge {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #f0f8f0;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .info-item {
            margin: 12px 0;
            font-size: 15px;
          }
          .info-label {
            font-weight: bold;
            color: #555;
            display: inline-block;
            min-width: 140px;
          }
          .next-steps {
            background-color: #fff7e6;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
          }
          .next-steps h3 {
            color: #ff8c00;
            margin-top: 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Field Submitted Successfully!</h1>
            <div class="success-badge">✓ Submission Complete</div>
            <p>Dear ${data.ownerName},</p>
            <p>Congratulations! Your field has been successfully submitted to Fieldsy and is now live on our platform.</p>

            <div class="info-box">
              <h3 style="margin-top: 0;">Field Details</h3>
              <div class="info-item">
                <span class="info-label">Field Name:</span> ${data.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Location:</span> ${data.fieldAddress}
              </div>
              <div class="info-item">
                <span class="info-label">Submitted On:</span> ${formattedDate}
              </div>
            </div>

            <div class="next-steps">
              <h3>🎉 What's Next?</h3>
              <ul>
                <li>Your field is now visible to dog owners searching for fields</li>
                <li>You'll receive notifications when bookings are made</li>
                <li>You can manage your field details and availability in your dashboard</li>
                <li>Update pricing and booking rules anytime from your account</li>
                <li>Start receiving bookings and earning money!</li>
              </ul>
            </div>

            <p><strong>Important Tips:</strong></p>
            <ul>
              <li>Keep your field information up to date</li>
              <li>Respond promptly to booking requests</li>
              <li>Maintain good communication with dog owners</li>
              <li>Ensure your field is ready before each booking</li>
            </ul>

            <p>Thank you for joining Fieldsy! We're excited to have you as part of our community of field owners.</p>

            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getFieldApprovalTemplate = (data) => {
    const formattedDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Field Approved</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .success-badge {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #f0f8f0;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .info-item {
            margin: 12px 0;
            font-size: 15px;
          }
          .info-label {
            font-weight: bold;
            color: #555;
            display: inline-block;
            min-width: 140px;
          }
          .next-steps {
            background-color: #fff7e6;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
          }
          .next-steps h3 {
            color: #ff8c00;
            margin-top: 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
          .celebration {
            text-align: center;
            font-size: 48px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <div class="celebration">🎉</div>
            <h1 style="text-align: center;">Your Field Has Been Approved!</h1>
            <div class="success-badge" style="display: block; text-align: center;">✓ Approved & Live</div>
            <p>Dear ${data.ownerName},</p>
            <p>Congratulations! Great news - your field has been reviewed and <strong>approved</strong> by our admin team. Your field is now live on Fieldsy and visible to dog owners searching for fields!</p>

            <div class="info-box">
              <h3 style="margin-top: 0;">Field Details</h3>
              <div class="info-item">
                <span class="info-label">Field Name:</span> ${data.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Location:</span> ${data.fieldAddress}
              </div>
              <div class="info-item">
                <span class="info-label">Approved On:</span> ${formattedDate}
              </div>
              <div class="info-item">
                <span class="info-label">Status:</span> <span style="color: #4CAF50; font-weight: bold;">Active & Listed</span>
              </div>
            </div>

            <div class="next-steps">
              <h3>🎉 What's Next?</h3>
              <ul>
                <li><strong>Your field is now live</strong> and visible to all dog owners on Fieldsy</li>
                <li><strong>Start receiving bookings</strong> - You'll get email and in-app notifications</li>
                <li><strong>Manage your field</strong> - Update details, pricing, and availability anytime</li>
                <li><strong>Track your earnings</strong> - View booking history and payouts in your dashboard</li>
                <li><strong>Connect with customers</strong> - Respond to inquiries through our messaging system</li>
              </ul>
            </div>

            <p><strong>💰 Payment & Earnings:</strong></p>
            <ul>
              <li>You'll receive 80% of each booking amount (we take 20% platform fee)</li>
              <li>Payments are processed via Stripe after each completed booking</li>
              <li>Set up your Stripe Connect account to receive payouts</li>
            </ul>

            <p><strong>📈 Tips for Success:</strong></p>
            <ul>
              <li>Keep your field information accurate and up to date</li>
              <li>Add high-quality photos to attract more bookings</li>
              <li>Respond promptly to booking requests and messages</li>
              <li>Maintain good communication with dog owners</li>
              <li>Ensure your field is clean and ready before each booking</li>
            </ul>

            <p>Thank you for joining Fieldsy! We're excited to have you as part of our community of field owners helping dogs enjoy safe, secure spaces to play and exercise.</p>

            <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>

            <p><strong>Happy hosting!</strong></p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getBookingStatusChangeTemplate = (emailData) => {
    const formattedDate = new Date(emailData.date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const statusColors = {
        'CANCELLED': '#f44336',
        'COMPLETED': '#4CAF50',
        'CONFIRMED': '#2196F3'
    };
    const statusMessages = {
        'CANCELLED': 'Your booking has been cancelled.',
        'COMPLETED': 'Your booking has been completed. We hope you had a great time!',
        'CONFIRMED': 'Your booking has been confirmed.'
    };
    const statusColor = statusColors[emailData.newStatus] || '#FF9800';
    const statusMessage = statusMessages[emailData.newStatus] || `Your booking status has been updated to ${emailData.newStatus}.`;
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Status Update</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .status-badge {
            display: inline-block;
            background-color: ${statusColor};
            color: white;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: bold;
            margin: 15px 0;
          }
          .info-box {
            background-color: #f5f5f5;
            border-left: 4px solid ${statusColor};
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .info-item {
            margin: 12px 0;
            font-size: 15px;
          }
          .info-label {
            font-weight: bold;
            color: #555;
            display: inline-block;
            min-width: 120px;
          }
          .reason-box {
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h1>Booking Status Update</h1>
            <div class="status-badge">${emailData.newStatus}</div>
            <p>Dear ${emailData.userName},</p>
            <p>${statusMessage}</p>

            <div class="info-box">
              <h3 style="margin-top: 0;">Booking Details</h3>
              <div class="info-item">
                <span class="info-label">Booking ID:</span> #${emailData.bookingId.slice(-8).toUpperCase()}
              </div>
              <div class="info-item">
                <span class="info-label">Field:</span> ${emailData.fieldName}
              </div>
              <div class="info-item">
                <span class="info-label">Date:</span> ${formattedDate}
              </div>
              <div class="info-item">
                <span class="info-label">Time:</span> ${emailData.startTime} - ${emailData.endTime}
              </div>
            </div>

            ${emailData.reason ? `
            <div class="reason-box">
              <h3 style="margin-top: 0;">Reason:</h3>
              <p>${emailData.reason}</p>
            </div>
            ` : ''}

            ${emailData.newStatus === 'CANCELLED' ? `
              <p>If you were charged for this booking, a refund will be processed to your original payment method within 5-7 business days.</p>
            ` : ''}

            ${emailData.newStatus === 'COMPLETED' ? `
              <p>We hope you and your furry friend had a wonderful time! If you enjoyed your experience, please consider leaving a review for the field owner.</p>
            ` : ''}

            <p>If you have any questions, please don't hesitate to contact our support team.</p>

            <p>Thank you for using Fieldsy!</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find  or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
// Recurring booking email template for dog owner
const getRecurringBookingCreatedTemplateDogOwner = (data) => {
    const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Next Recurring Booking Scheduled</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .booking-card {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin: 25px 0;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .booking-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 15px;
          }
          .booking-detail {
            display: flex;
            align-items: center;
            margin: 12px 0;
            font-size: 16px;
          }
          .booking-icon {
            margin-right: 12px;
            font-size: 20px;
          }
          .info-box {
            background-color: #e8f5e9;
            border-left: 4px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
          }
          .highlight {
            background-color: #fff9c4;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: bold;
            color: #333;
          }
          .button {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
            margin-top: 30px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h2>Hi ${data.userName}! 👋</h2>
            <p>Great news! Your next <span class="highlight">${data.interval}</span> recurring booking has been automatically scheduled.</p>

            <div class="booking-card">
              <div class="booking-title">📅 Upcoming Booking Details</div>
              <div class="booking-detail">
                <span class="booking-icon">🏞️</span>
                <strong>Field:</strong> ${data.fieldName}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">📆</span>
                <strong>Date:</strong> ${formattedDate}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">⏰</span>
                <strong>Time:</strong> ${data.startTime} - ${data.endTime}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">🐕</span>
                <strong>Dogs:</strong> ${data.numberOfDogs}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">💰</span>
                <strong>Amount:</strong> £${data.totalPrice.toFixed(2)}
              </div>
            </div>

            <div class="info-box">
              <p><strong>ℹ️ What You Need to Know:</strong></p>
              <ul>
                <li>Your payment has been processed successfully</li>
                <li>This slot has been reserved for you</li>
                <li>Your ${data.interval} subscription will continue automatically</li>
                <li>You can manage or cancel your subscription anytime from your account</li>
              </ul>
            </div>

            <p style="text-align: center;">
              <a href="${constants_1.FRONTEND_URL}/user/my-bookings" class="button">View Booking</a>
            </p>

            <p>See you at the field! 🐕‍🦺</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find or Host secure fields for your furry friends 🐕</p>
            <p style="font-size: 12px; margin-top: 10px;">
              You're receiving this email because you have an active recurring booking subscription.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
};
// Recurring booking email template for field owner
const getRecurringBookingCreatedTemplateFieldOwner = (data) => {
    const formattedDate = new Date(data.bookingDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Recurring Booking Scheduled</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 2px solid #4CAF50;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
          }
          .content {
            padding: 30px 20px;
          }
          .booking-card {
            background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin: 25px 0;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .booking-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 15px;
          }
          .booking-detail {
            display: flex;
            align-items: center;
            margin: 12px 0;
            font-size: 16px;
          }
          .booking-icon {
            margin-right: 12px;
            font-size: 20px;
          }
          .earnings-box {
            background-color: #e8f5e9;
            border: 2px solid #4CAF50;
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
            text-align: center;
          }
          .earnings-amount {
            font-size: 32px;
            font-weight: bold;
            color: #4CAF50;
            margin: 10px 0;
          }
          .highlight {
            background-color: #fff9c4;
            padding: 3px 8px;
            border-radius: 4px;
            font-weight: bold;
            color: #333;
          }
          .button {
            display: inline-block;
            background-color: #2196F3;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
            margin-top: 30px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>
          <div class="content">
            <h2>Hi ${data.ownerName}! 👋</h2>
            <p>A <span class="highlight">${data.interval}</span> recurring booking has been automatically scheduled for your field.</p>

            <div class="booking-card">
              <div class="booking-title">📅 Booking Details</div>
              <div class="booking-detail">
                <span class="booking-icon">🏞️</span>
                <strong>Field:</strong> ${data.fieldName}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">👤</span>
                <strong>Dog Owner:</strong> ${data.dogOwnerName}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">📆</span>
                <strong>Date:</strong> ${formattedDate}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">⏰</span>
                <strong>Time:</strong> ${data.startTime} - ${data.endTime}
              </div>
              <div class="booking-detail">
                <span class="booking-icon">🐕</span>
                <strong>Dogs:</strong> ${data.numberOfDogs}
              </div>
            </div>

            <div class="earnings-box">
              <p><strong>💰 Your Earnings</strong></p>
              <div class="earnings-amount">£${data.fieldOwnerAmount.toFixed(2)}</div>
              <p style="font-size: 14px; color: #666;">
                (Total: £${data.totalPrice.toFixed(2)} - £${(data.totalPrice - data.fieldOwnerAmount).toFixed(2)} platform fee)
              </p>
              <p style="font-size: 13px; color: #888; margin-top: 10px;">
                Payment will be processed after the booking is completed
              </p>
            </div>

            <p><strong>ℹ️ What This Means:</strong></p>
            <ul>
              <li>This is an automatic ${data.interval} recurring booking</li>
              <li>The slot has been reserved in your calendar</li>
              <li>The dog owner's payment has been processed successfully</li>
              <li>Please ensure your field is ready for the booking date</li>
            </ul>

            <p style="text-align: center;">
              <a href="${constants_1.FRONTEND_URL}/field-owner/preview" class="button">View Booking</a>
            </p>

            <p>Thank you for hosting with Fieldsy! 🏞️</p>
          </div>
          <div class="footer">
            <p>© 2025 Fieldsy. All rights reserved.</p>
            <p>Find or Host secure fields for your furry friends 🐕</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
// Email service class
class EmailService {
    async sendMail(to, subject, html) {
        console.log('📧 [sendMail] Starting...');
        console.log('📧 [sendMail] Transporter configured:', !!transporter);
        console.log('📧 [sendMail] To:', to);
        console.log('📧 [sendMail] Subject:', subject);
        console.log('📧 [sendMail] From:', EMAIL_FROM);
        if (!transporter) {
            console.warn(`⚠️ Email service disabled. Transporter is null.`);
            console.warn('Configure SMTP_USER/EMAIL_USER and SMTP_PASS/EMAIL_PASS in .env to enable email sending');
            console.warn(`Email that would have been sent to: ${to}`);
            console.warn(`Subject: ${subject}`);
            return false;
        }
        try {
            console.log('📧 [sendMail] Sending email via SMTP...');
            const info = await transporter.sendMail({
                from: EMAIL_FROM,
                to,
                subject,
                html,
            });
            console.log('✅ Email sent successfully!');
            console.log('✅ Message ID:', info.messageId);
            console.log('✅ Response:', info.response);
            return true;
        }
        catch (error) {
            console.error('❌ Failed to send email:', error.message);
            console.error('❌ Error code:', error.code);
            console.error('❌ Error command:', error.command);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }
    async sendOtpEmail(email, otp, type, name) {
        let subject;
        let html;
        switch (type) {
            case 'RESET_PASSWORD':
                subject = 'Password Reset - Fieldsy';
                html = getPasswordResetTemplate(otp, name);
                break;
            case 'SIGNUP':
            case 'EMAIL_VERIFICATION':
            default:
                subject = 'Email Verification - Fieldsy';
                html = getOtpEmailTemplate(otp, name);
                break;
        }
        return this.sendMail(email, subject, html);
    }
    async sendFieldClaimEmail(claimData) {
        const subject = 'Field Claim Submitted - Fieldsy';
        const html = getFieldClaimTemplate(claimData);
        try {
            const result = await this.sendMail(claimData.email, subject, html);
            console.log(`✅ Field claim confirmation email sent to ${claimData.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send field claim email to ${claimData.email}:`, error);
            // Don't throw error to prevent claim submission from failing
            return false;
        }
    }
    async sendFieldClaimStatusEmail(statusData) {
        const statusText = statusData.status === 'APPROVED' ? 'Approved' : 'Rejected';
        const subject = `Field Claim ${statusText} - Fieldsy`;
        // Log the email data for debugging
        console.log('📧 [sendFieldClaimStatusEmail] Preparing email...');
        console.log('📧 To:', statusData.email);
        console.log('📧 Subject:', subject);
        console.log('📧 Status:', statusData.status);
        console.log('📧 Has credentials:', !!statusData.credentials);
        console.log('📧 Has existing account:', !!statusData.existingAccount);
        if (statusData.existingAccount) {
            console.log('📧 Existing account provider:', statusData.existingAccount.provider);
            console.log('📧 Is Google account:', statusData.existingAccount.isGoogleAccount);
        }
        const html = getFieldClaimStatusTemplate({
            fullName: statusData.fullName,
            fieldName: statusData.fieldName,
            fieldAddress: statusData.fieldAddress,
            status: statusData.status,
            reviewNotes: statusData.reviewNotes,
            documents: statusData.documents,
            credentials: statusData.credentials,
            existingAccount: statusData.existingAccount
        });
        try {
            console.log('📧 [sendFieldClaimStatusEmail] Calling sendMail...');
            const result = await this.sendMail(statusData.email, subject, html);
            console.log(`✅ Field claim ${statusText.toLowerCase()} email sent to ${statusData.email}, result:`, result);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send field claim status email to ${statusData.email}:`, error?.message || error);
            // Re-throw to let the caller know about the failure
            throw error;
        }
    }
    async sendBookingConfirmationToDogOwner(bookingData) {
        const subject = 'Booking Confirmed - Fieldsy';
        const html = getBookingConfirmationTemplate(bookingData);
        try {
            const result = await this.sendMail(bookingData.email, subject, html);
            console.log(`✅ Booking confirmation email sent to ${bookingData.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send booking confirmation email to ${bookingData.email}:`, error);
            return false;
        }
    }
    async sendNewBookingNotificationToFieldOwner(bookingData) {
        const subject = 'New Booking Received - Fieldsy';
        const html = getNewBookingNotificationTemplate(bookingData);
        try {
            const result = await this.sendMail(bookingData.email, subject, html);
            console.log(`✅ New booking notification email sent to ${bookingData.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send new booking notification email to ${bookingData.email}:`, error);
            return false;
        }
    }
    async sendBookingStatusChangeEmail(emailData) {
        const subject = `Booking ${emailData.newStatus} - Fieldsy`;
        const html = getBookingStatusChangeTemplate(emailData);
        try {
            const result = await this.sendMail(emailData.email, subject, html);
            console.log(`✅ Booking status change email sent to ${emailData.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send booking status change email to ${emailData.email}:`, error);
            return false;
        }
    }
    async sendFieldSubmissionEmail(data) {
        const subject = 'Field Submitted Successfully - Fieldsy';
        const html = getFieldSubmissionTemplate(data);
        try {
            const result = await this.sendMail(data.email, subject, html);
            console.log(`✅ Field submission email sent to ${data.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send field submission email to ${data.email}:`, error);
            return false;
        }
    }
    async sendFieldApprovalEmail(data) {
        const subject = 'Your Field Has Been Approved! - Fieldsy';
        const html = getFieldApprovalTemplate({
            ownerName: data.ownerName,
            ownerEmail: data.email,
            fieldName: data.fieldName,
            fieldAddress: data.fieldAddress
        });
        try {
            const result = await this.sendMail(data.email, subject, html);
            console.log(`✅ Field approval email sent to ${data.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send field approval email to ${data.email}:`, error);
            return false;
        }
    }
    async sendRecurringBookingEmailToDogOwner(data) {
        const subject = `Your ${data.interval} booking has been scheduled! - Fieldsy`;
        const html = getRecurringBookingCreatedTemplateDogOwner(data);
        try {
            const result = await this.sendMail(data.email, subject, html);
            console.log(`✅ Recurring booking email sent to dog owner ${data.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send recurring booking email to ${data.email}:`, error);
            return false;
        }
    }
    async sendRecurringBookingEmailToFieldOwner(data) {
        const subject = `New ${data.interval} recurring booking scheduled - Fieldsy`;
        const html = getRecurringBookingCreatedTemplateFieldOwner(data);
        try {
            const result = await this.sendMail(data.email, subject, html);
            console.log(`✅ Recurring booking email sent to field owner ${data.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send recurring booking email to ${data.email}:`, error);
            return false;
        }
    }
    async sendFieldAddressChangeNotification(data) {
        const subject = `Field Address Updated: ${data.fieldName}`;
        // Detailed logging for address change notification
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📬 FIELD ADDRESS CHANGE EMAIL NOTIFICATION');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📧 Sender Email (FROM):', EMAIL_FROM || 'NOT CONFIGURED');
        console.log('📧 Recipient Email (TO):', data.adminEmail);
        console.log('📧 Subject:', subject);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('📋 Field Details:');
        console.log('   - Field Name:', data.fieldName);
        console.log('   - Field ID:', data.fieldId);
        console.log('   - Owner Name:', data.ownerName || 'N/A');
        console.log('   - Owner Email:', data.ownerEmail || 'N/A');
        console.log('───────────────────────────────────────────────────────────────');
        console.log('📍 Address Change:');
        console.log('   - Previous Address:', data.previousAddress);
        console.log('   - New Address:', data.newAddress);
        console.log('   - Change Date:', data.changeDate);
        console.log('───────────────────────────────────────────────────────────────');
        const html = getFieldAddressChangeNotificationTemplate({
            fieldName: data.fieldName,
            fieldId: data.fieldId,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
            previousAddress: data.previousAddress,
            newAddress: data.newAddress,
            changeDate: data.changeDate,
        });
        try {
            console.log('🚀 Attempting to send email...');
            const result = await this.sendMail(data.adminEmail, subject, html);
            if (result) {
                console.log('✅ EMAIL SENT SUCCESSFULLY');
                console.log('   - Status: DELIVERED');
                console.log('   - Recipient:', data.adminEmail);
                console.log('   - Sender:', EMAIL_FROM);
            }
            else {
                console.log('⚠️ EMAIL SEND RETURNED FALSE');
                console.log('   - Status: FAILED (sendMail returned false)');
                console.log('   - This may indicate email service is disabled or misconfigured');
            }
            console.log('═══════════════════════════════════════════════════════════════');
            return result;
        }
        catch (error) {
            console.log('❌ EMAIL SEND FAILED WITH ERROR');
            console.log('   - Status: ERROR');
            console.log('   - Recipient:', data.adminEmail);
            console.log('   - Sender:', EMAIL_FROM);
            console.log('   - Error:', error);
            console.log('═══════════════════════════════════════════════════════════════');
            return false;
        }
    }
    async sendBookingReminderEmail(data) {
        const subject = `Reminder: Your booking at ${data.fieldName} is coming up! - Fieldsy`;
        const html = getBookingReminderTemplate(data);
        try {
            const result = await this.sendMail(data.email, subject, html);
            console.log(`✅ Booking reminder email sent to ${data.email}`);
            return result;
        }
        catch (error) {
            console.error(`❌ Failed to send booking reminder email to ${data.email}:`, error);
            return false;
        }
    }
}
// Email template for booking reminder
const getBookingReminderTemplate = (data) => {
    const { format } = require('date-fns');
    const formattedDate = format(data.bookingDate, 'EEEE, MMMM d, yyyy');
    const reminderText = data.hoursUntilBooking >= 2
        ? `in ${data.hoursUntilBooking} hours`
        : 'very soon';
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Reminder</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333333;
            margin: 0;
            padding: 0;
            background-color: #f7f7f7;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            padding: 20px 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px 10px 0 0;
          }
          .logo {
            font-size: 32px;
            font-weight: bold;
            color: #ffffff;
          }
          .content {
            padding: 30px 20px;
          }
          .reminder-badge {
            display: inline-block;
            background-color: #ff6b6b;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            margin-bottom: 20px;
          }
          .booking-details {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e9ecef;
          }
          .detail-row:last-child {
            border-bottom: none;
          }
          .detail-label {
            font-weight: 600;
            color: #495057;
          }
          .detail-value {
            color: #212529;
          }
          .highlight {
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
            text-align: center;
            margin: 20px 0;
          }
          .cta-button {
            display: inline-block;
            background-color: #4CAF50;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin: 20px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666666;
            font-size: 14px;
            border-top: 1px solid #eeeeee;
          }
          .tips {
            background-color: #e7f3ff;
            padding: 15px;
            border-left: 4px solid #2196F3;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🐾 Fieldsy</div>
          </div>

          <div class="content">
            <div style="text-align: center;">
              <span class="reminder-badge">⏰ UPCOMING BOOKING</span>
            </div>

            <h2 style="color: #333; text-align: center;">Hi ${data.userName}!</h2>

            <p style="font-size: 16px; text-align: center;">
              Your booking at <strong>${data.fieldName}</strong> is coming up ${reminderText}!
            </p>

            <div class="highlight">
              ${data.timeSlot}
            </div>

            <div class="booking-details">
              <div class="detail-row">
                <span class="detail-label">📍 Location:</span>
                <span class="detail-value">${data.fieldName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">📅 Date:</span>
                <span class="detail-value">${formattedDate}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">⏰ Time:</span>
                <span class="detail-value">${data.startTime} - ${data.endTime}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">🐕 Number of Dogs:</span>
                <span class="detail-value">${data.numberOfDogs}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">📍 Address:</span>
                <span class="detail-value">${data.address}</span>
              </div>
            </div>

            <div class="tips">
              <strong>💡 Quick Tips:</strong>
              <ul style="margin: 10px 0; padding-left: 20px;">
                <li>Bring water and treats for your dogs</li>
                <li>Arrive 5-10 minutes early</li>
                <li>Make sure your dogs are ready for playtime!</li>
                <li>Check the field rules before arrival</li>
              </ul>
            </div>

            <div style="text-align: center;">
              <a href="${constants_1.FRONTEND_URL}/user/my-bookings" class="cta-button">
                View Booking Details
              </a>
            </div>

            <p style="text-align: center; color: #666; margin-top: 30px;">
              Have a great time with your furry friends! 🐾
            </p>
          </div>

          <div class="footer">
            <p>Need to reschedule or cancel? Log in to your account to manage your bookings.</p>
            <p>&copy; ${new Date().getFullYear()} Fieldsy. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getFieldAddressChangeNotificationTemplate = (data) => {
    const formattedDate = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(data.changeDate));
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Field Address Updated</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f7f7f7;
            margin: 0;
            padding: 0;
            color: #333333;
          }
          .container {
            max-width: 640px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.05);
          }
          .header {
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 16px;
            margin-bottom: 24px;
          }
          .header h1 {
            margin: 0;
            font-size: 22px;
            color: #222222;
          }
          .details {
            background-color: #f8faf8;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
          }
          .details p {
            margin: 8px 0;
          }
          .addresses {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
          }
          .address-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
          }
          .address-card h3 {
            margin: 0 0 8px;
            font-size: 16px;
            color: #4CAF50;
          }
          .footer {
            margin-top: 20px;
            font-size: 13px;
            color: #6b7280;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Field Address Updated</h1>
            <p style="margin: 8px 0 0; font-size: 14px; color: #666;">${formattedDate}</p>
          </div>

          <div class="details">
            <p><strong>Field:</strong> ${data.fieldName} (${data.fieldId})</p>
            <p><strong>Field Owner:</strong> ${data.ownerName || 'Field Owner'}${data.ownerEmail ? ` (${data.ownerEmail})` : ''}</p>
          </div>

          <div class="addresses">
            <div class="address-card">
              <h3>Previous Address</h3>
              <p>${data.previousAddress || 'Not provided'}</p>
            </div>
            <div class="address-card">
              <h3>New Address</h3>
              <p>${data.newAddress || 'Not provided'}</p>
            </div>
          </div>

          <div class="footer">
            <p>This email was sent automatically to let you know that a field owner changed their address details.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
// Commission change notification templates
const getDefaultCommissionChangeTemplate = (data) => {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #4CAF50, #45a049); padding: 30px 20px; text-align: center; color: white; }
          .content { padding: 30px; }
          .rate-box { background: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
          .rate-change { display: flex; justify-content: center; align-items: center; gap: 20px; flex-wrap: wrap; }
          .rate-item { padding: 15px 25px; border-radius: 8px; }
          .old-rate { background: #fee2e2; color: #dc2626; }
          .new-rate { background: #dcfce7; color: #16a34a; }
          .rate-value { font-size: 32px; font-weight: bold; }
          .rate-label { font-size: 12px; text-transform: uppercase; margin-top: 5px; }
          .arrow { font-size: 24px; color: #666; }
          .footer { padding: 20px; text-align: center; background: #f9f9f9; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Platform Commission Update</h1>
          </div>
          <div class="content">
            <p>Hi ${data.ownerName || 'Field Owner'},</p>
            <p>We wanted to let you know that the platform commission rate has been updated.</p>

            <div class="rate-box">
              <div class="rate-change">
                <div class="rate-item old-rate">
                  <div class="rate-value">${data.previousRate}%</div>
                  <div class="rate-label">Previous Rate</div>
                </div>
                <div class="arrow">→</div>
                <div class="rate-item new-rate">
                  <div class="rate-value">${data.newRate}%</div>
                  <div class="rate-label">New Rate</div>
                </div>
              </div>
            </div>

            <p><strong>What this means for you:</strong></p>
            <ul>
              <li>The new commission rate applies to all future bookings starting from today.</li>
              <li>Completed bookings will retain their original commission rates.</li>
              <li>Your earnings from upcoming bookings will be calculated using the new ${data.newRate}% platform fee.</li>
            </ul>

            <p>If you have any questions about this change, please don't hesitate to contact our support team.</p>

            <p>Best regards,<br>The Fieldsy Team</p>
          </div>
          <div class="footer">
            <p>This email was sent to notify you of changes to your Fieldsy account.</p>
            <p>© ${new Date().getFullYear()} Fieldsy. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
const getCustomCommissionChangeTemplate = (data) => {
    const rateDescription = data.useDefault
        ? `Your commission rate has been changed to use the platform default rate of ${data.newRate}%.`
        : `A custom commission rate of ${data.newRate}% has been set for your account.`;
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #4CAF50, #45a049); padding: 30px 20px; text-align: center; color: white; }
          .content { padding: 30px; }
          .rate-box { background: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
          .rate-change { display: flex; justify-content: center; align-items: center; gap: 20px; flex-wrap: wrap; }
          .rate-item { padding: 15px 25px; border-radius: 8px; }
          .old-rate { background: #fee2e2; color: #dc2626; }
          .new-rate { background: #dcfce7; color: #16a34a; }
          .rate-value { font-size: 32px; font-weight: bold; }
          .rate-label { font-size: 12px; text-transform: uppercase; margin-top: 5px; }
          .arrow { font-size: 24px; color: #666; }
          .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
          .badge-custom { background: #fef3c7; color: #d97706; }
          .badge-default { background: #e0e7ff; color: #4f46e5; }
          .footer { padding: 20px; text-align: center; background: #f9f9f9; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Your Commission Rate Updated</h1>
          </div>
          <div class="content">
            <p>Hi ${data.ownerName || 'Field Owner'},</p>
            <p>${rateDescription}</p>

            <div class="rate-box">
              <div class="rate-change">
                <div class="rate-item old-rate">
                  <div class="rate-value">${data.previousRate}%</div>
                  <div class="rate-label">Previous Rate</div>
                </div>
                <div class="arrow">→</div>
                <div class="rate-item new-rate">
                  <div class="rate-value">${data.newRate}%</div>
                  <div class="rate-label">New Rate</div>
                </div>
              </div>
              <div style="margin-top: 15px;">
                <span class="badge ${data.useDefault ? 'badge-default' : 'badge-custom'}">
                  ${data.useDefault ? 'Platform Default Rate' : 'Custom Rate'}
                </span>
              </div>
            </div>

            <p><strong>What this means for you:</strong></p>
            <ul>
              <li>The new commission rate of ${data.newRate}% applies to all your future bookings.</li>
              <li>Completed bookings will retain their original commission rates.</li>
              <li>For a £100 booking, your earnings will be £${(100 - data.newRate).toFixed(2)} after the platform fee.</li>
            </ul>

            <p>If you have any questions about this change, please contact our support team.</p>

            <p>Best regards,<br>The Fieldsy Team</p>
          </div>
          <div class="footer">
            <p>This email was sent to notify you of changes to your Fieldsy account.</p>
            <p>© ${new Date().getFullYear()} Fieldsy. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};
// Add methods to EmailService class for commission notifications
EmailService.prototype.sendDefaultCommissionChangeEmail = async function (data) {
    const subject = 'Platform Commission Rate Updated - Fieldsy';
    const html = getDefaultCommissionChangeTemplate({
        ownerName: data.ownerName,
        previousRate: data.previousRate,
        newRate: data.newRate,
    });
    try {
        const result = await this.sendMail(data.email, subject, html);
        console.log(`✅ Default commission change email sent to ${data.email}`);
        return result;
    }
    catch (error) {
        console.error(`❌ Failed to send default commission change email to ${data.email}:`, error);
        return false;
    }
};
EmailService.prototype.sendCustomCommissionChangeEmail = async function (data) {
    const subject = 'Your Commission Rate Has Been Updated - Fieldsy';
    const html = getCustomCommissionChangeTemplate({
        ownerName: data.ownerName,
        previousRate: data.previousRate,
        newRate: data.newRate,
        useDefault: data.useDefault,
    });
    try {
        const result = await this.sendMail(data.email, subject, html);
        console.log(`✅ Custom commission change email sent to ${data.email}`);
        return result;
    }
    catch (error) {
        console.error(`❌ Failed to send custom commission change email to ${data.email}:`, error);
        return false;
    }
};
exports.emailService = new EmailService();
