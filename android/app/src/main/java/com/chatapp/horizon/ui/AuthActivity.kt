package com.chatapp.horizon.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.chatapp.horizon.databinding.ActivityLoginBinding
import com.chatapp.horizon.models.AuthRequest
import com.chatapp.horizon.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AuthActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private var isRegisterMode = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Check if already authenticated
        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        val savedToken = prefs.getString("token", null)
        val savedUserId = prefs.getInt("user_id", -1)
        val savedUsername = prefs.getString("username", null)

        if (savedToken != null && savedUserId != -1 && savedUsername != null) {
            goToChatList(savedToken, savedUserId, savedUsername)
            return
        }

        setupListeners()
    }

    private fun setupListeners() {
        binding.btnCreateAccount.setOnClickListener {
            isRegisterMode = !isRegisterMode
            binding.btnLogin.text = if (isRegisterMode) "Create Account" else "Sign In"
            binding.btnCreateAccount.text = if (isRegisterMode) {
                "Already have an account? Sign In"
            } else {
                "Don't have an account? Create one"
            }
        }

        binding.btnLogin.setOnClickListener {
            val username = binding.etUsername.text.toString().trim().lowercase()
            val password = binding.etPassword.text.toString()

            if (username.isEmpty()) {
                binding.etUsername.error = "Enter a username"
                return@setOnClickListener
            }

            if (password.length < 6) {
                binding.etPassword.error = "Password must be at least 6 characters"
                return@setOnClickListener
            }

            binding.btnLogin.isEnabled = false
            binding.btnLogin.text = "Connecting..."

            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val request = AuthRequest(username, password)
                    val response = if (isRegisterMode) {
                        ApiClient.apiService.register(request)
                    } else {
                        ApiClient.apiService.login(request)
                    }

                    withContext(Dispatchers.Main) {
                        binding.btnLogin.isEnabled = true
                        binding.btnLogin.text = if (isRegisterMode) "Create Account" else "Sign In"

                        if (response.isSuccessful && response.body() != null) {
                            val body = response.body()!!
                            val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
                            prefs.edit()
                                .putString("token", body.token)
                                .putInt("user_id", body.user.id)
                                .putString("username", body.user.username)
                                .apply()

                            goToChatList(body.token, body.user.id, body.user.username)
                        } else {
                            val err = response.errorBody()?.string() ?: "Authentication failed"
                            Toast.makeText(this@AuthActivity, "Error: $err", Toast.LENGTH_LONG).show()
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        binding.btnLogin.isEnabled = true
                        binding.btnLogin.text = if (isRegisterMode) "Create Account" else "Sign In"
                        Toast.makeText(this@AuthActivity, "Connection error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    private fun goToChatList(token: String, userId: Int, username: String) {
        val intent = Intent(this, ChatListActivity::class.java).apply {
            putExtra("AUTH_TOKEN", token)
            putExtra("CURRENT_USER_ID", userId)
            putExtra("CURRENT_USERNAME", username)
        }
        startActivity(intent)
        finish()
    }
}
