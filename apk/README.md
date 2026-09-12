# Horizon Chat — Android APK Release (v3.0.0 Phase 3)

### Direct Download
- [horizon-chat-v3.0.0.apk](./horizon-chat-v3.0.0.apk?raw=true) (8.09 MB)
- [app-debug.apk](./app-debug.apk?raw=true) (8.09 MB)

---

### Features in v3.0.0
1. **Cloudflare R2 Direct Media Storage**: 
   - Zero-server load binary uploads direct to Cloudflare R2 bucket.
   - Presigned upload pipeline supporting photos, videos, voice notes, and documents.
   - Permanent retention policy for all media files.
2. **Muted High-Contrast Theme**:
   - Modern dark UI palette: `#121214` background, `#1E1F24` surface, `#263352` sent bubbles, `#2A2B32` received bubbles.
   - High-contrast text `#F4F4F6` and refined accent buttons `#4E75F8`.
3. **View-Once Ephemeral Protection**:
   - Recipient sees single-view badge `(1)`.
   - Single-view ephemeral mode with permanent backend asset retention.
4. **Real-Time Delivery & Status Indicators**:
   - Vector XML ticks (`SENT` single tick, `DELIVERED` double tick, `READ` double ticks).
   - Real-time online presence and typing indicators.
5. **Background Message Queue & Offline Sync**:
   - Optimistic message delivery with background retry queue.

---

### Installation via ADB
Connect your Android phone via USB with USB debugging enabled, then run:

```bash
# Direct ADB install
adb install -r apk/horizon-chat-v3.0.0.apk

# Launch app directly
adb shell am start -n com.chatapp.horizon/.ui.AuthActivity
```

---

### Manual Phone Install
1. Download `horizon-chat-v3.0.0.apk` directly on your Android device from GitHub.
2. Tap the downloaded file in your Notification panel or File Manager.
3. If prompted, allow "Install Unknown Apps" from your browser or file manager.
4. Tap **Install** and open **Horizon Chat**.

