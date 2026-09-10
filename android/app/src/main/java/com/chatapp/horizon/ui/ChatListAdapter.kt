package com.chatapp.horizon.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.chatapp.horizon.databinding.ItemConversationBinding
import com.chatapp.horizon.models.Conversation

class ChatListAdapter(
    private val onChatClicked: (Conversation) -> Unit
) : RecyclerView.Adapter<ChatListAdapter.ChatViewHolder>() {

    private val chats = mutableListOf<Conversation>()

    fun setChats(newChats: List<Conversation>) {
        chats.clear()
        chats.addAll(newChats)
        notifyDataSetChanged()
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
            binding.tvUsername.text = "@$username"
            binding.tvAvatarInitials.text = username.take(2).uppercase()

            binding.viewOnlineDot.visibility = if (chat.online) View.VISIBLE else View.GONE

            val snippet = chat.lastMessage?.messageText ?: "No messages yet"
            binding.tvLastSnippet.text = snippet

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
