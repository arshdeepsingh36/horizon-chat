package com.chatapp.horizon.ui

import android.graphics.BitmapFactory
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ItemChatSentMediaBinding
import com.chatapp.horizon.databinding.ItemMessageReceivedBinding
import com.chatapp.horizon.databinding.ItemMessageSentBinding
import com.chatapp.horizon.models.ChatMessage

class ChatAdapter(
    private val currentUserId: Int,
    private val onMediaDownloadClicked: (ChatMessage) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val TYPE_SENT_TEXT = 1
        private const val TYPE_RECEIVED_TEXT = 2
        private const val TYPE_SENT_MEDIA = 3
        private const val MAX_HEAP_ITEMS = 200
    }

    private val messages = mutableListOf<ChatMessage>()

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
            isSent && msg.attachmentType == "IMAGE" -> TYPE_SENT_MEDIA
            isSent -> TYPE_SENT_TEXT
            else -> TYPE_RECEIVED_TEXT
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            TYPE_SENT_TEXT -> SentTextViewHolder(ItemMessageSentBinding.inflate(inflater, parent, false))
            TYPE_SENT_MEDIA -> SentMediaViewHolder(ItemChatSentMediaBinding.inflate(inflater, parent, false))
            else -> ReceivedTextViewHolder(ItemMessageReceivedBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val msg = messages[position]
        when (holder) {
            is SentTextViewHolder -> holder.bind(msg)
            is SentMediaViewHolder -> holder.bind(msg, onMediaDownloadClicked)
            is ReceivedTextViewHolder -> holder.bind(msg)
        }
    }

    class SentTextViewHolder(private val binding: ItemMessageSentBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage) {
            binding.tvMessageBody.text = msg.messageText
            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            updateTicks(binding.ivTicks, msg.status)
        }
    }

    class ReceivedTextViewHolder(private val binding: ItemMessageReceivedBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage) {
            binding.tvReceivedMessageBody.text = msg.messageText
            binding.tvReceivedTimestamp.text = formatTimestamp(msg.createdAt)
        }
    }

    class SentMediaViewHolder(private val binding: ItemChatSentMediaBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(msg: ChatMessage, onDownloadClicked: (ChatMessage) -> Unit) {
            binding.tvCaption.text = msg.messageText
            binding.tvTimestamp.text = formatTimestamp(msg.createdAt)
            binding.tvFileSize.text = formatFileSize(msg.fileSizeBytes)
            updateTicks(binding.ivTicks, msg.status)

            // Decode 20x20 micro-blur Base64 string
            if (!msg.thumbnailBlur.isNullOrEmpty()) {
                val cleanBase64 = msg.thumbnailBlur.substringAfter("base64,")
                val decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                binding.ivThumbnail.setImageBitmap(bitmap)
            }

            binding.downloadOverlay.setOnClickListener {
                binding.downloadOverlay.visibility = View.GONE
                binding.pbLoading.visibility = View.VISIBLE
                onDownloadClicked(msg)

                // Load high-res binary
                if (!msg.attachmentUrl.isNullOrEmpty()) {
                    Glide.with(itemView.context)
                        .load(msg.attachmentUrl)
                        .into(binding.ivThumbnail)
                    binding.pbLoading.visibility = View.GONE
                }
            }
        }
    }
}

private fun updateTicks(imageView: android.widget.ImageView, status: String) {
    when (status) {
        "READ" -> {
            imageView.setImageResource(android.R.drawable.checkbox_on_background)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.ticks_read))
        }
        "DELIVERED" -> {
            imageView.setImageResource(android.R.drawable.checkbox_on_background)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.text_muted))
        }
        else -> {
            imageView.setImageResource(android.R.drawable.ic_menu_send)
            imageView.setColorFilter(ContextCompat.getColor(imageView.context, R.color.text_muted))
        }
    }
}

private fun formatTimestamp(iso: String): String {
    return try {
        iso.substring(11, 16)
    } catch (e: Exception) {
        "12:00"
    }
}

private fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return ""
    val mb = bytes.toDouble() / (1024 * 1024)
    return String.format("%.1f MB", mb)
}
