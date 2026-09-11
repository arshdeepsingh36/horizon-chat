package com.chatapp.horizon.ui

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.PointF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.bumptech.glide.Glide
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.chatapp.horizon.R
import com.chatapp.horizon.databinding.ActivityPhotoViewerBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

class PhotoViewerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPhotoViewerBinding
    private var photoUrl: String = ""
    private var photoTitle: String = "Photo"
    private var senderName: String = ""
    private var photoTimestamp: String = ""
    private var photoCaption: String = ""
    private var localBitmap: Bitmap? = null
    private var localPhotoFile: File? = null

    // Touch and Zoom Matrices
    private val matrix = Matrix()
    private val savedMatrix = Matrix()
    private var mode = NONE
    private val start = PointF()
    private val mid = PointF()
    private var oldDist = 1f
    private lateinit var scaleDetector: ScaleGestureDetector

    companion object {
        private const val NONE = 0
        private const val DRAG = 1
        private const val ZOOM = 2
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPhotoViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        photoUrl = intent.getStringExtra("PHOTO_URL") ?: ""
        photoTitle = intent.getStringExtra("PHOTO_TITLE") ?: "Photo"
        senderName = intent.getStringExtra("SENDER_NAME") ?: ""
        photoTimestamp = intent.getStringExtra("TIMESTAMP") ?: ""
        photoCaption = intent.getStringExtra("CAPTION") ?: ""

        setupUI()
        loadPhoto()
    }

    private fun setupUI() {
        binding.tvPhotoTitle.text = if (senderName.isNotEmpty()) "Photo from @$senderName" else photoTitle
        binding.tvPhotoSubtitle.text = if (photoTimestamp.isNotEmpty()) photoTimestamp else "Horizon Photo"

        if (photoCaption.isNotEmpty()) {
            binding.layoutBottomCaption.visibility = View.VISIBLE
            binding.tvPhotoCaption.text = photoCaption
        } else {
            binding.layoutBottomCaption.visibility = View.GONE
        }

        binding.btnBack.setOnClickListener { finish() }

        binding.btnSharePhoto.setOnClickListener {
            sharePhoto()
        }

        binding.btnSavePhoto.setOnClickListener {
            savePhotoToGallery()
        }

        // Tap to toggle controls
        binding.rootPhotoViewer.setOnClickListener {
            toggleControls()
        }

        setupZoomTouchListener()
    }

    private fun toggleControls() {
        val isVisible = binding.layoutTopBar.visibility == View.VISIBLE
        val newVis = if (isVisible) View.GONE else View.VISIBLE
        val targetAlpha = if (isVisible) 0f else 1f

        binding.layoutTopBar.visibility = View.VISIBLE
        if (photoCaption.isNotEmpty()) binding.layoutBottomCaption.visibility = View.VISIBLE

        binding.layoutTopBar.animate().alpha(targetAlpha).setDuration(200).withEndAction {
            binding.layoutTopBar.visibility = newVis
        }.start()

        if (photoCaption.isNotEmpty()) {
            binding.layoutBottomCaption.animate().alpha(targetAlpha).setDuration(200).withEndAction {
                binding.layoutBottomCaption.visibility = newVis
            }.start()
        }
    }

    private fun setupZoomTouchListener() {
        scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val scaleFactor = detector.scaleFactor
                matrix.postScale(scaleFactor, scaleFactor, detector.focusX, detector.focusY)
                binding.ivFullPhoto.imageMatrix = matrix
                return true
            }
        })

        binding.ivFullPhoto.scaleType = ImageView.ScaleType.FIT_CENTER
        binding.ivFullPhoto.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            if (event.action == MotionEvent.ACTION_UP) {
                toggleControls()
            }
            true
        }
    }

    private fun loadPhoto() {
        if (photoUrl.isEmpty()) {
            Toast.makeText(this, "Photo URL is empty", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        binding.pbPhotoLoading.visibility = View.VISIBLE

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                // 1. Base64 data string
                if (photoUrl.startsWith("data:image/")) {
                    val clean = photoUrl.substringAfter("base64,")
                    val bytes = Base64.decode(clean, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    localBitmap = bmp

                    val cacheDir = File(cacheDir, "photo_cache").apply { mkdirs() }
                    val file = File(cacheDir, "photo_${System.currentTimeMillis()}.jpg")
                    file.writeBytes(bytes)
                    localPhotoFile = file

                    withContext(Dispatchers.Main) {
                        binding.pbPhotoLoading.visibility = View.GONE
                        binding.ivFullPhoto.setImageBitmap(bmp)
                    }
                    return@launch
                }

                // 2. Local File
                if (photoUrl.startsWith("file://") || photoUrl.startsWith("/")) {
                    val file = File(photoUrl.removePrefix("file://"))
                    if (file.exists()) {
                        localPhotoFile = file
                        val bmp = BitmapFactory.decodeFile(file.absolutePath)
                        localBitmap = bmp
                        withContext(Dispatchers.Main) {
                            binding.pbPhotoLoading.visibility = View.GONE
                            binding.ivFullPhoto.setImageBitmap(bmp)
                        }
                        return@launch
                    }
                }

                // 3. Remote URL
                val bmp = Glide.with(this@PhotoViewerActivity)
                    .asBitmap()
                    .load(photoUrl)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .submit()
                    .get()

                localBitmap = bmp
                withContext(Dispatchers.Main) {
                    binding.pbPhotoLoading.visibility = View.GONE
                    binding.ivFullPhoto.setImageBitmap(bmp)
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    binding.pbPhotoLoading.visibility = View.GONE
                    Toast.makeText(this@PhotoViewerActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun sharePhoto() {
        val bmp = localBitmap ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val cacheDir = File(cacheDir, "shared_photos").apply { mkdirs() }
                val tempFile = File(cacheDir, "shared_${System.currentTimeMillis()}.jpg")
                FileOutputStream(tempFile).use { out ->
                    bmp.compress(Bitmap.CompressFormat.JPEG, 95, out)
                }

                val uri = FileProvider.getUriForFile(
                    this@PhotoViewerActivity,
                    "${applicationContext.packageName}.fileprovider",
                    tempFile
                )

                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "image/jpeg"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    if (photoCaption.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, photoCaption)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(intent, "Share Photo"))
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@PhotoViewerActivity, "Failed to share photo", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun savePhotoToGallery() {
        val bmp = localBitmap
        if (bmp == null) {
            Toast.makeText(this, "Photo is still loading...", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(this, "Saving photo to device gallery...", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val fileName = "Horizon_Photo_${System.currentTimeMillis()}.jpg"

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Horizon")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }

                    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { out ->
                            bmp.compress(Bitmap.CompressFormat.JPEG, 95, out)
                        }
                        values.clear()
                        values.put(MediaStore.Images.Media.IS_PENDING, 0)
                        contentResolver.update(uri, values, null, null)

                        withContext(Dispatchers.Main) {
                            Toast.makeText(this@PhotoViewerActivity, "Photo saved to Pictures/Horizon! 📸", Toast.LENGTH_LONG).show()
                        }
                    }
                } else {
                    val picturesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                    val destDir = File(picturesDir, "Horizon").apply { mkdirs() }
                    val destFile = File(destDir, fileName)
                    FileOutputStream(destFile).use { out ->
                        bmp.compress(Bitmap.CompressFormat.JPEG, 95, out)
                    }
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@PhotoViewerActivity, "Photo saved: ${destFile.name}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@PhotoViewerActivity, "Failed to save photo: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
