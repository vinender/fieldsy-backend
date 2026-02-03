//@ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as otpGenerator from 'otp-generator';
import { emailService } from './email.service';

const prisma = new PrismaClient();

export type OtpType = 'SIGNUP' | 'RESET_PASSWORD' | 'EMAIL_VERIFICATION' | 'SOCIAL_LOGIN' | 'EMAIL_CHANGE';

export class OtpService {
  private readonly OTP_LENGTH = 6;
  private readonly OTP_EXPIRY_MINUTES = 10;
  private readonly MAX_OTP_ATTEMPTS = 3;

  // Generate a 6-digit OTP
  generateOtp(): string {
    return otpGenerator.generate(this.OTP_LENGTH, {
      digits: true,
      lowerCaseAlphabets: false,
      upperCaseAlphabets: false,
      specialChars: false,
    });
  }

  // Create and save OTP to database
  async createOtp(email: string, type: OtpType): Promise<string> {
    try {
      // Delete any existing OTPs for this email and type
      await prisma.otpVerification.deleteMany({
        where: {
          email,
          type,
          verified: false,
        },
      });

      // Generate new OTP
      const otp = this.generateOtp();

      // Calculate expiry time
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.OTP_EXPIRY_MINUTES);

      // Save OTP to database
      await prisma.otpVerification.create({
        data: {
          email,
          otp,
          type,
          expiresAt,
        },
      });

      return otp;
    } catch (error) {
      console.error('Error creating OTP:', error);
      throw new Error('Failed to create OTP');
    }
  }

  // Check if OTP is valid without marking as verified
  async checkOtpValidity(email: string, otp: string, type: OtpType): Promise<boolean> {
    try {
      const otpRecord = await prisma.otpVerification.findFirst({
        where: {
          email,
          otp,
          type,
          verified: false,
          expiresAt: {
            gt: new Date(), // Not expired
          },
        },
      });

      return !!otpRecord;
    } catch (error) {
      console.error('Error checking OTP:', error);
      return false;
    }
  }

  // Verify OTP and mark as used
  async verifyOtp(email: string, otp: string, type: OtpType): Promise<boolean> {
    try {
      // Find the OTP record
      const otpRecord = await prisma.otpVerification.findFirst({
        where: {
          email,
          otp,
          type,
          verified: false,
          expiresAt: {
            gt: new Date(), // Not expired
          },
        },
      });

      if (!otpRecord) {
        return false;
      }

      // Mark OTP as verified
      await prisma.otpVerification.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          verified: true,
        },
      });

      return true;
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return false;
    }
  }

  // Send OTP via email
  async sendOtp(email: string, type: OtpType, name?: string): Promise<void> {
    try {
      // Create OTP
      const otp = await this.createOtp(email, type);

      // Send email with OTP
      await emailService.sendOtpEmail(email, otp, type, name);
    } catch (error) {
      console.error('Error sending OTP:', error);
      throw new Error('Failed to send OTP');
    }
  }

  // Resend OTP
  async resendOtp(email: string, type: OtpType, name?: string): Promise<void> {
    try {
      // Check if there's a recent OTP (prevent spam)
      const recentOtp = await prisma.otpVerification.findFirst({
        where: {
          email,
          type,
          verified: false,
          createdAt: {
            gt: new Date(Date.now() - 60 * 1000), // Within last minute
          },
        },
      });

      if (recentOtp) {
        throw new Error('Please wait a minute before requesting a new OTP');
      }

      // Send new OTP
      await this.sendOtp(email, type, name);
    } catch (error) {
      console.error('Error resending OTP:', error);
      throw error;
    }
  }

  // Clean up expired OTPs (can be run as a cron job)
  async cleanupExpiredOtps(): Promise<void> {
    try {
      await prisma.otpVerification.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: new Date(),
              },
            },
            {
              verified: true,
              updatedAt: {
                lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours old
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error('Error cleaning up expired OTPs:', error);
    }
  }

  // Check if email has pending verification
  async hasPendingVerification(email: string, type: OtpType): Promise<boolean> {
    const otpRecord = await prisma.otpVerification.findFirst({
      where: {
        email,
        type,
        verified: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    return !!otpRecord;
  }
}

export const otpService = new OtpService();
