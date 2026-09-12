import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

/**
 * Storage Retention Policy:
 * Horizon Chat applies PERMANENT RETENTION for all media assets (PFP, public chat media, and view-once media).
 * No lifecycle rules or automatic object deletion routines are configured.
 * View-once state is tracked purely via database flags (`is_viewed`), preserving original media in R2.
 */

export function getR2Config() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'horizon-chat-media',
    publicUrl: process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_DOMAIN || '',
  };
}

/**
 * Check if Cloudflare R2 credentials are fully configured
 */
export function isR2Configured() {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2Config();
  return Boolean(
    accountId &&
    accessKeyId &&
    secretAccessKey &&
    bucketName &&
    !accountId.includes('your_') &&
    !accessKeyId.includes('your_')
  );
}

/**
 * Initialize and get Cloudflare R2 S3Client instance
 */
let _s3Client = null;
let _lastAccountId = null;
let _lastAccessKeyId = null;

export function getR2Client() {
  if (!isR2Configured()) {
    return null;
  }
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();

  if (!_s3Client || _lastAccountId !== accountId || _lastAccessKeyId !== accessKeyId) {
    _s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    _lastAccountId = accountId;
    _lastAccessKeyId = accessKeyId;
  }
  return _s3Client;
}

/**
 * Get the R2 Bucket Name
 */
export function getBucketName() {
  return getR2Config().bucketName;
}

/**
 * Format timestamp as YYYYMMDD_HHMMSS
 */
export function getFormattedTimestamp(date = new Date()) {
  const YYYY = date.getUTCFullYear();
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(date.getUTCDate()).padStart(2, '0');
  const HH = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}_${HH}${mm}${ss}`;
}

/**
 * Determine category folder: images | videos | voice | others
 */
export function getMediaCategory(mediaType = '', fileName = '', contentType = '') {
  const type = (mediaType || '').toLowerCase();
  const mime = (contentType || '').toLowerCase();
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  if (type === 'image' || mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) {
    return 'images';
  }
  if (type === 'video' || mime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'avi', '3gp'].includes(ext)) {
    return 'videos';
  }
  if (type === 'voice' || type === 'audio' || mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus'].includes(ext)) {
    return 'voice';
  }
  return 'others';
}

/**
 * Build structured Cloudflare R2 object key:
 * - Profile: {username}/pfp/user_{YYYYMMDD}_{HHMMSS}_pfp.png
 * - Chat Sent Public: {username}/sent/public/{recipient_username}/{images|videos|voice|others}/{filename}
 * - Chat Sent View-Once: {username}/sent/once_view/{recipient_username}/{images|videos|voice|others}/{filename}
 */
export function buildR2Key({
  username,
  uploadType = 'chat_media',
  recipientUsername = 'general',
  mediaType = '',
  fileName = '',
  contentType = '',
  isViewOnce = false,
}) {
  const cleanUsername = (username || 'user').replace(/[^a-zA-Z0-9_]/g, '_');
  const ext = (fileName.split('.').pop() || '').toLowerCase() || 'png';

  if (uploadType === 'pfp' || mediaType === 'pfp') {
    const timestamp = getFormattedTimestamp();
    return `${cleanUsername}/pfp/user_${timestamp}_pfp.${ext}`;
  }

  const category = getMediaCategory(mediaType, fileName, contentType);
  const viewFolder = isViewOnce ? 'once_view' : 'public';
  const cleanRecipient = (recipientUsername || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
  
  const originalName = fileName ? fileName.replace(/[^a-zA-Z0-9._-]/g, '_') : `file_${Date.now()}.${ext}`;
  const timestamp = getFormattedTimestamp();
  const finalFileName = `${timestamp}_${originalName}`;

  return `${cleanUsername}/sent/${viewFolder}/${cleanRecipient}/${category}/${finalFileName}`;
}

/**
 * Construct the public URL for an R2 object key
 */
export function getR2PublicUrl(key) {
  if (!key) return '';
  const { publicUrl, bucketName, accountId } = getR2Config();
  if (publicUrl) {
    const baseUrl = publicUrl.replace(/\/+$/, '');
    const cleanKey = key.replace(/^\/+/, '');
    return `${baseUrl}/${cleanKey}`;
  }
  // Fallback direct R2 endpoint if public domain is not configured
  return `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${key}`;
}

/**
 * Generate a presigned PUT URL for direct client-to-R2 upload
 * @param {Object} options
 * @param {string} options.key - R2 object key / path
 * @param {string} options.contentType - MIME type of the upload
 * @param {number} [options.expiresIn=3600] - Expiration in seconds (default 1 hour)
 * @returns {Promise<{ uploadUrl: string, key: string, publicUrl: string }>}
 */
export async function generatePresignedUploadUrl({ key, contentType, expiresIn = 3600 }) {
  const client = getR2Client();
  if (!client) {
    throw new Error('Cloudflare R2 is not configured. Missing or invalid credentials.');
  }
  const { bucketName } = getR2Config();

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  const publicUrl = getR2PublicUrl(key);

  return {
    uploadUrl,
    key,
    publicUrl,
  };
}

/**
 * Generate a presigned GET URL for private/authenticated object downloads
 * @param {Object} options
 * @param {string} options.key - R2 object key
 * @param {number} [options.expiresIn=3600] - Expiration in seconds
 * @returns {Promise<string>}
 */
export async function generatePresignedDownloadUrl({ key, expiresIn = 3600 }) {
  const client = getR2Client();
  if (!client) {
    throw new Error('Cloudflare R2 is not configured. Missing or invalid credentials.');
  }
  const { bucketName } = getR2Config();

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn });
}

export default {
  getR2Config,
  isR2Configured,
  getR2Client,
  getBucketName,
  getFormattedTimestamp,
  getMediaCategory,
  buildR2Key,
  getR2PublicUrl,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
};
