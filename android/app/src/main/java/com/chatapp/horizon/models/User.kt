package com.chatapp.horizon.models

import com.google.gson.annotations.SerializedName

data class User(
    @SerializedName("id")
    val id: Int,

    @SerializedName("username")
    val username: String,

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

    @SerializedName("lastMessage")
    val lastMessage: ChatMessage? = null,

    @SerializedName("unreadCount")
    val unreadCount: Int = 0,

    @SerializedName("online")
    var online: Boolean = false
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
