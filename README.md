<p align="center">
  <h1 align="center">clawdPet</h1>
  <p align="center">
    Turn an old phone into a desktop pixel pet + Claude usage monitor + task notification ringer.
  </p>
</p>

> **Security Notice:** This project is designed as a personal LAN tool for trusted home networks. All communication between the server and phone uses unencrypted HTTP/WebSocket. Do **not** expose the server port (9870) to the public internet. If you need remote access, use a VPN or [Tailscale](https://tailscale.com) to keep traffic within a private network.

## Architecture

```
┌──────────────────────────────────┐                   ┌───────────────────────────────┐
│  Dev Machine (Node.js Server)    │  LAN / Tailscale  │  Old Phone (Android App)      │
│                                  │                   │                               │
│  ┌────────────────────┐         │     WebSocket     │  ┌─────────────────────────┐  │
│  │ UsagePoller        │──poll──►│ ◄───────────────► │  │ WebView                 │  │
│  │ (claude-usage-     │  60s   │                   │  │  • Pixel pet (swappable) │  │
│  │  widget)           │        │                   │  │  • Session/Weekly usage  │  │
│  └────────────────────┘        │                   │  │  • Task state animation  │  │
│                                 │                   │  └─────────┬───────────────┘  │
│  ┌────────────────────┐        │                   │            │ JS→Native bridge │
│  │ HookReceiver       │        │                   │  ┌─────────▼───────────────┐  │
│  │ (clawd-on-desk)    │◄─hook──│                   │  │ AlarmService (Kotlin)   │  │
│  └────────────────────┘        │                   │  │  • Done → ringtone      │  │
│                                 │                   │  │  • Needs input → alarm  │  │
│  ┌────────────────────┐        │                   │  └─────────────────────────┘  │
│  │ SpriteManager      │◄──────│    HTTP Upload    │                               │
│  │ Custom skin upload │        │                   │  Settings: server address +   │
│  └────────────────────┘        │                   │            custom pet upload  │
└──────────────────────────────────┘                   └───────────────────────────────┘

Claude Code hooks (stdin JSON) ──► scripts/notify.js ──► POST /api/hook ──► state machine ──► WS broadcast
```

## Features

- **Pixel desktop pet** with state-driven animations (idle, working, thinking, sleeping, etc.)
- **Claude usage monitoring** — session and weekly usage bars with countdown timers
- **Task notifications** — configurable per-event ringtone (permission vs finished), adjustable vibration intensity, 5s auto-stop
- **Claude Code hooks** — automatic 15-event hook registration, real-time state updates
- **Custom skins** — tap the pet to open skin picker; upload sprites or convert .ani cursor files
- **Session selector** — capsule dropdown showing all active sessions with state/message
- **Boot auto-start** — optional automatic launch on phone reboot
- **Multi-session aware** — tracks multiple Claude sessions, resolves dominant state by priority
- **Subagent tracking** — juggling animation when subagents are active
- **Oneshot events** — brief error/notification/attention states that auto-revert

## Quick Start

### 1. Server

```bash
git clone https://github.com/chocobo9/clawdPet.git
cd clawdPet/server
npm install
npm start
```

The server starts on `http://0.0.0.0:9870`. Find your LAN IP:

```bash
# Windows
ipconfig | findstr IPv4

# macOS/Linux
hostname -I
```

### 2. Claude Code Hooks

Install hooks so Claude Code notifies the server on every event:

```bash
node scripts/install-hooks.js
```

This adds 15 event hooks to `~/.claude/settings.json`. To remove them:

```bash
node scripts/install-hooks.js --uninstall
```

### 3. Android App

1. Open `android/` in Android Studio
2. Build and install on your old phone (minSdk 29 / Android 10+)
3. On first launch, long-press back button → Settings → enter `http://<your-LAN-IP>:9870`
4. Configure notification sounds, vibration intensity, and boot auto-start in the same Settings page

## Configuration

Config file: `~/.clawd-phone/config.json` (auto-created on first run)

| Field | Default | Description |
|-------|---------|-------------|
| `claudeCredentialsPath` | `~/.claude/.credentials.json` | Path to Claude OAuth credentials |
| `pollIntervalSeconds` | `60` | How often to poll the usage API (10-600) |
| `host` | `0.0.0.0` | Server bind address |
| `port` | `9870` | Server port |
| `hookSecret` | `""` | If set, hooks must include `Authorization: Bearer <secret>` |
| `oneshotDurationMs` | `5000` | How long oneshot states (error, notification) display |
| `sleepTimeoutMs` | `120000` | Delay before pet falls asleep after all sessions end |

Override the config directory with `CLAWD_PHONE_CONFIG_DIR` env var.

## Project Structure

```
clawdPet/
├── server/
│   ├── src/
│   │   ├── index.js            # Express + WS entry point
│   │   ├── config.js           # Config loading with Zod validation
│   │   ├── models.js           # Zod schemas, state machine, event maps
│   │   ├── usage-poller.js     # Claude usage API polling
│   │   ├── hook-receiver.js    # Hook event processing + state machine
│   │   ├── websocket-hub.js    # WebSocket connection management
│   │   ├── sprite-manager.js   # Custom skin upload + management
│   │   └── default-pet-data.js # Built-in pixel pet sprite data
│   ├── static/                 # Frontend (HTML/CSS/JS)
│   ├── skins/                  # Pet sprite skins
│   ├── tests/                  # Vitest test suite (350 tests)
│   └── package.json
├── android/                    # Kotlin Android app
│   └── app/src/main/java/com/clawd/phone/
│       ├── MainActivity.kt     # WebView + lifecycle
│       ├── AlarmBridge.kt      # JS→Native alarm bridge
│       ├── ConnectionChecker.kt
│       ├── SettingsActivity.kt # Server URL, sound/vibration, auto-start
│       ├── KeepAliveService.kt # Foreground service
│       ├── BootReceiver.kt    # Auto-launch on BOOT_COMPLETED
│       └── Prefs.kt           # SharedPreferences keys
├── scripts/
│   ├── notify.js               # Hook notification script
│   └── install-hooks.js        # Hook auto-registration
└── TESTING.md                  # Test documentation
```

## Pet States

| State | Trigger | Priority |
|-------|---------|----------|
| `juggling` | SubagentStart | 4 (highest) |
| `working` | PreToolUse, PostToolUse, SubagentStop | 3 |
| `thinking` | UserPromptSubmit | 2 |
| `idle` | SessionStart | 1 |
| `sleeping` | SessionEnd + timeout | 0 |
| `attention` | Stop, PostCompact | oneshot |
| `error` | PostToolUseFailure, StopFailure | oneshot |
| `notification` | Notification, Elicitation | oneshot |
| `sweeping` | PreCompact | oneshot |
| `carrying` | WorktreeCreate | oneshot |

## FAQ

### The phone can't connect to the server

1. Make sure both devices are on the same WiFi network
2. Check that the server is running: `curl http://<IP>:9870/api/health`
3. On Windows, allow Node.js through the firewall
4. If across networks, install [Tailscale](https://tailscale.com) on both devices and use the Tailscale IP

### Usage data shows N/A or doesn't update

1. Claude Code must have been used at least once to generate credentials
2. Check that `~/.claude/.credentials.json` exists and contains a valid token
3. The token refreshes automatically — if it's stale, run any Claude Code command to refresh it
4. Check server logs for `[usage-poller] Token error` messages

### Hooks don't seem to fire

1. Verify hooks are installed: check `~/.claude/settings.json` for `clawdpet` entries
2. Re-run `node scripts/install-hooks.js` to reinstall
3. Check that the config at `~/.clawd-phone/config.json` has the correct server address
4. Test manually: `echo '{"session_id":"test"}' | node scripts/notify.js SessionStart`

### How do I add a custom skin?

**Option A — Tap the pet** in the dashboard → skin picker opens → tap "+" to upload a ZIP or image.

**Option B — From .ani cursor files:**

```bash
# Put idle.ani, running.ani, waiting.ani (and optionally thinking.ani) in .harness/pet_source/
node .harness/ani2skin.mjs
# Restart server — new skin appears as "custom-ani" in the picker
```

**Option C — Manual:** place a skin directory in `server/skins/` with a `manifest.json`. Supports three formats:
- `json-frames` — hex-encoded pixel data with palette (14×10, like built-in skins)
- `image` — one PNG/GIF/WebP per state
- `image-frames` — multiple PNGs per state with frame cycling (for .ani conversions)

### The pet is stuck in one state

The server has automatic stale-session cleanup:
- Sessions older than 10 minutes are removed
- Working state auto-reverts after 5 minutes of no activity
- If a session crashes without sending `SessionEnd`, the cleanup handles it

## Acknowledgments

Built by combining and extending three open-source projects:

- [claude-buddy](https://github.com/handsome-rich/claude-buddy) — pixel pet sprites and animation system
- [claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget) — OAuth authentication and usage API polling
- [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) — Claude Code hook registration and state machine

## License

MIT
