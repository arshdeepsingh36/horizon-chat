# Product Requirements Document (PRD)

**Project Name:** Horizon Chat (Native Android Cloud-Synced Messenger)  
**Document Version:** 2.0.0  
**Target Release:** Q4 2026  
**Target Platform:** Native Android (Min SDK 24 / Android 7.0+, Target SDK 34 / Android 14)  
**Infrastructure Budget:** $0.00 / Zero-Cost Operational Footprint (Forever Free Tiers)  

---

### 1. Executive Summary & Core Objective

Horizon Chat is a native Android real-time messaging application designed to deliver the conversational ergonomics of WhatsApp while implementing the server-side, multi-session cloud persistence of Telegram. It addresses two fundamental limitations of existing communication tools:

* **Identity Exposure:** Bypasses mandatory phone number bindings, SMS OTP verifications, and email confirmations by utilizing simple alphanumeric credentials.
* **Local Data Loss vs. Manual Backups:** Eliminates local-only storage or manual Google Drive/iCloud backup toggles by streaming, indexing, and preserving all message history on a persistent cloud database.

The application introduces a **Sunset Glow & Twilight Ocean** dark theme inspired by natural ambient light, paired with an on-demand, lazy-loaded attachment delivery system that protects bandwidth and client memory.

---

### 2. Strategic Pillars & Personas

#### Core Product Pillars
* **Instant Frictionless Access:** Users sign up with only an alphanumeric handle and passphrase, reaching the chat list in under 10 seconds.
* **Perpetual Cloud Sync:** History is stored in PostgreSQL and delivered on-demand via cursor pagination. Uninstalls, device wipes, or secondary logins automatically restore full conversation history.
* **Bandwidth & Memory Conservatism:** Chat history loads in chunks of 25 messages. Media files are stored as micro-blur previews (~200 bytes) and only downloaded upon an explicit user tap.
* **Cost Invariance ($0 Operational Cost):** Operates completely within generous free cloud tiers (Neon Serverless PostgreSQL, Render Web Services, and Cloudflare R2 / Google Drive API).

#### Target User Personas
* **The Privacy-Conscious Chatter:** Wants zero association between real-world identifiers (SIM card numbers, personal emails) and direct messaging accounts.
* **The Low-Bandwidth / Budget-Device User:** Cannot maintain hundreds of megabytes of media auto-downloading in the background, requiring fine-grained control over when media is fetched.
* **The Frequent Switcher:** Switches devices or clears application caches frequently without risking data loss or having to wait for manual backup restores.

---

### 3. Detailed Feature Specifications

#### 3.1 Authentication & Onboarding
* **Screen Identity:** `activity_login.xml`
* **Layout Structure:**
  * Clean, minimal screen featuring the Sunset Bulb vector asset at the top.
  * Two input fields: `Username` and `Password` with a primary high-contrast action button labeled `Sign In`.
  * A secondary, subtle text button positioned at the bottom of the screen: `"Don't have an account? Create one"`.
* **Behavior:**
  * Tapping `"Create one"` switches the state to Registration mode inline without navigating away or opening extra screens.
  * Validation: Usernames must be 3–32 alphanumeric characters (`[a-zA-Z0-9_]`). Passwords must be at least 6 characters.
  * Upon successful authentication, a JSON Web Token (JWT) is issued and saved securely in Android `EncryptedSharedPreferences`.
  * Subsequent app launches bypass this screen automatically if the JWT remains valid.

#### 3.2 Conversation List (Dashboard)
* **Screen Identity:** `activity_chat_list.xml`
* **Layout Structure:**
  * Top toolbar: Dusk Navy (`#162238`) with title `Messages` and an overflow action icon.
  * Body: `RecyclerView` displaying active conversations sorted by the timestamp of the latest interaction.
  * Bottom Right: Floating Action Button (FAB) in Sunset Glow Amber (`#F59E0B`) to initiate a new direct chat.
* **Conversation Cell Specs:**
  * Recipient circular profile avatar with placeholder initial.
  * Recipient username in Bold Off-White (`#FFFBEB`).
  * Last message snippet (truncated with ellipsis if length > 35 characters).
  * Relative timestamp (e.g., `12:45 PM`, `Yesterday`).
  * Real-time delivery ticks (Single gray, double gray, double blue) if the latest message was outbound.
* **New Conversation Modal:**
  * Tapping the FAB opens a search dialog where typing a username checks existence against `GET /api/users/lookup?username={query}`. Selecting a user immediately navigates to `ChatActivity`.

