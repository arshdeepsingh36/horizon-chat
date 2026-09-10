package com.chatapp.horizon.ui

import android.app.Dialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ActivityChatBinding
import com.chatapp.horizon.databinding.DialogAttachmentPickerBinding
import com.chatapp.horizon.models.ChatMessage
import com.chatapp.horizon.network.ApiClient
import com.google.android.material.bottomsheet.BottomSheetDialog
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.*

class ChatActivity : AppCompatActivity() {

    private lateinit var binding: ActivityChatBinding
    private lateinit var adapter: ChatAdapter
    private var mSocket: Socket? = null

    private var currentUserId: Int = 1
    private var targetUserId: Int = 2
    private var targetUsername: String = "User"
    private var targetAvatarUrl: String? = null
    private var authToken: String = ""
    private var serverUrl: String = ApiClient.BASE_URL.trimEnd('/')

    private var isLoadingOlder = false
    private var isViewOnceActive = false

    // Typing Debounce
    private val typingHandler = Handler(Looper.getMainLooper())
    private var isCurrentlyTyping = false
    private val stopTypingRunnable = Runnable { stopTyping() }

    // Image Picker
    private val imagePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { handlePickedImage(it) }
    }

    // Document Picker
    private val documentPickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { handlePickedDocument(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        currentUserId = intent.getIntExtra("CURRENT_USER_ID", 1)
        targetUserId = intent.getIntExtra("TARGET_USER_ID", 2)
        targetUsername = intent.getStringExtra("TARGET_USERNAME") ?: "User"
        targetAvatarUrl = intent.getStringExtra("TARGET_AVATAR_URL")
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: ""

        setupUI()
        setupSocket()
        loadInitialMessages()
    }

    private fun setupUI() {
        binding.tvRecipientName.text = "@$targetUsername"
        binding.btnBack.setOnClickListener { finish() }

        if (!targetAvatarUrl.isNullOrEmpty()) {
            Glide.with(this)
                .load(targetAvatarUrl)
                .placeholder(android.R.drawable.sym_def_app_icon)
                .into(binding.ivRecipientAvatar)
        }

        val layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvChatMessages.layoutManager = layoutManager

        adapter = ChatAdapter(
            currentUserId = currentUserId,
            onMediaDownloadClicked = { mediaMessage ->
                // Media loaded
            },
            onViewOnceClicked = { viewOnceMsg ->
                showViewOnceModal(viewOnceMsg)
            }
        )
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
                stopTyping()
                sendMessage(
                    text = text,
                    attachmentType = "NONE",
                    attachmentUrl = null,
                    thumbnailBlur = null,
                    fileSizeBytes = 0,
                    isViewOnce = false
                )
                binding.etMessage.setText("")
            }
        }

        // View-Once Toggle (1-circle icon in dock)
        binding.btnViewOnceToggle.setOnClickListener {
            isViewOnceActive = !isViewOnceActive
            updateViewOnceToggleUI()
        }

        // Attachment Button
        binding.btnAttachment.setOnClickListener {
            showAttachmentBottomSheet()
        }

        // Typing Listener
        binding.etMessage.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (!s.isNullOrEmpty()) {
                    startTyping()
                } else {
                    stopTyping()
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun startTyping() {
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true
            val payload = JSONObject().apply {
                put("recipientId", targetUserId)
            }
            mSocket?.emit("typing_start", payload)
        }
        typingHandler.removeCallbacks(stopTypingRunnable)
        typingHandler.postDelayed(stopTypingRunnable, 1500)
    }

    private fun stopTyping() {
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false
            typingHandler.removeCallbacks(stopTypingRunnable)
            val payload = JSONObject().apply {
                put("recipientId", targetUserId)
            }
            mSocket?.emit("typing_stop", payload)
        }
    }

    private fun updateViewOnceToggleUI() {
        if (isViewOnceActive) {
            binding.btnViewOnceToggle.setColorFilter(
                ContextCompat.getColor(this, R.color.accent_amber)
            )
            Toast.makeText(this, "View Once: ON for next media", Toast.LENGTH_SHORT).show()
        } else {
            binding.btnViewOnceToggle.setColorFilter(
                ContextCompat.getColor(this, R.color.text_muted)
            )
        }
    }

    private fun showAttachmentBottomSheet() {
        val bottomSheet = BottomSheetDialog(this)
        val sheetBinding = DialogAttachmentPickerBinding.inflate(layoutInflater)
        bottomSheet.setContentView(sheetBinding.root)

        // Sync View-Once switch
        sheetBinding.switchViewOnce.isChecked = isViewOnceActive
        sheetBinding.switchViewOnce.setOnCheckedChangeListener { _, isChecked ->
            isViewOnceActive = isChecked
            updateViewOnceToggleUI()
        }

        // 1. Gallery
        sheetBinding.btnOptionGallery.setOnClickListener {
            bottomSheet.dismiss()
            imagePickerLauncher.launch("image/*")
        }

        // 2. Voice Note
        sheetBinding.btnOptionVoice.setOnClickListener {
            bottomSheet.dismiss()
            sendVoiceNote()
        }

        // 3. Location
        sheetBinding.btnOptionLocation.setOnClickListener {
            bottomSheet.dismiss()
            sendLocation()
        }

        // 4. Document
        sheetBinding.btnOptionDocument.setOnClickListener {
            bottomSheet.dismiss()
            documentPickerLauncher.launch("*/*")
        }

        bottomSheet.show()
    }

    private fun handlePickedImage(uri: Uri) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val originalBitmap = BitmapFactory.decodeStream(inputStream)
                inputStream?.close()

                if (originalBitmap != null) {
                    // Downscale large camera photos to max 1280px for instant upload
                    val maxDim = 1280
                    val width = originalBitmap.width
                    val height = originalBitmap.height
                    val ratio = Math.min(1.0, maxDim.toDouble() / Math.max(width, height))
                    val scaledBitmap = if (ratio < 1.0) {
                        Bitmap.createScaledBitmap(originalBitmap, (width * ratio).toInt(), (height * ratio).toInt(), true)
                    } else {
                        originalBitmap
                    }

                    // 1. Generate 20x20 micro-blur thumbnail
                    val microThumb = Bitmap.createScaledBitmap(scaledBitmap, 20, 20, true)
                    val thumbStream = ByteArrayOutputStream()
                    microThumb.compress(Bitmap.CompressFormat.JPEG, 60, thumbStream)
                    val thumbBase64 = "data:image/jpeg;base64," + Base64.encodeToString(thumbStream.toByteArray(), Base64.NO_WRAP)

                    // 2. Compress full image (JPEG 75% quality)
                    val fullStream = ByteArrayOutputStream()
                    scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 75, fullStream)
                    val imageBytes = fullStream.toByteArray()
                    val fullSize = imageBytes.size.toLong()
                    val fullBase64 = "data:image/jpeg;base64," + Base64.encodeToString(imageBytes, Base64.NO_WRAP)

                    val viewOnce = isViewOnceActive
                    withContext(Dispatchers.Main) {
                        isViewOnceActive = false
                        updateViewOnceToggleUI()
                    }

                    // 3. Upload real image to server
                    var uploadedUrl: String? = null
                    try {
                        val uploadReq = MediaUploadRequest(
                            imageBase64 = fullBase64,
                            fileName = "photo_${System.currentTimeMillis()}.jpg",
                            fileSizeBytes = fullSize,
                            thumbnailBlur = thumbBase64
                        )
                        val uploadRes = ApiClient.apiService.uploadMedia("Bearer $authToken", uploadReq)
                        if (uploadRes.isSuccessful && uploadRes.body() != null) {
                            uploadedUrl = uploadRes.body()!!.attachmentUrl
                        }
                    } catch (uploadErr: Exception) {
                        uploadErr.printStackTrace()
                    }

                    // 4. If upload request failed, fallback to direct data URI so recipient still sees the actual image
                    val finalUrl = uploadedUrl ?: fullBase64

                    withContext(Dispatchers.Main) {
                        sendMessage(
                            text = if (viewOnce) "View Once Photo" else "Photo",
                            attachmentType = "IMAGE",
                            attachmentUrl = finalUrl,
                            thumbnailBlur = thumbBase64,
                            fileSizeBytes = fullSize,
                            isViewOnce = viewOnce
                        )
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to load image: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun handlePickedDocument(uri: Uri) {
        var docName = "Document.pdf"
        var docSize = 1048576L

        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (cursor.moveToFirst()) {
                    if (nameIndex != -1) docName = cursor.getString(nameIndex) ?: docName
                    if (sizeIndex != -1) docSize = cursor.getLong(sizeIndex)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        sendMessage(
            text = docName,
            attachmentType = "DOCUMENT",
            attachmentUrl = "https://cdn.horizonchat.io/docs/$docName",
            thumbnailBlur = null,
            fileSizeBytes = docSize,
            isViewOnce = false
        )
    }

    private fun sendVoiceNote() {
        val durationText = "0:14"
        sendMessage(
            text = durationText,
            attachmentType = "AUDIO",
            attachmentUrl = "https://cdn.horizonchat.io/audio/voice_note.aac",
            thumbnailBlur = null,
            fileSizeBytes = 54200,
            isViewOnce = false
        )
    }

    private fun sendLocation() {
        val coordsText = "30.7333° N, 76.7794° E"
        sendMessage(
            text = coordsText,
            attachmentType = "LOCATION",
            attachmentUrl = "https://maps.google.com/?q=30.7333,76.7794",
            thumbnailBlur = null,
            fileSizeBytes = 0,
            isViewOnce = false
        )
    }

    private fun showViewOnceModal(msg: ChatMessage) {
        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val frameLayout = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.bg_base))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Fullscreen Image
        val imageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        frameLayout.addView(imageView)

        // Top bar container
        val topBar = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 40
                leftMargin = 20
                rightMargin = 20
            }
        }

        val tvTitle = TextView(this).apply {
            text = "View Once Photo • Disappears on close"
            setTextColor(ContextCompat.getColor(context, R.color.accent_amber))
            textSize = 14f
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL }
        }
        topBar.addView(tvTitle)

        val btnClose = TextView(this).apply {
            text = "✕ CLOSE"
            setTextColor(ContextCompat.getColor(context, R.color.text_primary))
            textSize = 14f
            setPadding(16, 12, 16, 12)
            setBackgroundColor(ContextCompat.getColor(context, R.color.surface_elevated))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL }
            setOnClickListener { dialog.dismiss() }
        }
        topBar.addView(btnClose)
        frameLayout.addView(topBar)

        dialog.setContentView(frameLayout)

        val imageUrl = msg.attachmentUrl
        if (!imageUrl.isNullOrEmpty()) {
            if (imageUrl.startsWith("data:image/")) {
                try {
                    val cleanBase64 = imageUrl.substringAfter("base64,")
                    val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                    imageView.setImageBitmap(bitmap)
                } catch (e: Exception) {
                    Glide.with(this).load(imageUrl).into(imageView)
                }
            } else {
                Glide.with(this).load(imageUrl).into(imageView)
            }
        }

        dialog.setOnDismissListener {
            // Mark viewed via REST and Socket
            adapter.markMessageViewed(msg.id)
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    ApiClient.apiService.markViewOnceOpened("Bearer $authToken", msg.id)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            val payload = JSONObject().apply {
                put("messageId", msg.id)
                put("recipientId", targetUserId)
            }
            mSocket?.emit("mark_media_viewed", payload)
            Toast.makeText(this, "Photo closed and permanently deleted.", Toast.LENGTH_SHORT).show()
        }

        dialog.show()
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

            mSocket?.on("user_typing") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    val senderId = data?.optInt("userId", data.optInt("senderId", -1)) ?: -1
                    val isTyping = data?.optBoolean("isTyping", false) ?: false
                    if (senderId == targetUserId) {
                        runOnUiThread {
                            if (isTyping) {
                                binding.tvPresence.text = "typing..."
                                binding.tvPresence.setTextColor(ContextCompat.getColor(this, R.color.accent_amber))
                            } else {
                                binding.tvPresence.text = "online"
                                binding.tvPresence.setTextColor(ContextCompat.getColor(this, R.color.ticks_sent))
                            }
                        }
                    }
                }
            }

            mSocket?.on("media_viewed") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    val messageId = data?.optLong("messageId", -1L) ?: -1L
                    if (messageId != -1L) {
                        runOnUiThread {
                            adapter.markMessageViewed(messageId)
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
                val response = ApiClient.apiService.getMessages(
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
                val response = ApiClient.apiService.getMessages(
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

    private fun sendMessage(
        text: String,
        attachmentType: String,
        attachmentUrl: String?,
        thumbnailBlur: String?,
        fileSizeBytes: Long,
        isViewOnce: Boolean
    ) {
        val optimisticMsg = ChatMessage(
            id = System.currentTimeMillis(),
            senderId = currentUserId,
            recipientId = targetUserId,
            messageText = text,
            attachmentType = attachmentType,
            attachmentUrl = attachmentUrl,
            thumbnailBlur = thumbnailBlur,
            fileSizeBytes = fileSizeBytes,
            status = "SENT",
            isViewOnce = isViewOnce,
            isViewed = false,
            createdAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(Date())
        )
        adapter.appendMessage(optimisticMsg)
        binding.rvChatMessages.smoothScrollToPosition(adapter.itemCount - 1)

        val payload = JSONObject().apply {
            put("recipientId", targetUserId)
            put("text", text)
            put("attachmentType", attachmentType)
            if (attachmentUrl != null) put("attachmentUrl", attachmentUrl)
            if (thumbnailBlur != null) put("thumbnailBlur", thumbnailBlur)
            if (fileSizeBytes > 0) put("fileSizeBytes", fileSizeBytes)
            put("isViewOnce", isViewOnce)
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
            isViewOnce = json.optBoolean("is_view_once", false),
            isViewed = json.optBoolean("is_viewed", false),
            createdAt = json.optString("created_at", "")
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        stopTyping()
        mSocket?.disconnect()
        mSocket?.off()
    }
}
