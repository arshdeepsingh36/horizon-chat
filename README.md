# Horizon Chat — Native Android & Cloud-Synced Messenger

> **A real-time messaging application delivering the conversational ergonomics of WhatsApp backed by the permanent server-side cloud synchronization of Telegram, designed with Sunset Glow & Twilight Ocean aesthetics under a 100% Zero-Cost Free-Tier architecture.**

---

## 🌟 Highlights

* **Zero Identity Exposure:** No phone numbers, SMS OTP verifications, or email tracking. Authentication relies solely on unique alphanumeric handles and salted `bcrypt` password hashing.
* **Telegram-Style Permanent Cloud Persistence:** Zero message loss on device switch or cache clear. Conversations stream and synchronize through Neon Serverless PostgreSQL with local SQLite fallback.
* **WhatsApp Ergonomics:** Status ticks (`SENT` single tick, `DELIVERED` double tick, `READ` double amber tick `#FDE68A`), asymmetric message bubbles (Warm Coral `#EA580C` sent, Twilight Slate `#24334D` received), typing state, and presence indicators.
* **Reverse Cursor-Based Paging:** Reverse chronological paging (`?cursor=&limit=25`) prevents memory exhaustion and eliminates long load times on slow mobile connections.
* **20×20 Micro-Blur Previews:** Media attachments transmit a lightweight Base64 preview thumbnail (~200 bytes) with tap-to-download lazy loading and Cloudflare R2 zero-egress presigned direct uploads.
* **Cross-Platform Delivery:**
  - **Native Android App (Kotlin):** Target SDK 34, ViewBinding, Retrofit 2, Socket.IO, Glide.
  - **Modern Web App / PWA:** Standalone Android installable app with responsive chassis and desktop mode.

---

## 📱 Download Android APK (Latest v2.0.0)

Directly install Horizon Chat onto your Android phone:

* **[Download horizon-chat-v2.0.0.apk (7.85 MB)](./apk/horizon-chat-v2.0.0.apk?raw=true)**
* **[Download app-debug.apk (7.85 MB)](./apk/app-debug.apk?raw=true)**

### Quick ADB Install
```bash
adb install -r apk/horizon-chat-v2.0.0.apk
```

---

## 📁 Repository Structure

```
├── .gitignore                     # Git exclusion rules (node_modules, build artifacts, db, secrets)
├── .env.example                   # Environment variable template
├── README.md                      # Project documentation overview
├── PRD.md                         # Product Requirements Document (v2.0.0)
├── TRD.md                         # Technical Requirements Document (v2.0.0)
├── rules.md                       # Architectural & engineering guardrails
├── designsystem.md                # Sunset Glow & Twilight Ocean design tokens
├── ald.md                         # Architecture & Low-Level Design specifications
├── schema.sql                     # PostgreSQL production database migration
├── feedback_loop.ps1              # Continuous feedback loop runner (PowerShell)
├── feedback_loop.sh               # Continuous feedback loop runner (Bash)
│
├── server/                        # Node.js + Express + Socket.IO Backend
│   ├── package.json
│   ├── server.js                  # REST API, WebSocket gateway, R2 presigner
│   ├── db.js                      # Dual PostgreSQL / SQLite persistence engine
│   └── test_horizon_v2.js         # Automated end-to-end integration test suite
│
├── client/                        # React + Vite Web App & PWA
│   ├── index.html                 # PWA-enabled entry point with meta tags
│   ├── src/
│   │   ├── App.jsx                # Main device wrapper & state manager
│   │   ├── App.css / index.css    # Sunset Glow & Twilight Ocean design system
│   │   └── components/
│   │       ├── HorizonAuth.jsx    # Alphanumeric login/registration
│   │       ├── HorizonChatList.jsx# Conversations list with unread badges & search
│   │       ├── HorizonChatView.jsx# 1-on-1 chat with reverse cursor pagination
│   │       └── AndroidStatusBar.jsx
│   └── public/manifest.json       # PWA manifest for 1-tap Android home screen install
│
└── android/                       # Native Android Project (Kotlin & Android Studio)
    ├── build.gradle / settings.gradle
    ├── gradlew.bat
    └── app/
        ├── build.gradle           # Target SDK 34, Min SDK 24, Retrofit, Socket.IO, Glide
        └── src/main/
            ├── AndroidManifest.xml
            ├── java/com/chatapp/horizon/
            │   ├── models/        # ChatMessage, User, Conversation, Presign models
            │   ├── network/       # Retrofit ApiService & ApiClient
            │   └── ui/            # AuthActivity, ChatListActivity, ChatActivity, Adapters
            └── res/               # Layouts, Sunset Glow colors, themes
```

---

## 🚀 Quickstart Guide

### 1. Run the Backend
```bash
cd server
npm install
npm start
# Server listens on port 5000 (SQLite database auto-initialized)
```

### 2. Run the Web Application
```bash
cd client
npm install
npm run dev -- --host
# Accessible at http://localhost:5173/ or on your phone at http://<local-ip>:5173/
```

### 3. Run the Native Android App
1. Open **Android Studio**.
2. Select **File -> Open...** and choose the `android` folder.
3. Click **Run** (`Shift + F10`) to deploy to an emulator or USB-connected Android phone.

---

## 🧪 Automated Integrity & Guardrail Verification

Run the autonomous feedback loop script at any time to verify compilation, linting, guardrails, and runtime integration:

* **Windows PowerShell:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\feedback_loop.ps1
  ```
* **Linux / macOS / WSL:**
  ```bash
  chmod +x ./feedback_loop.sh
  ./feedback_loop.sh
  ```

---

## 📄 License
MIT License. Free for personal, commercial, and educational use.