#### 3.3 Direct Chat Room & Message Engine
* **Screen Identity:** `activity_chat.xml`
* **Layout Structure:**
  * **Header Toolbar:** Back arrow, circular avatar, contact handle, and a dynamic presence subtitle (`online` in `#F59E0B` or `offline` in `#94A3B8`).
  * **Message Canvas:** `RecyclerView` utilizing `LinearLayoutManager` with `stackFromEnd = true`.
  * **Dock:** Horizontal input capsule with an Attachment clip button (left), multi-line expandable `EditText` (center), and an Amber Send FAB (right).
* **Delivery Status Lifecycle (WhatsApp Model):**
  * `SENT` (Single Gray Tick): Message successfully processed by the server and written to the database.
  * `DELIVERED` (Double Gray Tick): Socket packet acknowledged by the recipient's connected client.
  * `READ` (Double Amber/Blue Tick): Message view rendered inside the recipient's active viewport.

#### 3.4 Media Handling & Lazy-Load Blur Previews
* **Transmission Protocol:**
  * When a user attaches an image via the paperclip icon, the Android client generates a micro-thumbnail Base64 string (20×20 px Gaussian blur equivalent) and uploads the raw payload to the cloud storage bucket (Cloudflare R2 or Google Drive API).
  * The WebSocket payload sends the `attachment_url`, `thumbnail_blur`, and `file_size_bytes` alongside optional text captions.
* **Viewing Experience:**
  * The recipient's chat view renders the message bubble displaying only the blurred thumbnail overlay, the human-readable file size (e.g., `2.4 MB`), and a center download glyph (`ic_download`).
  * No external network download is initiated automatically.
  * Tapping the bubble transitions the download glyph into an indeterminate circular progress bar, streams the raw image from the CDN/cloud URL, and replaces the blurred canvas with the full-resolution image.

#### 3.5 Infinite Scroll & Pagination (Telegram Model)
* **Initial Feed Load:** Upon entering a conversation, the client fetches strictly the **25 most recent messages** (`GET /api/messages/:targetUserId?limit=25`).
* **Scroll-Up Cursor Pagination:**
  * The client monitors the top visible item position via an `OnScrollListener`.
  * When the user scrolls within 3 items of the top, the client issues a fetch using the oldest message ID currently held in memory as the cursor: `GET /api/messages/:targetUserId?cursor={oldestId}&limit=25`.
  * The resulting batch is prepended to the adapter, and layout scroll offset is anchored to prevent jarring view shifts.

---

### 4. Technical Specifications & Architecture

#### 4.1 System Components
```
+-------------------------------------------------------------------------+
|                          Android Native App                             |
|  - Retrofit/OkHttp (REST Auth & Cursor Paging)                          |
|  - Socket.IO-Client (Bidirectional Events & Read Receipts)             |
|  - EncryptedSharedPreferences (JWT Session Token)                       |
+-------------------+---------------------------------+-------------------+
                    |                                 |
        HTTPS / WSS |                     HTTPS / CDN | (On-Demand Media)
                    v                                 v
+-------------------+-------------+     +-------------+-------------------+
|     Node.js / Express Server    |     | Zero-Cost Cloud Media Storage   |
|   - Socket.IO Relay Engine      |     | - Cloudflare R2 (10 GB Free S3) |
|   - JWT Validation Middleware   |     |   OR Google Drive REST API      |
+-------------------+-------------+     +---------------------------------+
                    |
           pg Pool  | TLS (Port 5432)
                    v
+-------------------+-----------------------------------------------------+
|            Neon Serverless PostgreSQL (Permanent Cloud Sync)           |
|   - accounts (User identity & Bcrypt hashes)                            |
|   - messages (Indexed history, blur previews, statuses)                 |
+-------------------------------------------------------------------------+
```

#### 4.2 Data Models & Schema
```sql
-- Accounts (Strictly minimal credentials, zero phone/email metadata)
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- Messages (Full Telegram-style cloud storage)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_text TEXT,
    attachment_type VARCHAR(20) DEFAULT 'NONE', -- 'NONE', 'IMAGE', 'FILE', 'AUDIO'
    attachment_url TEXT,
    thumbnail_blur TEXT,                        -- Base64 micro-thumbnail
    file_size_bytes BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'SENT',          -- 'SENT', 'DELIVERED', 'READ'
    reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reverse chronological index for high-speed cursor pagination
CREATE INDEX IF NOT EXISTS idx_chat_cursor 
ON messages(sender_id, recipient_id, id DESC);
```

