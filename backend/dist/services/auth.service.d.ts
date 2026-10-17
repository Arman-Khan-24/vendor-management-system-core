import { UserRole } from '../models/types.js';
export declare class AuthService {
    static registerOwnerAndBusiness(data: {
        businessName: string;
        businessSlug: string;
        categoryTemplate?: string;
        phone?: string;
        ownerName: string;
        email: string;
        password: string;
    }): Promise<{
        token: string;
        user: {
            id: string;
            name: string;
            email: string;
            role: UserRole;
        };
        business: import("../models/types.js").Business;
    }>;
    static login(data: {
        email: string;
        password: string;
    }): Promise<{
        token: string;
        user: {
            id: string;
            name: string;
            email: string;
            role: UserRole;
        };
        business: import("../models/types.js").Business;
    }>;
    static createTeamMember({ businessId, name, email, password, role }: {
        businessId: string;
        name: string;
        email: string;
        password: string;
        role: UserRole;
    }): Promise<{
        id: string;
        name: string;
        email: string;
        role: UserRole;
        created_at: Date;
    }>;
    private static generateToken;
}
