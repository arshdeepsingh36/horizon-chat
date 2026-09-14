package com.chatapp.horizon.network

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import com.chatapp.horizon.models.PresignedUrlRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

data class R2UploadResult(
    val publicUrl: String,
    val key: String,
    val fileName: String,
    val contentType: String,
    val fileSizeBytes: Long
)

object R2Uploader {
    private const val TAG = "R2Uploader"

    private val r2Client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Retrieve active JWT token from persistent storage (horizon_token or fallback token)
     */
    fun getAuthToken(context: Context): String {
        val prefs = context.getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        return prefs.getString("horizon_token", null)
            ?: prefs.getString("token", "")
            ?: ""
    }

    /**
     * Resolve Uri (content:// or file://) into binary byte array
     */
    fun readBytesFromUri(context: Context, uri: Uri): ByteArray {
        return context.contentResolver.openInputStream(uri)?.use { stream ->
            stream.readBytes()
        } ?: throw IOException("Unable to open input stream for URI: $uri")
    }

    /**
     * Resolve filename from Uri or fallback
     */
    fun getFileNameFromUri(context: Context, uri: Uri, fallback: String): String {
        try {
            if (uri.scheme == "content") {
                context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex != -1 && cursor.moveToFirst()) {
                        val name = cursor.getString(nameIndex)
                        if (!name.isNullOrEmpty()) return name
                    }
                }
            }
            val path = uri.path
            if (path != null) {
                val cut = path.lastIndexOf('/')
                if (cut != -1) return path.substring(cut + 1)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not resolve file name from URI: ${e.message}")
        }
        return fallback
    }

    /**
     * Determine MIME Content-Type from URI, extension or fallback
     */
    fun resolveContentType(context: Context, uri: Uri?, fallbackType: String = "application/octet-stream"): String {
        if (uri != null) {
            val type = context.contentResolver.getType(uri)
            if (!type.isNullOrEmpty()) return type
        }
        return fallbackType
    }

    /**
     * Upload binary data directly to Cloudflare R2 using Presigned PUT URL.
     * Strictly matches Content-Type header between presign request and R2 PUT.
     */
    suspend fun uploadBinary(
        context: Context,
        bytes: ByteArray,
        uploadType: String = "chat_media", // "pfp" or "chat_media"
        recipientUsername: String = "general",
        mediaType: String = "image", // "image", "video", "voice", "file", "pfp"
        fileName: String,
        contentType: String,
        isViewOnce: Boolean = false,
        explicitToken: String? = null
    ): R2UploadResult = withContext(Dispatchers.IO) {
        val token = explicitToken ?: getAuthToken(context)
        if (token.isEmpty()) {
            val errMsg = "Authentication token is missing. Cannot perform R2 upload."
            Log.e(TAG, errMsg)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg)
        }

        val cleanContentType = contentType.ifBlank { "application/octet-stream" }
        val cleanFileName = fileName.ifBlank { "file_${System.currentTimeMillis()}.bin" }

        // 1. Request presigned upload URL from server
        val presignReq = PresignedUrlRequest(
            uploadType = uploadType,
            recipientUsername = recipientUsername,
            mediaType = mediaType,
            fileName = cleanFileName,
            contentType = cleanContentType,
            isViewOnce = isViewOnce,
            fileSizeBytes = bytes.size.toLong()
        )

        val presignResponse = try {
            ApiClient.apiService.getPresignedUploadUrl("Bearer $token", presignReq)
        } catch (e: Exception) {
            val errMsg = "Presigned URL network request failed: ${e.message}"
            Log.e(TAG, errMsg, e)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg, e)
        }

        if (!presignResponse.isSuccessful || presignResponse.body() == null) {
            val errorBody = presignResponse.errorBody()?.string() ?: "Empty error response"
            val status = presignResponse.code()
            val errMsg = "Failed to obtain presigned upload URL: HTTP $status - $errorBody"
            Log.e(TAG, errMsg)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg)
        }

        val presignBody = presignResponse.body()!!
        val uploadUrl = presignBody.uploadUrl
        val publicUrl = presignBody.publicUrl
        val r2Key = presignBody.key

        if (uploadUrl.isEmpty()) {
            val errMsg = "Server returned empty uploadUrl for presigned request."
            Log.e(TAG, errMsg)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg)
        }

        // 2. Execute direct binary PUT to Cloudflare R2
        val mediaTypeObj = cleanContentType.toMediaTypeOrNull()
        val requestBody = bytes.toRequestBody(mediaTypeObj)

        val putRequest = Request.Builder()
            .url(uploadUrl)
            .put(requestBody)
            .header("Content-Type", cleanContentType) // Strictly match Content-Type used in presigned URL request
            .build()

        val r2Response = try {
            r2Client.newCall(putRequest).execute()
        } catch (e: Exception) {
            val errMsg = "Direct R2 HTTP PUT failed: ${e.message}"
            Log.e(TAG, errMsg, e)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg, e)
        }

        if (!r2Response.isSuccessful) {
            val errBody = r2Response.body?.string() ?: ""
            val status = r2Response.code
            val errMsg = "Direct R2 PUT failed: HTTP status $status message=${r2Response.message} body=$errBody"
            Log.e(TAG, errMsg)
            System.err.println("[$TAG] $errMsg")
            throw IOException(errMsg)
        }

        Log.i(TAG, "Successfully uploaded ${bytes.size} bytes to R2. Key: $r2Key, Public URL: $publicUrl")

        return@withContext R2UploadResult(
            publicUrl = publicUrl,
            key = r2Key,
            fileName = cleanFileName,
            contentType = cleanContentType,
            fileSizeBytes = bytes.size.toLong()
        )
    }

    /**
     * Upload directly from a Uri (content:// or file://)
     */
    suspend fun uploadUri(
        context: Context,
        uri: Uri,
        uploadType: String = "chat_media",
        recipientUsername: String = "general",
        mediaType: String = "image",
        fallbackFileName: String = "file_${System.currentTimeMillis()}",
        explicitContentType: String? = null,
        isViewOnce: Boolean = false,
        explicitToken: String? = null
    ): R2UploadResult {
        val bytes = readBytesFromUri(context, uri)
        val fileName = getFileNameFromUri(context, uri, fallbackFileName)
        val contentType = explicitContentType ?: resolveContentType(context, uri)
        return uploadBinary(
            context = context,
            bytes = bytes,
            uploadType = uploadType,
            recipientUsername = recipientUsername,
            mediaType = mediaType,
            fileName = fileName,
            contentType = contentType,
            isViewOnce = isViewOnce,
            explicitToken = explicitToken
        )
    }

    /**
     * Upload directly from a File
     */
    suspend fun uploadFile(
        context: Context,
        file: File,
        uploadType: String = "chat_media",
        recipientUsername: String = "general",
        mediaType: String = "file",
        explicitContentType: String = "application/octet-stream",
        isViewOnce: Boolean = false,
        explicitToken: String? = null
    ): R2UploadResult {
        val bytes = file.readBytes()
        return uploadBinary(
            context = context,
            bytes = bytes,
            uploadType = uploadType,
            recipientUsername = recipientUsername,
            mediaType = mediaType,
            fileName = file.name,
            contentType = explicitContentType,
            isViewOnce = isViewOnce,
            explicitToken = explicitToken
        )
    }
}
