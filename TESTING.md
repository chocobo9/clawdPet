# Testing

## Test Suite Summary

| Component | File | Tests | Coverage Focus |
|-----------|------|-------|----------------|
| Models/Schema | models.test.js | 44 | Zod validation, enums, edge cases |
| App/Config | app.test.js | 49 | Route handlers, static serving, bridge |
| Config | config.test.js | 20 | JSON loading, env vars, defaults |
| Pet Engine | pet.test.js | 57 | Sprite loading, animation, states |
| WebSocket Hub | websocket-hub.test.js | 16 | Broadcast, heartbeat, multi-client |
| Hook Receiver | hook-receiver.test.js | 26 | State machine, oneshot, auth |
| Usage Poller | usage-poller.test.js | 27 | Polling, backoff, token handling |
| Sprite Manager | sprite-manager.test.js | 35 | Skin loading, format detection |
| Notify Script | notify.test.js | 35 | stdin, config, HTTP POST, E2E |
| Install Hooks | install-hooks.test.js | 27 | Install/uninstall, idempotent, atomic |
| **E2E Chain** | **e2e-chain.test.js** | **14** | **Full chain: hook→server→WS→client** |
| **Total** | **11 files** | **350** | |

## Running Tests

```bash
cd server
npm test                    # full suite
npx vitest run              # same, explicit
npx vitest run tests/e2e-chain.test.js   # E2E only
```

## E2E Chain Tests

The `e2e-chain.test.js` file validates the complete notification pipeline:

```
Claude Code hook fires
  → scripts/notify.js reads stdin JSON
    → HTTP POST to server /api/hook
      → hook-receiver processes event
        → state machine updates
          → WebSocket broadcasts to clients
            → Client receives task_event with resolvedState
```

### Scenarios Covered

1. **Basic flow**: SessionStart stdin → WS client receives `{type: "task_event", data: {event, resolvedState}}`
2. **State transitions**: PreToolUse→working, Stop→attention
3. **Multiple clients**: All connected WS clients receive broadcast
4. **No clients**: Server doesn't error with zero WS connections
5. **Auth chain**: Matching secret passes, wrong secret gets 401 (no WS broadcast)
6. **Full lifecycle**: SessionStart→UserPromptSubmit→PreToolUse→PostToolUse→Stop→SessionEnd
7. **Subagent**: SubagentStart→juggling, SubagentStop→resumes previous state
8. **Oneshot**: PostToolUseFailure→error→OneshotReturn→previous state
9. **Rapid-fire**: Concurrent events from multiple sessions
10. **Server down**: notify.js exits 0 gracefully
11. **Client disconnect**: Server continues operating after WS disconnect

### Test Distribution

- Happy path: 5/14 = 36% (<=50%)
- Edge/error: 5/14 = 36% (>=30%)
- Adversarial/boundary: 4/14 = 29% (>=20%)

## Android Tests

```bash
cd android
./gradlew test              # unit tests (49 tests)
```

| Class | Tests | Focus |
|-------|-------|-------|
| AlarmBridgeTest | 25 | Cooldown, audio modes, handler posting |
| ConnectionCheckerTest | 13 | HTTP health check, error states |
| MainActivityTest | 11 | Back key, lifecycle, WebView config |

## Test Conventions

- Framework: Vitest 3.x (server), JUnit 5 + Mockito (Android)
- No `skip`/`xfail` without user approval
- No empty catch blocks in test assertions
- Distribution target: happy <=50%, edge >=30%, adversarial >=20%
