package com.chatapp.horizon.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Dialog
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.location.Location
import android.location.LocationManager
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.*
import android.provider.OpenableColumns
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.view.*
import android.webkit.MimeTypeMap
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ActivityChatBinding
import com.chatapp.horizon.databinding.DialogAttachmentPickerBinding
import com.chatapp.horizon.databinding.DialogMessageContextMenuBinding
import com.chatapp.horizon.models.*
import com.chatapp.horizon.network.ApiClient
import com.chatapp.horizon.network.MessageDispatchManager
import com.chatapp.horizon.utils.AvatarHelper
import com.chatapp.horizon.utils.HorizonNotificationManager
import com.chatapp.horizon.utils.TimeFormatHelper
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*

class ChatActivity : AppCompatActivity(), MessageDispatchManager.MessageEventListener {

    private lateinit var binding: ActivityChatBinding
    private lateinit var adapter: ChatAdapter

    private var currentUserId: Int = 1
    private var targetUserId: Int = 2
    private var targetUsername: String = "User"
    private var targetDisplayName: String = "User"
    private var targetAvatarUrl: String? = null
    private var targetBioStatus: String = ""
    private var targetLastSeen: String? = null
    private var isTargetOnline: Boolean = false
    private var authToken: String = ""
    private var serverUrl: String = ApiClient.BASE_URL.trimEnd('/')

    private var isLoadingOlder = false
    private var isViewOnceActive = false
    private val cachedMessageList = mutableListOf<ChatMessage>()
    private var activeQuotedMessage: ChatMessage? = null

    // Typing Debounce
    private val typingHandler = Handler(Looper.getMainLooper())
    private var isCurrentlyTyping = false
    private val stopTypingRunnable = Runnable { stopTyping() }

    // Audio Recording
    private var mediaRecorder: MediaRecorder? = null
    private var activeVoiceFile: File? = null
    private var voiceRecordingStartTime: Long = 0L
    private val recordingTimerHandler = Handler(Looper.getMainLooper())
    private var recordingTimerRunnable: Runnable? = null

    // Audio Preview
    private var previewMediaPlayer: MediaPlayer? = null
    private val previewProgressHandler = Handler(Looper.getMainLooper())
    private var previewProgressRunnable: Runnable? = null
    private var recordedAudioDurationMs: Long = 0L

    // Camera output URI
    private var cameraOutputUri: Uri? = null

