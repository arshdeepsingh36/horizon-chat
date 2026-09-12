package com.chatapp.horizon.models

import com.google.gson.annotations.SerializedName

data class ChatMessage(
    @SerializedName("id")
    var id: Long,

    @SerializedName("sender_id")
    val senderId: Int,

    @SerializedName("recipient_id")
    val recipientId: Int,

    @SerializedName("message_text")
    var messageText: String? = null,

    @SerializedName("attachment_type")
    var attachmentType: String = "NONE", // NONE, IMAGE, VIDEO, AUDIO, LOCATION, DOCUMENT

    @SerializedName("attachment_url")
    var attachmentUrl: String? = null,

    @SerializedName("thumbnail_blur")
    val thumbnailBlur: String? = null, // Base64 micro-thumbnail (~200 bytes)

    @SerializedName("file_size_bytes")
    val fileSizeBytes: Long = 0,

    @SerializedName("status")
    var status: String = "SENT", // PENDING, SENT, DELIVERED, READ

    @SerializedName("is_view_once")
    val isViewOnce: Boolean = false,

    @SerializedName("is_viewed")
    var isViewed: Boolean = false,

    @SerializedName("reply_to_id")
    val replyToId: Long? = null,

    @SerializedName("reactions")
    var reactions: Map<String, List<Int>> = emptyMap(),

    @SerializedName("is_pinned")
    var isPinned: Boolean = false,

    @SerializedName("deleted_for_everyone")
    var deletedForEveryone: Boolean = false,

    @SerializedName("local_client_id")
    var localClientId: String? = null,

    @SerializedName("created_at")
    val createdAt: String
)
