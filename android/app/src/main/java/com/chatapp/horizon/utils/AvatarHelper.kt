package com.chatapp.horizon.utils

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import com.bumptech.glide.Glide
import java.util.Locale
import kotlin.math.abs

object AvatarHelper {

    private val PALETTE = listOf(
        "#EA580C", // Sunset Coral
        "#0284C7", // Ocean Blue
        "#7C3AED", // Vivid Violet
        "#059669", // Emerald Green
        "#D97706", // Warm Amber
        "#DB2777", // Sunset Rose
        "#0D9488", // Deep Teal
        "#4F46E5"  // Indigo
    )

    fun getInitials(name: String?): String {
        if (name.isNullOrBlank()) return "?"
        val clean = name.trim().removePrefix("@")
        val parts = clean.split("\\s+".toRegex()).filter { it.isNotBlank() }
        return when {
            parts.size >= 2 -> {
                val first = parts[0].take(1).uppercase(Locale.ROOT)
                val second = parts[1].take(1).uppercase(Locale.ROOT)
                "$first$second"
            }
            clean.length >= 2 -> clean.take(2).uppercase(Locale.ROOT)
            clean.isNotEmpty() -> clean.take(1).uppercase(Locale.ROOT)
            else -> "?"
        }
    }

    fun getAvatarColor(name: String?): Int {
        if (name.isNullOrBlank()) return Color.parseColor(PALETTE[0])
        val hash = abs(name.trim().lowercase(Locale.ROOT).hashCode())
        val hex = PALETTE[hash % PALETTE.size]
        return Color.parseColor(hex)
    }

    fun setupAvatar(
        imageView: ImageView,
        initialsView: TextView,
        avatarUrl: String?,
        name: String?
    ) {
        val initials = getInitials(name)
        val color = getAvatarColor(name)

        initialsView.text = initials

        val bgDrawable = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
        initialsView.background = bgDrawable

        if (!avatarUrl.isNullOrBlank()) {
            imageView.visibility = View.VISIBLE
            initialsView.visibility = View.GONE
            Glide.with(imageView.context)
                .load(avatarUrl)
                .circleCrop()
                .into(imageView)
        } else {
            imageView.visibility = View.GONE
            initialsView.visibility = View.VISIBLE
        }
    }
}
