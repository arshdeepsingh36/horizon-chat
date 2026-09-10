package com.chatapp.horizon.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.chatapp.horizon.databinding.ActivityChatListBinding
import com.chatapp.horizon.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ChatListActivity : AppCompatActivity() {

    private lateinit var binding: ActivityChatListBinding
    private lateinit var adapter: ChatListAdapter

    private var authToken: String = ""
    private var currentUserId: Int = 1
    private var currentUsername: String = "User"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatListBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: prefs.getString("token", "") ?: ""
        currentUserId = intent.getIntExtra("CURRENT_USER_ID", prefs.getInt("user_id", 1))
        currentUsername = intent.getStringExtra("CURRENT_USERNAME") ?: prefs.getString("username", "User") ?: "User"

        setupUI()
        loadChats()
    }

    override fun onResume() {
        super.onResume()
        loadChats()
    }

    private fun setupUI() {
        binding.toolbar.title = "Horizon Chat (@$currentUsername)"

        adapter = ChatListAdapter { conversation ->
            val intent = Intent(this, ChatActivity::class.java).apply {
                putExtra("CURRENT_USER_ID", currentUserId)
                putExtra("TARGET_USER_ID", conversation.partnerId)
                putExtra("TARGET_USERNAME", conversation.partnerUsername)
                putExtra("AUTH_TOKEN", authToken)
            }
            startActivity(intent)
        }

        binding.rvConversationList.layoutManager = LinearLayoutManager(this)
        binding.rvConversationList.adapter = adapter

        binding.fabNewChat.setOnClickListener {
            showNewChatDialog()
        }
    }

    private fun loadChats() {
        if (authToken.isEmpty()) return

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response = ApiClient.apiService.getChats("Bearer $authToken")
                if (response.isSuccessful && response.body() != null) {
                    val chats = response.body()!!
                    withContext(Dispatchers.Main) {
                        adapter.setChats(chats)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showNewChatDialog() {
        val input = EditText(this).apply {
            hint = "Enter @username"
        }

        AlertDialog.Builder(this)
            .setTitle("Start New Chat")
            .setMessage("Search for a user in the Horizon directory:")
            .setView(input)
            .setPositiveButton("Search") { _, _ ->
                val query = input.text.toString().trim().lowercase().removePrefix("@")
                if (query.isNotEmpty()) {
                    lookupAndOpenChat(query)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun lookupAndOpenChat(username: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val response = ApiClient.apiService.lookupUser("Bearer $authToken", username)
                withContext(Dispatchers.Main) {
                    if (response.isSuccessful && response.body() != null) {
                        val targetUser = response.body()!!
                        val intent = Intent(this@ChatListActivity, ChatActivity::class.java).apply {
                            putExtra("CURRENT_USER_ID", currentUserId)
                            putExtra("TARGET_USER_ID", targetUser.id)
                            putExtra("TARGET_USERNAME", targetUser.username)
                            putExtra("AUTH_TOKEN", authToken)
                        }
                        startActivity(intent)
                    } else {
                        Toast.makeText(this@ChatListActivity, "User @$username not found", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatListActivity, "Network error: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
