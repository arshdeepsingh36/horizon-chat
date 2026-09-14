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

  const { uploadUrl, key, publicUrl } = await presignRes.json();

  if (!uploadUrl) {
    throw new Error('Server did not return a valid presigned upload URL.');
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
    throw new Error(`Direct R2 upload failed with status ${uploadRes.status}: ${uploadRes.statusText}`);
  }

  return {
    publicUrl,
    key,
    fileName,
    contentType,
    fileSize: fileToUpload.size
  };
}

export default uploadToR2;
