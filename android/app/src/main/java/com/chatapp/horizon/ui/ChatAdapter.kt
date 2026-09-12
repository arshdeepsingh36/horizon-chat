package com.chatapp.horizon.ui

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.Toast
import androidx.constraintlayout.widget.ConstraintLayout
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ItemChatDocBinding
import com.chatapp.horizon.databinding.ItemChatLocationBinding
import com.chatapp.horizon.databinding.ItemChatSentMediaBinding
import com.chatapp.horizon.databinding.ItemChatVoiceBinding
import com.chatapp.horizon.databinding.ItemChatVideoBinding
import com.chatapp.horizon.databinding.ItemMessageReceivedBinding
import com.chatapp.horizon.databinding.ItemMessageSentBinding
import com.chatapp.horizon.models.ChatMessage
import com.chatapp.horizon.network.ApiClient
import com.chatapp.horizon.utils.TimeFormatHelper
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class ChatAdapter(
    private val currentUserId: Int,
    private val onMediaDownloadClicked: (ChatMessage) -> Unit,
    private val onViewOnceClicked: (ChatMessage) -> Unit = {},
    private val onImageClicked: (ChatMessage) -> Unit = {},
    private val onDocumentClicked: (ChatMessage) -> Unit = {},
    private val onVideoClicked: (ChatMessage) -> Unit = {},
    private val onMessageLongClicked: (ChatMessage, View) -> Unit = { _, _ -> }
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val TYPE_SENT_TEXT = 1
        private const val TYPE_RECEIVED_TEXT = 2
        private const val TYPE_SENT_MEDIA = 3
        private const val TYPE_RECEIVED_MEDIA = 4
        private const val TYPE_VOICE = 5
        private const val TYPE_LOCATION = 6
        private const val TYPE_DOCUMENT = 7
        private const val TYPE_VIDEO = 8
        private const val MAX_HEAP_ITEMS = 200
    }

    private val messages = mutableListOf<ChatMessage>()
    private var activeMediaPlayer: MediaPlayer? = null
    private var activePlayingMsgId: Long? = null
    private val progressHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

    fun releaseMediaPlayer() {
        progressRunnable?.let { progressHandler.removeCallbacks(it) }
        try {
            activeMediaPlayer?.stop()
            activeMediaPlayer?.release()
        } catch (e: Exception) {
            // ignore
        } finally {
            activeMediaPlayer = null
            activePlayingMsgId = null
        }
    }

    fun setMessages(newMessages: List<ChatMessage>) {
        messages.clear()
        messages.addAll(newMessages)
        trimToMaxHeap()
        notifyDataSetChanged()
    }

    fun prependMessages(olderMessages: List<ChatMessage>) {
        messages.addAll(0, olderMessages)
        trimToMaxHeap()
        notifyItemRangeInserted(0, olderMessages.size)
    }

    fun appendMessage(message: ChatMessage) {
        messages.add(message)
        trimToMaxHeap()
        notifyItemInserted(messages.size - 1)
    }

    fun markMessageRead(messageId: Long) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].status = "READ"
            notifyItemChanged(index)
        }
    }

    fun markMessageDelivered(messageId: Long) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1 && messages[index].status != "READ") {
            messages[index].status = "DELIVERED"
            notifyItemChanged(index)
        }
    }

    fun updateOptimisticMessage(tempId: Long, serverMsg: ChatMessage) {
        if (activePlayingMsgId == tempId) {
            activePlayingMsgId = serverMsg.id
        }
        val index = messages.indexOfFirst { it.id == tempId }
        if (index != -1) {
            messages[index] = serverMsg
            notifyItemChanged(index)
        }
    }

    fun updateMessageStatus(messageId: Long, status: String) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].status = status
            notifyItemChanged(index)
        }
    }

    fun markMessageViewed(messageId: Long) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].isViewed = true
            notifyItemChanged(index)
        }
    }

    fun updateMessageReaction(messageId: Long, reactions: Map<String, List<Int>>) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].reactions = reactions
            notifyItemChanged(index)
        }
    }

    fun updateMessageDeleted(messageId: Long, deletedForEveryone: Boolean, text: String?) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].deletedForEveryone = deletedForEveryone
            if (deletedForEveryone) {
                messages[index].messageText = text ?: "🚫 This message was deleted"
                messages[index].attachmentType = "NONE"
                messages[index].attachmentUrl = null
            } else {
                messages.removeAt(index)
                notifyItemRemoved(index)
                return
            }
            notifyItemChanged(index)
        }
    }

    fun updateMessagePinned(messageId: Long, isPinned: Boolean) {
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            messages[index].isPinned = isPinned
            notifyItemChanged(index)
        }
    }

    fun findMessageById(messageId: Long): ChatMessage? {
        return messages.find { it.id == messageId }
    }

    fun getOldestMessageId(): Long? {
        return messages.firstOrNull()?.id
    }

    private fun trimToMaxHeap() {
        if (messages.size > MAX_HEAP_ITEMS) {
            val removeCount = messages.size - MAX_HEAP_ITEMS
            repeat(removeCount) { messages.removeAt(0) }
        }
    }

    override fun getItemCount(): Int = messages.size

    override fun getItemViewType(position: Int): Int {
        val msg = messages[position]
        val isSent = msg.senderId == currentUserId
        return when {
            msg.isViewOnce -> if (isSent) TYPE_SENT_MEDIA else TYPE_RECEIVED_MEDIA
            msg.attachmentType == "VIDEO" -> TYPE_VIDEO
            msg.attachmentType == "AUDIO" -> TYPE_VOICE
            msg.attachmentType == "LOCATION" -> TYPE_LOCATION
            msg.attachmentType == "DOCUMENT" -> TYPE_DOCUMENT
            msg.attachmentType == "IMAGE" -> if (isSent) TYPE_SENT_MEDIA else TYPE_RECEIVED_MEDIA
            isSent -> TYPE_SENT_TEXT
            else -> TYPE_RECEIVED_TEXT
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            TYPE_SENT_TEXT -> SentTextViewHolder(ItemMessageSentBinding.inflate(inflater, parent, false))
            TYPE_RECEIVED_TEXT -> ReceivedTextViewHolder(ItemMessageReceivedBinding.inflate(inflater, parent, false))
            TYPE_SENT_MEDIA, TYPE_RECEIVED_MEDIA -> MediaViewHolder(ItemChatSentMediaBinding.inflate(inflater, parent, false))
            TYPE_VIDEO -> VideoViewHolder(ItemChatVideoBinding.inflate(inflater, parent, false), onVideoClicked)
            TYPE_VOICE -> VoiceViewHolder(ItemChatVoiceBinding.inflate(inflater, parent, false)) { m, b ->
                handleVoicePlayback(m, b)
            }
            TYPE_LOCATION -> LocationViewHolder(ItemChatLocationBinding.inflate(inflater, parent, false))
            TYPE_DOCUMENT -> DocViewHolder(ItemChatDocBinding.inflate(inflater, parent, false))
            else -> SentTextViewHolder(ItemMessageSentBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val msg = messages[position]
        val isSent = msg.senderId == currentUserId

        holder.itemView.setOnLongClickListener {
            onMessageLongClicked(msg, it)
            true
        }

        when (holder) {
            is SentTextViewHolder -> holder.bind(msg, ::findMessageById)
            is ReceivedTextViewHolder -> holder.bind(msg, ::findMessageById)
            is MediaViewHolder -> holder.bind(msg, isSent, onMediaDownloadClicked, onViewOnceClicked, onImageClicked)
            is VideoViewHolder -> holder.bind(msg, isSent)
            is VoiceViewHolder -> holder.bind(msg, isSent, msg.id == activePlayingMsgId && activeMediaPlayer?.isPlaying == true)
            is LocationViewHolder -> holder.bind(msg, isSent)
            is DocViewHolder -> holder.bind(msg, isSent, onDocumentClicked)
        }
    }

    private fun handleVoicePlayback(msg: ChatMessage, holderBinding: ItemChatVoiceBinding) {
        val context = holderBinding.root.context
        val audioUrl = msg.attachmentUrl
        if (audioUrl.isNullOrEmpty()) {
            Toast.makeText(context, "Voice note audio not available", Toast.LENGTH_SHORT).show()
            return
        }

        // If clicking the currently playing message -> pause it
        if (activePlayingMsgId == msg.id && activeMediaPlayer?.isPlaying == true) {
            activeMediaPlayer?.pause()
            holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
            progressRunnable?.let { progressHandler.removeCallbacks(it) }
            return
        }

        // If clicking a paused current message -> resume
        if (activePlayingMsgId == msg.id && activeMediaPlayer != null) {
            activeMediaPlayer?.start()
            holderBinding.btnPlayPause.setImageResource(R.drawable.ic_pause_circle)
            startProgressUpdater(holderBinding)
            return
        }

        // Stop previously playing audio and notify changed
        val prevPlayingId = activePlayingMsgId
        releaseMediaPlayer()
        if (prevPlayingId != null) {
            val prevIndex = messages.indexOfFirst { it.id == prevPlayingId }
            if (prevIndex != -1) notifyItemChanged(prevIndex)
        }

        activePlayingMsgId = msg.id
        holderBinding.btnPlayPause.setImageResource(R.drawable.ic_pause_circle)
        holderBinding.pbAudioProgress.progress = 0

        val voiceDir = File(context.cacheDir, "voice_cache").apply { mkdirs() }
        val localCacheFile = File(voiceDir, "voice_${msg.id}.m4a")

        fun playFromLocalFile(file: File) {
            try {
                val player = MediaPlayer()
                activeMediaPlayer = player
                player.setDataSource(file.absolutePath)
                player.prepare()
                player.start()
                startProgressUpdater(holderBinding)
                player.setOnCompletionListener {
                    holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                    holderBinding.pbAudioProgress.progress = 0
                    val finishedId = activePlayingMsgId
                    releaseMediaPlayer()
                    if (finishedId != null) {
                        val idx = messages.indexOfFirst { it.id == finishedId }
                        if (idx != -1) notifyItemChanged(idx)
                    }
                }
                player.setOnErrorListener { _, _, _ ->
                    holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                    holderBinding.pbAudioProgress.progress = 0
                    releaseMediaPlayer()
                    Toast.makeText(context, "Unable to play audio format", Toast.LENGTH_SHORT).show()
                    true
                }
            } catch (e: Exception) {
                e.printStackTrace()
                releaseMediaPlayer()
                holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                Toast.makeText(context, "Error playing audio: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        val mainHandler = Handler(Looper.getMainLooper())

        // 1. Data URL (Base64)
        if (audioUrl.startsWith("data:audio/")) {
            try {
                val cleanBase64 = if (audioUrl.contains("base64,")) audioUrl.substringAfter("base64,") else audioUrl
                val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                localCacheFile.writeBytes(decodedBytes)
                playFromLocalFile(localCacheFile)
            } catch (e: Exception) {
                e.printStackTrace()
                releaseMediaPlayer()
                holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                Toast.makeText(context, "Invalid audio encoding", Toast.LENGTH_SHORT).show()
            }
            return
        }

        // 2. Pre-cached file exists and is valid
        if (localCacheFile.exists() && localCacheFile.length() > 50) {
            playFromLocalFile(localCacheFile)
            return
        }

        // 3. Mock CDN URL handling
        if (audioUrl.contains("cdn.horizonchat.io")) {
            releaseMediaPlayer()
            holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
            Toast.makeText(context, "Mock voice note from Phase 1 demo", Toast.LENGTH_SHORT).show()
            return
        }

        val resolvedUrl = when {
            audioUrl.startsWith("http://horizon-chat-1.onrender.com") -> audioUrl.replace("http://", "https://")
            audioUrl.startsWith("http://") || audioUrl.startsWith("https://") || audioUrl.startsWith("data:") -> audioUrl
            else -> "${ApiClient.BASE_URL.trimEnd('/')}/${audioUrl.trimStart('/')}"
        }

        // 4. Remote HTTP/HTTPS Audio: Download to cache in background, then play
        Thread {
            try {
                var currentUrl = resolvedUrl
                var connection = URL(currentUrl).openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.instanceFollowRedirects = true

                var redirects = 0
                while (connection.responseCode in 300..399 && redirects < 5) {
                    val location = connection.getHeaderField("Location") ?: break
                    connection.disconnect()
                    currentUrl = if (location.startsWith("http")) location else URL(URL(currentUrl), location).toString()
                    connection = URL(currentUrl).openConnection() as HttpURLConnection
                    connection.connectTimeout = 15000
                    connection.readTimeout = 20000
                    redirects++
                }

                if (connection.responseCode in 200..299) {
                    val tempDownload = File(voiceDir, "dl_tmp_${msg.id}_${System.currentTimeMillis()}.m4a")
                    connection.inputStream.use { input: InputStream ->
                        tempDownload.outputStream().use { output: OutputStream ->
                            input.copyTo(output)
                        }
                    }
                    if (tempDownload.exists() && tempDownload.length() > 50) {
                        tempDownload.renameTo(localCacheFile)
                    }

                    mainHandler.post {
                        if (activePlayingMsgId == msg.id) {
                            if (localCacheFile.exists() && localCacheFile.length() > 50) {
                                playFromLocalFile(localCacheFile)
                            } else {
                                releaseMediaPlayer()
                                holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                                Toast.makeText(context, "Downloaded audio file is empty", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                } else {
                    mainHandler.post {
                        releaseMediaPlayer()
                        holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                        Toast.makeText(context, "Audio file not found on server (${connection.responseCode})", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                mainHandler.post {
                    releaseMediaPlayer()
                    holderBinding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
                    Toast.makeText(context, "Failed to download voice note", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun startProgressUpdater(holderBinding: ItemChatVoiceBinding) {
        progressRunnable?.let { progressHandler.removeCallbacks(it) }
        progressRunnable = object : Runnable {
            override fun run() {
                val mp = activeMediaPlayer
                if (mp != null && mp.isPlaying) {
                    if (mp.duration > 0) {
                        val progress = ((mp.currentPosition.toDouble() / mp.duration) * 100).toInt()
                        holderBinding.pbAudioProgress.progress = progress.coerceIn(0, 100)
                    }
                    progressHandler.postDelayed(this, 100)
                }
            }
        }
        progressHandler.post(progressRunnable!!)
    }

    class SentTextViewHolder(private val binding: ItemMessageSentBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, findQuote: (Long) -> ChatMessage?) {
            binding.tvMessageBody.text = msg.messageText ?: ""
            binding.tvTimestamp.text = TimeFormatHelper.formatMessageTime(msg.createdAt)
            updateTicks(binding.ivTicks, msg.status)

            binding.layoutPinned.visibility = if (msg.isPinned) View.VISIBLE else View.GONE

            if (msg.replyToId != null) {
                val quoted = findQuote(msg.replyToId)
                binding.layoutReplyQuote.visibility = View.VISIBLE
                binding.tvQuoteAuthor.text = if (quoted?.senderId == msg.senderId) "You" else "User"
                binding.tvQuoteText.text = quoted?.messageText ?: "Quoted message"
            } else {
                binding.layoutReplyQuote.visibility = View.GONE
            }

            val rxText = formatReactions(msg.reactions)
            if (rxText.isNotEmpty()) {
                binding.tvReactionsBadge.text = rxText
                binding.tvReactionsBadge.visibility = View.VISIBLE
            } else {
                binding.tvReactionsBadge.visibility = View.GONE
            }
        }
    }

    class ReceivedTextViewHolder(private val binding: ItemMessageReceivedBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, findQuote: (Long) -> ChatMessage?) {
            binding.tvReceivedMessageBody.text = msg.messageText ?: ""
            binding.tvReceivedTimestamp.text = TimeFormatHelper.formatMessageTime(msg.createdAt)

            binding.layoutReceivedPinned.visibility = if (msg.isPinned) View.VISIBLE else View.GONE

            if (msg.replyToId != null) {
                val quoted = findQuote(msg.replyToId)
                binding.layoutReceivedReplyQuote.visibility = View.VISIBLE
                binding.tvReceivedQuoteAuthor.text = if (quoted?.senderId == msg.senderId) "User" else "You"
                binding.tvReceivedQuoteText.text = quoted?.messageText ?: "Quoted message"
            } else {
                binding.layoutReceivedReplyQuote.visibility = View.GONE
            }

            val rxText = formatReactions(msg.reactions)
            if (rxText.isNotEmpty()) {
                binding.tvReceivedReactionsBadge.text = rxText
                binding.tvReceivedReactionsBadge.visibility = View.VISIBLE
            } else {
                binding.tvReceivedReactionsBadge.visibility = View.GONE
            }
        }
    }

    class MediaViewHolder(private val binding: ItemChatSentMediaBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(
            msg: ChatMessage,
            isSent: Boolean,
            onDownloadClicked: (ChatMessage) -> Unit,
            onViewOnceClicked: (ChatMessage) -> Unit,
            onImageClicked: (ChatMessage) -> Unit
        ) {
            val context = itemView.context
            val params = binding.cardMedia.layoutParams as ConstraintLayout.LayoutParams
            if (isSent) {
                params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                params.startToStart = ConstraintLayout.LayoutParams.UNSET
                binding.cardMedia.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_sent))
                binding.ivTicks.visibility = View.VISIBLE
                updateTicks(binding.ivTicks, msg.status)
            } else {
                params.startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                params.endToEnd = ConstraintLayout.LayoutParams.UNSET
                binding.cardMedia.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_received))
                binding.ivTicks.visibility = View.GONE
            }
            binding.cardMedia.layoutParams = params

            binding.tvCaption.text = msg.messageText ?: ""
            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            binding.tvFileSize.text = formatFileSize(msg.fileSizeBytes)

            // VIEW ONCE HANDLING
            if (msg.isViewOnce) {
                binding.downloadOverlay.visibility = View.GONE
                binding.viewOnceOverlay.visibility = View.VISIBLE
                binding.ivThumbnail.setImageDrawable(null)

                if (msg.isViewed) {
                    binding.ivViewOnceIcon.setImageResource(R.drawable.ic_view_once_opened)
                    binding.ivViewOnceIcon.setColorFilter(ContextCompat.getColor(context, R.color.text_muted))
                    binding.tvViewOnceStatus.text = "Opened"
                    binding.tvViewOnceSub.text = "Expired"
                    binding.viewOnceOverlay.setOnClickListener {
                        Toast.makeText(context, "This photo has already been opened.", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    binding.ivViewOnceIcon.setImageResource(R.drawable.ic_view_once)
                    binding.ivViewOnceIcon.setColorFilter(ContextCompat.getColor(context, R.color.accent_amber))
                    binding.tvViewOnceStatus.text = "1 Photo (View Once)"
                    binding.tvViewOnceSub.text = "Tap to open"
                    binding.viewOnceOverlay.setOnClickListener {
                        onViewOnceClicked(msg)
                    }
                }
                return
            }

            // REGULAR MEDIA HANDLING
            binding.viewOnceOverlay.visibility = View.GONE

            var isFullImageLoaded = false

            if (!msg.thumbnailBlur.isNullOrEmpty()) {
                try {
                    val cleanBase64 = msg.thumbnailBlur.substringAfter("base64,")
                    val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                    val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                    binding.ivThumbnail.setImageBitmap(bitmap)
                } catch (e: Exception) {
                    binding.ivThumbnail.setImageResource(R.drawable.ic_attach_gallery)
                }
            }

            // Clicking downloaded image opens full-screen lightbox
            binding.ivThumbnail.setOnClickListener {
                if (isFullImageLoaded || binding.downloadOverlay.visibility == View.GONE) {
                    onImageClicked(msg)
                }
            }

            binding.downloadOverlay.setOnClickListener {
                binding.downloadOverlay.visibility = View.GONE
                onDownloadClicked(msg)
                val url = msg.attachmentUrl
                if (!url.isNullOrEmpty()) {
                    if (url.startsWith("data:image/")) {
                        try {
                            val cleanBase64 = url.substringAfter("base64,")
                            val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                            val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                            binding.ivThumbnail.setImageBitmap(bitmap)
                            isFullImageLoaded = true
                        } catch (e: Exception) {
                            Glide.with(context).load(url).into(binding.ivThumbnail)
                            isFullImageLoaded = true
                        }
                    } else {
                        Glide.with(context)
                            .load(url)
                            .into(binding.ivThumbnail)
                        isFullImageLoaded = true
                    }
                }
                binding.pbLoading.visibility = View.GONE
            }
        }
    }

    class VoiceViewHolder(
        private val binding: ItemChatVoiceBinding,
        private val onPlayVoiceClicked: (ChatMessage, ItemChatVoiceBinding) -> Unit
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, isSent: Boolean, isCurrentlyPlaying: Boolean) {
            val context = itemView.context
            val params = binding.cardVoice.layoutParams as ConstraintLayout.LayoutParams
            if (isSent) {
                params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                params.startToStart = ConstraintLayout.LayoutParams.UNSET
                binding.cardVoice.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_sent))
                binding.ivTicks.visibility = View.VISIBLE
                updateTicks(binding.ivTicks, msg.status)
            } else {
                params.startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                params.endToEnd = ConstraintLayout.LayoutParams.UNSET
                binding.cardVoice.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_received))
                binding.ivTicks.visibility = View.GONE
            }
            binding.cardVoice.layoutParams = params

            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            binding.tvDuration.text = if (!msg.messageText.isNullOrEmpty()) msg.messageText else "0:12"

            if (isCurrentlyPlaying) {
                binding.btnPlayPause.setImageResource(R.drawable.ic_pause_circle)
            } else {
                binding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
            }

            binding.btnPlayPause.setOnClickListener {
                onPlayVoiceClicked(msg, binding)
            }
        }
    }

    class LocationViewHolder(private val binding: ItemChatLocationBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, isSent: Boolean) {
            val context = itemView.context
            val params = binding.cardLocation.layoutParams as ConstraintLayout.LayoutParams
            if (isSent) {
                params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                params.startToStart = ConstraintLayout.LayoutParams.UNSET
                binding.cardLocation.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_sent))
                binding.ivTicks.visibility = View.VISIBLE
                updateTicks(binding.ivTicks, msg.status)
            } else {
                params.startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                params.endToEnd = ConstraintLayout.LayoutParams.UNSET
                binding.cardLocation.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_received))
                binding.ivTicks.visibility = View.GONE
            }
            binding.cardLocation.layoutParams = params

            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            binding.tvCoordinates.text = if (!msg.messageText.isNullOrEmpty()) msg.messageText else "30.7333° N, 76.7794° E"

            binding.btnOpenMaps.setOnClickListener {
                val coords = binding.tvCoordinates.text.toString()
                try {
                    val uri = Uri.parse("geo:0,0?q=$coords")
                    val intent = Intent(Intent.ACTION_VIEW, uri)
                    context.startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(context, "Coordinates: $coords", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    class DocViewHolder(private val binding: ItemChatDocBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(
            msg: ChatMessage,
            isSent: Boolean,
            onDocumentClicked: (ChatMessage) -> Unit
        ) {
            val context = itemView.context
            val params = binding.cardDoc.layoutParams as ConstraintLayout.LayoutParams
            if (isSent) {
                params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                params.startToStart = ConstraintLayout.LayoutParams.UNSET
                binding.cardDoc.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_sent))
                binding.ivTicks.visibility = View.VISIBLE
                updateTicks(binding.ivTicks, msg.status)
            } else {
                params.startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                params.endToEnd = ConstraintLayout.LayoutParams.UNSET
                binding.cardDoc.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_received))
                binding.ivTicks.visibility = View.GONE
            }
            binding.cardDoc.layoutParams = params

            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            val docName = if (!msg.messageText.isNullOrEmpty()) msg.messageText else "Document.pdf"
            binding.tvDocName.text = docName
            binding.tvDocSize.text = if (msg.fileSizeBytes > 0) formatFileSize(msg.fileSizeBytes) else "Document File"

            binding.btnDownloadDoc.setOnClickListener {
                onDocumentClicked(msg)
            }
            binding.cardDoc.setOnClickListener {
                onDocumentClicked(msg)
            }
        }
    }

    class VideoViewHolder(
        private val binding: ItemChatVideoBinding,
        private val onVideoClicked: (ChatMessage) -> Unit
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, isSent: Boolean) {
            val context = itemView.context
            val params = binding.cardVideo.layoutParams as ConstraintLayout.LayoutParams
            if (isSent) {
                params.endToEnd = ConstraintLayout.LayoutParams.PARENT_ID
                params.startToStart = ConstraintLayout.LayoutParams.UNSET
                binding.cardVideo.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_sent))
            } else {
                params.startToStart = ConstraintLayout.LayoutParams.PARENT_ID
                params.endToEnd = ConstraintLayout.LayoutParams.UNSET
                binding.cardVideo.setCardBackgroundColor(ContextCompat.getColor(context, R.color.bubble_received))
            }
            binding.cardVideo.layoutParams = params

            binding.tvVideoCaption.text = if (!msg.messageText.isNullOrEmpty() && msg.messageText != "Video") msg.messageText else "Video"
            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            binding.tvVideoSize.text = if (msg.fileSizeBytes > 0) formatFileSize(msg.fileSizeBytes) else "Video File"
            binding.tvVideoDuration.text = if (msg.thumbnailBlur != null && msg.thumbnailBlur!!.contains("dur:")) {
                msg.thumbnailBlur!!.substringAfter("dur:")
            } else {
                "▶ Video"
            }

            val isUploading = msg.status == "UPLOADING" || msg.status == "PENDING"
            val isFailed = msg.status == "FAILED"

            if (isUploading) {
                binding.layoutUploadingOverlay.visibility = View.VISIBLE
                binding.btnPlayVideoOverlay.visibility = View.GONE
                binding.tvStatusIndicator.visibility = View.VISIBLE
                binding.tvStatusIndicator.text = "Uploading..."
                binding.tvStatusIndicator.setTextColor(ContextCompat.getColor(context, R.color.accent_amber))
                binding.ivTicks.visibility = View.GONE
            } else if (isFailed) {
                binding.layoutUploadingOverlay.visibility = View.GONE
                binding.btnPlayVideoOverlay.visibility = View.VISIBLE
                binding.tvStatusIndicator.visibility = View.VISIBLE
                binding.tvStatusIndicator.text = "Failed"
                binding.tvStatusIndicator.setTextColor(ContextCompat.getColor(context, R.color.error_red))
                binding.ivTicks.visibility = View.GONE
            } else {
                binding.layoutUploadingOverlay.visibility = View.GONE
                binding.btnPlayVideoOverlay.visibility = View.VISIBLE
                binding.tvStatusIndicator.visibility = View.GONE
                if (isSent) {
                    binding.ivTicks.visibility = View.VISIBLE
                    updateTicks(binding.ivTicks, msg.status)
                } else {
                    binding.ivTicks.visibility = View.GONE
                }
            }

            val rawThumb = if (msg.thumbnailBlur != null && msg.thumbnailBlur!!.contains(";dur:")) {
                msg.thumbnailBlur!!.substringBefore(";dur:")
            } else if (msg.thumbnailBlur != null && !msg.thumbnailBlur!!.startsWith("dur:")) {
                msg.thumbnailBlur
            } else {
                null
            }
            val thumbUrl = if (!rawThumb.isNullOrEmpty()) rawThumb else msg.attachmentUrl
            Glide.with(context)
                .load(thumbUrl)
                .centerCrop()
                .placeholder(R.drawable.ic_attach_gallery)
                .into(binding.ivVideoThumbnail)

            binding.cardVideo.setOnClickListener {
                onVideoClicked(msg)
            }
            binding.btnPlayVideoOverlay.setOnClickListener {
                onVideoClicked(msg)
            }
        }
    }
}