#### 4.3 WebSocket Event Interface
| Event Name | Direction | Payload Structure | Action / Handling |
| :--- | :--- | :--- | :--- |
| `send_message` | Client → Server | `{ recipientId: Int, text: String, attachmentUrl?: String, thumbnailBlur?: String, fileSize?: Long }` | Writes to PostgreSQL, returns ack callback with ID, relays to recipient. |
| `new_message` | Server → Client | Full `ChatMessage` record | Pushes to active adapter, triggers smooth scroll if at bottom. |
| `mark_read` | Client → Server | `{ messageId: Long, senderId: Int }` | Updates database status to `READ`, emits confirmation to sender. |
| `message_read_ack` | Server → Client | `{ messageId: Long }` | Modifies status tick in adapter from double gray to double amber. |
| `user_status_changed` | Server → Client | `{ userId: Int, status: 'online' \| 'offline' }` | Updates presence subtitle indicator in direct room toolbar. |

---

### 5. UI/UX Design System Specifications

The visual design language is anchored in the warm glow and deep shadows of the sunset bulb reference artwork:

| Design Token | Color Hex | Application in Android Client |
| :--- | :--- | :--- |
| `theme_bg_base` | `#0E1626` | Root window background across Login, List, and Chat activities. |
| `theme_surface` | `#162238` | Action bars, header toolbars, input dock, and bottom sheets. |
| `theme_bubble_sent` | `#EA580C` | Warm Coral Orange used for outgoing message cards. |
| `theme_bubble_received` | `#24334D` | Muted Twilight Slate used for incoming message cards. |
| `theme_accent_amber` | `#F59E0B` | Sunset Glow Amber used for Send FAB, online presence dot, and links. |
| `theme_text_primary` | `#FFFBEB` | Warm off-white for message copy and view headers. |
| `theme_text_muted` | `#94A3B8` | Cool horizon slate for timestamps, sizes, and field placeholders. |
| `theme_ticks_read` | `#FDE68A` | Light amber double ticks denoting read status on sent bubbles. |

#### Component Constraints:
* **Bubbles:** Maximum bubble width is constrained to `260dp` on mobile screens to ensure conversational alignment. Outgoing bubbles have a bottom-right radius of `2dp`; incoming bubbles have a bottom-left radius of `2dp`.
* **Input Dock:** Floats seamlessly above the system soft-keyboard utilizing standard Android window soft input flags (`adjustResize`).

---

### 6. Non-Functional Requirements & Free-Tier Operational Constraints

* **Cold-Start Resilience:** Free hosting platforms (Render Web Services) automatically spin down idle containers after 15 minutes of inactivity.
  * *Requirement:* The Android application must implement an interceptor that detects HTTP 503 / connection timeouts during initial app launch, rendering a non-blocking top banner: *"Connecting to server instance..."* while waiting up to 45 seconds for container spin-up.
* **Database Connection Pooling:** Neon serverless compute drops idle connections. The Node.js backend must utilize pooled connections (`pg.Pool`) configured with reasonable timeouts to avoid exhaustion.
* **Storage Footprint:** PostgreSQL is used strictly for relational metadata, accounts, and short strings. Binary data is never stored in the database; all image payloads are offloaded to Cloudflare R2 / Drive.
* **Security & Transport:** All communication must be strictly encrypted via TLS 1.3 (HTTPS and WSS). Passwords must never be stored in plain text and must be hashed using `bcrypt` with at least 10 salt rounds.

---

### 7. Release Milestones & Implementation Roadmap

```
[ Milestone 1: Core Cloud Infrastructure & Auth ]
  ├── Deploy Neon PostgreSQL instance and run schema migrations.
  ├── Deploy Node.js + Express backend to Render with JWT auth routes.
  └── Build Android LoginActivity with create-account state toggles.

[ Milestone 2: Direct Messaging & Sockets ]
  ├── Implement Socket.IO persistent connection lifecycle in Android.
  ├── Build ChatActivity toolbar, input dock, and Recycler adapters.
  └── Hook up real-time message sending, receiving, and tick updates.

[ Milestone 3: Infinite Scrolling & Lazy Media ]
  ├── Implement cursor-based pagination (/api/messages with ?cursor=).
  ├── Hook up RecyclerView scroll-up listener for older messages.
  └── Add Cloudflare R2 / Google Drive media upload with blurred placeholders.

[ Milestone 4: Polish, Theme & Hardening ]
  ├── Apply full Sunset Glow / Twilight Ocean palette across all components.
  ├── Configure Render wake-up handling and network retry policies.
  └── Perform end-to-end multi-device sync validation across uninstalls.
```
