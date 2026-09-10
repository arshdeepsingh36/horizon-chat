# Technical Requirements Document (TRD)

**Project Name:** Horizon Chat (Native Android Cloud-Synced Messenger)  
**Document Version:** 2.0.0  
**Target Release:** Q4 2026  
**Target Platform:** Native Android (Kotlin, Min SDK 24 / Target SDK 34)  
**Infrastructure Cost:** $0.00 / Zero-Cost Operational Tier  

---

### System Architecture & Technology Stack

* **Mobile Client:** Native Android written in Kotlin using ViewBinding, Kotlin Coroutines, Retrofit 2 + OkHttp 3, and `socket.io-client`.
* **Application & Real-Time Gateway:** Node.js + Express + Socket.IO server deployed as a free containerized web service on Render.
* **Relational Identity & Chat Engine:** Neon Serverless PostgreSQL (free tier compute with auto-sleep and 0.5 GiB persistent storage).
* **Media & Attachment Storage:** Cloudflare R2 (10 GB free S3-compatible tier with zero egress fees) or Google Drive REST API for larger attachments.
* **Authentication Token Store:** EncryptedSharedPreferences on Android holding stateless HMAC-SHA256 signed JSON Web Tokens (JWT).

```
+-----------------------------------------------------------------------------------+
|                               Android Client                                      |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  |   AuthActivity     |  |   ChatListActivity   |  |       ChatActivity        |  |
|  +---------+----------+  +----------+-----------+  +-------------+-------------+  |
|            |                        |                            |                |
|            +-------------------+----+----------------------------+                |
|                                |                                                  |
|                   +------------v-------------+                                    |
|                   |  Retrofit (REST Engine)  |                                    |
|                   |  Socket.IO (WSS Engine)  |                                    |
|                   +------------+-------------+                                    |
+--------------------------------|--------------------------------------------------+
                                 |
                     HTTPS / WSS | (TLS 1.3 Encryption)
                                 v
+--------------------------------+--------------------------------------------------+
|                            Backend Gateway (Node.js)                              |
|  +---------------------+  +------------------------+  +------------------------+  |
|  |  Express REST API   |  |   Socket.IO Router     |  | In-Memory Socket Maps  |  |
|  |  (Auth, Pagination) |  | (Delivery, Tick State) |  | (userId -> socketId)   |  |
|  +----------+----------+  +-----------+------------+  +-----------+------------+  |
+-------------|-------------------------|---------------------------|---------------+
              |                         |                           |
              +--------------------+----+---------------------------+
                                   |
                         TCP / TLS | (Pooled Connections)
                                   v
+----------------------------------+------------------------------------------------+
|                         Neon Serverless PostgreSQL                                |
|  +-------------------------------------+  +------------------------------------+  |
|  |           accounts Table            |  |          messages Table            |  |
|  |  (Username, Passphrase Hash, Meta)  |  |  (History, URLs, Blurhash, Status) |  |
|  +-------------------------------------+  +------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

### Database Schema & Query Optimization

Run the following SQL migrations to instantiate the production tables in PostgreSQL:

```sql
-- 1. Accounts Table (Minimalist Auth; zero phone/email collection)
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- 2. Messages Table (Telegram-style permanent cloud record)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_text TEXT,
    attachment_type VARCHAR(20) DEFAULT 'NONE', -- 'NONE', 'IMAGE', 'FILE', 'AUDIO'
    attachment_url TEXT,
    thumbnail_blur TEXT,                        -- Base64 micro-preview (~200 bytes)
    file_size_bytes BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'SENT',          -- 'SENT', 'DELIVERED', 'READ'
    reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compound index for rapid reverse-chronological cursor queries
CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
ON messages(sender_id, recipient_id, id DESC);
```

---

### REST API Contracts

**1. Register User**
* **Endpoint:** `POST /api/auth/register`
* **Request Payload:**
```json
{
  "username": "arsh_dev",
  "password": "SecurePassword123"
}
```
* **Response (201 Created):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 14,
    "username": "arsh_dev"
  }
}
```

