import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { UserRepository } from '../repositories/user.repo.js';
import { ProductRepository } from '../repositories/product.repo.js';
import { AuthUserPayload } from '../middleware/auth.middleware.js';
import { UserRole } from '../models/types.js';

export class AuthService {
  static async registerOwnerAndBusiness(data: {
    businessName: string;
    businessSlug: string;
    categoryTemplate?: string;
    phone?: string;
    ownerName: string;
    email: string;
    password: string;
  }) {
    // Check if business slug exists
    const existingBusiness = await BusinessRepository.findBySlug(data.businessSlug);
    if (existingBusiness) {
      throw new AppError('Business identifier/slug already taken. Please choose another.', 409);
    }

    // Check if email exists
    const existingUser = await UserRepository.findByEmail(data.email);
    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Create Business
    const business = await BusinessRepository.create({
      name: data.businessName,
      slug: data.businessSlug.toLowerCase().trim(),
      categoryTemplate: data.categoryTemplate || 'fruits_veg',
      phone: data.phone,
      currency: 'INR',
      invoiceTrigger: 'Delivered'
    });

    // Seed products from template if specified
    if (business.category_template) {
      const template = await BusinessRepository.getCategoryTemplate(business.category_template);
      if (template && Array.isArray(template.seed_products) && template.seed_products.length > 0) {
        await ProductRepository.bulkCreate(business.id, template.seed_products);
      }
    }

    // Hash password and create Owner user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const user = await UserRepository.create({
      businessId: business.id,
      name: data.ownerName,
      email: data.email.toLowerCase().trim(),
      passwordHash,
      role: 'OWNER'
    });

    // Generate JWT
    const token = this.generateToken({
      userId: user.id,
      businessId: business.id,
      email: user.email,
      role: user.role,
      name: user.name
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business
    };
  }

  static async login(data: { email: string; password: string }) {
    const user = await UserRepository.findByEmail(data.email.toLowerCase().trim());
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    const isValid = await bcrypt.compare(data.password, user.password_hash);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401);
    }

    const business = await BusinessRepository.findById(user.business_id);
    if (!business) {
      throw new AppError('Business tenant not found', 404);
    }

    const token = this.generateToken({
      userId: user.id,
      businessId: user.business_id,
      email: user.email,
      role: user.role,
      name: user.name
    });

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business
    };
  }

  static async createTeamMember({
    businessId,
    name,
    email,
    password,
    role
  }: {
    businessId: string;
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }) {
    const existing = await UserRepository.findByEmail(email.toLowerCase().trim());
    if (existing) {
      throw new AppError('User with this email already exists', 409);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await UserRepository.create({
      businessId,
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at
    };
  }

  private static generateToken(payload: AuthUserPayload): string {
    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any
    });
  }
}
