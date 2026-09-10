# Architecture & Low-Level Design Document (ALD)

**Project:** Horizon Chat (Native Android Cloud-Synced Messenger)  
**Version:** 2.0.0  

---

## 1. System Component Diagram

```
+----------------------------------------------------------------+
|                     Android Native Client                      |
|  +---------------------+   +-----------------+   +------------+|
|  |     ChatActivity    |   |   ChatAdapter   |   |  ChatModel ||
|  +----------+----------+   +--------+--------+   +-----+------+|
|             |                       |                  |       |
|             +-----------------------+------------------+       |
|                                     |                          |
|                       +-------------v---------------+          |
|                       |  OkHttp / Socket.IO Client  |          |
|                       +-------------+---------------+          |
+-------------------------------------|--------------------------+
                                      |
                          HTTPS / WSS | (Encrypted Transport TLS 1.3)
                                      v
+----------------------------------------------------------------+
|               Node.js + Socket.IO Backend Server               |
|  +--------------------+   +------------------+   +------------+|
|  |  Express REST API  |   | Socket Handshake |   | JWT Guard  ||
|  +----------+---------+   +--------+---------+   +-----+------+|
|             |                      |                   |       |
|             +----------------------+-------------------+       |
|                                    |                           |
|                       +------------v------------+              |
|                       |  In-Memory Socket Maps  |              |
|                       |   (userId -> socketId)  |              |
|                       +------------+------------+              |
+------------------------------------|---------------------------+
                                     |
                           TCP / TLS | (SQL Queries)
                                     v
+----------------------------------------------------------------+
|                  Neon Serverless PostgreSQL                    |
|  +--------------------------------+   +----------------------+ |
|  |         accounts Table         |   |    messages Table    | |
|  +--------------------------------+   +----------------------+ |
+----------------------------------------------------------------+
```

---

## 2. Sequence Diagrams

### 2.1 Real-Time Message Transmission & Read Acknowledgement

```
Client A (Sender)          Server (Node.js/DB)         Client B (Recipient)
       |                            |                            |
       |--- send_message ---------->|                            |
       |   {recipientId, text}      |                            |
       |                            |--- INSERT INTO messages -->|
       |                            |   (status = 'DELIVERED')   |
       |                            |                            |
       |<-- ack callback (SAVED) ---|--- new_message ----------->|
       |   (Render 1 tick)          |   (Render incoming msg)    |
       |                            |                            |
       |                            |<-- mark_read --------------|
       |                            |   {messageId, senderId}    |
       |                            |                            |
       |                            |--- UPDATE status = 'READ'->|
       |<-- message_read_ack -------|                            |
       |   (Render 2 amber ticks)   |                            |
```

### 2.2 Offline Recipient Flow (Telegram Style Persistence)

```
Client A (Sender)                   Server                Client B (Offline)
       |                              |                            |
       |--- send_message ------------>|                            |
       |                              |--- INSERT INTO messages    |
       |                              |    (status = 'SENT')       |
       |<-- ack (1 gray tick) --------|                            |
       |                              |                            x (Offline)
       |                              |                            .
       |                              |                            .
       |                              |<-- App Reopen / GET -------|
       |                              |    (/api/messages/:id)     |
       |                              |--- Return latest 25 rows ->|
       |                              |                            |
       |                              |<-- mark_read --------------|
       |<-- message_read_ack ---------|                            |
       |   (Turns to 2 amber ticks)   |                            |
```

---

## 3. Data Synchronization & Error Recovery

* **Network Reconnection:** Android Socket.IO automatically attempts exponential backoff reconnections upon network dropouts, resending stored JWT credentials in `handshake.auth`.
* **Duplicate Prevention:** Generated message IDs use PostgreSQL BIGSERIAL primary keys with compound cursor index `idx_messages_pair_cursor ON messages(sender_id, recipient_id, id DESC)`.
* **Unsent Message Buffer:** Unacknowledged outbound messages are retained in volatile UI state with an error retry indicator.
* **Cold Start Recovery:** Render containers that spin down during dormancy (15 min inactivity) are intercepted; the client renders a non-blocking top banner: *"Connecting to server instance..."* while waiting up to 45s.