private fun formatReactions(reactions: Map<String, List<Int>>?): String {
    if (reactions.isNullOrEmpty()) return ""
    return reactions.entries
        .filter { it.value.isNotEmpty() }
        .joinToString(" ") { (emoji, users) ->
            if (users.size > 1) "$emoji ${users.size}" else emoji
        }
}

private fun updateTicks(imageView: ImageView, status: String) {
    when (status) {
        "UPLOADING", "PENDING" -> {
            imageView.visibility = View.VISIBLE
            imageView.setImageResource(R.drawable.ic_recording_dot)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.text_muted))
        }
        "READ" -> {
            imageView.visibility = View.VISIBLE
            imageView.setImageResource(R.drawable.ic_tick_double)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.ticks_read))
        }
        "DELIVERED" -> {
            imageView.visibility = View.VISIBLE
            imageView.setImageResource(R.drawable.ic_tick_double)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.ticks_sent))
        }
        else -> {
            imageView.visibility = View.VISIBLE
            imageView.setImageResource(R.drawable.ic_tick_single)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.ticks_sent))
        }
    }
}

private fun formatTimestamp(iso: String?): String {
    if (iso.isNullOrEmpty()) return ""
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
            val localFormat = SimpleDateFormat("hh:mm a", Locale.getDefault())
            localFormat.format(date)
        } else {
            iso.substring(11, 16)
        }
    } catch (e: Exception) {
        "12:00"
    }
}

private fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return ""
    val mb = bytes.toDouble() / (1024 * 1024)
    return String.format("%.1f MB", mb)
}
