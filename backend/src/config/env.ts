import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const environment = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'super_secret_jwt_key_orderledger_dev_mode';

if (environment === 'production') {
  const normalizedSecret = jwtSecret.toLowerCase().replace(/[^a-z0-9]/g, '');
  const isPlaceholder = /supersecretjwtkeyorderledger|changeme|changethis|replaceme|replacewith|yourjwtsecret|yoursecret|example|placeholder|development|devmode|notforproduction/.test(normalizedSecret);
  if (!process.env.JWT_SECRET || jwtSecret.length < 32 || /\s/.test(jwtSecret) || /^(.)\1+$/.test(jwtSecret) || isPlaceholder) {
    throw new Error('JWT_SECRET must contain at least 32 characters with no whitespace and must not be a repeated character or example placeholder in production. Generate a random secret.');
  }
}

export const config = {
  env: environment,
  port: parseInt(process.env.PORT || '5000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orderledger',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:5000',
};
