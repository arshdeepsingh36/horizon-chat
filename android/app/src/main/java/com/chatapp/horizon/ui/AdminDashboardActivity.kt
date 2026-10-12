package com.chatapp.horizon.ui

import android.content.Context
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ActivityAdminDashboardBinding
import com.chatapp.horizon.databinding.ItemAdminUserBinding
import com.chatapp.horizon.models.AdminPurgeRequest
import com.chatapp.horizon.models.AdminResetPasswordRequest
import com.chatapp.horizon.models.AdminUser
import com.chatapp.horizon.models.UpdateUserStatusRequest
import com.chatapp.horizon.network.ApiClient
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AdminDashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAdminDashboardBinding
    private var authToken: String = ""
    private val allUsers = mutableListOf<AdminUser>()
    private val displayedUsers = mutableListOf<AdminUser>()
    private lateinit var usersAdapter: AdminUsersAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = intent.getStringExtra("AUTH_TOKEN")
            ?: prefs.getString("token", null)
            ?: prefs.getString("horizon_token", "") ?: ""

        if (authToken.isEmpty()) {
            Toast.makeText(this, "Session expired. Please log in again.", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        setupRecyclerView()
        setupListeners()
        loadDashboardData()
    }

    private fun setupRecyclerView() {
        usersAdapter = AdminUsersAdapter(
            displayedUsers,
            onToggleStatus = { user -> toggleUserStatus(user) },
            onResetPassword = { user -> promptResetPassword(user) }
        )
        binding.rvAdminUsers.layoutManager = LinearLayoutManager(this)
        binding.rvAdminUsers.adapter = usersAdapter
    }

    private fun setupListeners() {
        binding.btnAdminBack.setOnClickListener { finish() }

        binding.btnAdminRefresh.setOnClickListener {
            loadDashboardData()
        }

        binding.btnManualPurge.setOnClickListener {
            promptManualPurge()
        }

        binding.etSearchAdminUsers.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                filterUsers(s.toString())
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun loadDashboardData() {
        binding.pbAdminLoading.visibility = View.VISIBLE
        val bearer = if (authToken.startsWith("Bearer ")) authToken else "Bearer $authToken"

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val statsRes = ApiClient.apiService.getAdminStats(bearer)
                val usersRes = ApiClient.apiService.getAdminUsers(bearer)

                withContext(Dispatchers.Main) {
                    binding.pbAdminLoading.visibility = View.GONE

                    if (statsRes.isSuccessful && statsRes.body() != null) {
                        val stats = statsRes.body()!!
                        binding.tvStatTotalUsers.text = stats.totalUsers.toString()
                        binding.tvStatActiveSockets.text = stats.activeConnections.toString()
                        binding.tvStatTotalMessages.text = stats.totalMessages.toString()
                    }

                    if (usersRes.isSuccessful && usersRes.body() != null) {
                        allUsers.clear()
                        allUsers.addAll(usersRes.body()!!)
                        filterUsers(binding.etSearchAdminUsers.text.toString())
                    } else if (!usersRes.isSuccessful) {
                        val err = usersRes.errorBody()?.string() ?: "Failed to load users"
                        Toast.makeText(this@AdminDashboardActivity, "Error: $err", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.pbAdminLoading.visibility = View.GONE
                    Toast.makeText(this@AdminDashboardActivity, "Network error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun filterUsers(query: String) {
        val q = query.trim().lowercase()
        displayedUsers.clear()
        if (q.isEmpty()) {
            displayedUsers.addAll(allUsers)
        } else {
            displayedUsers.addAll(allUsers.filter {
                it.username.lowercase().contains(q) ||
                (it.displayName?.lowercase()?.contains(q) == true)
            })
        }
        usersAdapter.notifyDataSetChanged()
    }

    private fun toggleUserStatus(user: AdminUser) {
        val nextStatus = !user.isActive
        val actionWord = if (nextStatus) "Activate" else "Deactivate"
        val bearer = if (authToken.startsWith("Bearer ")) authToken else "Bearer $authToken"

        MaterialAlertDialogBuilder(this)
            .setTitle("$actionWord @${user.username}?")
            .setMessage("Are you sure you want to ${actionWord.lowercase()} this user account?")
            .setPositiveButton("Confirm") { _, _ ->
                binding.pbAdminLoading.visibility = View.VISIBLE
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val res = ApiClient.apiService.updateAdminUserStatus(
                            bearer,
                            user.id,
                            UpdateUserStatusRequest(nextStatus)
                        )
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            if (res.isSuccessful) {
                                Toast.makeText(this@AdminDashboardActivity, "User status updated", Toast.LENGTH_SHORT).show()
                                loadDashboardData()
                            } else {
                                Toast.makeText(this@AdminDashboardActivity, "Failed to update status", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            Toast.makeText(this@AdminDashboardActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun promptResetPassword(user: AdminUser) {
        val input = android.widget.EditText(this).apply {
            hint = "New password (min 6 characters)"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setPadding(40, 30, 40, 30)
            setTextColor(resources.getColor(R.color.text_primary, theme))
            setHintTextColor(resources.getColor(R.color.text_muted, theme))
        }

        val bearer = if (authToken.startsWith("Bearer ")) authToken else "Bearer $authToken"

        MaterialAlertDialogBuilder(this)
            .setTitle("Reset Password: @${user.username}")
            .setMessage("Enter the new password for this account.")
            .setView(input)
            .setPositiveButton("Save Password") { _, _ ->
                val newPass = input.text.toString().trim()
                if (newPass.length < 6) {
                    Toast.makeText(this, "Password must be at least 6 characters", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                binding.pbAdminLoading.visibility = View.VISIBLE
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val res = ApiClient.apiService.adminResetUserPassword(
                            bearer,
                            user.id,
                            AdminResetPasswordRequest(newPass)
                        )
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            if (res.isSuccessful) {
                                Toast.makeText(this@AdminDashboardActivity, "Password updated successfully", Toast.LENGTH_LONG).show()
                            } else {
                                Toast.makeText(this@AdminDashboardActivity, "Failed to reset password", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            Toast.makeText(this@AdminDashboardActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun promptManualPurge() {
        val bearer = if (authToken.startsWith("Bearer ")) authToken else "Bearer $authToken"

        MaterialAlertDialogBuilder(this)
            .setTitle("Trigger 24h Message Purge?")
            .setMessage("This will permanently delete messages seen older than 24 hours and purge their Cloudflare R2 attachments. This action is irreversible.")
            .setPositiveButton("Purge Now") { _, _ ->
                binding.pbAdminLoading.visibility = View.VISIBLE
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val res = ApiClient.apiService.adminPurgeMessages(bearer, AdminPurgeRequest(24))
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            if (res.isSuccessful) {
                                val body = res.body()
                                Toast.makeText(this@AdminDashboardActivity, body?.message ?: "Purge completed", Toast.LENGTH_LONG).show()
                                loadDashboardData()
                            } else {
                                Toast.makeText(this@AdminDashboardActivity, "Purge request failed", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            binding.pbAdminLoading.visibility = View.GONE
                            Toast.makeText(this@AdminDashboardActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    inner class AdminUsersAdapter(
        private val users: List<AdminUser>,
        private val onToggleStatus: (AdminUser) -> Unit,
        private val onResetPassword: (AdminUser) -> Unit
    ) : RecyclerView.Adapter<AdminUsersAdapter.ViewHolder>() {

        inner class ViewHolder(val b: ItemAdminUserBinding) : RecyclerView.ViewHolder(b.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val b = ItemAdminUserBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return ViewHolder(b)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val u = users[position]
            val b = holder.b

            b.tvAdminUserAvatar.text = u.username.take(2).uppercase()
            b.tvAdminUsername.text = "@${u.username}"

            if (u.isAdmin) {
                b.tvAdminBadge.visibility = View.VISIBLE
            } else {
                b.tvAdminBadge.visibility = View.GONE
            }

            if (u.isActive) {
                b.tvAdminStatusBadge.text = "ACTIVE"
                b.tvAdminStatusBadge.setTextColor(0xFF10B981.toInt())
                b.tvAdminStatusBadge.setBackgroundColor(0x2610B981)
                b.btnAdminToggleStatus.text = "Deactivate"
                b.btnAdminToggleStatus.setBackgroundColor(0xFFEF4444.toInt())
            } else {
                b.tvAdminStatusBadge.text = "DISABLED"
                b.tvAdminStatusBadge.setTextColor(0xFFEF4444.toInt())
                b.tvAdminStatusBadge.setBackgroundColor(0x26EF4444)
                b.btnAdminToggleStatus.text = "Activate"
                b.btnAdminToggleStatus.setBackgroundColor(0xFF10B981.toInt())
            }

            val statusDot = if (u.online) "🟢 Online" else "⚪ Offline"
            b.tvAdminUserSubtext.text = "Messages: ${u.messageCount} • $statusDot"

            b.btnAdminToggleStatus.setOnClickListener { onToggleStatus(u) }
            b.btnAdminResetPassword.setOnClickListener { onResetPassword(u) }
        }

        override fun getItemCount() = users.size
    }
}
