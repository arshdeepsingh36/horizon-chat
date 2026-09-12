package com.chatapp.horizon.utils

import java.text.SimpleDateFormat
import java.util.*

object TimeFormatHelper {

    private fun parseIsoDate(isoTimestamp: String?): Date? {
        if (isoTimestamp.isNullOrBlank()) return null
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss.SSS"
        )
        for (pattern in formats) {
            try {
                val sdf = SimpleDateFormat(pattern, Locale.US).apply {
                    if (pattern.endsWith("'Z'")) {
                        timeZone = TimeZone.getTimeZone("UTC")
                    } else {
                        timeZone = TimeZone.getTimeZone("UTC")
                    }
                }
                val d = sdf.parse(isoTimestamp)
                if (d != null) return d
            } catch (_: Exception) {}
        }
        return null
    }

    fun formatLastSeen(isoTimestamp: String?, isOnline: Boolean): String {
        if (isOnline) return "online"
        val date = parseIsoDate(isoTimestamp) ?: return "offline"

        val now = Calendar.getInstance()
        val msgCal = Calendar.getInstance().apply { time = date }

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault()).apply {
            timeZone = TimeZone.getDefault()
        }
        val formattedTime = timeFormat.format(date)

        val isToday = now.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == msgCal.get(Calendar.DAY_OF_YEAR)

        now.add(Calendar.DAY_OF_YEAR, -1)
        val isYesterday = now.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == msgCal.get(Calendar.DAY_OF_YEAR)

        return when {
            isToday -> "Last seen today at $formattedTime"
            isYesterday -> "Last seen yesterday at $formattedTime"
            else -> {
                val fullDateFormat = SimpleDateFormat("dd/MM/yyyy 'at' h:mm a", Locale.getDefault()).apply {
                    timeZone = TimeZone.getDefault()
                }
                "Last seen ${fullDateFormat.format(date)}"
            }
        }
    }

    fun formatConversationTimestamp(isoTimestamp: String?): String {
        val date = parseIsoDate(isoTimestamp) ?: return ""

        val now = Calendar.getInstance()
        val msgCal = Calendar.getInstance().apply { time = date }

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault()).apply {
            timeZone = TimeZone.getDefault()
        }

        val isToday = now.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == msgCal.get(Calendar.DAY_OF_YEAR)

        now.add(Calendar.DAY_OF_YEAR, -1)
        val isYesterday = now.get(Calendar.YEAR) == msgCal.get(Calendar.YEAR) &&
                now.get(Calendar.DAY_OF_YEAR) == msgCal.get(Calendar.DAY_OF_YEAR)

        now.time = Date() // reset now
        val diffDays = (now.timeInMillis - date.time) / (1000 * 60 * 60 * 24)

        return when {
            isToday -> timeFormat.format(date)
            isYesterday -> "Yesterday"
            diffDays < 7 -> {
                val dayFormat = SimpleDateFormat("EEEE", Locale.getDefault()).apply {
                    timeZone = TimeZone.getDefault()
                }
                dayFormat.format(date)
            }
            else -> {
                val dateFormat = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).apply {
                    timeZone = TimeZone.getDefault()
                }
                dateFormat.format(date)
            }
        }
    }

    fun formatMessageTime(isoTimestamp: String?): String {
        val date = parseIsoDate(isoTimestamp) ?: return "12:00"
        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault()).apply {
            timeZone = TimeZone.getDefault()
        }
        return timeFormat.format(date)
    }
}
