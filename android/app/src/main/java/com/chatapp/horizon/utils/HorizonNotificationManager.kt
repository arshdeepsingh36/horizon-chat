package com.chatapp.horizon.utils

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.chatapp.horizon.R
import com.chatapp.horizon.models.ChatMessage
import com.chatapp.horizon.ui.ChatActivity

object HorizonNotificationManager {

    private const val CHANNEL_ID = "horizon_messages_channel"
    private const val CHANNEL_NAME = "Horizon Chat Messages"
    private const val CHANNEL_DESC = "Notifications for incoming real-time messages"

    var activeChatPartnerId: Int? = null

    fun init(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = CHANNEL_DESC
                enableLights(true)
                enableVibration(true)
                setShowBadge(true)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showIncomingMessageNotification(
        context: Context,
        message: ChatMessage,
        senderUsername: String,
        senderDisplayName: String,
        currentUserId: Int,
        authToken: String
    ) {
        // Do not notify if user is currently looking at this active conversation
        if (activeChatPartnerId == message.senderId) return

        init(context)

        val intent = Intent(context, ChatActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("CURRENT_USER_ID", currentUserId)
            putExtra("TARGET_USER_ID", message.senderId)
            putExtra("TARGET_USERNAME", senderUsername)
            putExtra("TARGET_DISPLAY_NAME", senderDisplayName)
            putExtra("AUTH_TOKEN", authToken)
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            message.senderId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val snippet = when (message.attachmentType) {
            "IMAGE" -> if (message.isViewOnce) "📷 1 View once photo" else "📷 Photo"
            "VIDEO" -> if (message.isViewOnce) "🎥 1 View once video" else "🎥 Video"
            "AUDIO" -> "🎤 Voice note"
            "LOCATION" -> "📍 Location pin"
            "DOCUMENT" -> "📄 Document"
            else -> message.messageText ?: "New message"
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_horizon_app_logo)
            .setContentTitle(senderDisplayName)
            .setContentText(snippet)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(message.senderId, notification)
    }
}
