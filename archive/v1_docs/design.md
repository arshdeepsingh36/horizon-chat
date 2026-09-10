# UI/UX Design System & Specification Document
## Project: Ephemeral Peer-to-Peer Chat Application ("Stitch to Design")
**Document Version:** 1.0.0  
**Status:** Approved for Implementation  
**Target Platforms:** Responsive Web (Mobile-first), Progressive Web App (PWA), React Native (iOS & Android)

---

## 1. Executive Summary & Design Vision

### 1.1 Product Purpose
The Ephemeral Peer-to-Peer Chat Application is built around strict privacy, immediate connectivity, and zero persistent data footprints. Unlike conventional messaging platforms (WhatsApp, Telegram, Signal) that prioritize persistent cloud archives, syncing, and account recovery, this product treats every communication exchange as temporary, volatile, and localized strictly to memory (RAM).

### 1.2 Core Design Principles
1. **Visual Ephemerality:** Every component communicates transience. Visual cues (e.g., absence of message persistence indicators, clean reset triggers, transient pulse badges) remind users that no historical footprint exists once the session terminates.
2. **Frictionless Entry:** Zero-data onboarding. Users require only a self-chosen `username` and `password`. No phone numbers, email confirmations, SMS OTPs, or third-party OAuth providers.
3. **Information Density & Speed:** Lightweight system fonts, CSS-only animations, and zero heavy image assets ensure rapid load times even under low-bandwidth conditions or when cold-starting free-tier cloud instances.
4. **Instant Peer Awareness:** High-visibility presence indicators reflect socket status in real time so users immediately know whether the peer is reachable before sending ephemeral messages.

---

## 2. Design System Tokens

### 2.1 Color Palette

The interface defaults to a high-contrast dark aesthetic (Deep Slate & Charcoal) engineered for focus, low OLED battery draw, and modern privacy-first aesthetics.

| Token Name | Hex Value | RGB / HSL | Usage Description |
| :--- | :--- | :--- | :--- |
| `color-bg-base` | `#0B1120` | `rgb(11, 17, 32)` | Application canvas background (Root container) |
| `color-bg-surface` | `#1E293B` | `rgb(30, 41, 59)` | Cards, input fields, header bar, action sheets |
| `color-bg-elevated` | `#334155` | `rgb(51, 65, 85)` | Modal dialogs, dropdowns, incoming chat bubbles |
| `color-border-subtle` | `#334155` | `rgb(51, 65, 85)` | Inactive input borders, card outlines |
| `color-border-focus` | `#38BDF8` | `rgb(56, 189, 248)` | Active input borders, focus rings |
| `color-brand-primary` | `#0284C7` | `rgb(2, 132, 199)` | Outgoing message bubbles, primary action buttons |
| `color-brand-accent` | `#38BDF8` | `rgb(56, 189, 248)` | Interactive links, active tab underlines, icons |
| `color-text-primary` | `#F8FAFC` | `rgb(248, 250, 252)` | Primary text, titles, user input |
| `color-text-secondary`| `#94A3B8` | `rgb(148, 163, 184)` | Placeholder text, secondary metadata, timestamps |
| `color-status-online` | `#22C55E` | `rgb(34, 197, 94)` | Active socket indicator dot |
| `color-status-offline`| `#64748B` | `rgb(100, 116, 139)` | Inactive / disconnected indicator dot |
| `color-danger-base` | `#F43F5E` | `rgb(244, 63, 94)` | Wipe session button, disconnect alert |
| `color-danger-bg` | `#4C0519` | `rgb(76, 5, 25)` | Critical warning card background |

### 2.2 Typography Hierarchy

Utilizes system-native fonts to avoid render-blocking network requests and layout shifts.

* **Font Stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
* **Monospace Stack (IDs/Tokens):** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

