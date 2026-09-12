/**
 * Direct Cloudflare R2 Upload Helper (Zero-Cost Egress & Direct Binary Pipeline)
 * 
 * Flow:
 * 1. Request presigned upload URL from backend /api/upload/presigned-url
 * 2. Upload raw binary/blob directly to Cloudflare R2 endpoint via HTTP PUT
 * 3. Return the public URL and R2 key
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

  const fileName = file.name || `media_${Date.now()}`;
  const contentType = file.type || 'application/octet-stream';

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
    body: file
  });

  if (!uploadRes.ok) {
    throw new Error(`Direct R2 upload failed with status ${uploadRes.status}: ${uploadRes.statusText}`);
  }

  return {
    publicUrl,
    key,
    fileName,
    contentType,
    fileSize: file.size
  };
}

export default uploadToR2;
