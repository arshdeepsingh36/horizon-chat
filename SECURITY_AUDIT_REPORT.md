# 🛡️ Horizon Chat — Security Architecture & Audit Inventory

**Document Version:** 1.0  
**Application Version:** v3.2.2  
**Target Environment:** Node.js / Express / Socket.IO / SQLite / Android (Kotlin) / React (Vite)  
**Date Generated:** 2026-09-25  

---

## 1. System Architecture Overview

Horizon Chat is a real-time messaging application consisting of four core components:
1. **Node.js Express Backend** (`server/server.js`): REST API, JWT authentication, rate limiting, and business logic.
2. **Socket.IO Real-time Server**: Real-time bi-directional message dispatch, typing indicators, delivery/read receipts, reactions, and online status tracking.
3. **SQLite Database Layer** (`server/db.js`): User accounts, conversation mappings, message retention, and FCM/Push notification token registries.
4. **Clients**:
   - **Android Native App** (`android/`): Kotlin MVVM architecture, Retrofit REST client, Socket.IO Java client, FCM push listener.
   - **Web App** (`client/`): React Vite SPA with responsive modern Horizon & WhatsApp themes.

---

## 2. Authentication & Access Control

| Control | Implementation Details | Location |
| :--- | :--- | :--- |
| **Password Hashing** | `bcryptjs` with salt rounds = 10 | [`server/db.js`](file:///f:/vibe%20code/chat/server/db.js) |
| **Token Type** | JSON Web Token (JWT) signed with `JWT_SECRET` (HMAC SHA-256) | [`server/server.js`](file:///f:/vibe%20code/chat/server/server.js) |
| **Token Transport** | `Authorization: Bearer <token>` in HTTP headers; `auth.token` / `query.token` in Socket.IO handshake | Client & Server |
| **Brute Force Defense** | `express-rate-limit` on `/api/auth/*` (10 requests per 15 minutes per IP) | [`server/server.js`](file:///f:/vibe%20code/chat/server/server.js#L206) |
| **Socket Authentication** | Handshake middleware validates JWT before granting connection; socket bound to `socket.user` | [`server/server.js`](file:///f:/vibe%20code/chat/server/server.js#L916) |

---

## 3. REST API Endpoint Inventory

All endpoints marked **🔒 Protected** require a valid `Bearer <JWT>` in the `Authorization` header.

### 🔑 Authentication
| Method | Endpoint | Auth | Description & Security Controls |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public (Rate-limited) | Validates username uniqueness, hashes password with bcrypt. |
| `POST` | `/api/auth/login` | Public (Rate-limited) | Verifies bcrypt hash, returns JWT and user profile. |

### 👤 User & Profile Management
| Method | Endpoint | Auth | Description & Security Controls |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/users/me` | 🔒 Protected | Returns the authenticated user's profile. |
| `PUT` | `/api/users/profile` | 🔒 Protected | Updates display name, status text, avatar URL, or theme. |
| `PUT` | `/api/users/password` | 🔒 Protected | Requires old password verification before updating to new hash. |
| `GET` | `/api/users/lookup` | 🔒 Protected | Query parameter username lookup. |
| `GET` | `/api/users/lookup/:username` | 🔒 Protected | Exact username search (case-insensitive). |
| `GET` | `/api/users/search` | 🔒 Protected | Prefix/substring search for contacts. |
| `POST` | `/api/users/block` | 🔒 Protected | Adds target user ID to block list. |
| `POST` | `/api/users/unblock` | 🔒 Protected | Removes user ID from block list. |
| `POST` | `/api/users/report` | 🔒 Protected | Submits abuse report for moderation. |

### 💬 Messaging & Conversation History
| Method | Endpoint | Auth | Description & Security Controls |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/chats` | 🔒 Protected | Aggregates all recent active conversations for the authenticated user. |
| `GET` | `/api/messages/:targetUserId` | 🔒 Protected | Fetches paginated history between `req.user.id` and `targetUserId`. |
| `GET` | `/api/messages/unread` | 🔒 Protected | Returns count of unread messages per partner. |
| `GET` | `/api/messages/sync` | 🔒 Protected | Silent foreground fetch of missed messages since last timestamp. |
| `POST` | `/api/messages/batch-read` | 🔒 Protected | Bulk marks messages as READ for a given sender. |
| `POST` | `/api/messages/:id/react` | 🔒 Protected | Adds/toggles an emoji reaction on a message. |
| `POST` | `/api/messages/:id/view-once` | 🔒 Protected | Marks view-once media as viewed and invalidates media URL. |
| `DELETE` | `/api/messages/:id` | 🔒 Protected | Deletion verification: ensures requester is sender or recipient; handles "Delete for Everyone" timeframe. |
| `DELETE` | `/api/messages/conversations/:targetUserId` | 🔒 Protected | Clears one-sided conversation history for the requester. |

### 📎 Media & Cloudflare R2 Uploads
| Method | Endpoint | Auth | Description & Security Controls |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/upload/presigned-url` | 🔒 Protected | Generates S3/R2 presigned PUT URLs with expiration time and UUID key prefix. |
| `POST` | `/api/media/presign` | 🔒 Protected | Alternative presigned URL generator for mobile clients. |
| `POST` | `/api/media/upload` | 🔒 Protected | Multipart form upload fallback directly through server with size limits. |
| `PUT` | `/api/media/mock-upload/:key` | Dev/Fallback | In-memory/local upload mock for testing without AWS S3/R2 credentials. |

### 🔔 Push Notifications & Utilities
| Method | Endpoint | Auth | Description & Security Controls |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Server uptime and health probe. |
| `GET` | `/api/notifications/vapid-public-key` | Public | Returns Web Push VAPID public key. |
| `POST` | `/api/notifications/register-token` | 🔒 Protected | Associates FCM token / Web Push subscription to user ID. |
| `POST` | `/api/notifications/unregister-token` | 🔒 Protected | Removes token on logout or uninstallation. |
| `GET` | `/download/apk` | Public | Serves direct binary download for Horizon Chat Android APK. |

---

## 4. WebSocket Event Security Inventory

Socket connection is authenticated during handshake using `jwt.verify(token, JWT_SECRET)`. Unauthorized connections are immediately rejected.

| Event (Client $\to$ Server) | Payload Validation | Authorization & Room Boundary |
| :--- | :--- | :--- |
| `join_user` | `{ userId }` | Verifies `userId === socket.user.id`. Joins personal socket room. |
| `join_room` | `{ roomId, partnerId }` | Validates room membership. Joins pairwise room `chat_min_max`. |
| `send_message` | `{ recipientId, text, attachmentUrl, attachmentType, isViewOnce, replyToId }` | Checks block list, verifies recipient exists, persists to DB, dispatches to recipient sockets and fallback push. |
| `typing_start` / `typing_stop` | `{ recipientId }` | Dispatches exclusively to the target recipient. |
| `mark_delivered` / `message_delivered` | `{ messageId, senderId }` | Updates message status in DB to `DELIVERED`, emits ACK to sender. |
| `mark_read` / `message_read` | `{ messageId, senderId }` | Updates DB status to `READ`, emits blue-tick update to sender. |
| `mark_conversation_read` | `{ partnerId }` | Marks all incoming unread messages from partner as `READ`. |
| `message_reaction` / `toggle_reaction` | `{ messageId, emoji, recipientId }` | Validates message ownership/room, persists reaction set in DB, broadcasts to conversation. |
| `mark_media_viewed` | `{ messageId, senderId }` | Validates recipient; marks media viewed and purges URL if view-once. |
| `delete_message` | `{ messageId, deleteForEveryone }` | Checks 60m creation / 7m seen constraints; marks message deleted or removes record. |
| `pin_message` | `{ messageId, recipientId, isPinned }` | Checks sender or recipient relationship before updating pinned status. |

---

## 5. Database & Data Protection

- **Database Engine:** SQLite (stored in `server/horizon_chat.db` or configured path).
- **Query Parameterization:** All SQL queries in [`server/db.js`](file:///f:/vibe%20code/chat/server/db.js) use parameterized statements (`?` placeholders via `better-sqlite3` or `sqlite3`) to prevent SQL Injection.
- **View-Once Media Lifecycle:**
  1. Media uploaded to R2/Cloudflare with random UUID keys.
  2. Flagged `is_view_once = 1` in database.
  3. When opened by recipient, `mark_media_viewed` / `POST /api/messages/:id/view-once` sets `viewed = 1` and overwrites `attachment_url = NULL` in DB to prevent subsequent fetches.
- **Data Deletion:**
  - `delete_for_everyone`: Overwrites message content with `""` and sets `deleted_for_everyone = 1` so foreign key references and timestamps remain consistent without exposing deleted payload.

---

## 6. Push Notification Security & Privacy

- **Firebase Cloud Messaging (FCM):** Server integrates Google Service Account credentials via `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`.
- **Payload Privacy Strategy:**
  - Background notification dispatch sets `body: "Update....."` for privacy while keeping title as sender name.
  - Data payload carries internal message IDs so client can trigger a secure authenticated sync upon foregrounding.

---

## 7. Client Security (Android & Web)

### Android Native
- **Storage:** Sensitive user session data (JWT token, user ID) stored in private `SharedPreferences` / `EncryptedSharedPreferences`.
- **Network Security:** Strict HTTPS / WSS communication in production. Cleartext traffic disabled by default.
- **ProGuard / R8:** Code obfuscation and optimization enabled for release builds in [`android/app/build.gradle`](file:///f:/vibe%20code/chat/android/app/build.gradle).

### Web Client
- **XSS Protection:** React JSX automatic string escaping prevents HTML/script injection in message rendering.
- **Token Management:** JWT kept in `localStorage` / memory state; cleared on explicit logout or 401 Unauthorized responses.

---

## 8. Security Audit & Penetration Testing Checklist

Use this checklist during manual and automated security assessments:

| Check Category | Test Case / Vector | Expected Outcome | Status |
| :--- | :--- | :--- | :---: |
| **Authentication** | Attempt registration with empty/weak credentials | Rejection with 400 Bad Request | ⬜ |
| **Authentication** | Brute-force `/api/auth/login` | 429 Too Many Requests triggered | ⬜ |
| **Authorization (IDOR)** | Request `/api/messages/:targetUserId` with forged JWT | 401 Unauthorized / 403 Forbidden | ⬜ |
| **Authorization (IDOR)** | Attempt to delete another user's message as "Delete for Everyone" after time limit | 403 Forbidden error returned | ⬜ |
| **Injection** | Send `' OR '1'='1` in login/search fields | Parameterized query handles input as literal | ⬜ |
| **XSS** | Send `<script>alert(1)</script>` in chat message text | Rendered as text node, not executed | ⬜ |
| **WebSocket** | Emit `send_message` with spoofed `senderId` | Ignored; server derives sender exclusively from authenticated socket token | ⬜ |
| **Media Security** | Attempt to view a `view-once` media link repeatedly after viewed | Media URL erased from DB and returns 404/Null | ⬜ |
| **Environment** | Check `.env` and secret key leakage in git repo | All private credentials and `.env` ignored in `.gitignore` | ⬜ |

---

## 9. Key Source Files for Audit

- **Core Server & Routes:** [`server/server.js`](file:///f:/vibe%20code/chat/server/server.js)
- **Database Schema & Queries:** [`server/db.js`](file:///f:/vibe%20code/chat/server/db.js)
- **Web Chat View & Sanitization:** [`client/src/components/HorizonChatView.jsx`](file:///f:/vibe%20code/chat/client/src/components/HorizonChatView.jsx)
- **Android Network Layer:** [`android/app/src/main/java/com/chatapp/horizon/network/`](file:///f:/vibe%20code/chat/android/app/src/main/java/com/chatapp/horizon/network/)
- **Android Manifest & Permissions:** [`android/app/src/main/AndroidManifest.xml`](file:///f:/vibe%20code/chat/android/app/src/main/AndroidManifest.xml)
