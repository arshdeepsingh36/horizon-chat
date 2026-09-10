# Design System Specification Document

**Project:** Horizon Chat (Sunset Glow & Twilight Ocean Theme)  
**Document Version:** 1.0.0  
**Target:** Android Native Design System & Tokens  

---

## 1. Design Tokens & Color Palette

The visual system is derived directly from the reference ambient artwork (incandescent bulb against a coastal sunset), using deep dusk slate for foundation and warm radiant amber for interactive accents.

### 1.1 Color Tokens

| Token Name | Hex Value | Android Resource Name | Semantic Usage |
| :--- | :--- | :--- | :--- |
| `color_bg_base` | `#0E1626` | `@color/bg_base` | App canvas root, window background |
| `color_surface` | `#162238` | `@color/surface` | App bars, bottom docks, elevated cards |
| `color_surface_elevated`| `#1E293B` | `@color/surface_elevated` | Modal sheets, floating dialogs |
| `color_bubble_sent` | `#EA580C` | `@color/bubble_sent` | Outgoing message card background (Warm Coral) |
| `color_bubble_received`| `#24334D` | `@color/bubble_received` | Incoming message card background (Twilight Slate) |
| `color_accent_amber` | `#F59E0B` | `@color/accent_amber` | Floating action buttons, active toggles, online status |
| `color_accent_glow` | `#FBBF24` | `@color/accent_glow` | Focus outlines, highlight borders |
| `color_text_primary` | `#FFFBEB` | `@color/text_primary` | Primary headings, message body text |
| `color_text_muted` | `#94A3B8` | `@color/text_muted` | Timestamps, secondary subtitles, placeholders |
| `color_ticks_sent` | `#CBD5E1` | `@color/ticks_sent` | Single gray tick (Server ACK) |
| `color_ticks_read` | `#FDE68A` | `@color/ticks_read` | Double amber ticks (Recipient read confirmation) |
| `color_overlay_blur` | `#770E1626` | `@color/overlay_blur` | Tap-to-download semi-transparent scrim |

---

## 2. Typography Hierarchy

Utilizes Android platform system fonts (`sans-serif` and `sans-serif-medium`) to ensure zero performance overhead and native rendering.

| Style Name | Text Size | Line Height | Font Family / Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `TextAppearance.App.Display` | 24sp | 32dp | `sans-serif-medium` (600) | Auth splash titles, modal headers |
| `TextAppearance.App.ToolbarTitle` | 18sp | 24dp | `sans-serif-medium` (600) | Chat screen & chat list app bar titles |
| `TextAppearance.App.BodyPrimary` | 15sp | 22dp | `sans-serif` (400) | Message bubble text, chat list snippets |
| `TextAppearance.App.BodySecondary` | 14sp | 20dp | `sans-serif` (400) | Form inputs, dialog body copy |
| `TextAppearance.App.Caption` | 11sp | 14dp | `sans-serif-medium` (500) | Message timestamps, download size hints |
| `TextAppearance.App.Button` | 15sp | 20dp | `sans-serif-medium` (600) | Primary button labels (AllCaps: false) |

---

## 3. Elevation, Shapes & Radii

* **Corner Radii:**
  * `radius_sm`: 4dp (Status pills, tag badges)
  * `radius_md`: 12dp (Input text fields, dialog corners)
  * `radius_bubble`: 14dp (Message bubbles)
  * `radius_bubble_accent`: 2dp (Squared corner on speaking side)
  * `radius_full`: 999dp (Circular avatars, FAB buttons, download overlays)
* **Elevation Tokens:**
  * `elevation_flat`: 0dp (Input field surfaces)
  * `elevation_card`: 2dp (Message bubbles, conversation row items)
  * `elevation_fab`: 4dp (Send button, New Chat button)

---

## 4. Component Visual Specifications

### 4.1 Message Bubbles
* **Outgoing Bubble (Right Aligned):**
  * Background: `#EA580C`
  * Shape: Top-left: `14dp`, Top-right: `14dp`, Bottom-left: `14dp`, Bottom-right: `2dp`
  * Text Color: `#FFFBEB`
  * Timestamp: `#FED7AA`
  * Read Indicator: Double checkmark tinted `#FDE68A`
* **Incoming Bubble (Left Aligned):**
  * Background: `#24334D`
  * Shape: Top-left: `14dp`, Top-right: `14dp`, Bottom-left: `2dp`, Bottom-right: `14dp`
  * Text Color: `#FFFBEB`
  * Timestamp: `#94A3B8`

### 4.2 Media & Thumbnail Blur Card
* **Container:** Fixed width `240dp`, height `180dp` inside message card.
* **Placeholder Blur Image:** Decoded 20x20 base64 bitmap with scaleType `centerCrop`.
* **Download Scrim Overlay:** Background `#770E1626` with centered download circle icon (`36dp`) and file size label in 11sp white.
* **Loading State:** Circular ProgressBar with indeterminate tint `#F59E0B`.

### 4.3 Input Dock
* **Container:** Height `wrap_content` (min `56dp`), background `#162238`.
* **Input Field:** Borderless `EditText`, text color `#FFFBEB`, hint `#94A3B8`.
* **Send Button:** Circle FloatingActionButton (`42dp`), background `#F59E0B`, icon tint `#0E1626`.
