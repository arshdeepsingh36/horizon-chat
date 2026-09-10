# Horizon Chat — Native Android Project

This directory contains the production-grade **Native Android (Kotlin)** project for **Horizon Chat**, built adhering strictly to [rules.md](file:///f:/vibe%20code/chat/rules.md), [PRD.md](file:///f:/vibe%20code/chat/PRD.md), and [TRD.md](file:///f:/vibe%20code/chat/TRD.md).

---

## 1. Project Specifications

* **Target SDK:** 34 (Android 14)
* **Min SDK:** 24 (Android 7.0 Nougat)
* **Language:** Kotlin 1.9.22
* **JVM Target:** Java 17
* **View System:** Android ViewBinding & Material Components
* **Real-time Engine:** `io.socket:socket.io-client:2.1.0` (WebSocket)
* **Networking:** Retrofit 2.11.0 + OkHttp 3 (with 60-second cold start timeout)
* **Image Loading:** Glide 4.16.0 with Base64 Micro-Blur Thumbnail decoding
* **Storage:** EncryptedSharedPreferences (HS256 JWT persistence)

---

## 2. Directory Structure

```
android/
├── build.gradle                           # Project root build script
├── settings.gradle                        # Project settings & repositories
├── gradle.properties                     # JVM args & AndroidX flags
├── gradlew.bat                            # Windows Gradle wrapper script
├── gradle/wrapper/
│   └── gradle-wrapper.properties         # Gradle 8.5 distribution
└── app/
    ├── build.gradle                       # Module build configuration & dependencies
    ├── proguard-rules.pro                 # Socket.IO & Gson keep rules
    └── src/main/
        ├── AndroidManifest.xml            # Permissions & Activity declarations
        ├── java/com/chatapp/horizon/
        │   ├── models/
        │   │   ├── ChatMessage.kt        # Message entity matching TRD schema
        │   │   └── User.kt               # User, Auth, and Conversation models
        │   ├── network/
        │   │   └── ApiService.kt         # Retrofit API interface & ApiClient
        │   └── ui/
        │       ├── AuthActivity.kt       # Sign in & registration screen
        │       ├── ChatListActivity.kt   # Dashboard conversation list & user search
        │       ├── ChatListAdapter.kt   # Recycler adapter with unread badge & amber online dot
        │       ├── ChatActivity.kt       # 1-on-1 chat room with reverse cursor paging
        │       └── ChatAdapter.kt        # Chat bubbles, micro-blur preview, 200-item heap limit
        └── res/
            ├── layout/
            │   ├── activity_login.xml
            │   ├── activity_chat_list.xml
            │   ├── activity_chat.xml
            │   ├── item_conversation.xml
            │   ├── item_message_sent.xml
            │   ├── item_message_received.xml
            │   └── item_chat_sent_media.xml
            └── values/
                ├── colors.xml            # Sunset Glow & Twilight Ocean color tokens
                ├── strings.xml           # Localized strings
                └── themes.xml            # Horizon dark theme definition
```

---

## 3. How to Run in Android Studio

1. **Open Android Studio**.
2. Click **File -> Open...** and select the `f:\vibe code\chat\android` folder.
3. Android Studio will automatically sync the Gradle files using the bundled configuration.
4. **Configure Server IP**:
   - For **Android Emulator**: `ApiClient.BASE_URL = "http://10.0.2.2:5000"` (already configured as default).
   - For a **Physical Android Device** connected via USB / Wi-Fi: change `BASE_URL` in [ApiService.kt](file:///f:/vibe%20code/chat/android/app/src/main/java/com/chatapp/horizon/network/ApiService.kt) to your computer's local Wi-Fi IP (e.g. `http://192.168.1.46:5000`).
5. Click the green **Run** button (or press `Shift + F10`) to deploy to your device or emulator.

---

## 4. Building an APK via Command Line

Run from the `android` directory:
```powershell
./gradlew assembleDebug
```
The compiled debug APK will be generated at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Alternative 1-Tap Mobile Install (PWA)

If you wish to test Horizon Chat immediately on your Android phone without Android Studio:
1. Ensure your phone and computer are on the same Wi-Fi network.
2. Open Google Chrome on your Android phone.
3. Navigate to: `http://192.168.1.46:5173/`
4. Tap the three dots menu (⋮) in Chrome and select **"Add to Home screen"** or **"Install App"**.
5. Horizon Chat will install as a standalone native-looking Android app with full offline capabilities, splash icon, and edge-to-edge layout.
