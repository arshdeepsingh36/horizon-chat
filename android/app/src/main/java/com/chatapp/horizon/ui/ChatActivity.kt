package com.chatapp.horizon.ui

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.chatapp.horizon.databinding.ActivityChatBinding
import com.chatapp.horizon.models.ChatMessage
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ChatActivity : AppCompatActivity() {

    private lateinit var binding: ActivityChatBinding
    private lateinit var adapter: ChatAdapter
    private var mSocket: Socket? = null

    private var currentUserId: Int = 1
    private var targetUserId: Int = 2
    private var targetUsername: String = "User"
    private var authToken: String = ""
    private var serverUrl: String = com.chatapp.horizon.network.ApiClient.BASE_URL.trimEnd('/')

    private var isLoadingOlder = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        currentUserId = intent.getIntExtra("CURRENT_USER_ID", 1)
        targetUserId = intent.getIntExtra("TARGET_USER_ID", 2)
        targetUsername = intent.getStringExtra("TARGET_USERNAME") ?: "User"
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: ""

        setupUI()
        setupSocket()
        loadInitialMessages()
    }

    private fun setupUI() {
        binding.tvRecipientName.text = "@$targetUsername"
        binding.btnBack.setOnClickListener { finish() }

        val layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvChatMessages.layoutManager = layoutManager

        adapter = ChatAdapter(currentUserId) { mediaMessage ->
            // Triggered on tap-to-download
        }
        binding.rvChatMessages.adapter = adapter

        // Reverse Cursor Pagination Scroll Listener
        binding.rvChatMessages.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                super.onScrolled(recyclerView, dx, dy)
                val firstVisible = layoutManager.findFirstVisibleItemPosition()
                val oldestId = adapter.getOldestMessageId()
                if (!isLoadingOlder && firstVisible <= 3 && oldestId != null) {
                    loadOlderMessages(oldestId)
                }
            }
        })

        // Send Button
        binding.btnSend.setOnClickListener {
            val text = binding.etMessage.text.toString().trim()
            if (text.isNotEmpty()) {
                sendMessage(text)
                binding.etMessage.setText("")
            }
        }
    }

    private fun setupSocket() {
        try {
            val options = IO.Options().apply {
                auth = mapOf("token" to authToken)
                reconnection = true
                reconnectionAttempts = 5
                reconnectionDelay = 1000
            }
            mSocket = IO.socket(serverUrl, options)

            mSocket?.on("new_message") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    data?.let {
                        val msg = parseJsonMessage(it)
                        runOnUiThread {
                            if (msg.senderId == targetUserId || msg.recipientId == targetUserId) {
                                adapter.appendMessage(msg)
                                binding.rvChatMessages.smoothScrollToPosition(adapter.itemCount - 1)
                                if (msg.senderId == targetUserId) {
                                    markMessageRead(msg.id)
                                }
                            }
                        }
                    }
                }
            }

            mSocket?.on("message_read_ack") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    val messageId = data?.optLong("messageId") ?: -1L
                    if (messageId != -1L) {
                        runOnUiThread {
                            adapter.markMessageRead(messageId)
                        }
                    }
                }
            }

            mSocket?.on("user_status_changed") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    val uId = data?.optInt("userId")
                    val status = data?.optString("status")
                    if (uId == targetUserId) {
                        runOnUiThread {
                            binding.tvPresence.text = status
                        }
                    }
                }
            }

            mSocket?.connect()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun loadInitialMessages() {
        if (authToken.isEmpty()) return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response = com.chatapp.horizon.network.ApiClient.apiService.getMessages(
                    token = "Bearer $authToken",
                    targetUserId = targetUserId,
                    limit = 25
                )
                if (response.isSuccessful && response.body() != null) {
                    val list = response.body()!!
                    withContext(Dispatchers.Main) {
                        adapter.setMessages(list)
                        binding.rvChatMessages.scrollToPosition(adapter.itemCount - 1)
                        // Mark incoming messages as read
                        list.forEach { msg ->
                            if (msg.senderId == targetUserId && msg.status != "READ") {
                                markMessageRead(msg.id)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun loadOlderMessages(cursorId: Long) {
        if (authToken.isEmpty() || isLoadingOlder) return
        isLoadingOlder = true
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response = com.chatapp.horizon.network.ApiClient.apiService.getMessages(
                    token = "Bearer $authToken",
                    targetUserId = targetUserId,
                    cursor = cursorId,
                    limit = 25
                )
                if (response.isSuccessful && response.body() != null) {
                    val olderBatch = response.body()!!
                    withContext(Dispatchers.Main) {
                        adapter.prependMessages(olderBatch)
                        isLoadingOlder = false
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        isLoadingOlder = false
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isLoadingOlder = false
                }
            }
        }
    }

    private fun sendMessage(text: String) {
        val payload = JSONObject().apply {
            put("recipientId", targetUserId)
            put("text", text)
            put("attachmentType", "NONE")
        }
        mSocket?.emit("send_message", payload)
    }

    private fun markMessageRead(messageId: Long) {
        val payload = JSONObject().apply {
            put("messageId", messageId)
            put("senderId", targetUserId)
        }
        mSocket?.emit("mark_read", payload)
    }

    private fun parseJsonMessage(json: JSONObject): ChatMessage {
        return ChatMessage(
            id = json.optLong("id", System.currentTimeMillis()),
            senderId = json.optInt("sender_id", 0),
            recipientId = json.optInt("recipient_id", 0),
            messageText = json.optString("message_text", ""),
            attachmentType = json.optString("attachment_type", "NONE"),
            attachmentUrl = json.optString("attachment_url", null),
            thumbnailBlur = json.optString("thumbnail_blur", null),
            fileSizeBytes = json.optLong("file_size_bytes", 0),
            status = json.optString("status", "SENT"),
            createdAt = json.optString("created_at", "")
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        mSocket?.disconnect()
        mSocket?.off()
    }
}
