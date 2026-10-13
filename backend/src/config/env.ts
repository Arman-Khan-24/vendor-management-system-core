import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orderledger',
  jwtSecret: process.env.JWT_SECRET || 'super_secret_jwt_key_orderledger_dev_mode',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:5000',
};
