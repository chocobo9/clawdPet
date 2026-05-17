<p align="center">
  <h1 align="center">clawdPet</h1>
  <p align="center">
    Turn an old phone into a desktop pixel pet + Claude usage monitor + task notification ringer.
  </p>
</p>

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
- **Task notifications** — ringtone when Claude finishes, alarm when input is needed
- **Claude Code hooks** — automatic 15-event hook registration, real-time state updates
- **Custom skins** — upload your own pet sprites via the settings page
- **Multi-session aware** — tracks multiple Claude sessions, resolves dominant state by priority
- **Subagent tracking** — juggling animation when subagents are active
- **Oneshot events** — brief error/notification/attention states that auto-revert

## Quick Start

### 1. Server

```bash
git clone https://github.com/user/clawdPet.git
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
3. On first launch, enter the server address: `http://<your-LAN-IP>:9870`

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
│       ├── SettingsActivity.kt # Server address config
│       ├── KeepAliveService.kt # Foreground service
│       └── Prefs.kt           # SharedPreferences helper
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

### How do I upload a custom skin?

1. Open the settings page on the phone app (long-press the back button)
2. Use the skin upload section to upload a ZIP file containing:
   - `manifest.json` with `name`, `states` map, and `format` (`gif` or `image`)
   - Animation files (GIF or PNG) for each state

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
