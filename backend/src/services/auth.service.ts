import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { BusinessRepository } from '../repositories/business.repo.js';
import { UserRepository } from '../repositories/user.repo.js';
import { ProductRepository } from '../repositories/product.repo.js';
import { AuthUserPayload } from '../middleware/auth.middleware.js';
import { UserRole } from '../models/types.js';
import { withTransaction } from '../database/connection.js';

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

    const email = data.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(data.password, 10);
    return withTransaction(async client => {
      // Login uses a global email. Serialize all account creation for that identity.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
      const existingUser = await UserRepository.findByEmail(email, client);
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
      }, client);

      // Seed products from template if specified
      if (business.category_template) {
        const template = await BusinessRepository.getCategoryTemplate(business.category_template, client);
        if (template && Array.isArray(template.seed_products) && template.seed_products.length > 0) {
          await ProductRepository.bulkCreate(business.id, template.seed_products, client);
        }
      }

      const user = await UserRepository.create({
        businessId: business.id,
        name: data.ownerName,
        email,
        passwordHash,
        role: 'OWNER'
      }, client);

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
    });
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
    email = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);
    return withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
      const existing = await UserRepository.findByEmail(email, client);
      if (existing) {
        throw new AppError('User with this email already exists', 409);
      }

      const user = await UserRepository.create({
        businessId,
        name,
        email: email.toLowerCase().trim(),
        passwordHash,
        role
      }, client);

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at
      };
    });
  }

  private static generateToken(payload: AuthUserPayload): string {
    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any
    });
  }
}
