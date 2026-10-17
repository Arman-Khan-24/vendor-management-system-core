import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = decoded;
        req.businessId = decoded.businessId; // Strictly bounded to authenticated tenant
        next();
    }
    catch (err) {
        res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
        return;
    }
}
export function requireRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized: authentication required' });
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({ error: 'Forbidden: insufficient role privileges' });
            return;
        }
        next();
    };
}
