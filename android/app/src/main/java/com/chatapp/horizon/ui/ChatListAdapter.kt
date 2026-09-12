package com.chatapp.horizon.ui

import android.graphics.Color
import android.graphics.Typeface
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.chatapp.horizon.databinding.ItemConversationBinding
import com.chatapp.horizon.models.Conversation
import com.chatapp.horizon.utils.AvatarHelper
import com.chatapp.horizon.utils.TimeFormatHelper

class ChatListAdapter(
    private val onChatClicked: (Conversation) -> Unit
) : RecyclerView.Adapter<ChatListAdapter.ChatViewHolder>() {

    private val chats = mutableListOf<Conversation>()

    fun setChats(newChats: List<Conversation>) {
        chats.clear()
        chats.addAll(newChats)
        notifyDataSetChanged()
    }

    fun setTyping(partnerId: Int, isTyping: Boolean) {
        val index = chats.indexOfFirst { it.partnerId == partnerId }
        if (index != -1) {
            chats[index].isTyping = isTyping
            notifyItemChanged(index)
        }
    }

    fun setUserOnline(partnerId: Int, online: Boolean) {
        val index = chats.indexOfFirst { it.partnerId == partnerId }
        if (index != -1) {
            chats[index].online = online
            notifyItemChanged(index)
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val binding = ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ChatViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) {
        holder.bind(chats[position])
    }

    override fun getItemCount(): Int = chats.size

    inner class ChatViewHolder(private val binding: ItemConversationBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(chat: Conversation) {
            val username = chat.partnerUsername
            val displayName = chat.partnerDisplayName ?: "@$username"
            binding.tvUsername.text = displayName

            AvatarHelper.setupAvatar(
                binding.ivAvatar,
                binding.tvAvatarInitials,
                chat.partnerAvatarUrl,
                displayName
            )

            binding.viewOnlineDot.visibility = if (chat.online) View.VISIBLE else View.GONE

            // Bind exact localized timestamp (Fixing static 12:00 bug - Task 8)
            val timeStr = TimeFormatHelper.formatConversationTimestamp(chat.lastMessage?.createdAt)
            binding.tvTimestamp.text = timeStr
            binding.tvTimestamp.visibility = if (timeStr.isNotEmpty()) View.VISIBLE else View.GONE

            if (chat.isTyping) {
                binding.tvLastSnippet.text = "typing..."
                binding.tvLastSnippet.setTextColor(Color.parseColor("#F59E0B"))
                binding.tvLastSnippet.setTypeface(null, Typeface.ITALIC)
            } else {
                val snippet = when (chat.lastMessage?.attachmentType) {
                    "IMAGE" -> if (chat.lastMessage.isViewOnce) "📷 1 View once photo" else "📷 Photo"
                    "VIDEO" -> if (chat.lastMessage.isViewOnce) "🎥 1 View once video" else "🎥 Video"
                    "AUDIO" -> "🎤 Voice note"
                    "LOCATION" -> "📍 Location pin"
                    "DOCUMENT" -> "📄 Document"
                    else -> chat.lastMessage?.messageText ?: "No messages yet"
                }
                binding.tvLastSnippet.text = snippet
                binding.tvLastSnippet.setTextColor(Color.parseColor("#94A3B8"))
                binding.tvLastSnippet.setTypeface(null, Typeface.NORMAL)
            }

            if (chat.unreadCount > 0) {
                binding.tvUnreadBadge.visibility = View.VISIBLE
                binding.tvUnreadBadge.text = chat.unreadCount.toString()
            } else {
                binding.tvUnreadBadge.visibility = View.GONE
            }

            binding.root.setOnClickListener {
                onChatClicked(chat)
            }
        }
    }
}