    // Pickers & Launchers
    private val imagePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { handlePickedImage(it) }
    }

    private val videoPickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { handleCapturedVideo(it) }
    }

    private val documentPickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { handlePickedDocument(it) }
    }

    private val takePhotoLauncher = registerForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = cameraOutputUri
        if (success && uri != null) {
            handlePickedImage(uri)
        }
    }

    private val captureVideoLauncher = registerForActivityResult(
        ActivityResultContracts.CaptureVideo()
    ) { success ->
        val uri = cameraOutputUri
        if (success && uri != null) {
            handleCapturedVideo(uri)
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            openCameraChoiceDialog()
        } else {
            Toast.makeText(this, "Camera permission is required to capture photos and videos", Toast.LENGTH_SHORT).show()
        }
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            fetchAndSendRealLocation()
        } else {
            Toast.makeText(this, "Location permission is required to share current location", Toast.LENGTH_SHORT).show()
        }
    }

    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Toast.makeText(this, "Microphone permission is required to record voice notes", Toast.LENGTH_SHORT).show()
        }
    }

    private val profileLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val cleared = result.data?.getBooleanExtra("ACTION_CLEARED", false) ?: false
            if (cleared) {
                adapter.setMessages(emptyList())
                cachedMessageList.clear()
                updatePinnedBannerUI()
            }
            val searchTriggered = result.data?.getBooleanExtra("ACTION_SEARCH", false) ?: false
            if (searchTriggered) {
                binding.layoutInChatSearch.visibility = View.VISIBLE
                binding.etSearchInChat.requestFocus()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: prefs.getString("token", "") ?: ""
        currentUserId = intent.getIntExtra("CURRENT_USER_ID", prefs.getInt("userId", 1))
        targetUserId = intent.getIntExtra("TARGET_USER_ID", 2)
        targetUsername = intent.getStringExtra("TARGET_USERNAME") ?: "User"
        targetDisplayName = intent.getStringExtra("TARGET_DISPLAY_NAME") ?: targetUsername
        targetAvatarUrl = intent.getStringExtra("TARGET_AVATAR_URL")
        targetBioStatus = intent.getStringExtra("TARGET_BIO_STATUS") ?: ""

        setupUI()
        setupMessageDispatcher()
        refreshTargetUserProfile()
        loadInitialMessages()
    }

    override fun onResume() {
        super.onResume()
        HorizonNotificationManager.activeChatPartnerId = targetUserId
        if (authToken.isNotEmpty()) {
            MessageDispatchManager.emitBatchRead(targetUserId)
        }
    }

    override fun onPause() {
        super.onPause()
        HorizonNotificationManager.activeChatPartnerId = null
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupUI() {
        binding.tvRecipientName.text = targetDisplayName.ifEmpty { "@$targetUsername" }
        binding.btnBack.setOnClickListener { finish() }

        renderToolbarAvatar()

        // Tapping recipient header, avatar, name, or info icon opens dedicated UserProfileActivity
        val openProfileListener = View.OnClickListener {
            val intent = Intent(this, UserProfileActivity::class.java).apply {
                putExtra("CURRENT_USER_ID", currentUserId)
                putExtra("TARGET_USER_ID", targetUserId)
                putExtra("TARGET_USERNAME", targetUsername)
                putExtra("TARGET_DISPLAY_NAME", targetDisplayName)
                putExtra("TARGET_AVATAR_URL", targetAvatarUrl)
                putExtra("TARGET_BIO_STATUS", targetBioStatus)
                putExtra("TARGET_LAST_SEEN", targetLastSeen)
                putExtra("TARGET_ONLINE", isTargetOnline)
                putExtra("AUTH_TOKEN", authToken)
            }
            profileLauncher.launch(intent)
        }
        binding.layoutToolbarProfileHeader.setOnClickListener(openProfileListener)
        binding.ivRecipientAvatar.setOnClickListener(openProfileListener)
        binding.tvRecipientAvatarInitials.setOnClickListener(openProfileListener)
        binding.tvRecipientName.setOnClickListener(openProfileListener)
        binding.tvPresence.setOnClickListener(openProfileListener)
        binding.btnInfoProfile.setOnClickListener(openProfileListener)

        // Quoted Reply cancel button
        binding.btnCancelReply.setOnClickListener {
            clearActiveReply()
        }

        // Pinned message banner close button
        binding.btnClosePinned.setOnClickListener {
            binding.layoutPinnedBanner.visibility = View.GONE
        }

        // Pinned message banner click -> scroll to pinned message
        binding.layoutPinnedBanner.setOnClickListener {
            val pinnedMsg = cachedMessageList.find { it.isPinned }
            if (pinnedMsg != null) {
                val index = cachedMessageList.indexOfFirst { it.id == pinnedMsg.id }
                if (index != -1) {
                    binding.rvChatMessages.smoothScrollToPosition(index)
                }
            }
        }

        // Toolbar In-Chat Search Button Toggle
        binding.btnSearchChat.setOnClickListener {
            if (binding.layoutInChatSearch.visibility == View.VISIBLE) {
                binding.layoutInChatSearch.visibility = View.GONE
                binding.etSearchInChat.setText("")
                adapter.setMessages(cachedMessageList)
            } else {
                binding.layoutInChatSearch.visibility = View.VISIBLE
                binding.etSearchInChat.requestFocus()
            }
        }

        // In-Chat Search Listener
        binding.etSearchInChat.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                val query = s?.toString()?.trim()?.lowercase() ?: ""
                if (query.isEmpty()) {
                    adapter.setMessages(cachedMessageList)
                } else {
                    val filtered = cachedMessageList.filter {
                        (it.messageText ?: "").lowercase().contains(query)
                    }
                    adapter.setMessages(filtered)
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        binding.btnCloseInChatSearch.setOnClickListener {
            binding.etSearchInChat.setText("")
            binding.layoutInChatSearch.visibility = View.GONE
            adapter.setMessages(cachedMessageList)
        }

        val layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvChatMessages.layoutManager = layoutManager

        adapter = ChatAdapter(
            currentUserId = currentUserId,
            onMediaDownloadClicked = { /* Handled in adapter */ },
            onViewOnceClicked = { viewOnceMsg -> showViewOnceModal(viewOnceMsg) },
            onImageClicked = { imgMsg -> openPhotoViewer(imgMsg) },
            onDocumentClicked = { docMsg -> openDocumentFile(docMsg) },
            onVideoClicked = { videoMsg -> launchVideoPlayer(videoMsg) },
            onMessageLongClicked = { msg, _ -> showReactionsAndContextMenu(msg) }
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

        // Send Text Message Button
        binding.btnSend.setOnClickListener {
            val text = binding.etMessage.text.toString().trim()
            if (text.isNotEmpty()) {
                stopTyping()
                val replyId = activeQuotedMessage?.id
                clearActiveReply()
                sendMessage(
                    text = text,
                    attachmentType = "NONE",
                    attachmentUrl = null,
                    thumbnailBlur = null,
                    fileSizeBytes = 0,
                    isViewOnce = false,
                    replyToId = replyId
                )
                binding.etMessage.setText("")
            }
        }

        // View-Once Toggle (1-circle icon in dock)
        binding.btnViewOnceToggle.setOnClickListener {
            isViewOnceActive = !isViewOnceActive
            updateViewOnceToggleUI()
        }

        // Attachment Sheet Button
        binding.btnAttachment.setOnClickListener {
            showAttachmentBottomSheet()
        }

        // Camera Button (Photo & Video)
        binding.btnCamera.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            } else {
                openCameraChoiceDialog()
            }
        }

        // Hold-to-Record Microphone Button
        binding.btnMic.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        true
                    } else {
                        triggerHapticFeedback()
                        startVoiceRecording()
                        true
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    stopVoiceRecording()
                    true
                }
                else -> false
            }
        }

        // Text Change Listener (Typing indicator & Mic/Send Button Toggle)
        binding.etMessage.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (!s.isNullOrEmpty()) {
                    binding.btnMic.visibility = View.GONE
                    binding.btnSend.visibility = View.VISIBLE
                    startTyping()
                } else {
                    binding.btnMic.visibility = View.VISIBLE
                    binding.btnSend.visibility = View.GONE
                    stopTyping()
                }
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun setupMessageDispatcher() {
        MessageDispatchManager.initialize(authToken, serverUrl)
        MessageDispatchManager.addListener(this)
    }

    private fun triggerHapticFeedback() {
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(50, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(50)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ==========================================
    // REPLIES & PINNED BANNER HELPERS
    // ==========================================
    private fun setReplyMessage(msg: ChatMessage) {
        activeQuotedMessage = msg
        binding.layoutReplyPreview.visibility = View.VISIBLE
        val authorName = if (msg.senderId == currentUserId) "You" else (targetDisplayName.ifEmpty { "@$targetUsername" })
        binding.tvReplyAuthor.text = "Replying to $authorName"
        binding.tvReplySnippet.text = when {
            msg.attachmentType == "IMAGE" -> "📷 Photo"
            msg.attachmentType == "VIDEO" -> "🎥 Video"
            msg.attachmentType == "AUDIO" -> "🎤 Voice Note"
            msg.attachmentType == "DOCUMENT" -> "📄 Document"
            msg.attachmentType == "LOCATION" -> "📍 Location"
            else -> msg.messageText ?: "Quoted message"
        }
        binding.etMessage.requestFocus()
    }

    private fun clearActiveReply() {
        activeQuotedMessage = null
        binding.layoutReplyPreview.visibility = View.GONE
    }

    private fun updatePinnedBannerUI() {
        val pinnedMsg = cachedMessageList.find { it.isPinned }
        if (pinnedMsg != null) {
            binding.layoutPinnedBanner.visibility = View.VISIBLE
            binding.tvPinnedSnippet.text = when {
                pinnedMsg.attachmentType == "IMAGE" -> "📷 Photo"
                pinnedMsg.attachmentType == "VIDEO" -> "🎥 Video"
                pinnedMsg.attachmentType == "AUDIO" -> "🎤 Voice Note"
                pinnedMsg.attachmentType == "DOCUMENT" -> "📄 Document"
                pinnedMsg.attachmentType == "LOCATION" -> "📍 Location"
                else -> pinnedMsg.messageText ?: "Pinned message"
            }
        } else {
            binding.layoutPinnedBanner.visibility = View.GONE
        }
    }

    // ==========================================
    // LONG PRESS REACTION & CONTEXT MENU (TASK 3)
    // ==========================================
    private fun showReactionsAndContextMenu(msg: ChatMessage) {
        triggerHapticFeedback()

        val bottomSheet = BottomSheetDialog(this)
        val menuBinding = DialogMessageContextMenuBinding.inflate(layoutInflater)
        bottomSheet.setContentView(menuBinding.root)

        // Setup reactions
        val emojis = mapOf(
            menuBinding.btnReactionHeart to "❤️",
            menuBinding.btnReactionThumbsUp to "👍",
            menuBinding.btnReactionThumbsDown to "👎",
            menuBinding.btnReactionFire to "🔥",
            menuBinding.btnReactionInLove to "🥰",
            menuBinding.btnReactionClap to "👏",
            menuBinding.btnReactionJoy to "😂"
        )

        emojis.forEach { (view, emoji) ->
            view.setOnClickListener {
                triggerHapticFeedback()
                MessageDispatchManager.emitReaction(msg.id, emoji)
                bottomSheet.dismiss()
            }
        }

        // 1. Reply / Quote
        menuBinding.btnActionReply.setOnClickListener {
            bottomSheet.dismiss()
            setReplyMessage(msg)
        }

        // 2. Copy Text
        if (!msg.messageText.isNullOrEmpty() && msg.attachmentType == "NONE") {
            menuBinding.btnActionCopy.visibility = View.VISIBLE
            menuBinding.btnActionCopy.setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("Horizon Message", msg.messageText)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "Message copied to clipboard", Toast.LENGTH_SHORT).show()
                bottomSheet.dismiss()
            }
        } else {
            menuBinding.btnActionCopy.visibility = View.GONE
        }

        // 3. Pin / Unpin
        menuBinding.tvPinActionLabel.text = if (msg.isPinned) "Unpin Message" else "Pin Message"
        menuBinding.btnActionPin.setOnClickListener {
            MessageDispatchManager.emitPin(msg.id, !msg.isPinned)
            bottomSheet.dismiss()
        }

        // 4. Forward
        menuBinding.btnActionForward.setOnClickListener {
            bottomSheet.dismiss()
            showForwardDialog(msg)
        }

        // 5. Save to Downloads
        if (msg.attachmentType in listOf("IMAGE", "VIDEO", "DOCUMENT", "AUDIO") && !msg.attachmentUrl.isNullOrEmpty()) {
            menuBinding.btnActionSave.visibility = View.VISIBLE
            menuBinding.btnActionSave.setOnClickListener {
                bottomSheet.dismiss()
                saveMediaToDownloads(msg)
            }
        } else {
            menuBinding.btnActionSave.visibility = View.GONE
        }

        // 6. Delete
        menuBinding.btnActionDelete.setOnClickListener {
            bottomSheet.dismiss()
            showDeleteDialog(msg)
        }

        bottomSheet.show()
    }

    private fun showDeleteDialog(msg: ChatMessage) {
        val isMe = msg.senderId == currentUserId
        val options = if (isMe) {
            arrayOf("Delete for me", "Delete for everyone")
        } else {
            arrayOf("Delete for me")
        }

        AlertDialog.Builder(this)
            .setTitle("Delete message?")
            .setItems(options) { _, which ->
                if (which == 0) {
                    MessageDispatchManager.emitDelete(msg.id, deleteForEveryone = false)
                } else {
                    MessageDispatchManager.emitDelete(msg.id, deleteForEveryone = true)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showForwardDialog(msg: ChatMessage) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.getConversations("Bearer $authToken")
                if (res.isSuccessful && res.body() != null) {
                    val convs = res.body()!!
                    withContext(Dispatchers.Main) {
                        val names = convs.map { it.partnerDisplayName ?: it.partnerUsername }.toTypedArray()
                        if (names.isEmpty()) {
                            Toast.makeText(this@ChatActivity, "No other chats to forward to", Toast.LENGTH_SHORT).show()
                            return@withContext
                        }

                        AlertDialog.Builder(this@ChatActivity)
                            .setTitle("Forward message to...")
                            .setItems(names) { _, which ->
                                val target = convs[which]
                                MessageDispatchManager.enqueueMessage(
                                    currentUserId = currentUserId,
                                    recipientId = target.partnerUserId,
                                    text = msg.messageText ?: "",
                                    attachmentType = msg.attachmentType,
                                    attachmentUrl = msg.attachmentUrl,
                                    thumbnailBlur = msg.thumbnailBlur,
                                    fileSizeBytes = msg.fileSizeBytes,
                                    isViewOnce = false,
                                    replyToId = null
                                )
                                Toast.makeText(this@ChatActivity, "Forwarded to ${names[which]}", Toast.LENGTH_SHORT).show()
                            }
                            .setNegativeButton("Cancel", null)
                            .show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun saveMediaToDownloads(msg: ChatMessage) {
        val url = msg.attachmentUrl ?: return
        val ext = when (msg.attachmentType) {
            "IMAGE" -> "jpg"
            "VIDEO" -> "mp4"
            "AUDIO" -> "m4a"
            "DOCUMENT" -> "pdf"
            else -> "bin"
        }
        val fileName = if (!msg.messageText.isNullOrEmpty() && msg.attachmentType == "DOCUMENT") {
            msg.messageText!!
        } else {
            "Horizon_${msg.attachmentType.lowercase()}_${System.currentTimeMillis()}.$ext"
        }

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val targetFile = File(downloadsDir, fileName)

                if (url.startsWith("data:")) {
                    val cleanBase64 = if (url.contains("base64,")) url.substringAfter("base64,") else url
                    val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                    FileOutputStream(targetFile).use { it.write(bytes) }
                } else if (url.startsWith("http")) {
                    val client = OkHttpClient()
                    val req = Request.Builder().url(url).build()
                    val resp = client.newCall(req).execute()
                    if (resp.isSuccessful && resp.body != null) {
                        FileOutputStream(targetFile).use { it.write(resp.body!!.bytes()) }
                    }
                } else {
                    val src = File(url)
                    if (src.exists()) {
                        src.copyTo(targetFile, overwrite = true)
                    }
                }

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Saved to Downloads: $fileName", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to save: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // ==========================================
    // VOICE NOTE IMPLEMENTATION
    // ==========================================
    private fun startVoiceRecording() {
        try {
            val audioDir = File(cacheDir, "voice_notes").apply { mkdirs() }
            activeVoiceFile = File(audioDir, "voice_${System.currentTimeMillis()}.m4a")

            mediaRecorder = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()).apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(64000)
                setAudioSamplingRate(44100)
                setOutputFile(activeVoiceFile!!.absolutePath)
                prepare()
                start()
            }

            voiceRecordingStartTime = System.currentTimeMillis()
            binding.layoutNormalInput.visibility = View.GONE
            binding.layoutRecordingBar.visibility = View.VISIBLE
            binding.tvRecordingTimer.text = "0:00"

            binding.ivRecordingDot.animate().alpha(0.2f).setDuration(400).withEndAction {
                binding.ivRecordingDot.animate().alpha(1.0f).setDuration(400).start()
            }.start()

            recordingTimerRunnable = object : Runnable {
                override fun run() {
                    val elapsedSec = ((System.currentTimeMillis() - voiceRecordingStartTime) / 1000).toInt()
                    binding.tvRecordingTimer.text = String.format("%d:%02d", elapsedSec / 60, elapsedSec % 60)
                    recordingTimerHandler.postDelayed(this, 1000)
                }
            }
            recordingTimerHandler.post(recordingTimerRunnable!!)
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "Failed to start recording: ${e.message}", Toast.LENGTH_SHORT).show()
            restoreNormalInputDock()
        }
    }

    private fun stopVoiceRecording() {
        recordingTimerRunnable?.let { recordingTimerHandler.removeCallbacks(it) }

        try {
            mediaRecorder?.stop()
            mediaRecorder?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            mediaRecorder = null
        }

        val elapsedMs = System.currentTimeMillis() - voiceRecordingStartTime
        if (elapsedMs < 1000 || activeVoiceFile == null || !activeVoiceFile!!.exists()) {
            activeVoiceFile?.delete()
            activeVoiceFile = null
            restoreNormalInputDock()
            Toast.makeText(this, "Hold microphone to record voice note", Toast.LENGTH_SHORT).show()
            return
        }

        recordedAudioDurationMs = elapsedMs
        val totalSec = (elapsedMs / 1000).toInt()
        val durationFormatted = String.format("%d:%02d", totalSec / 60, totalSec % 60)

        binding.layoutRecordingBar.visibility = View.GONE
        binding.layoutVoicePreviewBar.visibility = View.VISIBLE
        binding.tvVoicePreviewDuration.text = durationFormatted
        binding.pbVoicePreview.progress = 0

        setupVoicePreviewUI(activeVoiceFile!!, elapsedMs)
    }

    private fun setupVoicePreviewUI(file: File, durationMs: Long) {
        cleanVoicePreviewState()
        binding.btnPlayVoicePreview.setImageResource(R.drawable.ic_play_arrow)

        binding.btnPlayVoicePreview.setOnClickListener {
            if (previewMediaPlayer == null) {
                previewMediaPlayer = MediaPlayer().apply {
                    setDataSource(file.absolutePath)
                    prepare()
                    setOnCompletionListener {
                        binding.btnPlayVoicePreview.setImageResource(R.drawable.ic_play_arrow)
                        binding.pbVoicePreview.progress = 0
                        previewProgressRunnable?.let { r -> previewProgressHandler.removeCallbacks(r) }
                    }
                    start()
                }
                binding.btnPlayVoicePreview.setImageResource(R.drawable.ic_pause_circle)
                startPreviewProgressUpdater()
            } else if (previewMediaPlayer!!.isPlaying) {
                previewMediaPlayer!!.pause()
                binding.btnPlayVoicePreview.setImageResource(R.drawable.ic_play_arrow)
                previewProgressRunnable?.let { r -> previewProgressHandler.removeCallbacks(r) }
            } else {
                previewMediaPlayer!!.start()
                binding.btnPlayVoicePreview.setImageResource(R.drawable.ic_pause_circle)
                startPreviewProgressUpdater()
            }
        }

        binding.btnCancelVoice.setOnClickListener {
            cleanVoicePreviewState()
            file.delete()
            activeVoiceFile = null
            restoreNormalInputDock()
            Toast.makeText(this, "Voice note discarded", Toast.LENGTH_SHORT).show()
        }

        binding.btnSendVoice.setOnClickListener {
            cleanVoicePreviewState()
            restoreNormalInputDock()
            val replyId = activeQuotedMessage?.id
            clearActiveReply()
            uploadAndSendVoiceNote(file, durationMs, replyId)
        }
    }

    private fun startPreviewProgressUpdater() {
        previewProgressRunnable = object : Runnable {
            override fun run() {
                val mp = previewMediaPlayer
                if (mp != null && mp.isPlaying && mp.duration > 0) {
                    val progress = ((mp.currentPosition.toDouble() / mp.duration) * 100).toInt()
                    binding.pbVoicePreview.progress = progress
                    previewProgressHandler.postDelayed(this, 100)
                }
            }
        }
        previewProgressHandler.post(previewProgressRunnable!!)
    }

    private fun cleanVoicePreviewState() {
        previewProgressRunnable?.let { previewProgressHandler.removeCallbacks(it) }
        try {
            previewMediaPlayer?.stop()
            previewMediaPlayer?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            previewMediaPlayer = null
        }
    }

    private fun restoreNormalInputDock() {
        binding.layoutRecordingBar.visibility = View.GONE
        binding.layoutVoicePreviewBar.visibility = View.GONE
        binding.layoutNormalInput.visibility = View.VISIBLE
    }

    private fun uploadAndSendVoiceNote(file: File, durationMs: Long, replyId: Long?) {
        val totalSec = (durationMs / 1000).toInt()
        val durationText = String.format("%d:%02d", totalSec / 60, totalSec % 60)

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val bytes = file.readBytes()
                val base64 = "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                val uploadReq = MediaUploadRequest(
                    imageBase64 = base64,
                    fileName = "voice_${System.currentTimeMillis()}.m4a",
                    fileSizeBytes = bytes.size.toLong(),
                    thumbnailBlur = null
                )
                val response = ApiClient.apiService.uploadMedia("Bearer $authToken", uploadReq)
                val finalUrl = if (response.isSuccessful && response.body() != null) {
                    response.body()!!.attachmentUrl
                } else {
                    base64
                }

                val viewOnce = isViewOnceActive
                withContext(Dispatchers.Main) {
                    isViewOnceActive = false
                    updateViewOnceToggleUI()
                    val tempId = System.currentTimeMillis()
                    try {
                        val voiceDir = File(cacheDir, "voice_cache").apply { mkdirs() }
                        file.copyTo(File(voiceDir, "voice_${tempId}.m4a"), overwrite = true)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    sendMessage(
                        text = durationText,
                        attachmentType = "AUDIO",
                        attachmentUrl = finalUrl,
                        thumbnailBlur = null,
                        fileSizeBytes = bytes.size.toLong(),
                        isViewOnce = viewOnce,
                        preassignedTempId = tempId,
                        replyToId = replyId
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to upload voice note: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            } finally {
                file.delete()
                activeVoiceFile = null
            }
        }
    }

    private fun renderToolbarAvatar() {
        AvatarHelper.setupAvatar(
            imageView = binding.ivRecipientAvatar,
            initialsView = binding.tvRecipientAvatarInitials,
            avatarUrl = targetAvatarUrl,
            name = if (targetDisplayName.isNotEmpty()) targetDisplayName else targetUsername
        )
        updatePresenceUI(isTargetOnline, false)
    }

    private fun updatePresenceUI(isOnline: Boolean, isTyping: Boolean) {
        if (isTyping) {
            binding.tvPresence.text = "typing..."
            binding.tvPresence.setTextColor(ContextCompat.getColor(this, R.color.accent_amber))
            binding.viewOnlineDot.visibility = View.VISIBLE
        } else if (isOnline) {
            binding.tvPresence.text = "online"
            binding.tvPresence.setTextColor(ContextCompat.getColor(this, R.color.ticks_sent))
            binding.viewOnlineDot.visibility = View.VISIBLE
        } else {
            binding.tvPresence.text = TimeFormatHelper.formatLastSeen(targetLastSeen, isOnline)
            binding.tvPresence.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
            binding.viewOnlineDot.visibility = View.GONE
        }
    }

    private fun refreshTargetUserProfile() {
        if (authToken.isEmpty()) return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.lookupUser("Bearer $authToken", targetUsername)
                if (res.isSuccessful && res.body() != null) {
                    val user = res.body()!!
                    withContext(Dispatchers.Main) {
                        targetDisplayName = user.displayName ?: user.username
                        targetBioStatus = user.bioStatus ?: ""
                        targetAvatarUrl = user.avatarUrl
                        targetLastSeen = user.lastSeen
                        isTargetOnline = user.online
                        binding.tvRecipientName.text = targetDisplayName.ifEmpty { "@$targetUsername" }
                        renderToolbarAvatar()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // ==========================================
    // CAMERA & MEDIA PICKERS
    // ==========================================
    private fun openCameraChoiceDialog() {
        val options = arrayOf("📸 Take Photo", "🎥 Record Video")
        AlertDialog.Builder(this)
            .setTitle("Camera")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> launchNativeCameraPhoto()
                    1 -> launchNativeCameraVideo()
                }
            }
            .show()
    }

    private fun launchNativeCameraPhoto() {
        val cameraDir = File(cacheDir, "camera").apply { mkdirs() }
        val photoFile = File(cameraDir, "photo_${System.currentTimeMillis()}.jpg")
        cameraOutputUri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", photoFile)
        takePhotoLauncher.launch(cameraOutputUri)
    }

    private fun launchNativeCameraVideo() {
        val cameraDir = File(cacheDir, "camera").apply { mkdirs() }
        val videoFile = File(cameraDir, "video_${System.currentTimeMillis()}.mp4")
        cameraOutputUri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", videoFile)
        captureVideoLauncher.launch(cameraOutputUri)
    }

    private fun handleCapturedVideo(uri: Uri) {
        val replyId = activeQuotedMessage?.id
        clearActiveReply()

        lifecycleScope.launch(Dispatchers.IO) {
            var currentTempId = System.currentTimeMillis()
            try {
                var durationMs = 0L
                var thumbBase64: String? = null

                try {
                    val retriever = MediaMetadataRetriever()
                    retriever.setDataSource(this@ChatActivity, uri)
                    val durStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    durationMs = durStr?.toLongOrNull() ?: 0L
                    val frameBitmap = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    if (frameBitmap != null) {
                        val scaled = Bitmap.createScaledBitmap(frameBitmap, 320, 240, true)
                        val baos = ByteArrayOutputStream()
                        scaled.compress(Bitmap.CompressFormat.JPEG, 70, baos)
                        thumbBase64 = "data:image/jpeg;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                    }
                    retriever.release()
                } catch (metaErr: Exception) {
                    metaErr.printStackTrace()
                }

                val durSec = (durationMs / 1000).toInt()
                val durationText = String.format("%d:%02d", durSec / 60, durSec % 60)

                val inputStream = contentResolver.openInputStream(uri)
                val bytes = inputStream?.readBytes() ?: ByteArray(0)
                inputStream?.close()

                if (bytes.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@ChatActivity, "Could not read video file", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                if (bytes.size > 50 * 1024 * 1024) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@ChatActivity, "Video exceeds 50MB limit", Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }

                currentTempId = System.currentTimeMillis()
                val videoDir = File(cacheDir, "video_cache").apply { mkdirs() }
                val localCopy = File(videoDir, "vid_${currentTempId}.mp4")
                try {
                    localCopy.writeBytes(bytes)
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                val metaThumb = (thumbBase64 ?: "") + ";dur:" + durationText
                val viewOnce = isViewOnceActive

                val base64 = "data:video/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                val uploadReq = MediaUploadRequest(
                    imageBase64 = base64,
                    fileName = "video_${currentTempId}.mp4",
                    fileSizeBytes = bytes.size.toLong(),
                    thumbnailBlur = thumbBase64
                )
                val response = ApiClient.apiService.uploadMedia("Bearer $authToken", uploadReq)
                val finalUrl = if (response.isSuccessful && response.body() != null) {
                    response.body()!!.attachmentUrl
                } else {
                    base64
                }

                withContext(Dispatchers.Main) {
                    isViewOnceActive = false
                    updateViewOnceToggleUI()
                    sendMessage(
                        text = durationText,
                        attachmentType = "VIDEO",
                        attachmentUrl = finalUrl,
                        thumbnailBlur = metaThumb,
                        fileSizeBytes = bytes.size.toLong(),
                        isViewOnce = viewOnce,
                        preassignedTempId = currentTempId,
                        replyToId = replyId
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to upload video: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun showAttachmentBottomSheet() {
        val bottomSheet = BottomSheetDialog(this)
        val sheetBinding = DialogAttachmentPickerBinding.inflate(layoutInflater)
        bottomSheet.setContentView(sheetBinding.root)

        sheetBinding.switchViewOnce.isChecked = isViewOnceActive
        sheetBinding.switchViewOnce.setOnCheckedChangeListener { _, isChecked ->
            isViewOnceActive = isChecked
            updateViewOnceToggleUI()
        }

        sheetBinding.btnOptionGallery.setOnClickListener {
            bottomSheet.dismiss()
            imagePickerLauncher.launch("image/*")
        }

        sheetBinding.btnOptionVideo.setOnClickListener {
            bottomSheet.dismiss()
            val choices = arrayOf("📁 Choose Video from Gallery", "🎥 Record Video with Camera")
            AlertDialog.Builder(this)
                .setTitle("Send Video")
                .setItems(choices) { _, which ->
                    when (which) {
                        0 -> videoPickerLauncher.launch("video/*")
                        1 -> {
                            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                            } else {
                                launchNativeCameraVideo()
                            }
                        }
                    }
                }
                .show()
        }

        sheetBinding.btnOptionDocument.setOnClickListener {
            bottomSheet.dismiss()
            documentPickerLauncher.launch("*/*")
        }

        sheetBinding.btnOptionCamera.setOnClickListener {
            bottomSheet.dismiss()
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            } else {
                openCameraChoiceDialog()
            }
        }

        sheetBinding.btnOptionVoice.setOnClickListener {
            bottomSheet.dismiss()
            Toast.makeText(this, "Hold the mic icon on the bottom right to record voice notes", Toast.LENGTH_LONG).show()
        }

        sheetBinding.btnOptionLocation.setOnClickListener {
            bottomSheet.dismiss()
            sendLocation()
        }

        bottomSheet.show()
    }

    private fun handlePickedImage(uri: Uri) {
        val replyId = activeQuotedMessage?.id
        clearActiveReply()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val originalBitmap = BitmapFactory.decodeStream(inputStream)
                inputStream?.close()

                if (originalBitmap != null) {
                    val maxDim = 1280
                    val width = originalBitmap.width
                    val height = originalBitmap.height
                    val ratio = Math.min(1.0, maxDim.toDouble() / Math.max(width, height))
                    val scaledBitmap = if (ratio < 1.0) {
                        Bitmap.createScaledBitmap(originalBitmap, (width * ratio).toInt(), (height * ratio).toInt(), true)
                    } else {
                        originalBitmap
                    }

                    val microThumb = Bitmap.createScaledBitmap(scaledBitmap, 20, 20, true)
                    val thumbStream = ByteArrayOutputStream()
                    microThumb.compress(Bitmap.CompressFormat.JPEG, 60, thumbStream)
                    val thumbBase64 = "data:image/jpeg;base64," + Base64.encodeToString(thumbStream.toByteArray(), Base64.NO_WRAP)

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

                    val finalUrl = uploadedUrl ?: fullBase64

                    withContext(Dispatchers.Main) {
                        sendMessage(
                            text = if (viewOnce) "View Once Photo" else "Photo",
                            attachmentType = "IMAGE",
                            attachmentUrl = finalUrl,
                            thumbnailBlur = thumbBase64,
                            fileSizeBytes = fullSize,
                            isViewOnce = viewOnce,
                            replyToId = replyId
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
        val replyId = activeQuotedMessage?.id
        clearActiveReply()

        var docName = "Document.pdf"
        var docSize = 0L

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

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val bytes = inputStream?.readBytes() ?: ByteArray(0)
                inputStream?.close()

                if (docSize == 0L) docSize = bytes.size.toLong()

                val base64 = "data:application/octet-stream;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                val uploadReq = MediaUploadRequest(
                    imageBase64 = base64,
                    fileName = docName,
                    fileSizeBytes = docSize,
                    thumbnailBlur = null
                )

                try {
                    val docsDir = File(cacheDir, "documents").apply { mkdirs() }
                    File(docsDir, docName).writeBytes(bytes)
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                val response = ApiClient.apiService.uploadMedia("Bearer $authToken", uploadReq)
                val finalUrl = if (response.isSuccessful && response.body() != null) {
                    response.body()!!.attachmentUrl
                } else {
                    base64
                }

                withContext(Dispatchers.Main) {
                    sendMessage(
                        text = docName,
                        attachmentType = "DOCUMENT",
                        attachmentUrl = finalUrl,
                        thumbnailBlur = null,
                        fileSizeBytes = docSize,
                        isViewOnce = false,
                        replyToId = replyId
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to upload document: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun sendLocation() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        } else {
            fetchAndSendRealLocation()
        }
    }

    private fun fetchAndSendRealLocation() {
        val replyId = activeQuotedMessage?.id
        clearActiveReply()

        try {
            val locationManager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            val location: Location? = try {
                locationManager?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                    ?: locationManager?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            } catch (e: SecurityException) {
                null
            }

            val lat = location?.latitude ?: 30.7333
            val lng = location?.longitude ?: 76.7794

            val coordsText = String.format(Locale.US, "%.4f° N, %.4f° E", lat, lng)
            val mapUrl = "https://maps.google.com/?q=$lat,$lng"

            sendMessage(
                text = coordsText,
                attachmentType = "LOCATION",
                attachmentUrl = mapUrl,
                thumbnailBlur = null,
                fileSizeBytes = 0,
                isViewOnce = false,
                replyToId = replyId
            )
        } catch (e: Exception) {
            e.printStackTrace()
            sendMessage(
                text = "30.7333° N, 76.7794° E",
                attachmentType = "LOCATION",
                attachmentUrl = "https://maps.google.com/?q=30.7333,76.7794",
                thumbnailBlur = null,
                fileSizeBytes = 0,
                isViewOnce = false,
                replyToId = replyId
            )
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

    private fun showViewOnceModal(msg: ChatMessage) {
        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.window?.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        val frameLayout = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.bg_base))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val imageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        frameLayout.addView(imageView)

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
            adapter.markMessageViewed(msg.id)
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    ApiClient.apiService.markViewOnceOpened("Bearer $authToken", msg.id)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            MessageDispatchManager.emitMediaViewed(msg.id, targetUserId)
            Toast.makeText(this, "Photo closed and permanently expired.", Toast.LENGTH_SHORT).show()
        }

        dialog.show()
    }

    private fun startTyping() {
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true
            MessageDispatchManager.emitTypingStart(targetUserId)
        }
        typingHandler.removeCallbacks(stopTypingRunnable)
        typingHandler.postDelayed(stopTypingRunnable, 2500)
    }

    private fun stopTyping() {
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false
            typingHandler.removeCallbacks(stopTypingRunnable)
            MessageDispatchManager.emitTypingStop(targetUserId)
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
                        cachedMessageList.clear()
                        cachedMessageList.addAll(list)
                        adapter.setMessages(list)
                        binding.rvChatMessages.scrollToPosition(adapter.itemCount - 1)
                        updatePinnedBannerUI()
                        MessageDispatchManager.emitBatchRead(targetUserId)
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
                        cachedMessageList.addAll(0, olderBatch)
                        adapter.prependMessages(olderBatch)
                        updatePinnedBannerUI()
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
        isViewOnce: Boolean,
        preassignedTempId: Long? = null,
        replyToId: Long? = null
    ) {
        val optimisticMsg = MessageDispatchManager.enqueueMessage(
            currentUserId = currentUserId,
            recipientId = targetUserId,
            text = text,
            attachmentType = attachmentType,
            attachmentUrl = attachmentUrl,
            thumbnailBlur = thumbnailBlur,
            fileSizeBytes = fileSizeBytes,
            isViewOnce = isViewOnce,
            replyToId = replyToId
        )
        cachedMessageList.add(optimisticMsg)
        adapter.appendMessage(optimisticMsg)
        binding.rvChatMessages.smoothScrollToPosition(adapter.itemCount - 1)
    }

    // ==========================================
    // MESSAGE DISPATCH MANAGER LISTENER CALLBACKS
    // ==========================================
    override fun onNewMessage(message: ChatMessage) {
        runOnUiThread {
            if (message.senderId == targetUserId || message.recipientId == targetUserId) {
                val existingIdx = cachedMessageList.indexOfFirst { it.id == message.id || (it.localClientId != null && it.localClientId == message.localClientId) }
                if (existingIdx != -1) {
                    cachedMessageList[existingIdx] = message
                    adapter.updateOptimisticMessage(cachedMessageList[existingIdx].id, message)
                } else {
                    cachedMessageList.add(message)
                    adapter.appendMessage(message)
                    binding.rvChatMessages.smoothScrollToPosition(adapter.itemCount - 1)
                }
                if (message.senderId == targetUserId) {
                    MessageDispatchManager.emitBatchRead(targetUserId)
                }
                updatePinnedBannerUI()
            }
        }
    }

    override fun onMessageStatusUpdated(messageId: Long, localClientId: String?, status: String) {
        runOnUiThread {
            val idx = cachedMessageList.indexOfFirst { it.id == messageId || (localClientId != null && it.localClientId == localClientId) }
            if (idx != -1) {
                cachedMessageList[idx].status = status
            }
            if (status == "READ") {
                adapter.markMessageRead(messageId)
            } else if (status == "DELIVERED") {
                adapter.markMessageDelivered(messageId)
            } else {
                adapter.updateMessageStatus(messageId, status)
            }
        }
    }

    override fun onMessageReactionUpdated(messageId: Long, reactions: Map<String, List<Int>>) {
        runOnUiThread {
            val idx = cachedMessageList.indexOfFirst { it.id == messageId }
            if (idx != -1) {
                cachedMessageList[idx].reactions = reactions
            }
            adapter.updateMessageReaction(messageId, reactions)
        }
    }

    override fun onMessagePinned(messageId: Long, isPinned: Boolean) {
        runOnUiThread {
            val idx = cachedMessageList.indexOfFirst { it.id == messageId }
            if (idx != -1) {
                cachedMessageList[idx].isPinned = isPinned
            }
            adapter.updateMessagePinned(messageId, isPinned)
            updatePinnedBannerUI()
        }
    }

    override fun onMessageDeleted(messageId: Long, deletedForEveryone: Boolean, deletedByUsers: List<Int>) {
        runOnUiThread {
            val idx = cachedMessageList.indexOfFirst { it.id == messageId }
            if (idx != -1) {
                if (deletedForEveryone) {
                    cachedMessageList[idx].deletedForEveryone = true
                    cachedMessageList[idx].messageText = "🚫 This message was deleted"
                    cachedMessageList[idx].attachmentType = "NONE"
                    cachedMessageList[idx].attachmentUrl = null
                } else if (deletedByUsers.contains(currentUserId)) {
                    cachedMessageList.removeAt(idx)
                }
            }
            adapter.updateMessageDeleted(messageId, deletedForEveryone, "🚫 This message was deleted")
            updatePinnedBannerUI()
        }
    }

    override fun onUserTyping(userId: Int, isTyping: Boolean) {
        runOnUiThread {
            if (userId == targetUserId) {
                updatePresenceUI(isTargetOnline, isTyping)
            }
        }
    }

    override fun onUserStatusChanged(userId: Int, status: String, lastSeen: String?) {
        runOnUiThread {
            if (userId == targetUserId) {
                isTargetOnline = status == "online"
                if (!lastSeen.isNullOrEmpty()) {
                    targetLastSeen = lastSeen
                }
                updatePresenceUI(isTargetOnline, false)
            }
        }
    }

    override fun onConversationRead(readerId: Int, partnerId: Int, readAt: String) {
        runOnUiThread {
            if (readerId == targetUserId && partnerId == currentUserId) {
                cachedMessageList.forEach { msg ->
                    if (msg.senderId == currentUserId) {
                        msg.status = "READ"
                        adapter.markMessageRead(msg.id)
                    }
                }
            }
        }
    }

    override fun onMediaViewed(messageId: Long) {
        runOnUiThread {
            val idx = cachedMessageList.indexOfFirst { it.id == messageId }
            if (idx != -1) {
                cachedMessageList[idx].isViewed = true
            }
            adapter.markMessageViewed(messageId)
        }
    }

    private fun openPhotoViewer(msg: ChatMessage) {
        val url = msg.attachmentUrl ?: return
        val sender = if (msg.senderId == currentUserId) "You" else targetUsername
        val intent = Intent(this, PhotoViewerActivity::class.java).apply {
            putExtra("PHOTO_URL", url)
            putExtra("PHOTO_TITLE", "Photo")
            putExtra("SENDER_NAME", sender)
            putExtra("TIMESTAMP", msg.createdAt)
            putExtra("CAPTION", msg.messageText)
        }
        startActivity(intent)
    }

    private fun launchVideoPlayer(msg: ChatMessage) {
        val url = msg.attachmentUrl ?: return
        val sender = if (msg.senderId == currentUserId) "You" else targetUsername
        val intent = Intent(this, VideoPlayerActivity::class.java).apply {
            putExtra("VIDEO_URL", url)
            putExtra("VIDEO_TITLE", "Video")
            putExtra("SENDER_NAME", sender)
            putExtra("TIMESTAMP", msg.createdAt)
        }
        startActivity(intent)
    }

    private fun openDocumentFile(docMsg: ChatMessage) {
        val url = docMsg.attachmentUrl
        val docName = if (!docMsg.messageText.isNullOrEmpty()) docMsg.messageText!! else "document_${docMsg.id}.pdf"
        val docsDir = File(cacheDir, "documents").apply { mkdirs() }
        val localFile = File(docsDir, docName)

        if (url.isNullOrEmpty()) {
            Toast.makeText(this, "Document not available", Toast.LENGTH_SHORT).show()
            return
        }

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                if (!localFile.exists() || localFile.length() == 0L) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@ChatActivity, "Downloading $docName...", Toast.LENGTH_SHORT).show()
                    }

                    if (url.startsWith("data:")) {
                        val cleanBase64 = if (url.contains("base64,")) url.substringAfter("base64,") else url
                        val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                        FileOutputStream(localFile).use { it.write(bytes) }
                    } else if (url.startsWith("http")) {
                        val client = OkHttpClient()
                        val request = Request.Builder().url(url).build()
                        val response = client.newCall(request).execute()
                        if (response.isSuccessful && response.body != null) {
                            FileOutputStream(localFile).use { it.write(response.body!!.bytes()) }
                        }
                    } else if (url.startsWith("file://") || url.startsWith("/")) {
                        val srcFile = File(url.removePrefix("file://"))
                        if (srcFile.exists()) {
                            srcFile.copyTo(localFile, overwrite = true)
                        }
                    } else {
                        localFile.writeText("Horizon Chat Document: $docName\nTimestamp: ${docMsg.createdAt}")
                    }
                }

                withContext(Dispatchers.Main) {
                    if (localFile.exists() && localFile.length() > 0) {
                        try {
                            val contentUri = FileProvider.getUriForFile(
                                this@ChatActivity,
                                "${applicationContext.packageName}.fileprovider",
                                localFile
                            )
                            val ext = MimeTypeMap.getFileExtensionFromUrl(localFile.name).ifEmpty { localFile.extension }
                            val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase()) ?: "*/*"

                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(contentUri, mimeType)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(Intent.createChooser(intent, "Open $docName"))
                        } catch (e: Exception) {
                            Toast.makeText(this@ChatActivity, "Saved document: ${localFile.name}", Toast.LENGTH_LONG).show()
                        }
                    } else {
                        Toast.makeText(this@ChatActivity, "Failed to load document", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Error opening document: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        MessageDispatchManager.removeListener(this)
        stopTyping()
        cleanVoicePreviewState()
        try {
            mediaRecorder?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        mediaRecorder = null
        recordingTimerRunnable?.let { recordingTimerHandler.removeCallbacks(it) }
        adapter.releaseMediaPlayer()
    }
}