| Style Name | Font Size | Line Height | Weight | Letter Spacing | Target Elements |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display-lg` | 28px (1.75rem) | 36px | 700 (Bold) | -0.02em | Welcome title, splash headlines |
| `heading-md` | 20px (1.25rem) | 28px | 600 (Semi-bold) | -0.01em | App bar title, modal headers |
| `body-base` | 15px (0.9375rem)| 22px | 400 (Regular) | 0.00em | Chat bubble text, input text |
| `body-sm` | 13px (0.8125rem)| 18px | 400 (Regular) | 0.00em | Form field labels, helper alerts |
| `caption` | 11px (0.6875rem)| 14px | 500 (Medium) | +0.02em | Timestamps, status tags |
| `button-text` | 14px (0.875rem) | 20px | 600 (Semi-bold) | +0.01em | CTA buttons, interactive pills |

### 2.3 Spacing & Layout Grid
* **Base Grid Unit:** 4px
* **Spacing Scale:**
  * `space-1`: 4px
  * `space-2`: 8px
  * `space-3`: 12px
  * `space-4`: 16px
  * `space-5`: 20px
  * `space-6`: 24px
  * `space-8`: 32px
  * `space-12`: 48px
* **Border Radii:**
  * `radius-sm`: 4px (Chips, tags)
  * `radius-md`: 8px (Form inputs, action buttons)
  * `radius-lg`: 16px (Card containers, message bubbles)
  * `radius-full`: 9999px (Presence dots, rounded pill buttons)

---

## 3. Screen Flows & Wireframe Specifications

### 3.1 Flow Overview
```
[ App Launch / Landing ]
          │
          ▼
┌───────────────────────────────────┐
│ Screen 1: Auth & Handshake        │
│ • Tabs: Login / Create Identity   │
│ • No Email / Phone required       │
│ • Ephemeral session disclaimer    │
└─────────────────┬─────────────────┘
                  │ (Authentication Success -> JWT in Memory)
                  ▼
┌───────────────────────────────────┐
│ Screen 2: Ephemeral Direct Room   │
│ • Top Bar: Partner Selector & Ping│
│ • Message Stream (RAM only)       │
│ • Bottom Dock: Message Input Box  │
└─────────────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
[ Cold Start Loader ]  [ Wipe & Terminate Session ]
```

---

### 3.2 Screen 1: Authentication & Onboarding

#### Visual Layout & Stitch Wireframe
```text
+-------------------------------------------------------------+
|                                                             |
|                         [ ❖ LOGO ]                          |
|                       EPHEMERAL CHAT                        |
|             Zero-Footprint In-Memory Messaging             |
|                                                             |
|     +-------------------------------------------------+     |
|     |  [  Sign In  ]       |       Create Account     |     |
|     +-------------------------------------------------+     |
|     |                                                 |     |
|     |  Username                                       |     |
|     |  +-------------------------------------------+  |     |
|     |  | @alex_dev                                 |  |     |
|     |  +-------------------------------------------+  |     |
|     |                                                 |     |
|     |  Passphrase                                     |     |
|     |  +-------------------------------------------+  |     |
|     |  | ••••••••••••••••                          |  |     |
|     |  +-------------------------------------------+  |     |
|     |                                                 |     |
|     |  +-------------------------------------------+  |     |
|     |  |             ENTER SECURE ROOM             |  |     |
|     |  +-------------------------------------------+  |     |
|     |                                                 |     |
|     |  ⚠ Notice: Messages are held in RAM only.      |     |
|     |    Closing this window permanently deletes all  |     |
|     |    conversation records.                        |     |
|     +-------------------------------------------------+     |
|                                                             |
+-------------------------------------------------------------+
```

#### Detailed Element Specifications
1. **Logo & Header:** Minimalist geometric glyph with title in `display-lg`. Subtitle in `body-sm` (`color-text-secondary`).
2. **Segmented Switcher:** 2-tab switch between "Sign In" and "Create Account" (`color-bg-surface` background, `color-brand-accent` active underline).
3. **Form Fields:**
   - Single-line inputs (`radius-md`, 48px height, `color-bg-base` fill).
   - Auto-capitalization: `none`, Auto-correct: `off`, Spellcheck: `false`.
4. **Primary CTA:**
   - 48px height button with `color-brand-primary` fill and bold white text.
   - Hover/Active State: Lightens to `#0284C7` with a subtle elevation transition.
5. **Disclaimer Card:**
   - Bordered alert box with `color-danger-bg` background and `color-text-secondary` typography emphasizing zero disk backups.

---

### 3.3 Screen 2: Real-Time Ephemeral Room

#### Visual Layout & Stitch Wireframe
```text
+-------------------------------------------------------------+
|  @me: [john]    Chatting with: [@sarah ● ONLINE]   [🗑 WIPE]  |
+-------------------------------------------------------------+
|                                                             |
|  [System]: Session established. Zero data recorded to disk. |
|                                                             |
|                   Hey Sarah! Did you review the PR?         |
|                                             12:41 PM  ✓✓    |
|                                         +------------------+|
|                                         |  Outgoing Bubble ||
|                                         +------------------+|
|  +------------------+                                       |
|  |  Incoming Bubble |                                       |
|  +------------------+                                       |
|  Yes! Looks great. Merging now.                             |
|  12:42 PM                                                   |
|                                                             |
|                                                             |
+-------------------------------------------------------------+
|  +-----------------------------------------+  +----------+  |
|  | Type an ephemeral message...            |  |  SEND ➤  |  |
|  +-----------------------------------------+  +----------+  |
+-------------------------------------------------------------+
```

