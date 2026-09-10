# Horizon Chat — Android APK Release (v2.0.0 Phase 2)

### Direct Download
- [horizon-chat-v2.0.0.apk](./horizon-chat-v2.0.0.apk?raw=true) (7.85 MB)
- [app-debug.apk](./app-debug.apk?raw=true) (7.85 MB)

---

### Features in v2.0.0
1. **Real Media Attachments**: 
   - Real gallery photo picker with 1280px downscaling, progressive micro-blur previews, cloud storage (`/uploads/`), and high-res on-demand tap download.
   - Voice note records with audio player.
   - Live GPS location sharing with direct Google Maps intent.
   - Document sharing (PDF, images, etc.) with file metadata.
2. **View-Once Ephemeral Protection**:
   - Recipient sees single-view badge `(1)`.
   - Opens in hardware-protected full-screen viewer (`FLAG_SECURE` blocks screenshots & screen recordings).
   - Auto-expires to "Opened / Expired" on dismiss and deletes media from server.
3. **Profile Settings**:
   - Custom display name, bio status, profile avatar URL / camera upload.
   - In-app password change with current password verification.
4. **WhatsApp-Style Status Indicators**:
   - Clean vector XML ticks (`SENT` single tick, `DELIVERED` double tick, `READ` double amber tick `#FDE68A`) with no bounding boxes.
   - Real-time debounced typing indicators in header.
5. **Backend Cloud Sync**:
   - Render production cloud backend (`https://horizon-chat-1.onrender.com/`).
   - Telegram-style cloud persistence with Neon PostgreSQL / SQLite fallback.

---

### Installation via ADB
Connect your Android phone via USB with USB debugging enabled, then run:

```bash
# Direct ADB install
adb install -r apk/horizon-chat-v2.0.0.apk

# Launch app directly
adb shell am start -n com.chatapp.horizon/.ui.AuthActivity
```

---

### Manual Phone Install
1. Download `horizon-chat-v2.0.0.apk` directly on your Android device from GitHub.
2. Tap the downloaded file in your Notification panel or File Manager.
3. If prompted, allow "Install Unknown Apps" from your browser or file manager.
4. Tap **Install** and open **Horizon Chat**.
