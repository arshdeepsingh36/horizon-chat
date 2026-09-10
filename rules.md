# Engineering & Architectural Rules Document (rules.md)
## Project: Horizon Chat (Native Android + Cloud Persistence)
**Document Version:** 1.0.0  
**Scope:** Strict Code, Architecture, Performance, and Security Directives  

---

## 1. Zero-Cost Infrastructure & Resource Guardrails

* **Cost Enforcement:** Every operational component must strictly remain within zero-cost free-tier boundaries (Render Free Web Service, Neon Serverless PostgreSQL, Cloudflare R2 / Google Drive API). No billable APIs or paid add-ons are permitted.
* **Server Cold-Start Rule:** Render instances sleep after 15 minutes of inactivity. The Android client must configure network timeouts to 60 seconds and surface a non-blocking connection banner without crashing or locking the UI thread.
* **Database Connection Pooling:** Backend code must use pooled connections (`pg.Pool`) configured with reasonable timeouts to prevent connection exhaustion during Neon compute wake-up cycles.
* **Zero Local-Only Loss:** No conversation history may exist exclusively on local device storage. Every chat interaction must synchronize through the PostgreSQL cluster (Telegram persistence model).

---

## 2. Authentication & Privacy Directives

* **Minimal Identity Surface:** Never collect, prompt, or store phone numbers, SMS verification tokens, emails, or OAuth profiles. User accounts must rely strictly on unique `username` handles and hashed passwords.
* **Credential Protection:** Passwords must be hashed using `bcrypt` with at least 10 salt rounds prior to persistence. Plaintext passwords must never appear in server logs, HTTP responses, or error traces.
* **Stateless Tokens:** Authentication must be managed strictly via HMAC-SHA256 (HS256) JSON Web Tokens (JWT) passing user identity metadata. Android clients must store tokens securely using `EncryptedSharedPreferences`.

---

## 3. Data Flow & Pagination Constraints

* **Reverse Cursor-Based Paging:** Never fetch entire conversation histories at once. Initial chat screen entry must load strictly the 25 most recent messages. Older messages must only be fetched upon scrolling near the top using message ID cursors.
* **No Database Blob Storage:** Never write raw media files, base64 payloads, or binary blobs directly into PostgreSQL. All media must reside in Cloudflare R2 or Google Drive, with PostgreSQL storing only the resulting URL and metadata.
* **Blurhash / Micro-Preview Mandatory:** Media attachments must generate and transmit a micro-preview thumbnail (20x20 base64 bitmap) alongside file metadata. The client must never auto-download full-resolution files until the user explicitly taps to download.

---

## 4. UI/UX & Theming Standards

* **Palette Adherence:** UI components must strictly adhere to the Sunset Glow and Twilight Ocean palette:
  * Background: `#0E1626`
  * Surface/Toolbars: `#162238`
  * Outgoing message cards: Warm Coral `#EA580C`
  * Incoming message cards: Twilight Slate `#24334D`
  * Action items/FABs: Sunset Glow Amber `#F59E0B`
* **Tick State Consistency:** Outbound messages must accurately reflect status transitions via visual indicators: single gray tick (`SENT`), double gray tick (`DELIVERED`), and double amber tick (`READ`).
* **Keyboard Handling:** The bottom input dock must float naturally above the Android soft keyboard utilizing `adjustResize` without hiding the latest messages.

---

## 5. Mobile Client Concurrency & Memory Rules

* **Thread Concurrency:** All network I/O and socket setup must run within `Dispatchers.IO`. Any UI mutation, adapter notification, or scroll positioning must be dispatched on `Dispatchers.Main`.
* **Heap Protection:** Recycler adapters must cap in-memory chat items to 200 elements, recycling or dropping distant cached views to avoid out-of-memory (OOM) exceptions on low-tier Android devices.
* **Socket Lifecycle:** The socket connection must cleanly detach listeners and disconnect on `Activity.onDestroy()` to prevent memory leaks.
