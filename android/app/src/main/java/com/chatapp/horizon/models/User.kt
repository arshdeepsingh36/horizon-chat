package com.chatapp.horizon.models

import com.google.gson.annotations.SerializedName

data class User(
    @SerializedName("id")
    val id: Int,

    @SerializedName("username")
    val username: String,

    @SerializedName("displayName")
    val displayName: String? = null,

    @SerializedName("bioStatus")
    val bioStatus: String? = null,

    @SerializedName("avatarUrl")
    val avatarUrl: String? = null,

    @SerializedName("online")
    var online: Boolean = false
)

data class AuthResponse(
    @SerializedName("token")
    val token: String,

    @SerializedName("user")
    val user: User
)

data class AuthRequest(
    @SerializedName("username")
    val username: String,

    @SerializedName("password")
    val password: String
)

data class Conversation(
    @SerializedName("partnerId")
    val partnerId: Int,

    @SerializedName("partnerUsername")
    val partnerUsername: String,

    @SerializedName("partnerDisplayName")
    val partnerDisplayName: String? = null,

    @SerializedName("partnerAvatarUrl")
    val partnerAvatarUrl: String? = null,

    @SerializedName("partnerBioStatus")
    val partnerBioStatus: String? = null,

    @SerializedName("lastMessage")
    val lastMessage: ChatMessage? = null,

    @SerializedName("unreadCount")
    val unreadCount: Int = 0,

    @SerializedName("online")
    var online: Boolean = false,

    var isTyping: Boolean = false
)

data class UpdateProfileRequest(
    @SerializedName("displayName")
    val displayName: String?,

    @SerializedName("bioStatus")
    val bioStatus: String?,

    @SerializedName("avatarUrl")
    val avatarUrl: String?
)

data class UpdatePasswordRequest(
    @SerializedName("currentPassword")
    val currentPassword: String,

    @SerializedName("newPassword")
    val newPassword: String
)

data class GenericResponse(
    @SerializedName("success")
    val success: Boolean,

    @SerializedName("message")
    val message: String? = null
)

data class ProfileResponse(
    @SerializedName("success")
    val success: Boolean,

    @SerializedName("user")
    val user: User
)

data class PresignRequest(
    @SerializedName("fileName")
    val fileName: String,

    @SerializedName("contentType")
    val contentType: String = "image/png",

    @SerializedName("fileSizeBytes")
    val fileSizeBytes: Long = 0
)

data class PresignResponse(
    @SerializedName("uploadUrl")
    val uploadUrl: String,

    @SerializedName("publicUrl")
    val publicUrl: String,

    @SerializedName("thumbnailBlur")
    val thumbnailBlur: String,

    @SerializedName("key")
    val key: String,

    @SerializedName("fileSizeBytes")
    val fileSizeBytes: Long
)

data class MediaUploadRequest(
    @SerializedName("imageBase64")
    val imageBase64: String,

    @SerializedName("fileName")
    val fileName: String? = null,

    @SerializedName("fileSizeBytes")
    val fileSizeBytes: Long? = null,

    @SerializedName("thumbnailBlur")
    val thumbnailBlur: String? = null
)

data class MediaUploadResponse(
    @SerializedName("attachmentUrl")
    val attachmentUrl: String,

    @SerializedName("thumbnailBlur")
    val thumbnailBlur: String?,

    @SerializedName("fileSizeBytes")
    val fileSizeBytes: Long
)
