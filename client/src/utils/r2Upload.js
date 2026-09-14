import imageCompression from 'browser-image-compression';

/**
 * Direct Cloudflare R2 Upload Helper (Zero-Cost Egress & Direct Binary Pipeline)
 * 
 * Flow:
 * 1. Compress image client-side if image (WebP 512x512 quality 0.85 for avatars, 1920x1080 <1MB for chat)
 * 2. Request presigned upload URL from backend /api/upload/presigned-url
 * 3. Upload raw binary/blob directly to Cloudflare R2 endpoint via HTTP PUT
 * 4. Return the public URL and R2 key
 */

export async function uploadToR2({
  file,
  uploadType = 'chat_media', // 'pfp' | 'chat_media'
  recipientUsername = 'general',
  mediaType = 'image', // 'image' | 'video' | 'voice' | 'file'
  isViewOnce = false,
  apiBaseUrl = 'http://localhost:5000',
  token,
  onProgress = null
}) {
  if (!file) throw new Error('No file provided for upload.');

  let fileToUpload = file;
  let fileName = file.name || `media_${Date.now()}`;
  let contentType = file.type || 'application/octet-stream';

  // Client-Side Image Compression using browser-image-compression
  const isImage = (file.type && file.type.startsWith('image/')) || mediaType === 'image' || uploadType === 'pfp';
  if (isImage && typeof window !== 'undefined') {
    try {
      if (uploadType === 'pfp' || mediaType === 'pfp') {
        // High-Quality Profile Picture: WebP at max 512x512 with quality ~0.85
        const pfpOptions = {
          maxSizeMB: 1,
          maxWidthOrHeight: 512,
          fileType: 'image/webp',
          initialQuality: 0.85,
          useWebWorker: true
        };
        const compressedBlob = await imageCompression(file, pfpOptions);
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
        fileName = `${nameWithoutExt || 'pfp'}.webp`;
        contentType = 'image/webp';
        fileToUpload = new File([compressedBlob], fileName, { type: 'image/webp' });
      } else {
        // Chat Images: Cap dimensions at 1920x1080 and target size under 1MB
        const chatOptions = {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          initialQuality: 0.85,
          useWebWorker: true
        };
        const compressedBlob = await imageCompression(file, chatOptions);
        contentType = compressedBlob.type || file.type || 'image/jpeg';
        fileToUpload = new File([compressedBlob], fileName, { type: contentType });
      }
    } catch (compressionError) {
      console.warn('[IMAGE COMPRESSION] Compression skipped or failed, using original file:', compressionError);
    }
  }

  // 1. Request signed upload URL from server
  const presignRes = await fetch(`${apiBaseUrl}/api/upload/presigned-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      uploadType,
      recipientUsername,
      mediaType,
      fileName,
      contentType,
      fileSizeBytes: fileToUpload.size,
      isViewOnce
    })
  });

  if (!presignRes.ok) {
    const errorData = await presignRes.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to generate upload URL (${presignRes.status})`);
  }

  const presignData = await presignRes.json();
  const { uploadUrl, key, publicUrl } = presignData || {};

  if (!uploadUrl || !publicUrl) {
    throw new Error('Server did not return a valid presigned upload URL or public URL.');
  }

  // 2. Direct binary PUT to Cloudflare R2
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType
    },
    body: fileToUpload
  });

  if (!uploadRes.ok) {
    throw new Error(`Direct R2 upload failed with HTTP status ${uploadRes.status}: ${uploadRes.statusText}`);
  }

  return {
    publicUrl,
    key,
    fileName,
    contentType,
    fileSize: fileToUpload.size
  };
}

/**
 * Sanitize and clean any malformed URL (e.g. markdown links, leading slashes)
 */
export function sanitizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();

  // If URL has leading / before http(s): /https://... -> https://...
  if (url.startsWith('/http://') || url.startsWith('/https://')) {
    url = url.slice(1);
  }

  // If URL is markdown link: [https://domain](https://domain)/path -> https://domain/path
  const mdMatch = url.match(/^\[(.*?)\]\((https?:\/\/[^\s\)]+)\)(.*)$/);
  if (mdMatch) {
    const base = mdMatch[2].replace(/\/+$/, '');
    const trailing = (mdMatch[3] || '').replace(/^\/+/, '');
    url = trailing ? `${base}/${trailing}` : base;
  } else if (url.startsWith('[') && url.includes('](')) {
    const match = url.match(/\]\((.*?)\)/);
    if (match && match[1]) {
      const rest = url.substring(url.indexOf(')') + 1);
      url = match[1] + rest;
    }
  }

  // Remove any leftover brackets or leading slashes before protocol
  url = url.replace(/^\/+/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('blob:')) {
    if (url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com') || url.includes('storage.cloud')) {
      url = `https://${url}`;
    }
  }

  return url;
}

export default uploadToR2;
