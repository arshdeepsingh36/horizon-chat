package com.chatapp.horizon.network

import android.content.Context
import com.chatapp.horizon.models.ChatMessage
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

object MessageDispatchManager {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val pendingQueue = CopyOnWriteArrayList<ChatMessage>()
    private val listeners = CopyOnWriteArrayList<MessageStatusListener>()

    private var globalSocket: Socket? = null
    private var activeAuthToken: String = ""
    private var activeUserId: Int = 1

    interface MessageStatusListener {
        fun onMessageDispatched(localClientId: String, serverMessage: ChatMessage)
        fun onMessageStatusChanged(messageId: Long, newStatus: String)
        fun onIncomingMessage(message: ChatMessage)
        fun onMessageReacted(messageId: Long, reactions: Map<String, List<Int>>)
        fun onMessageDeleted(messageId: Long, deletedForEveryone: Boolean, messageText: String?)
        fun onMessagePinned(messageId: Long, isPinned: Boolean)
    }

    fun addListener(listener: MessageStatusListener) {
        if (!listeners.contains(listener)) {
            listeners.add(listener)
        }
    }

    fun removeListener(listener: MessageStatusListener) {
        listeners.remove(listener)
    }

    fun initSocket(authToken: String, userId: Int, serverUrl: String = ApiClient.BASE_URL.trimEnd('/')) {
        activeAuthToken = authToken
        activeUserId = userId

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
                        listeners.forEach { it.onIncomingMessage(msg) }
                    }
                }

                on("message_delivered_ack") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject
                        val mId = data?.optLong("messageId") ?: return@on
                        listeners.forEach { it.onMessageStatusChanged(mId, "DELIVERED") }
                    }
                }

                on("message_read_ack") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject
                        val mId = data?.optLong("messageId", -1L) ?: -1L
                        if (mId > 0) {
                            listeners.forEach { it.onMessageStatusChanged(mId, "READ") }
                        }
                    }
                }

                on("message_reacted") { args ->
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
                        listeners.forEach { it.onMessageReacted(mId, reactionsMap) }
                    }
                }

                on("message_deleted") { args ->
                    if (args.isNotEmpty()) {
                        val data = args[0] as? JSONObject ?: return@on
                        val mId = data.optLong("messageId")
                        val deletedForEveryone = data.optBoolean("deletedForEveryone", false)
                        val text = data.optString("messageText", "🚫 This message was deleted")
                        listeners.forEach { it.onMessageDeleted(mId, deletedForEveryone, text) }
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

                connect()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun getSocket(): Socket? = globalSocket

    fun enqueueMessage(message: ChatMessage) {
        val clientUid = message.localClientId ?: UUID.randomUUID().toString()
        message.localClientId = clientUid
        message.status = "PENDING"
        pendingQueue.add(message)

        scope.launch {
            processPendingQueue()
        }
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
                put("attachmentUrl", pending.attachmentUrl ?: JSONObject.NULL)
                put("thumbnailBlur", pending.thumbnailBlur ?: JSONObject.NULL)
                put("fileSizeBytes", pending.fileSizeBytes)
                put("isViewOnce", pending.isViewOnce)
                if (pending.replyToId != null) {
                    put("replyToId", pending.replyToId)
                }
            }

            if (sock != null && sock.connected()) {
                sock.emit("send_message", payload, io.socket.client.Ack { args ->
                    if (args.isNotEmpty()) {
                        val res = args[0] as? JSONObject
                        if (res != null && res.optBoolean("success", false)) {
                            val msgObj = res.optJSONObject("message")
                            if (msgObj != null) {
                                val saved = parseJsonMessage(msgObj)
                                pendingQueue.remove(pending)
                                listeners.forEach { it.onMessageDispatched(localId, saved) }
                            }
                        }
                    }
                })
            }
        }
    }

    fun emitReaction(messageId: Long, recipientId: Int, emoji: String) {
        globalSocket?.emit("message_reaction", JSONObject().apply {
            put("messageId", messageId)
            put("recipientId", recipientId)
            put("emoji", emoji)
        })
    }

    fun emitDelete(messageId: Long, recipientId: Int, mode: String) {
        globalSocket?.emit("delete_message", JSONObject().apply {
            put("messageId", messageId)
            put("recipientId", recipientId)
            put("mode", mode)
        })
    }

    fun emitPin(messageId: Long, recipientId: Int, isPinned: Boolean) {
        globalSocket?.emit("pin_message", JSONObject().apply {
            put("messageId", messageId)
            put("recipientId", recipientId)
            put("isPinned", isPinned)
        })
    }

    fun emitBatchRead(partnerId: Int) {
        globalSocket?.emit("mark_conversation_read", JSONObject().apply {
            put("partnerId", partnerId)
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
            createdAt = createdAt
        )
    }
}
