package com.chatapp.horizon.ui

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.*
import android.webkit.MimeTypeMap
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.*
import com.chatapp.horizon.models.*
import com.chatapp.horizon.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.regex.Pattern

class UserProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityUserProfileBinding

    private var targetUserId: Int = 0
    private var targetUsername: String = ""
    private var targetDisplayName: String = ""
    private var targetBioStatus: String = ""
    private var targetAvatarUrl: String? = null
    private var targetLastSeen: String? = null
    private var isTargetOnline: Boolean = false
    private var isTargetBlocked: Boolean = false
    private var authToken: String = ""

    private var allMessages = mutableListOf<ChatMessage>()
    private var activeTab: Int = 0 // 0 = Media, 1 = Docs, 2 = Links

    private lateinit var mediaAdapter: ProfileMediaAdapter
    private lateinit var docsAdapter: ProfileDocsAdapter
    private lateinit var linksAdapter: ProfileLinksAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityUserProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
        authToken = intent.getStringExtra("AUTH_TOKEN") ?: prefs.getString("token", "") ?: ""
        targetUserId = intent.getIntExtra("TARGET_USER_ID", 0)
        targetUsername = intent.getStringExtra("TARGET_USERNAME") ?: "User"
        targetDisplayName = intent.getStringExtra("TARGET_DISPLAY_NAME") ?: targetUsername
        targetBioStatus = intent.getStringExtra("TARGET_BIO_STATUS") ?: "Hey there! I am using Horizon Chat."
        targetAvatarUrl = intent.getStringExtra("TARGET_AVATAR_URL")
        targetLastSeen = intent.getStringExtra("TARGET_LAST_SEEN")
        isTargetOnline = intent.getBooleanExtra("TARGET_ONLINE", false)

        setupUI()
        loadUserProfile()
        loadSharedRepository()
    }

    private fun setupUI() {
        binding.btnBack.setOnClickListener { finish() }

        renderProfileHeader()

        // Avatar click -> Lightbox
        binding.ivUserAvatar.setOnClickListener {
            if (!targetAvatarUrl.isNullOrEmpty()) {
                openLightboxViewer(targetAvatarUrl!!, "@$targetUsername Profile Picture")
            }
        }

        // Quick Actions
        binding.btnQuickMessage.setOnClickListener {
            finish()
        }

        binding.btnQuickMute.setOnClickListener {
            showMuteDialog()
        }

        binding.btnQuickSearch.setOnClickListener {
            val resultIntent = Intent().apply {
                putExtra("ACTION_SEARCH", true)
            }
            setResult(RESULT_OK, resultIntent)
            finish()
        }

        // Tabs setup
        binding.tabMedia.setOnClickListener { switchTab(0) }
        binding.tabDocs.setOnClickListener { switchTab(1) }
        binding.tabLinks.setOnClickListener { switchTab(2) }

        // Moderation
        binding.btnActionClearChat.setOnClickListener {
            showClearChatDialog()
        }

        binding.btnActionBlockUser.setOnClickListener {
            toggleBlockUser()
        }

        binding.btnActionReportUser.setOnClickListener {
            showReportDialog()
        }

        // Check Mute State
        val isMuted = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
            .getBoolean("mute_user_${targetUserId}", false)
        updateMuteUI(isMuted)
    }

    private fun renderProfileHeader() {
        binding.tvDisplayName.text = if (targetDisplayName.isNotEmpty()) targetDisplayName else targetUsername
        binding.tvUsernameHandle.text = "@$targetUsername"
        binding.tvBioStatus.text = targetBioStatus

        if (isTargetOnline) {
            binding.tvLastSeen.text = "Online"
            binding.tvLastSeen.setTextColor(ContextCompat.getColor(this, R.color.ticks_sent))
        } else {
            binding.tvLastSeen.text = formatLastSeen(targetLastSeen)
            binding.tvLastSeen.setTextColor(ContextCompat.getColor(this, R.color.text_muted))
        }

        if (!targetAvatarUrl.isNullOrEmpty()) {
            binding.tvAvatarInitials.visibility = View.GONE
            binding.ivUserAvatar.visibility = View.VISIBLE
            Glide.with(this)
                .load(targetAvatarUrl)
                .circleCrop()
                .placeholder(android.R.drawable.sym_def_app_icon)
                .into(binding.ivUserAvatar)
            binding.ivUserAvatar.setOnClickListener {
                val intent = Intent(this, PhotoViewerActivity::class.java).apply {
                    putExtra("PHOTO_URL", targetAvatarUrl)
                    putExtra("PHOTO_TITLE", "Profile Photo")
                    putExtra("SENDER_NAME", targetUsername)
                }
                startActivity(intent)
            }
        } else {
            binding.ivUserAvatar.visibility = View.GONE
            binding.tvAvatarInitials.visibility = View.VISIBLE
            binding.tvAvatarInitials.text = targetUsername.take(2).uppercase()
        }

        binding.tvBlockLabel.text = if (isTargetBlocked) "Unblock @$targetUsername" else "Block @$targetUsername"
    }

    private fun loadUserProfile() {
        if (authToken.isEmpty()) return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.lookupUser("Bearer $authToken", targetUsername)
                if (res.isSuccessful && res.body() != null) {
                    val user = res.body()!!
                    withContext(Dispatchers.Main) {
                        targetDisplayName = user.displayName ?: user.username
                        targetBioStatus = user.bioStatus ?: "Hey there! I am using Horizon Chat."
                        targetAvatarUrl = user.avatarUrl
                        targetLastSeen = user.lastSeen
                        isTargetOnline = user.online
                        isTargetBlocked = user.isBlocked
                        renderProfileHeader()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun loadSharedRepository() {
        if (authToken.isEmpty()) return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val res = ApiClient.apiService.getMessages("Bearer $authToken", targetUserId, null, 50)
                if (res.isSuccessful && res.body() != null) {
                    allMessages.clear()
                    allMessages.addAll(res.body()!!)
                    withContext(Dispatchers.Main) {
                        switchTab(activeTab)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun switchTab(tabIndex: Int) {
        activeTab = tabIndex

        val activeBg = ContextCompat.getDrawable(this, R.drawable.button_primary_glow)
        val inactiveColor = ContextCompat.getColor(this, R.color.text_muted)
        val activeColor = ContextCompat.getColor(this, R.color.text_primary)

        binding.tabMedia.background = if (tabIndex == 0) activeBg else null
        binding.tabMedia.setTextColor(if (tabIndex == 0) activeColor else inactiveColor)

        binding.tabDocs.background = if (tabIndex == 1) activeBg else null
        binding.tabDocs.setTextColor(if (tabIndex == 1) activeColor else inactiveColor)

        binding.tabLinks.background = if (tabIndex == 2) activeBg else null
        binding.tabLinks.setTextColor(if (tabIndex == 2) activeColor else inactiveColor)

        when (tabIndex) {
            0 -> renderMediaTab()
            1 -> renderDocsTab()
            2 -> renderLinksTab()
        }
    }

    private fun renderMediaTab() {
        val mediaList = allMessages.filter { it.attachmentType == "IMAGE" || it.attachmentType == "VIDEO" }
        if (mediaList.isEmpty()) {
            binding.rvSharedRepository.visibility = View.GONE
            binding.tvEmptyRepository.visibility = View.VISIBLE
            binding.tvEmptyRepository.text = "No shared photos or videos yet"
            return
        }

        binding.tvEmptyRepository.visibility = View.GONE
        binding.rvSharedRepository.visibility = View.VISIBLE
        binding.rvSharedRepository.layoutManager = GridLayoutManager(this, 3)

        mediaAdapter = ProfileMediaAdapter(mediaList) { item ->
            if (item.attachmentType == "VIDEO") {
                val intent = Intent(this, VideoPlayerActivity::class.java).apply {
                    putExtra("VIDEO_URL", item.attachmentUrl)
                    putExtra("VIDEO_TITLE", "Video")
                    putExtra("SENDER_NAME", targetUsername)
                    putExtra("TIMESTAMP", item.createdAt)
                }
                startActivity(intent)
            } else if (!item.attachmentUrl.isNullOrEmpty()) {
                val intent = Intent(this, PhotoViewerActivity::class.java).apply {
                    putExtra("PHOTO_URL", item.attachmentUrl)
                    putExtra("PHOTO_TITLE", "Photo")
                    putExtra("SENDER_NAME", targetUsername)
                    putExtra("TIMESTAMP", item.createdAt)
                    putExtra("CAPTION", item.messageText)
                }
                startActivity(intent)
            }
        }
        binding.rvSharedRepository.adapter = mediaAdapter
    }

    private fun renderDocsTab() {
        val docList = allMessages.filter { it.attachmentType == "DOCUMENT" }
        if (docList.isEmpty()) {
            binding.rvSharedRepository.visibility = View.GONE
            binding.tvEmptyRepository.visibility = View.VISIBLE
            binding.tvEmptyRepository.text = "No shared documents yet"
            return
        }

        binding.tvEmptyRepository.visibility = View.GONE
        binding.rvSharedRepository.visibility = View.VISIBLE
        binding.rvSharedRepository.layoutManager = LinearLayoutManager(this)

        docsAdapter = ProfileDocsAdapter(docList) { doc ->
            openDocumentFile(doc)
        }
        binding.rvSharedRepository.adapter = docsAdapter
    }

    private fun renderLinksTab() {
        val linkPattern = Pattern.compile("https?://[\\w\\d:#@%/;$()~_?\\+-=\\\\\\.&]+")
        val extractedLinks = mutableListOf<String>()

        allMessages.forEach { msg ->
            val text = msg.messageText ?: ""
            val matcher = linkPattern.matcher(text)
            while (matcher.find()) {
                val url = matcher.group()
                if (!extractedLinks.contains(url)) {
                    extractedLinks.add(url)
                }
            }
        }

        if (extractedLinks.isEmpty()) {
            binding.rvSharedRepository.visibility = View.GONE
            binding.tvEmptyRepository.visibility = View.VISIBLE
            binding.tvEmptyRepository.text = "No shared links found in chat history"
            return
        }

        binding.tvEmptyRepository.visibility = View.GONE
        binding.rvSharedRepository.visibility = View.VISIBLE
        binding.rvSharedRepository.layoutManager = LinearLayoutManager(this)

        linksAdapter = ProfileLinksAdapter(extractedLinks) { url ->
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                startActivity(intent)
            } catch (e: Exception) {
                Toast.makeText(this, "Could not open URL: $url", Toast.LENGTH_SHORT).show()
            }
        }
        binding.rvSharedRepository.adapter = linksAdapter
    }

    private fun showMuteDialog() {
        val options = arrayOf("8 Hours", "1 Week", "Always", "Unmute")
        AlertDialog.Builder(this)
            .setTitle("Mute Notifications for @$targetUsername")
            .setItems(options) { _, which ->
                val prefs = getSharedPreferences("horizon_prefs", Context.MODE_PRIVATE)
                if (which == 3) {
                    prefs.edit().putBoolean("mute_user_${targetUserId}", false).apply()
                    updateMuteUI(false)
                    Toast.makeText(this, "Notifications unmuted", Toast.LENGTH_SHORT).show()
                } else {
                    prefs.edit().putBoolean("mute_user_${targetUserId}", true).apply()
                    updateMuteUI(true)
                    Toast.makeText(this, "Muted for ${options[which]}", Toast.LENGTH_SHORT).show()
                }
            }
            .show()
    }

    private fun updateMuteUI(isMuted: Boolean) {
        if (isMuted) {
            binding.ivMuteIcon.setColorFilter(ContextCompat.getColor(this, R.color.accent_amber))
            binding.tvMuteLabel.text = "Muted"
            binding.tvMuteLabel.setTextColor(ContextCompat.getColor(this, R.color.accent_amber))
        } else {
            binding.ivMuteIcon.setColorFilter(ContextCompat.getColor(this, R.color.text_primary))
            binding.tvMuteLabel.text = "Mute"
            binding.tvMuteLabel.setTextColor(ContextCompat.getColor(this, R.color.text_primary))
        }
    }

    private fun showClearChatDialog() {
        AlertDialog.Builder(this)
            .setTitle("Clear Conversation?")
            .setMessage("Are you sure you want to clear all message history with @$targetUsername? This cannot be undone.")
            .setPositiveButton("Clear History") { _, _ ->
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val res = ApiClient.apiService.clearConversation("Bearer $authToken", targetUserId)
                        withContext(Dispatchers.Main) {
                            if (res.isSuccessful) {
                                Toast.makeText(this@UserProfileActivity, "Conversation cleared ✨", Toast.LENGTH_SHORT).show()
                                allMessages.clear()
                                switchTab(activeTab)
                                val resultIntent = Intent().apply { putExtra("ACTION_CLEARED", true) }
                                setResult(RESULT_OK, resultIntent)
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@UserProfileActivity, "Failed to clear: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toggleBlockUser() {
        val willBlock = !isTargetBlocked
        val actionText = if (willBlock) "Block" else "Unblock"

        AlertDialog.Builder(this)
            .setTitle("$actionText @$targetUsername?")
            .setMessage(if (willBlock) "Blocked contacts will no longer be able to send you messages or view your status." else "Unblocking allows communication again.")
            .setPositiveButton(actionText) { _, _ ->
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val req = BlockRequest(targetUserId)
                        val res = if (willBlock) {
                            ApiClient.apiService.blockUser("Bearer $authToken", req)
                        } else {
                            ApiClient.apiService.unblockUser("Bearer $authToken", req)
                        }
                        withContext(Dispatchers.Main) {
                            if (res.isSuccessful) {
                                isTargetBlocked = willBlock
                                binding.tvBlockLabel.text = if (isTargetBlocked) "Unblock @$targetUsername" else "Block @$targetUsername"
                                Toast.makeText(this@UserProfileActivity, "User @$targetUsername ${if (willBlock) "blocked" else "unblocked"}", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@UserProfileActivity, "Action failed: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showReportDialog() {
        val reasons = arrayOf("Spam or Advertising", "Harassment or Bullying", "Inappropriate / NSFW Content", "Impersonation or Scam")
        var selectedIdx = 0

        AlertDialog.Builder(this)
            .setTitle("Report @$targetUsername")
            .setSingleChoiceItems(reasons, 0) { _, which ->
                selectedIdx = which
            }
            .setPositiveButton("Submit Report") { _, _ ->
                lifecycleScope.launch(Dispatchers.IO) {
                    try {
                        val req = ReportRequest(targetUserId, reasons[selectedIdx])
                        val res = ApiClient.apiService.reportUser("Bearer $authToken", req)
                        withContext(Dispatchers.Main) {
                            if (res.isSuccessful) {
                                Toast.makeText(this@UserProfileActivity, "Report submitted. Thank you.", Toast.LENGTH_LONG).show()
                            }
                        }
                    } catch (e: Exception) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@UserProfileActivity, "Failed to submit report: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openLightboxViewer(imageUrl: String, titleText: String) {
        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val frameLayout = FrameLayout(this).apply {
            setBackgroundColor(ContextCompat.getColor(context, R.color.bg_base))
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val imageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
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

        val topBar = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = 40
                leftMargin = 20
                rightMargin = 20
            }
        }

        val tvTitle = TextView(this).apply {
            text = titleText
            setTextColor(ContextCompat.getColor(context, R.color.accent_amber))
            textSize = 15f
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
            }
        }
        topBar.addView(tvTitle)

        val btnClose = TextView(this).apply {
            text = "✕ CLOSE"
            setTextColor(ContextCompat.getColor(context, R.color.text_primary))
            textSize = 14f
            setPadding(20, 14, 20, 14)
            setBackgroundColor(ContextCompat.getColor(context, R.color.surface_elevated))
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
            }
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

    private fun openDocumentFile(msg: ChatMessage) {
        val docName = if (!msg.messageText.isNullOrEmpty()) msg.messageText!! else "Document.pdf"
        val docsDir = File(cacheDir, "documents").apply { mkdirs() }
        val localFile = File(docsDir, docName)

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                if (!localFile.exists()) {
                    if (!msg.attachmentUrl.isNullOrEmpty() && msg.attachmentUrl!!.startsWith("http")) {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@UserProfileActivity, "Downloading $docName...", Toast.LENGTH_SHORT).show()
                        }
                        val client = OkHttpClient()
                        val request = Request.Builder().url(msg.attachmentUrl!!).build()
                        val response = client.newCall(request).execute()
                        if (response.isSuccessful && response.body != null) {
                            FileOutputStream(localFile).use { it.write(response.body!!.bytes()) }
                        }
                    } else {
                        localFile.writeText("Horizon Chat Document: $docName")
                    }
                }

                withContext(Dispatchers.Main) {
                    try {
                        val contentUri = FileProvider.getUriForFile(this@UserProfileActivity, "${packageName}.fileprovider", localFile)
                        val ext = MimeTypeMap.getFileExtensionFromUrl(localFile.name)
                        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(contentUri, mimeType)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                    } catch (e: Exception) {
                        Toast.makeText(this@UserProfileActivity, "Saved document: ${localFile.name}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun formatLastSeen(iso: String?): String {
        if (iso.isNullOrEmpty()) return "Offline"
        return try {
            val utcFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val date = try {
                utcFormat.parse(iso)
            } catch (e: Exception) {
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }.parse(iso)
            }
            if (date != null) {
                val timeFormat = SimpleDateFormat("hh:mm a", Locale.getDefault())
                "Last seen today at " + timeFormat.format(date)
            } else {
                "Offline"
            }
        } catch (e: Exception) {
            "Offline"
        }
    }

    // ==========================================
    // ADAPTERS FOR REPOSITORY TABS
    // ==========================================

    class ProfileMediaAdapter(
        private val list: List<ChatMessage>,
        private val onItemClicked: (ChatMessage) -> Unit
    ) : RecyclerView.Adapter<ProfileMediaAdapter.MediaViewHolder>() {

        inner class MediaViewHolder(val binding: ItemProfileMediaGridBinding) : RecyclerView.ViewHolder(binding.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MediaViewHolder {
            val binding = ItemProfileMediaGridBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return MediaViewHolder(binding)
        }

        override fun onBindViewHolder(holder: MediaViewHolder, position: Int) {
            val item = list[position]
            if (item.attachmentType == "VIDEO") {
                holder.binding.ivVideoOverlay.visibility = View.VISIBLE
                holder.binding.tvDuration.visibility = View.VISIBLE
                holder.binding.tvDuration.text = item.messageText ?: "Video"
            } else {
                holder.binding.ivVideoOverlay.visibility = View.GONE
                holder.binding.tvDuration.visibility = View.GONE
            }

            Glide.with(holder.itemView.context)
                .load(item.attachmentUrl ?: item.thumbnailBlur)
                .centerCrop()
                .placeholder(R.drawable.ic_attach_gallery)
                .into(holder.binding.ivMediaThumb)

            holder.itemView.setOnClickListener { onItemClicked(item) }
        }

        override fun getItemCount(): Int = list.size
    }

    class ProfileDocsAdapter(
        private val list: List<ChatMessage>,
        private val onDocClicked: (ChatMessage) -> Unit
    ) : RecyclerView.Adapter<ProfileDocsAdapter.DocViewHolder>() {

        inner class DocViewHolder(val binding: ItemProfileDocBinding) : RecyclerView.ViewHolder(binding.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): DocViewHolder {
            val binding = ItemProfileDocBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return DocViewHolder(binding)
        }

        override fun onBindViewHolder(holder: DocViewHolder, position: Int) {
            val doc = list[position]
            holder.binding.tvDocFileName.text = doc.messageText ?: "Document.pdf"
            val mb = if (doc.fileSizeBytes > 0) String.format("%.1f MB", doc.fileSizeBytes.toDouble() / (1024 * 1024)) else "Document"
            holder.binding.tvDocMeta.text = "$mb • Shared file"

            holder.itemView.setOnClickListener { onDocClicked(doc) }
            holder.binding.btnDownload.setOnClickListener { onDocClicked(doc) }
        }

        override fun getItemCount(): Int = list.size
    }

    class ProfileLinksAdapter(
        private val links: List<String>,
        private val onLinkClicked: (String) -> Unit
    ) : RecyclerView.Adapter<ProfileLinksAdapter.LinkViewHolder>() {

        inner class LinkViewHolder(val binding: ItemProfileLinkBinding) : RecyclerView.ViewHolder(binding.root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): LinkViewHolder {
            val binding = ItemProfileLinkBinding.inflate(LayoutInflater.from(parent.context), parent, false)
            return LinkViewHolder(binding)
        }

        override fun onBindViewHolder(holder: LinkViewHolder, position: Int) {
            val url = links[position]
            holder.binding.tvUrlText.text = url
            holder.binding.tvLinkMeta.text = "Shared link in conversation"
            holder.itemView.setOnClickListener { onLinkClicked(url) }
        }

        override fun getItemCount(): Int = links.size
    }
}
