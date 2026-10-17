import { User, UserRole } from '../models/types.js';
export declare class UserRepository {
    static findById({ userId, businessId }: {
        userId: string;
        businessId: string;
    }): Promise<User | null>;
    static findByEmail(email: string): Promise<User | null>;
    static findByBusinessAndEmail({ email, businessId }: {
        email: string;
        businessId: string;
    }): Promise<User | null>;
    static listByBusiness(businessId: string): Promise<Omit<User, 'password_hash'>[]>;
    static create(data: {
        businessId: string;
        name: string;
        email: string;
        passwordHash: string;
        role: UserRole;
    }): Promise<User>;
}
