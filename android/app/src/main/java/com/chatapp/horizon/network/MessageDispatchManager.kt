package com.chatapp.horizon.network

import com.chatapp.horizon.models.ChatMessage
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.CopyOnWriteArrayList

object MessageDispatchManager {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val pendingQueue = CopyOnWriteArrayList<ChatMessage>()
    private val listeners = CopyOnWriteArrayList<MessageEventListener>()

    private var globalSocket: Socket? = null
    private var activeAuthToken: String = ""
    private var activeServerUrl: String = ApiClient.BASE_URL.trimEnd('/')

    interface MessageEventListener {
        fun onNewMessage(message: ChatMessage) {}
        fun onMessageStatusUpdated(messageId: Long, localClientId: String?, status: String) {}
        fun onMessageReactionUpdated(messageId: Long, reactions: Map<String, List<Int>>) {}
        fun onMessagePinned(messageId: Long, isPinned: Boolean) {}
        fun onMessageDeleted(messageId: Long, deletedForEveryone: Boolean, deletedByUsers: List<Int>) {}
        fun onUserTyping(userId: Int, isTyping: Boolean) {}
        fun onUserStatusChanged(userId: Int, status: String, lastSeen: String?) {}
        fun onConversationRead(readerId: Int, partnerId: Int, readAt: String) {}
        fun onMediaViewed(messageId: Long) {}
    }

    fun addListener(listener: MessageEventListener) {
        if (!listeners.contains(listener)) {
            listeners.add(listener)
        }
    }

    fun removeListener(listener: MessageEventListener) {
        listeners.remove(listener)
    }

