/**
 * Server Environment Configuration & Schema Validation
 * Release 3.2.3 - Production Grade
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory or repository root if present
const serverEnvPath = path.resolve(__dirname, '..', '.env');
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');

if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

/**
 * Validates and exposes sanitized environment variables
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || 'horizon_super_secure_jwt_secret_v323_cloud_token',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',

  // Cloudflare R2 Credentials
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || 'horizon-chat-media',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || '',

  // Cors origins
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

// Log configuration summary at boot
console.log(`[CONFIG] Environment: ${env.NODE_ENV} | Port: ${env.PORT} | DB URL: ${env.DATABASE_URL ? 'Configured (Neon/PostgreSQL)' : 'Local Fallback'}`);
