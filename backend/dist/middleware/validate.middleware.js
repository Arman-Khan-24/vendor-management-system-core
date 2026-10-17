import { ZodError } from 'zod';
export function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                res.status(400).json({
                    error: 'Validation error',
                    details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
                });
                return;
            }
            next(error);
        }
    };
}
