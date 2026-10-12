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
        binding.btnForgotPassword.setOnClickListener {
            showForgotPasswordDialog()
        }

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
                                .putString("horizon_token", body.token)
                                .putInt("user_id", body.user.id)
                                .putString("username", body.user.username)
                                .putBoolean("is_admin", body.user.isAdmin)
                                .apply()

                            goToChatList(body.token, body.user.id, body.user.username, body.user.isAdmin)
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

    private fun showForgotPasswordDialog() {
        val input = android.widget.EditText(this).apply {
            hint = "Enter your username"
            setPadding(40, 30, 40, 30)
            setTextColor(resources.getColor(com.chatapp.horizon.R.color.text_primary, theme))
            setHintTextColor(resources.getColor(com.chatapp.horizon.R.color.text_muted, theme))
        }

        com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle("Forgot Password")
            .setMessage("Enter your username to request a 6-digit password reset code.")
            .setView(input)
            .setPositiveButton("Get Code") { _, _ ->
                val username = input.text.toString().trim().lowercase()
                if (username.isNotEmpty()) {
                    requestResetCode(username)
                } else {
                    Toast.makeText(this, "Username is required", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun requestResetCode(username: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.forgotPassword(com.chatapp.horizon.models.ForgotPasswordRequest(username))
                withContext(Dispatchers.Main) {
                    if (res.isSuccessful && res.body() != null) {
                        val body = res.body()!!
                        val tokenStr = body.resetToken ?: ""
                        showResetPasswordDialog(username, tokenStr)
                    } else {
                        Toast.makeText(this@AuthActivity, "Failed to generate reset code", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun showResetPasswordDialog(username: String, prefilledToken: String) {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(40, 20, 40, 20)
        }

        val etCode = android.widget.EditText(this).apply {
            hint = "6-Digit Reset Code"
            setText(prefilledToken)
            setPadding(20, 20, 20, 20)
            setTextColor(resources.getColor(com.chatapp.horizon.R.color.text_primary, theme))
            setHintTextColor(resources.getColor(com.chatapp.horizon.R.color.text_muted, theme))
        }

        val etNewPass = android.widget.EditText(this).apply {
            hint = "New Password (min 6 characters)"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setPadding(20, 20, 20, 20)
            setTextColor(resources.getColor(com.chatapp.horizon.R.color.text_primary, theme))
            setHintTextColor(resources.getColor(com.chatapp.horizon.R.color.text_muted, theme))
        }

        layout.addView(etCode)
        layout.addView(etNewPass)

        val messageText = if (prefilledToken.isNotEmpty()) {
            "Your reset code is: $prefilledToken\nEnter it below along with your new password."
        } else {
            "Enter the reset code sent to your account along with your new password."
        }

        com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle("Reset Password for @$username")
            .setMessage(messageText)
            .setView(layout)
            .setPositiveButton("Reset Password") { _, _ ->
                val code = etCode.text.toString().trim()
                val newPass = etNewPass.text.toString()
                if (code.isNotEmpty() && newPass.length >= 6) {
                    performPasswordReset(username, code, newPass)
                } else {
                    Toast.makeText(this, "Valid code and password (min 6 chars) required", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun performPasswordReset(username: String, code: String, newPass: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.resetPassword(
                    com.chatapp.horizon.models.ResetPasswordRequest(username, code, newPass)
                )
                withContext(Dispatchers.Main) {
                    if (res.isSuccessful) {
                        Toast.makeText(this@AuthActivity, "Password reset successfully! Please sign in.", Toast.LENGTH_LONG).show()
                        binding.etUsername.setText(username)
                        binding.etPassword.setText("")
                        isRegisterMode = false
                        binding.btnLogin.text = "Sign In"
                    } else {
                        val err = res.errorBody()?.string() ?: "Failed to reset password"
                        Toast.makeText(this@AuthActivity, "Error: $err", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AuthActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun goToChatList(token: String, userId: Int, username: String, isAdmin: Boolean = false) {
        val intent = Intent(this, ChatListActivity::class.java).apply {
            putExtra("AUTH_TOKEN", token)
            putExtra("CURRENT_USER_ID", userId)
            putExtra("CURRENT_USERNAME", username)
            putExtra("IS_ADMIN", isAdmin)
        }
        startActivity(intent)
        finish()
    }
}
