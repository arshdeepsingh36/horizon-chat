package com.chatapp.horizon.utils

import android.content.Context
import com.chatapp.horizon.models.ChatMessage

/**
 * Push & In-app notifications have been completely disabled and cleaned up per specification.
 * Methods are retained as safe no-ops to avoid breaking existing references.
 */
object HorizonNotificationManager {

    var activeChatPartnerId: Int? = null

    fun init(context: Context) {
        // Notifications disabled per requirement
    }

    fun showIncomingMessageNotification(
        context: Context,
        message: ChatMessage,
        senderUsername: String,
        senderDisplayName: String,
        currentUserId: Int,
        authToken: String
    ) {
        // Notifications disabled per requirement
    }
}
