/**
 * Cloudflare R2 S3 Client Configuration
 * Release 3.2.3 - High-Speed Object Storage & Byte-Range Streaming
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

let s3Client = null;

if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
  console.log(`[R2] S3 Client initialized targeting bucket: ${env.R2_BUCKET_NAME}`);
} else {
  console.warn('[R2 WARNING] R2 credentials not fully provided. Media will use fallback URL routing.');
}

/**
 * Generates a presigned PUT URL for client-direct uploads to Cloudflare R2
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type of the file
 * @param {number} expiresIn - Expiry in seconds (default 3600)
 * @returns {Promise<string>}
 */
export async function getPresignedUploadUrl(key, contentType = 'application/octet-stream', expiresIn = 3600) {
  if (!s3Client) {
    throw new Error('Cloudflare R2 client is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Returns a readable stream for byte-range streaming from R2
 * @param {string} key - S3 object key
 * @param {string} range - Optional HTTP byte range header (e.g. 'bytes=0-1024')
 * @returns {Promise<{ stream: ReadableStream, contentLength: number, contentRange: string, contentType: string }>}
 */
export async function getMediaStream(key, range = null) {
  if (!s3Client) {
    throw new Error('Cloudflare R2 client is not configured');
  }

  const commandParams = {
    Bucket: env.R2_BUCKET_NAME,
    Key: key
  };

  if (range) {
    commandParams.Range = range;
  }

  const command = new GetObjectCommand(commandParams);
  const response = await s3Client.send(command);

  return {
    stream: response.Body,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    contentType: response.ContentType || 'video/mp4',
    acceptRanges: 'bytes'
  };
}

/**
 * Resolves the public or streaming URL for a given media object key
 * @param {string} key - S3 object key
 * @returns {string}
 */
export function getMediaPublicUrl(key) {
  if (!key) return '';
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }
  return `/api/chat/media/stream?key=${encodeURIComponent(key)}`;
}

export { s3Client };
