package com.chatapp.horizon.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.chatapp.horizon.databinding.ActivityChatListBinding
import com.chatapp.horizon.models.ChatMessage
import com.chatapp.horizon.models.Conversation
import com.chatapp.horizon.network.ApiClient
import com.chatapp.horizon.network.MessageDispatchManager
import com.chatapp.horizon.utils.HorizonNotificationManager
import kotlinx.coroutines.*

class ChatListActivity : AppCompatActivity(), MessageDispatchManager.MessageEventListener {

    private lateinit var binding: ActivityChatListBinding
    private lateinit var adapter: ChatListAdapter

    private var authToken: String = ""
    private var currentUserId: Int = 1
    private var currentUsername: String = "User"

    private val cachedConversations = mutableListOf<Conversation>()
    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatListBinding.inflate(layoutInflater)
        setContentView(binding.root)

        HorizonNotificationManager.init(this)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: prefs.getString("token", "") ?: ""
        currentUserId = intent.getIntExtra("CURRENT_USER_ID", prefs.getInt("user_id", 1))
        currentUsername = intent.getStringExtra("CURRENT_USERNAME") ?: prefs.getString("username", "User") ?: "User"

        setupUI()
        setupSearch()
        initSocketAndQueue()
        loadChats()
    }

    override fun onResume() {
        super.onResume()
        HorizonNotificationManager.activeChatPartnerId = null
        MessageDispatchManager.addListener(this)
        loadChats()
    }

    override fun onPause() {
        super.onPause()
        MessageDispatchManager.removeListener(this)
    }

    private fun setupUI() {
        binding.tvAppTitle.text = "Horizon Chat (@$currentUsername)"

        adapter = ChatListAdapter { conversation ->
            val intent = Intent(this, ChatActivity::class.java).apply {
                putExtra("CURRENT_USER_ID", currentUserId)
                putExtra("TARGET_USER_ID", conversation.partnerId)
                putExtra("TARGET_USERNAME", conversation.partnerUsername)
                putExtra("TARGET_DISPLAY_NAME", conversation.partnerDisplayName ?: conversation.partnerUsername)
                putExtra("TARGET_AVATAR_URL", conversation.partnerAvatarUrl)
                putExtra("AUTH_TOKEN", authToken)
            }
            startActivity(intent)
        }

        binding.rvConversationList.layoutManager = LinearLayoutManager(this)
        binding.rvConversationList.adapter = adapter

        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, ProfileActivity::class.java))
        }

        binding.fabNewChat.setOnClickListener {
            binding.etSearchUsers.requestFocus()
        }
    }

    private fun setupSearch() {
        binding.btnClearSearch.setOnClickListener {
            binding.etSearchUsers.setText("")
        }

        binding.etSearchUsers.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val query = s?.toString()?.trim() ?: ""
                binding.btnClearSearch.visibility = if (query.isNotEmpty()) View.VISIBLE else View.GONE
                performDynamicSearch(query)
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun performDynamicSearch(query: String) {
        searchJob?.cancel()
        if (query.isEmpty()) {
            binding.tvEmptySearch.visibility = View.GONE
            adapter.setChats(cachedConversations)
            return
        }

        searchJob = lifecycleScope.launch(Dispatchers.IO) {
            delay(250) // Debounce 250ms

            // 1. Filter local cached chats by username or display name
            val localMatches = cachedConversations.filter {
                it.partnerUsername.contains(query, ignoreCase = true) ||
                        (it.partnerDisplayName?.contains(query, ignoreCase = true) == true)
            }.toMutableList()

            // 2. Query remote directory search for prefix / substring match across username and display_name (Task 5.1 & 5.2)
            try {
                val res = ApiClient.apiService.searchUsers("Bearer $authToken", query)
                if (res.isSuccessful && res.body() != null) {
                    val remoteUsers = res.body()!!
                    for (u in remoteUsers) {
                        if (localMatches.none { it.partnerId == u.id }) {
                            localMatches.add(
                                Conversation(
                                    partnerId = u.id,
                                    partnerUsername = u.username,
                                    partnerDisplayName = u.displayName ?: u.username,
                                    partnerAvatarUrl = u.avatarUrl,
                                    partnerBioStatus = u.bioStatus,
                                    lastMessage = null,
                                    unreadCount = 0,
                                    online = u.online
                                )
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }

            withContext(Dispatchers.Main) {
                adapter.setChats(localMatches)
                binding.tvEmptySearch.visibility = if (localMatches.isEmpty()) View.VISIBLE else View.GONE
            }
        }
    }

    private fun initSocketAndQueue() {
        if (authToken.isEmpty()) return
        MessageDispatchManager.initialize(authToken)
    }

    private fun loadChats() {
        if (authToken.isEmpty()) return

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response = ApiClient.apiService.getChats("Bearer $authToken")
                if (response.isSuccessful && response.body() != null) {
                    val chats = response.body()!!
                    cachedConversations.clear()
                    cachedConversations.addAll(chats)
                    withContext(Dispatchers.Main) {
                        if (binding.etSearchUsers.text.isNullOrEmpty()) {
                            adapter.setChats(chats)
                            binding.tvEmptySearch.visibility = if (chats.isEmpty()) View.VISIBLE else View.GONE
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // MessageEventListener Implementations
    override fun onNewMessage(message: ChatMessage) {
        runOnUiThread {
            loadChats()
            // Trigger push notification if outside this conversation (Task 7)
            if (message.senderId != currentUserId) {
                val partner = cachedConversations.find { it.partnerId == message.senderId }
                val senderName = partner?.partnerDisplayName ?: partner?.partnerUsername ?: "User @${message.senderId}"
                val senderUsername = partner?.partnerUsername ?: "user_${message.senderId}"

                HorizonNotificationManager.showIncomingMessageNotification(
                    this,
                    message,
                    senderUsername,
                    senderName,
                    currentUserId,
                    authToken
                )
            }
        }
    }

    override fun onMessageStatusUpdated(messageId: Long, localClientId: String?, status: String) {
        runOnUiThread { loadChats() }
    }

    override fun onUserTyping(userId: Int, isTyping: Boolean) {
        runOnUiThread { adapter.setTyping(userId, isTyping) }
    }

    override fun onUserStatusChanged(userId: Int, status: String, lastSeen: String?) {
        runOnUiThread { adapter.setUserOnline(userId, status == "online") }
    }

    override fun onConversationRead(readerId: Int, partnerId: Int, readAt: String) {
        runOnUiThread { loadChats() }
    }

    override fun onMessageDeleted(messageId: Long, deletedForEveryone: Boolean, deletedByUsers: List<Int>) {
        runOnUiThread { loadChats() }
    }

    override fun onDestroy() {
        super.onDestroy()
        MessageDispatchManager.removeListener(this)
    }
}