#### Detailed Element Specifications
1. **Header App Bar:**
   - **Left:** Current authenticated user handle (`@john`) in monospace badge.
   - **Center:** Target user handle input / display with integrated live status dot:
     - Green (`#22C55E`): Recipient socket active and listening.
     - Amber (`#F59E0B`): Server connecting / waking up.
     - Gray (`#64748B`): Recipient disconnected (messages dropped).
   - **Right:** Critical destructive CTA (`Wipe Session`) styled in `color-danger-base`.
2. **Message Stream Container:**
   - **Vertical Flow:** Pinned to bottom, smooth scrolling on new message entry.
   - **Incoming Message Bubble:**
     - Left-aligned.
     - Background: `color-bg-elevated` (`#334155`).
     - Border radius: `16px 16px 16px 2px` (speech-tail accent on bottom-left).
     - Text: `color-text-primary`.
   - **Outgoing Message Bubble:**
     - Right-aligned.
     - Background: `color-brand-primary` (`#0284C7`).
     - Border radius: `16px 16px 2px 16px` (speech-tail accent on bottom-right).
     - Text: `#FFFFFF`.
   - **Metadata Footer:** Timestamp in `caption` font with subtle read tick.
3. **Input Dock:**
   - Fixed to bottom viewport edge (supports mobile keyboard safe areas).
   - Dynamic auto-expanding text input with placeholder: `Type an ephemeral message...`.
   - Send Button: Enabled only when input is non-empty (`trim().length > 0`).

---

## 4. Interaction States & Micro-interactions

### 4.1 Server Cold Start State (Free-Tier Tolerance)
Because zero-cost hosting tiers (e.g., Render, Railway) spin down instances after 15 minutes of inactivity:
* **State Trigger:** Handshake latency exceeds 1.5 seconds.
* **UI Response:** A non-intrusive sticky top banner renders:
  > *"Server instance is spinning up (~30s on cold start). Please wait..."*
* Accompanied by an indeterminate linear loading bar (`color-brand-accent`).

### 4.2 Peer Disconnect State
* When peer drops connection:
  - Header presence dot transitions immediately to `#64748B` (Offline).
  - Subtle inline system pill: `@[username] left the session. Undelivered messages are permanently dropped.`

### 4.3 Instant Wipe Interaction
* Clicking **Wipe Session**:
  1. Triggers confirmation bottom sheet: *"Permanently delete active chat from memory?"*
  2. Confirming resets all local React state arrays to `[]`.
  3. Disconnects the active WebSocket.
  4. Flushes the auth token from memory.
  5. Redirects immediately back to Screen 1.

---

## 5. Accessibility (a11y) & Responsive Rules

1. **Color Contrast:**
   - Primary text `#F8FAFC` against `#0B1120` achieves an **18.2:1** contrast ratio (far exceeding WCAG AAA standard of 7:1).
   - Accent cyan `#38BDF8` against `#1E293B` achieves an **8.6:1** contrast ratio.
2. **Focus Rings:**
   - All interactive controls feature a visible 2px solid `#38BDF8` focus ring with a 2px offset.
3. **Screen Reader Hints:**
   - Online dot includes `aria-label="User is online"`.
   - Message bubbles feature role tags (`role="log"` for chat stream, `aria-live="polite"`).
4. **Responsive Breakpoints:**
   - **Mobile Viewport (< 640px):** Full width layout, 100% viewport height, sticky bottom dock.
   - **Tablet / Desktop Viewport (>= 640px):** Max container width of 720px, horizontally centered with subtle drop shadow (`box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5)`).

---

## 6. Implementation Checklist for Engineers

- [ ] Ensure no local storage (`localStorage`, `sessionStorage`, `IndexedDB`) stores message content.
- [ ] Bind component message array strictly to component memory state (`useState<Message[]>([])`).
- [ ] Add `beforeunload` event listener on browser tab to warn users before unintentional reloads.
- [ ] Connect WebSocket auth handshake using in-memory bearer token.
- [ ] Implement virtual keyboard offset handling for mobile Safari and Android Chrome.