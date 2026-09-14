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
    private var pendingAvatarBytes: ByteArray? = null
    private var currentAvatarUrl: String? = null

    private val pickImageLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { handleAvatarPicked(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = prefs.getString("horizon_token", null) ?: prefs.getString("token", "") ?: ""
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
                        currentAvatarUrl = user.avatarUrl
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

            if (bitmap == null) {
                Toast.makeText(this, "Failed to decode selected image", Toast.LENGTH_SHORT).show()
                return
            }

            // Scale down to avatar size (max 512x512) for crisp quality
            val maxDim = 512
            val width = bitmap.width
            val height = bitmap.height
            val ratio = Math.min(1.0, maxDim.toDouble() / Math.max(width, height))
            val scaled = if (ratio < 1.0) {
                Bitmap.createScaledBitmap(bitmap, (width * ratio).toInt(), (height * ratio).toInt(), true)
            } else {
                bitmap
            }

            val baos = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 85, baos)
            pendingAvatarBytes = baos.toByteArray()

            binding.tvAvatarInitials.visibility = View.GONE
            binding.ivProfileAvatar.visibility = View.VISIBLE
            Glide.with(this)
                .load(scaled)
                .circleCrop()
                .into(binding.ivProfileAvatar)

            Toast.makeText(this, "Profile photo selected. Tap 'Save Profile' to upload.", Toast.LENGTH_SHORT).show()
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
                var finalAvatarUrl = currentAvatarUrl

                // 1. If a new avatar was picked, upload directly to Cloudflare R2
                if (pendingAvatarBytes != null) {
                    val uploadResult = com.chatapp.horizon.network.R2Uploader.uploadBinary(
                        context = this@ProfileActivity,
                        bytes = pendingAvatarBytes!!,
                        uploadType = "pfp",
                        recipientUsername = "general",
                        mediaType = "pfp",
                        fileName = "avatar_${currentUsername}_${System.currentTimeMillis()}.jpg",
                        contentType = "image/jpeg",
                        isViewOnce = false,
                        explicitToken = authToken
                    )
                    finalAvatarUrl = uploadResult.publicUrl
                }

                // 2. Save profile metadata with R2 public URL
                val req = UpdateProfileRequest(
                    displayName = displayName,
                    bioStatus = bioStatus,
                    avatarUrl = finalAvatarUrl
                )
                val res = ApiClient.apiService.updateProfile("Bearer $authToken", req)
                withContext(Dispatchers.Main) {
                    binding.btnSaveProfile.isEnabled = true
                    binding.btnSaveProfile.text = "Save Profile"
                    if (res.isSuccessful) {
                        currentAvatarUrl = finalAvatarUrl
                        pendingAvatarBytes = null
                        Toast.makeText(this@ProfileActivity, "Profile updated successfully! ✨", Toast.LENGTH_SHORT).show()
                    } else {
                        val err = res.errorBody()?.string() ?: "Unknown error"
                        Toast.makeText(this@ProfileActivity, "Failed to update profile: $err", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.btnSaveProfile.isEnabled = true
                    binding.btnSaveProfile.text = "Save Profile"
                    Toast.makeText(this@ProfileActivity, "Upload Error: ${e.message}", Toast.LENGTH_LONG).show()
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
