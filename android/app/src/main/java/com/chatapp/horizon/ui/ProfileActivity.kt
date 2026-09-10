package com.chatapp.horizon.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.chatapp.horizon.databinding.ActivityProfileBinding
import com.chatapp.horizon.models.UpdatePasswordRequest
import com.chatapp.horizon.models.UpdateProfileRequest
import com.chatapp.horizon.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

class ProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProfileBinding
    private var authToken: String = ""
    private var currentUserId: Int = 0
    private var currentUsername: String = ""
    private var pendingAvatarBase64: String? = null

    private val pickImageLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleAvatarPicked(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = prefs.getString("token", "") ?: ""
        currentUserId = prefs.getInt("user_id", 0)
        currentUsername = prefs.getString("username", "") ?: "User"

        setupUI()
        loadProfileData()
    }

    private fun setupUI() {
        binding.tvUsernameHandle.text = "@$currentUsername"
        binding.btnBack.setOnClickListener { finish() }

        binding.btnChangeAvatar.setOnClickListener {
            pickImageLauncher.launch("image/*")
        }

        binding.btnSaveProfile.setOnClickListener {
            saveProfileChanges()
        }

        binding.btnUpdatePassword.setOnClickListener {
            updatePassword()
        }

        binding.btnLogout.setOnClickListener {
            val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
            prefs.edit().clear().apply()
            val intent = Intent(this, AuthActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivity(intent)
            finish()
        }
    }

    private fun loadProfileData() {
        if (authToken.isEmpty()) return

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.getProfile("Bearer $authToken")
                if (res.isSuccessful && res.body() != null) {
                    val user = res.body()!!
                    withContext(Dispatchers.Main) {
                        binding.etDisplayName.setText(user.displayName ?: user.username)
                        binding.etBioStatus.setText(user.bioStatus ?: "Hey there! I am using Horizon Chat.")

                        if (!user.avatarUrl.isNullOrEmpty()) {
                            binding.tvAvatarInitials.visibility = View.GONE
                            binding.ivProfileAvatar.visibility = View.VISIBLE
                            Glide.with(this@ProfileActivity)
                                .load(user.avatarUrl)
                                .circleCrop()
                                .into(binding.ivProfileAvatar)
                        } else {
                            binding.ivProfileAvatar.visibility = View.GONE
                            binding.tvAvatarInitials.visibility = View.VISIBLE
                            binding.tvAvatarInitials.text = user.username.take(2).uppercase()
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun handleAvatarPicked(uri: Uri) {
        try {
            val inputStream = contentResolver.openInputStream(uri)
            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream?.close()

            // Scale down to avatar size (max 200x200)
            val scaled = Bitmap.createScaledBitmap(bitmap, 200, 200, true)
            val baos = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 85, baos)
            val bytes = baos.toByteArray()
            val base64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

            pendingAvatarBase64 = base64

            binding.tvAvatarInitials.visibility = View.GONE
            binding.ivProfileAvatar.visibility = View.VISIBLE
            Glide.with(this)
                .load(scaled)
                .circleCrop()
                .into(binding.ivProfileAvatar)

            Toast.makeText(this, "Profile photo ready. Tap 'Save Profile' to apply.", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to load image: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun saveProfileChanges() {
        val displayName = binding.etDisplayName.text.toString().trim()
        val bioStatus = binding.etBioStatus.text.toString().trim()

        if (displayName.isEmpty()) {
            binding.etDisplayName.error = "Display name cannot be empty"
            return
        }

        binding.btnSaveProfile.isEnabled = false
        binding.btnSaveProfile.text = "Saving..."

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val req = UpdateProfileRequest(
                    displayName = displayName,
                    bioStatus = bioStatus,
                    avatarUrl = pendingAvatarBase64
                )
                val res = ApiClient.apiService.updateProfile("Bearer $authToken", req)
                withContext(Dispatchers.Main) {
                    binding.btnSaveProfile.isEnabled = true
                    binding.btnSaveProfile.text = "Save Profile"
                    if (res.isSuccessful) {
                        Toast.makeText(this@ProfileActivity, "Profile updated successfully! ✨", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@ProfileActivity, "Failed to update profile", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.btnSaveProfile.isEnabled = true
                    binding.btnSaveProfile.text = "Save Profile"
                    Toast.makeText(this@ProfileActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun updatePassword() {
        val currentPass = binding.etCurrentPassword.text.toString()
        val newPass = binding.etNewPassword.text.toString()

        if (currentPass.isEmpty()) {
            binding.etCurrentPassword.error = "Enter current password"
            return
        }
        if (newPass.length < 6) {
            binding.etNewPassword.error = "New password must be at least 6 characters"
            return
        }

        binding.btnUpdatePassword.isEnabled = false
        binding.btnUpdatePassword.text = "Updating..."

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val req = UpdatePasswordRequest(currentPass, newPass)
                val res = ApiClient.apiService.updatePassword("Bearer $authToken", req)
                withContext(Dispatchers.Main) {
                    binding.btnUpdatePassword.isEnabled = true
                    binding.btnUpdatePassword.text = "Change Password"
                    if (res.isSuccessful && res.body()?.success == true) {
                        binding.etCurrentPassword.setText("")
                        binding.etNewPassword.setText("")
                        Toast.makeText(this@ProfileActivity, "Password changed successfully! 🔒", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@ProfileActivity, "Incorrect current password", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.btnUpdatePassword.isEnabled = true
                    binding.btnUpdatePassword.text = "Change Password"
                    Toast.makeText(this@ProfileActivity, "Error: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