    fun initialize(authToken: String, serverUrl: String = ApiClient.BASE_URL.trimEnd('/')) {
        if (authToken.isEmpty()) return
        activeAuthToken = authToken
        activeServerUrl = serverUrl

        if (globalSocket != null && globalSocket!!.connected()) {
            return
        }

        try {
            val options = IO.Options().apply {
                auth = mapOf("token" to authToken)
                reconnection = true
                reconnectionDelay = 1000
                reconnectionAttempts = Int.MAX_VALUE
            }

            globalSocket = IO.socket(serverUrl, options).apply {
                on("connect") {
                    scope.launch {
                        processPendingQueue()
                    }
                }

                on("new_message") { args ->
                    if (args.isNotEmpty()) {
                        val json = args[0] as? JSONObject ?: return@on
                        val msg = parseJsonMessage(json)
                        listeners.forEach { it.onNewMessage(msg) }
                    }
                }

                on("message_delivered_ack") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject
                        val mId = data?.optLong("messageId", -1L) ?: -1L
                        if (mId > 0) {
                            listeners.forEach { it.onMessageStatusUpdated(mId, null, "DELIVERED") }
                        }
                    }
                }

                on("message_read_ack") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject
                        val mId = data?.optLong("messageId", -1L) ?: -1L
                        if (mId > 0) {
                            listeners.forEach { it.onMessageStatusUpdated(mId, null, "READ") }
                        }
                    }
                }

                on("conversation_read") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject
                        val readerId = data?.optInt("readerId", 0) ?: 0
                        val partnerId = data?.optInt("partnerId", 0) ?: 0
                        val readAt = data?.optString("readAt", "") ?: ""
                        listeners.forEach { it.onConversationRead(readerId, partnerId, readAt) }
                    }
                }

                on("message_reaction") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val mId = data.optLong("messageId")
                        val rxJson = data.optJSONObject("reactions")
                        val reactionsMap = mutableMapOf<String, List<Int>>()
                        rxJson?.keys()?.forEach { emoji ->
                            val arr = rxJson.optJSONArray(emoji)
                            val userIds = mutableListOf<Int>()
                            if (arr != null) {
                                for (i in 0 until arr.length()) {
                                    userIds.add(arr.optInt(i))
                                }
                            }
                            reactionsMap[emoji] = userIds
                        }
                        listeners.forEach { it.onMessageReactionUpdated(mId, reactionsMap) }
                    }
                }

                on("message_deleted") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val mId = data.optLong("messageId")
                        val deletedForEveryone = data.optBoolean("deletedForEveryone", false)
                        val deletedArr = data.optJSONArray("deletedByUsers")
                        val deletedUsers = mutableListOf<Int>()
                        if (deletedArr != null) {
                            for (i in 0 until deletedArr.length()) {
                                deletedUsers.add(deletedArr.optInt(i))
                            }
                        }
                        listeners.forEach { it.onMessageDeleted(mId, deletedForEveryone, deletedUsers) }
                    }
                }

                on("message_pinned") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val mId = data.optLong("messageId")
                        val isPinned = data.optBoolean("isPinned", false)
                        listeners.forEach { it.onMessagePinned(mId, isPinned) }
                    }
                }

                on("user_typing") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val uId = data.optInt("userId", data.optInt("senderId", 0))
                        val isTyping = data.optBoolean("isTyping", false)
                        listeners.forEach { it.onUserTyping(uId, isTyping) }
                    }
                }

                on("user_status_changed") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val uId = data.optInt("userId")
                        val status = data.optString("status")
                        val lastSeen = data.optString("lastSeen")
                        listeners.forEach { it.onUserStatusChanged(uId, status, lastSeen) }
                    }
                }

                on("media_viewed") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val mId = data.optLong("messageId", -1L)
                        if (mId > 0) {
                            listeners.forEach { it.onMediaViewed(mId) }
                        }
                    }
                }

                connect()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun enqueueMessage(
        currentUserId: Int,
        recipientId: Int,
        text: String,
        attachmentType: String,
        attachmentUrl: String?,
        thumbnailBlur: String?,
        fileSizeBytes: Long,
        isViewOnce: Boolean,
        replyToId: Long?
    ): ChatMessage {
        val tempId = System.currentTimeMillis()
        val clientUid = UUID.randomUUID().toString()

        val optimisticMsg = ChatMessage(
            id = tempId,
            senderId = currentUserId,
            recipientId = recipientId,
            messageText = text,
            attachmentType = attachmentType,
            attachmentUrl = attachmentUrl,
            thumbnailBlur = thumbnailBlur,
            fileSizeBytes = fileSizeBytes,
            status = "PENDING",
            isViewOnce = isViewOnce,
            isViewed = false,
            replyToId = replyToId,
            localClientId = clientUid,
            createdAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(Date())
        )

        pendingQueue.add(optimisticMsg)

        scope.launch {
            processPendingQueue()
        }

        return optimisticMsg
    }

    private suspend fun processPendingQueue() {
        if (pendingQueue.isEmpty()) return
        val sock = globalSocket

        val iterator = pendingQueue.iterator()
        while (iterator.hasNext()) {
            val pending = iterator.next()
            val localId = pending.localClientId ?: continue

            val payload = JSONObject().apply {
                put("recipientId", pending.recipientId)
                put("text", pending.messageText ?: "")
                put("attachmentType", pending.attachmentType)
                if (pending.attachmentUrl != null) put("attachmentUrl", pending.attachmentUrl)
                if (pending.thumbnailBlur != null) put("thumbnailBlur", pending.thumbnailBlur)
                if (pending.fileSizeBytes > 0) put("fileSizeBytes", pending.fileSizeBytes)
                put("isViewOnce", pending.isViewOnce)
                if (pending.replyToId != null) put("replyToId", pending.replyToId)
                put("localClientId", localId)
            }

            if (sock != null && sock.connected()) {
                sock.emit("send_message", payload, io.socket.client.Ack { args ->
                    if (args.isNotEmpty()) {
                        val res = args[0] as? JSONObject
                        val savedObj = res?.optJSONObject("message")
                        if (savedObj != null) {
                            val serverMsg = parseJsonMessage(savedObj)
                            pendingQueue.remove(pending)
                            listeners.forEach {
                                it.onNewMessage(serverMsg)
                                it.onMessageStatusUpdated(serverMsg.id, localId, "SENT")
                            }
                        }
                    }
                })
            }
        }
    }

    fun emitReaction(messageId: Long, emoji: String) {
        globalSocket?.emit("message_reaction", JSONObject().apply {
            put("messageId", messageId)
            put("emoji", emoji)
        })
    }

    fun emitDelete(messageId: Long, deleteForEveryone: Boolean) {
        globalSocket?.emit("delete_message", JSONObject().apply {
            put("messageId", messageId)
            put("deleteForEveryone", deleteForEveryone)
        })
    }

    fun emitPin(messageId: Long, isPinned: Boolean) {
        globalSocket?.emit("pin_message", JSONObject().apply {
            put("messageId", messageId)
            put("isPinned", isPinned)
        })
    }

    fun emitBatchRead(partnerId: Int) {
        globalSocket?.emit("mark_conversation_read", JSONObject().apply {
            put("partnerId", partnerId)
        })
        scope.launch {
            try {
                if (activeAuthToken.isNotEmpty()) {
                    ApiClient.apiService.batchMarkRead(
                        token = "Bearer $activeAuthToken",
                        request = mapOf("partnerId" to partnerId)
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun emitTypingStart(targetUserId: Int) {
        globalSocket?.emit("typing_start", JSONObject().apply {
            put("recipientId", targetUserId)
        })
    }

    fun emitTypingStop(targetUserId: Int) {
        globalSocket?.emit("typing_stop", JSONObject().apply {
            put("recipientId", targetUserId)
        })
    }

    fun emitMediaViewed(messageId: Long, recipientId: Int) {
        globalSocket?.emit("mark_media_viewed", JSONObject().apply {
            put("messageId", messageId)
            put("recipientId", recipientId)
        })
    }

    private fun parseJsonMessage(json: JSONObject): ChatMessage {
        val id = json.optLong("id")
        val senderId = json.optInt("sender_id", json.optInt("senderId"))
        val recipientId = json.optInt("recipient_id", json.optInt("recipientId"))
        val messageText = json.optString("message_text", json.optString("text", ""))
        val attachmentType = json.optString("attachment_type", json.optString("attachmentType", "NONE"))
        val attachmentUrl = if (json.has("attachment_url") && !json.isNull("attachment_url")) json.optString("attachment_url") else null
        val thumbnailBlur = if (json.has("thumbnail_blur") && !json.isNull("thumbnail_blur")) json.optString("thumbnail_blur") else null
        val fileSizeBytes = json.optLong("file_size_bytes", 0L)
        val status = json.optString("status", "SENT")
        val isViewOnce = json.optBoolean("is_view_once", false)
        val isViewed = json.optBoolean("is_viewed", false)
        val isPinned = json.optBoolean("is_pinned", false)
        val deletedForEveryone = json.optBoolean("deleted_for_everyone", false)
        val replyToId = if (json.has("reply_to_id") && !json.isNull("reply_to_id")) json.optLong("reply_to_id") else null
        val localClientId = if (json.has("local_client_id") && !json.isNull("local_client_id")) json.optString("local_client_id") else null
        val createdAt = json.optString("created_at", json.optString("createdAt", ""))

        val reactions = mutableMapOf<String, List<Int>>()
        val rxJson = json.optJSONObject("reactions")
        rxJson?.keys()?.forEach { emoji ->
            val arr = rxJson.optJSONArray(emoji)
            val userIds = mutableListOf<Int>()
            if (arr != null) {
                for (i in 0 until arr.length()) userIds.add(arr.optInt(i))
            }
            reactions[emoji] = userIds
        }

        return ChatMessage(
            id = id,
            senderId = senderId,
            recipientId = recipientId,
            messageText = messageText,
            attachmentType = attachmentType,
            attachmentUrl = attachmentUrl,
            thumbnailBlur = thumbnailBlur,
            fileSizeBytes = fileSizeBytes,
            status = status,
            isViewOnce = isViewOnce,
            isViewed = isViewed,
            replyToId = replyToId,
            reactions = reactions,
            isPinned = isPinned,
            deletedForEveryone = deletedForEveryone,
            localClientId = localClientId,
            createdAt = createdAt
        )
    }
}
