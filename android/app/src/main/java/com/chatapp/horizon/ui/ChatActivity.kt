package com.chatapp.horizon.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
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
import com.chatapp.horizon.models.*
import com.chatapp.horizon.network.ApiClient
import com.google.android.material.bottomsheet.BottomSheetDialog
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
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

    private val audioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Toast.makeText(this, "Microphone permission is required to record voice notes", Toast.LENGTH_SHORT).show()
        }
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

    @SuppressLint("ClickableViewAccessibility")
    private fun setupUI() {
        binding.tvRecipientName.text = "@$targetUsername"
        binding.btnBack.setOnClickListener { finish() }

        if (!targetAvatarUrl.isNullOrEmpty()) {
            Glide.with(this)
                .load(targetAvatarUrl)
                .placeholder(android.R.drawable.sym_def_app_icon)
                .into(binding.ivRecipientAvatar)
        }

        // Tapping recipient avatar opens profile picture in full-screen interactive lightbox
        binding.ivRecipientAvatar.setOnClickListener {
            if (!targetAvatarUrl.isNullOrEmpty()) {
                openLightboxViewer(targetAvatarUrl!!, "@$targetUsername Profile Picture")
            } else {
                Toast.makeText(this, "@$targetUsername (No avatar set)", Toast.LENGTH_SHORT).show()
            }
        }

        val layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        binding.rvChatMessages.layoutManager = layoutManager

        adapter = ChatAdapter(
            currentUserId = currentUserId,
            onMediaDownloadClicked = { /* Handled in adapter */ },
            onViewOnceClicked = { viewOnceMsg -> showViewOnceModal(viewOnceMsg) },
            onImageClicked = { imgMsg ->
                if (!imgMsg.attachmentUrl.isNullOrEmpty()) {
                    openLightboxViewer(imgMsg.attachmentUrl!!, "Photo")
                }
            },
            onDocumentClicked = { docMsg -> openDocumentFile(docMsg) }
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
    // 1. HOLD-TO-RECORD VOICE NOTE IMPLEMENTATION
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

            // Pulse red dot animation
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

        // Decouple recording from immediate dispatch: Swap input bar to Preview & Staging Bar
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

        // Cancel / Trash button
        binding.btnCancelVoice.setOnClickListener {
            cleanVoicePreviewState()
            file.delete()
            activeVoiceFile = null
            restoreNormalInputDock()
            Toast.makeText(this, "Voice note discarded", Toast.LENGTH_SHORT).show()
        }

        // Dedicated Send button
        binding.btnSendVoice.setOnClickListener {
            cleanVoicePreviewState()
            restoreNormalInputDock()
            uploadAndSendVoiceNote(file, durationMs)
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

    private fun uploadAndSendVoiceNote(file: File, durationMs: Long) {
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
                    sendMessage(
                        text = durationText,
                        attachmentType = "AUDIO",
                        attachmentUrl = finalUrl,
                        thumbnailBlur = null,
                        fileSizeBytes = bytes.size.toLong(),
                        isViewOnce = viewOnce
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

    // ====================================================
    // 2. FULL-SCREEN LIGHTBOX VIEWER (IMAGES & AVATARS)
    // ====================================================
    private fun openLightboxViewer(imageUrl: String, titleText: String) {
        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val frameLayout = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.bg_base))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Pinch-to-zoom interactive ImageView
        val imageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.FIT_CENTER
        }

        val matrix = Matrix()
        var scaleFactor = 1f
        val scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                scaleFactor *= detector.scaleFactor
                scaleFactor = Math.max(0.75f, Math.min(scaleFactor, 5.0f))
                matrix.setScale(scaleFactor, scaleFactor, detector.focusX, detector.focusY)
                imageView.imageMatrix = matrix
                return true
            }
        })

        imageView.setOnTouchListener { _, event ->
            if (imageView.scaleType != ImageView.ScaleType.MATRIX) {
                imageView.scaleType = ImageView.ScaleType.MATRIX
            }
            scaleDetector.onTouchEvent(event)
            true
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
            text = titleText
            setTextColor(ContextCompat.getColor(context, R.color.accent_amber))
            textSize = 15f
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
            setPadding(20, 14, 20, 14)
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

        dialog.show()
    }

    // ====================================================
    // 2b. NATIVE DOCUMENT VIEWER VIA FILEPROVIDER
    // ====================================================
    private fun openDocumentFile(msg: ChatMessage) {
        val docName = if (!msg.messageText.isNullOrEmpty()) msg.messageText!! else "Document.pdf"
        val docsDir = File(cacheDir, "documents").apply { mkdirs() }
        val localFile = File(docsDir, docName)

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                if (!localFile.exists()) {
                    if (!msg.attachmentUrl.isNullOrEmpty() && msg.attachmentUrl!!.startsWith("http")) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@ChatActivity, "Downloading $docName...", Toast.LENGTH_SHORT).show()
                        }
                        val client = OkHttpClient()
                        val request = Request.Builder().url(msg.attachmentUrl!!).build()
                        val response = client.newCall(request).execute()
                        if (response.isSuccessful && response.body != null) {
                            FileOutputStream(localFile).use { it.write(response.body!!.bytes()) }
                        }
                    } else {
                        // Generate sample document payload for local verification
                        localFile.writeText("Horizon Chat Document: $docName\nCreated for demonstration.")
                    }
                }

                withContext(Dispatchers.Main) {
                    try {
                        val contentUri = FileProvider.getUriForFile(
                            this@ChatActivity,
                            "${packageName}.fileprovider",
                            localFile
                        )
                        val ext = MimeTypeMap.getFileExtensionFromUrl(localFile.name)
                        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"

                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(contentUri, mimeType)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                    } catch (e: Exception) {
                        Toast.makeText(this@ChatActivity, "Document saved: ${localFile.name}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to open document: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // ====================================================
    // 3. NATIVE ANDROID CAMERA INTEGRATION (PHOTO & VIDEO)
    // ====================================================
    private fun openCameraChoiceDialog() {
        val options = arrayOf("📸 Take Photo", "🎥 Record Video")
        androidx.appcompat.app.AlertDialog.Builder(this)
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
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val bytes = inputStream?.readBytes() ?: ByteArray(0)
                inputStream?.close()

                val base64 = "data:video/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                val uploadReq = MediaUploadRequest(
                    imageBase64 = base64,
                    fileName = "video_${System.currentTimeMillis()}.mp4",
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
                    sendMessage(
                        text = "Video",
                        attachmentType = "VIDEO",
                        attachmentUrl = finalUrl,
                        thumbnailBlur = null,
                        fileSizeBytes = bytes.size.toLong(),
                        isViewOnce = viewOnce
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@ChatActivity, "Failed to send video: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // ====================================================
    // 4. ATTACHMENT BOTTOM SHEET & PICKERS
    // ====================================================
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

        // 2. Voice Note Guidance
        sheetBinding.btnOptionVoice.setOnClickListener {
            bottomSheet.dismiss()
            Toast.makeText(this, "Hold the mic icon on the bottom right to record voice notes", Toast.LENGTH_LONG).show()
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

                    // 1. Generate 20x20 micro-blur thumbnail (~200 bytes)
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

                    // 4. Fallback to direct data URI if offline
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
            val payload = JSONObject().apply {
                put("messageId", msg.id)
                put("recipientId", targetUserId)
            }
            mSocket?.emit("mark_media_viewed", payload)
            Toast.makeText(this, "Photo closed and permanently expired.", Toast.LENGTH_SHORT).show()
        }

        dialog.show()
    }

    // ==========================================
    // 5. WEBSOCKET GATEWAY & REAL-TIME RECEIPTS
    // ==========================================
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
                                    markMessageDelivered(msg.id)
                                    markMessageRead(msg.id)
                                }
                            }
                        }
                    }
                }
            }

            // Real-Time Delivery Receipt Acknowledgement
            mSocket?.on("message_delivered_ack") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as? JSONObject
                    val messageId = data?.optLong("messageId") ?: -1L
                    if (messageId != -1L) {
                        runOnUiThread {
                            adapter.markMessageDelivered(messageId)
                        }
                    }
                }
            }

            // Real-Time Read Receipt Acknowledgement
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

            // Scoped Real-Time Typing Indicators
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

    private fun startTyping() {
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true
            val payload = JSONObject().apply {
                put("recipientId", targetUserId)
            }
            mSocket?.emit("typing_start", payload)
        }
        typingHandler.removeCallbacks(stopTypingRunnable)
        typingHandler.postDelayed(stopTypingRunnable, 2500)
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
                        // Acknowledge delivery & read for all unread incoming messages
                        list.forEach { msg ->
                            if (msg.senderId == targetUserId && msg.status != "READ") {
                                markMessageDelivered(msg.id)
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
        val tempId = System.currentTimeMillis()
        val optimisticMsg = ChatMessage(
            id = tempId,
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

        mSocket?.emit("send_message", payload, io.socket.client.Ack { ackArgs ->
            if (ackArgs.isNotEmpty()) {
                val ackObj = ackArgs[0] as? JSONObject
                val savedObj = ackObj?.optJSONObject("message")
                if (savedObj != null) {
                    val serverMsg = parseJsonMessage(savedObj)
                    runOnUiThread {
                        adapter.updateOptimisticMessage(tempId, serverMsg)
                    }
                }
            }
        })
    }

    private fun markMessageDelivered(messageId: Long) {
        val payload = JSONObject().apply {
            put("messageId", messageId)
            put("senderId", targetUserId)
        }
        mSocket?.emit("mark_delivered", payload)
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
        cleanVoicePreviewState()
        try {
            mediaRecorder?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        mediaRecorder = null
        recordingTimerRunnable?.let { recordingTimerHandler.removeCallbacks(it) }
        mSocket?.disconnect()
        mSocket?.off()
    }
}