**2. Authenticate / Login**
* **Endpoint:** `POST /api/auth/login`
* **Request Payload:**
```json
{
  "username": "arsh_dev",
  "password": "SecurePassword123"
}
```
* **Response (200 OK):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 14,
    "username": "arsh_dev"
  }
}
```

**3. Cursor-Paginated Chat History**
* **Endpoint:** `GET /api/messages/:targetUserId?cursor={messageId}&limit=25`
* **Headers:** `Authorization: Bearer <jwt_token>`
* **Response (200 OK):**
```json
[
  {
    "id": 10452,
    "sender_id": 14,
    "recipient_id": 8,
    "message_text": "Did you test the new migration?",
    "attachment_type": "NONE",
    "attachment_url": null,
    "thumbnail_blur": null,
    "file_size_bytes": 0,
    "status": "READ",
    "created_at": "2026-09-10T08:24:12.000Z"
  },
  {
    "id": 10453,
    "sender_id": 8,
    "recipient_id": 14,
    "message_text": "Here is the schema trace",
    "attachment_type": "IMAGE",
    "attachment_url": "https://pub-r2.storage.cloud/schema_trace.png",
    "thumbnail_blur": "data:image/png;base64,iVBORw0KGgo...",
    "file_size_bytes": 2457812,
    "status": "DELIVERED",
    "created_at": "2026-09-10T08:25:01.000Z"
  }
]
```

**4. User Lookup**
* **Endpoint:** `GET /api/users/lookup?username={query}`
* **Headers:** `Authorization: Bearer <jwt_token>`
* **Response (200 OK):** `{ "id": 8, "username": "sarah_99" }`

---

### Real-Time WebSocket Protocol

**1. Handshake & Authentication**
* **Transport:** `WSS` (Secure WebSocket)
* **Auth Payload:** `{ auth: { token: "jwt_token_string" } }`
* **Behavior:** Handshake rejected with `401 Unauthorized` if token verification fails. Once verified, the server caches the user in `onlineUsers.set(userId, socket.id)` and broadcasts `user_status_changed` (`online`).

**2. Outbound Message Event**
* **Event Name:** `send_message`
* **Payload:**
```json
{
  "recipientId": 8,
  "text": "Check this file",
  "attachmentType": "IMAGE",
  "attachmentUrl": "https://pub-r2.storage.cloud/file.png",
  "thumbnailBlur": "data:image/png;base64,...",
  "fileSizeBytes": 1450200,
  "replyToId": null
}
```
* **Execution Flow:**
  * Server writes to PostgreSQL with status `'DELIVERED'` (if recipient is online) or `'SENT'` (if offline).
  * Server calls the client acknowledgement callback returning the saved database record with its generated `id`.
  * Server emits `new_message` to the recipient socket ID.

**3. Read Receipt Acknowledgement**
* **Event Name:** `mark_read`
* **Payload:** `{ "messageId": 10453, "senderId": 14 }`
* **Execution Flow:**
  * Server updates database record: `UPDATE messages SET status = 'READ' WHERE id = 10453`.
  * Server emits `message_read_ack` to the sender's active socket: `{ "messageId": 10453 }`.
  * Sender updates view bubble ticks to double amber (`#FDE68A`).

---

### Android Client Technical Specifications

**1. Dependencies & Versions (`build.gradle`)**
* `io.socket:socket.io-client:2.1.0` (WebSocket communication)
* `com.squareup.retrofit2:retrofit:2.11.0` & `converter-gson:2.11.0` (REST & Serialization)
* `com.squareup.okhttp3:logging-interceptor:4.12.0` (HTTP diagnostics)
* `androidx.security:security-crypto:1.1.0-alpha06` (EncryptedSharedPreferences)
* `com.github.bumptech.glide:glide:4.16.0` (Media decoding and memory caching)

**2. Threading & Concurrency Model**
* **Network Operations:** Executed strictly within `Dispatchers.IO` using Kotlin Coroutines.
* **Socket Events:** `mSocket.on(...)` callbacks are marshaled to `Dispatchers.Main` via `runOnUiThread { ... }` or `withContext(Dispatchers.Main)` before modifying adapter dataset collections.
* **Memory Management:** Maximum in-memory message history per conversation is bounded to 200 items in `ChatAdapter`. Older items past the limit are evicted from memory to preserve heap on low-spec hardware.

**3. Pagination & Scroll Mechanics**
* `LinearLayoutManager.stackFromEnd = true` keeps the view pinned to incoming live messages at the bottom.
* The `OnScrollListener` inspects `findFirstVisibleItemPosition()`. When the index drops below 3, an asynchronous fetch query loads the next page using the first item's ID as the `cursor`.
* `adapter.notifyItemRangeInserted(0, newPage.size)` prepends messages smoothly without jumping the user's viewport.

---

### Media Pipeline & Blur Preview Flow

```
+-----------------------------------------------------------------------------------+
|                                Media Upload Flow                                  |
|                                                                                   |
| 1. User picks image -> Compress to WebP / JPEG (Target max: 1920x1080)            |
| 2. Android client scales down a copy to 20x20 px bitmap -> Base64 encode         |
| 3. Android client uploads high-res binary to Cloudflare R2 / Drive API via HTTP   |
| 4. Socket payload emitted containing { attachmentUrl, thumbnailBlur, fileSize }   |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                               Media Display Flow                                  |
|                                                                                   |
| 1. Recipient receives `new_message` containing thumbnailBlur Base64 string        |
| 2. Base64 is decoded into a low-res Bitmap -> Blurred render in ImageView         |
| 3. Centered overlay displays "Tap to Download" and exact file size                |
| 4. User Tap -> Stream full file via Glide -> Hide overlay on completion           |
+-----------------------------------------------------------------------------------+
```

---

### Free-Tier Hosting & Operational Hardening

* **Cold Start Mitigation:** Render free web services shut down after 15 minutes of inactivity. The Android client implements an OkHttp connection timeout set to 60 seconds with an automatic 3-stage exponential backoff retry.
* **Connection Re-establishment:** If mobile data switches between Wi-Fi and Cellular, Socket.IO client automatically triggers reconnection logic, re-passes the stored JWT in `handshake.auth`, and requests all unread messages since the latest cached message ID.
* **PostgreSQL Connection Safeguards:** Neon serverless compute drops idle connections. The Node.js server maintains an active connection pool with `max: 10`, `idleTimeoutMillis: 30000`, and `connectionTimeoutMillis: 5000` to prevent socket hanging.
