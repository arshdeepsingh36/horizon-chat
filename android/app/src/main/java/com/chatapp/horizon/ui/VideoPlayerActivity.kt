package com.chatapp.horizon.ui

import android.content.ContentValues
import android.content.Intent
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ActivityVideoPlayerBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

class VideoPlayerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityVideoPlayerBinding
    private var videoUrl: String = ""
    private var videoTitle: String = "Video"
    private var senderName: String = ""
    private var videoTimestamp: String = ""
    private var localVideoFile: File? = null

    private var mediaPlayer: MediaPlayer? = null
    private var isMuted: Boolean = false
    private var isSeeking: Boolean = false
    private var isCropFill: Boolean = false
    private var videoWidth: Int = 0
    private var videoHeight: Int = 0

    private val progressHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

    private val autoHideHandler = Handler(Looper.getMainLooper())
    private val autoHideRunnable = Runnable {
        if (binding.videoView.isPlaying) {
            hideControls()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityVideoPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        videoUrl = intent.getStringExtra("VIDEO_URL") ?: ""
        videoTitle = intent.getStringExtra("VIDEO_TITLE") ?: "Video"
        senderName = intent.getStringExtra("SENDER_NAME") ?: ""
        videoTimestamp = intent.getStringExtra("TIMESTAMP") ?: ""

        setupUI()
        prepareAndPlayVideo()
    }

    private fun setupUI() {
        binding.tvPlayerTitle.text = if (senderName.isNotEmpty()) "Video from @$senderName" else videoTitle
        binding.tvPlayerSubtitle.text = if (videoTimestamp.isNotEmpty()) videoTimestamp else "Horizon Video"

        binding.btnBack.setOnClickListener { finish() }

        binding.btnPlayPause.setOnClickListener {
            togglePlayPause()
            resetAutoHide()
        }

        binding.btnMuteToggle.setOnClickListener {
            toggleMute()
            resetAutoHide()
        }

        binding.btnAspectToggle.setOnClickListener {
            toggleAspectRatio()
            resetAutoHide()
        }

        binding.btnShareVideo.setOnClickListener {
            shareVideo()
        }

        binding.btnSaveVideo.setOnClickListener {
            saveVideoToGallery()
        }

        binding.sbVideoProgress.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) {
                    val duration = binding.videoView.duration
                    if (duration > 0) {
                        val newPosition = (duration * (progress / 100.0)).toInt()
                        binding.tvCurrentTime.text = formatTime(newPosition)
                    }
                }
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) {
                isSeeking = true
                autoHideHandler.removeCallbacks(autoHideRunnable)
            }

            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                isSeeking = false
                val duration = binding.videoView.duration
                val progress = seekBar?.progress ?: 0
                if (duration > 0) {
                    val newPosition = (duration * (progress / 100.0)).toInt()
                    binding.videoView.seekTo(newPosition)
                }
                resetAutoHide()
            }
        })

        // Tap canvas to toggle controls
        binding.videoContainer.setOnClickListener {
            toggleControls()
        }
        binding.videoView.setOnClickListener {
            toggleControls()
        }
    }

    private fun toggleControls() {
        val isVisible = binding.layoutBottomControls.visibility == View.VISIBLE
        if (isVisible) {
            hideControls()
        } else {
            showControls()
            resetAutoHide()
        }
    }

    private fun showControls() {
        binding.layoutTopBar.visibility = View.VISIBLE
        binding.layoutBottomControls.visibility = View.VISIBLE
        binding.layoutTopBar.animate().alpha(1f).setDuration(200).start()
        binding.layoutBottomControls.animate().alpha(1f).setDuration(200).start()
    }

    private fun hideControls() {
        binding.layoutTopBar.animate().alpha(0f).setDuration(250).withEndAction {
            binding.layoutTopBar.visibility = View.GONE
        }.start()
        binding.layoutBottomControls.animate().alpha(0f).setDuration(250).withEndAction {
            binding.layoutBottomControls.visibility = View.GONE
        }.start()
    }

    private fun resetAutoHide() {
        autoHideHandler.removeCallbacks(autoHideRunnable)
        autoHideHandler.postDelayed(autoHideRunnable, 3500)
    }

    private fun prepareAndPlayVideo() {
        if (videoUrl.isEmpty()) {
            Toast.makeText(this, "Video URL is empty", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        binding.pbBuffering.visibility = View.VISIBLE

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                // 1. Data URI (Base64)
                if (videoUrl.startsWith("data:video/")) {
                    val clean = videoUrl.substringAfter("base64,")
                    val bytes = Base64.decode(clean, Base64.DEFAULT)
                    val cacheDir = File(cacheDir, "video_cache").apply { mkdirs() }
                    val file = File(cacheDir, "vid_${System.currentTimeMillis()}.mp4")
                    file.writeBytes(bytes)
                    localVideoFile = file

                    withContext(Dispatchers.Main) {
                        startPlaybackWithUri(Uri.fromFile(file))
                    }
                    return@launch
                }

                // 2. Local file URI
                if (videoUrl.startsWith("file://") || videoUrl.startsWith("/")) {
                    val file = File(videoUrl.removePrefix("file://"))
                    if (file.exists()) {
                        localVideoFile = file
                        withContext(Dispatchers.Main) {
                            startPlaybackWithUri(Uri.fromFile(file))
                        }
                        return@launch
                    }
                }

                // 3. Remote HTTP URL
                withContext(Dispatchers.Main) {
                    startPlaybackWithUri(Uri.parse(videoUrl))
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    binding.pbBuffering.visibility = View.GONE
                    Toast.makeText(this@VideoPlayerActivity, "Error loading video: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun startPlaybackWithUri(uri: Uri) {
        binding.videoView.setVideoURI(uri)
        binding.videoView.setOnPreparedListener { mp ->
            mediaPlayer = mp
            binding.pbBuffering.visibility = View.GONE
            val duration = mp.duration
            binding.tvTotalDuration.text = formatTime(duration)
            binding.btnPlayPause.setImageResource(R.drawable.ic_pause_circle)
            mp.isLooping = true

            videoWidth = mp.videoWidth
            videoHeight = mp.videoHeight
            adjustVideoAspectRatio()

            binding.videoView.start()
            startProgressUpdater()
            resetAutoHide()
        }

        binding.videoView.setOnErrorListener { _, _, _ ->
            binding.pbBuffering.visibility = View.GONE
            Toast.makeText(this, "Unable to play this video stream", Toast.LENGTH_SHORT).show()
            true
        }
    }

    private fun adjustVideoAspectRatio() {
        if (videoWidth <= 0 || videoHeight <= 0) return

        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val screenHeight = displayMetrics.heightPixels

        val videoRatio = videoWidth.toDouble() / videoHeight.toDouble()
        val screenRatio = screenWidth.toDouble() / screenHeight.toDouble()

        val lp = binding.videoView.layoutParams as FrameLayout.LayoutParams

        if (isCropFill) {
            // Fill / Crop
            if (videoRatio > screenRatio) {
                lp.width = (screenHeight * videoRatio).toInt()
                lp.height = screenHeight
            } else {
                lp.width = screenWidth
                lp.height = (screenWidth / videoRatio).toInt()
            }
        } else {
            // Aspect-Ratio Fit (Letterbox / Pillarbox)
            if (videoRatio > screenRatio) {
                lp.width = screenWidth
                lp.height = (screenWidth / videoRatio).toInt()
            } else {
                lp.width = (screenHeight * videoRatio).toInt()
                lp.height = screenHeight
            }
        }
        lp.gravity = android.view.Gravity.CENTER
        binding.videoView.layoutParams = lp
    }

    private fun toggleAspectRatio() {
        isCropFill = !isCropFill
        adjustVideoAspectRatio()
        val mode = if (isCropFill) "Crop to Fill" else "Aspect Fit"
        Toast.makeText(this, mode, Toast.LENGTH_SHORT).show()
    }

    private fun togglePlayPause() {
        if (binding.videoView.isPlaying) {
            binding.videoView.pause()
            binding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
            showControls()
            autoHideHandler.removeCallbacks(autoHideRunnable)
        } else {
            binding.videoView.start()
            binding.btnPlayPause.setImageResource(R.drawable.ic_pause_circle)
            resetAutoHide()
        }
    }

    private fun toggleMute() {
        val mp = mediaPlayer ?: return
        isMuted = !isMuted
        if (isMuted) {
            mp.setVolume(0f, 0f)
            binding.btnMuteToggle.setImageResource(R.drawable.ic_volume_off)
            Toast.makeText(this, "Muted", Toast.LENGTH_SHORT).show()
        } else {
            mp.setVolume(1f, 1f)
            binding.btnMuteToggle.setImageResource(R.drawable.ic_volume_up)
            Toast.makeText(this, "Unmuted", Toast.LENGTH_SHORT).show()
        }
    }

    private fun startProgressUpdater() {
        progressRunnable?.let { progressHandler.removeCallbacks(it) }
        progressRunnable = object : Runnable {
            override fun run() {
                if (!isSeeking && binding.videoView.isPlaying) {
                    val pos = binding.videoView.currentPosition
                    val dur = binding.videoView.duration
                    if (dur > 0) {
                        val progress = ((pos.toDouble() / dur) * 100).toInt()
                        binding.sbVideoProgress.progress = progress.coerceIn(0, 100)
                        binding.tvCurrentTime.text = formatTime(pos)
                    }
                }
                progressHandler.postDelayed(this, 200)
            }
        }
        progressHandler.post(progressRunnable!!)
    }

    private fun shareVideo() {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val fileToShare = localVideoFile ?: run {
                    val cacheDir = File(cacheDir, "shared_videos").apply { mkdirs() }
                    val temp = File(cacheDir, "shared_${System.currentTimeMillis()}.mp4")
                    FileOutputStream(temp).use { out -> writeVideoToStream(out) }
                    temp
                }

                val uri = FileProvider.getUriForFile(
                    this@VideoPlayerActivity,
                    "${applicationContext.packageName}.fileprovider",
                    fileToShare
                )

                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "video/mp4"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(intent, "Share Video"))
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@VideoPlayerActivity, "Failed to share video", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun saveVideoToGallery() {
        Toast.makeText(this, "Saving video to device gallery...", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val fileName = "Horizon_Video_${System.currentTimeMillis()}.mp4"

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
                        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                        put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Horizon")
                        put(MediaStore.Video.Media.IS_PENDING, 1)
                    }

                    val uri = contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { out ->
                            writeVideoToStream(out)
                        }
                        values.clear()
                        values.put(MediaStore.Video.Media.IS_PENDING, 0)
                        contentResolver.update(uri, values, null, null)

                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@VideoPlayerActivity, "Video saved to Movies/Horizon! 🎬", Toast.LENGTH_LONG).show()
                        }
                    }
                } else {
                    val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
                    val destDir = File(moviesDir, "Horizon").apply { mkdirs() }
                    val destFile = File(destDir, fileName)
                    FileOutputStream(destFile).use { out ->
                        writeVideoToStream(out)
                    }
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@VideoPlayerActivity, "Video saved: ${destFile.name}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@VideoPlayerActivity, "Failed to save video: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun writeVideoToStream(out: OutputStream) {
        val file = localVideoFile
        if (file != null && file.exists()) {
            file.inputStream().use { it.copyTo(out) }
            return
        }

        if (videoUrl.startsWith("http")) {
            val client = OkHttpClient()
            val request = Request.Builder().url(videoUrl).build()
            val response = client.newCall(request).execute()
            if (response.isSuccessful && response.body != null) {
                response.body!!.byteStream().use { input ->
                    input.copyTo(out)
                }
            }
        }
    }

    private fun formatTime(millis: Int): String {
        val seconds = (millis / 1000) % 60
        val minutes = (millis / (1000 * 60)) % 60
        return String.format("%d:%02d", minutes, seconds)
    }

    override fun onPause() {
        super.onPause()
        if (binding.videoView.isPlaying) {
            binding.videoView.pause()
            binding.btnPlayPause.setImageResource(R.drawable.ic_play_arrow)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        autoHideHandler.removeCallbacks(autoHideRunnable)
        progressRunnable?.let { progressHandler.removeCallbacks(it) }
        binding.videoView.stopPlayback()
    }
}
