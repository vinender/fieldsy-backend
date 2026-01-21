//@ts-nocheck
import prisma from '../config/database';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config/constants';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: 'DOG_OWNER' | 'FIELD_OWNER' | 'ADMIN';
  phone?: string;
  provider?: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string;
  bio?: string;
  image?: string;
}

class UserModel {
  // Helper to generate unique userId
  private async generateUserId(): Promise<string> {
    const counter = await prisma.counter.upsert({
      where: { name: 'user' },
      update: { value: { increment: 1 } },
      create: { name: 'user', value: 7777 },
    });
    return counter.value.toString();
  }

  // Helper to strip sensitive/internal IDs from user object for response
  stripInternalId(user: any) {
    if (!user) return null;
    const { id, ...userWithoutId } = user;
    return userWithoutId;
  }

  // Create a new user
  async create(data: CreateUserInput) {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const role = data.role || 'DOG_OWNER';

    // Get default commission rate from system settings for field owners
    let commissionRate: number | undefined = undefined;
    if (role === 'FIELD_OWNER') {
      // Get system settings for default commission rate
      const settings = await prisma.systemSettings.findFirst();
      commissionRate = settings?.defaultCommissionRate || 15.0; // Use 15% as fallback
    }

    // Generate unique human-readable userId
    const userId = await this.generateUserId();

    return prisma.user.create({
      data: {
        ...data,
        userId,
        password: hashedPassword,
        role,
        provider: data.provider || 'general',
        commissionRate,
      },
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        provider: true,
        image: true,
        googleImage: true,
        commissionRate: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Find user by email (returns first match, use for login without role)
  async findByEmail(email: string) {
    return prisma.user.findFirst({
      where: { email },
    });
  }

  // Find user by email and role
  async findByEmailAndRole(email: string, role: 'DOG_OWNER' | 'FIELD_OWNER' | 'ADMIN') {
    return prisma.user.findUnique({
      where: {
        email_role: {
          email,
          role
        }
      },
    });
  }

  // Find user by phone
  async findByPhone(phone: string) {
    return prisma.user.findFirst({
      where: { phone },
    });
  }

  // Find user by ID (handles both ObjectId and human-readable userId)
  async findById(id: string) {
    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    const where = isObjectId ? { id } : { userId: id };

    return prisma.user.findUnique({
      where,
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        bio: true,
        image: true,
        googleImage: true,
        provider: true,
        emailVerified: true,
        hasField: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Find user by ObjectId ONLY (for internal use)
  async findByInternalId(id: string) {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  // Update user
  async update(id: string, data: UpdateUserInput) {
    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    const where = isObjectId ? { id } : { userId: id };

    return prisma.user.update({
      where,
      data,
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        bio: true,
        image: true,
        googleImage: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Delete user
  async delete(id: string) {
    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    const where = isObjectId ? { id } : { userId: id };

    return prisma.user.delete({
      where,
    });
  }

  // Verify password
  async verifyPassword(plainPassword: string, hashedPassword: string) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  // Check if user has OAuth account
  async hasOAuthAccount(userId: string) {
    const account = await prisma.account.findFirst({
      where: { userId },
    });
    return !!account;
  }

  // Get OAuth providers for a user
  async getOAuthProviders(userId: string) {
    const accounts = await prisma.account.findMany({
      where: { userId },
      select: { provider: true },
    });
    return accounts.map(a => a.provider);
  }

  // Get all users (admin only)
  async findAll(skip = 0, take = 10) {
    return prisma.user.findMany({
      skip,
      take,
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        image: true,
        googleImage: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Create or update user from social login
  async createOrUpdateSocialUser(data: {
    email: string;
    name?: string;
    image?: string;
    provider: string;
    providerId: string;
    role?: 'DOG_OWNER' | 'FIELD_OWNER' | 'ADMIN';
  }) {
    const userRole = data.role || 'DOG_OWNER';

    // Check if user exists with same email (regardless of role)
    const existingUser = await this.findByEmail(data.email);

    if (existingUser) {
      // Check if the existing user has a different role
      if (existingUser.role !== userRole) {
        const roleNames = {
          DOG_OWNER: 'Dog Owner',
          FIELD_OWNER: 'Field Owner',
          ADMIN: 'Admin'
        };
        throw new Error(`This email is already registered as a ${roleNames[existingUser.role]}. Please select ${roleNames[existingUser.role]} to continue.`);
      }
      // Update existing user with social login info
      const updateData: any = {
        name: data.name || existingUser.name,
        // Keep user's uploaded image, store Google image separately
        image: existingUser.image, // Keep existing uploaded image
        emailVerified: new Date(), // Auto-verify when logging in with social provider
        provider: data.provider, // Update provider to track social login
      };

      // Store Google image separately if provider is Google
      if (data.provider === 'google' && data.image) {
        updateData.googleImage = data.image;
        // Only use Google image as primary if user has no uploaded image
        if (!existingUser.image) {
          updateData.image = data.image;
        }
      }

      return prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
        select: {
          id: true,
          userId: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          provider: true,
          image: true,
          googleImage: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    // Create new user from social login with specific role
    const userId = await this.generateUserId();
    const createData: any = {
      ...data,
      userId,
      email: data.email,
      name: data.name || data.email.split('@')[0],
      image: data.image,
      role: userRole,
      provider: data.provider,
      emailVerified: new Date(), // Social logins are automatically verified
    };

    // Store Google image separately if provider is Google
    if (data.provider === 'google' && data.image) {
      createData.googleImage = data.image;
    }

    return prisma.user.create({
      data: createData,
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        provider: true,
        image: true,
        googleImage: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Update user role
  async updateRole(id: string, role: 'DOG_OWNER' | 'FIELD_OWNER' | 'ADMIN') {
    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    const where = isObjectId ? { id } : { userId: id };

    return prisma.user.update({
      where,
      data: { role },
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        provider: true,
        image: true,
        googleImage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}

export default new UserModel();
