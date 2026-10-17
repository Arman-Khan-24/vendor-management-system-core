import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/types.js';
export interface AuthUserPayload {
    userId: string;
    businessId: string;
    email: string;
    role: UserRole;
    name: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthUserPayload;
            businessId?: string;
        }
    }
}
export declare function authenticate(req: Request, res: Response, next: NextFunction): void;
export declare function requireRoles(...allowedRoles: UserRole[]): (req: Request, res: Response, next: NextFunction) => void;
