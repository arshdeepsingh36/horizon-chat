package com.chatapp.horizon.models

import com.google.gson.annotations.SerializedName

data class ChatMessage(
    @SerializedName("id")
    val id: Long,

    @SerializedName("sender_id")
    val senderId: Int,

    @SerializedName("recipient_id")
    val recipientId: Int,

    @SerializedName("message_text")
    val messageText: String? = null,

    @SerializedName("attachment_type")
    val attachmentType: String = "NONE", // NONE, IMAGE, FILE, AUDIO

    @SerializedName("attachment_url")
    val attachmentUrl: String? = null,

    @SerializedName("thumbnail_blur")
    val thumbnailBlur: String? = null, // Base64 micro-thumbnail (~200 bytes)

    @SerializedName("file_size_bytes")
    val fileSizeBytes: Long = 0,

    @SerializedName("status")
    var status: String = "SENT", // SENT, DELIVERED, READ

    @SerializedName("is_view_once")
    val isViewOnce: Boolean = false,

    @SerializedName("is_viewed")
    var isViewed: Boolean = false,

    @SerializedName("reply_to_id")
    val replyToId: Long? = null,

    @SerializedName("created_at")
    val createdAt: String
)
