import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  HOOK_EVENTS,
  MARKER,
  buildCommandSpec,
  isOurEntry,
  detectLocalIp
} = require('../../scripts/install-hooks.js');

describe('install-hooks constants', () => {
  test('HOOK_EVENTS contains all 15 expected events', () => {
    const expected = [
      'SessionStart', 'SessionEnd', 'UserPromptSubmit',
      'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
      'Stop', 'StopFailure',
      'SubagentStart', 'SubagentStop',
      'PreCompact', 'PostCompact',
      'Notification', 'Elicitation',
      'WorktreeCreate'
    ];
    expect(HOOK_EVENTS).toEqual(expected);
    expect(HOOK_EVENTS).toHaveLength(15);
  });

  test('MARKER is clawdpet-notify', () => {
    expect(MARKER).toBe('clawdpet-notify');
  });

  test('HOOK_EVENTS matches server models.js HOOK_EVENTS', () => {
    const { HOOK_EVENTS: serverEvents } = require('../src/models.js');
    expect(HOOK_EVENTS).toEqual([...serverEvents]);
  });
});

describe('buildCommandSpec', () => {
  test('generates command containing notify.js and event name', () => {
    const spec = buildCommandSpec('SessionStart');
    expect(spec.type).toBe('command');
    expect(spec.command).toContain('notify.js');
    expect(spec.command).toContain('SessionStart');
  });

  test('generates different commands for different events', () => {
    const start = buildCommandSpec('SessionStart');
    const stop = buildCommandSpec('SessionEnd');
    expect(start.command).not.toBe(stop.command);
    expect(start.command).toContain('SessionStart');
    expect(stop.command).toContain('SessionEnd');
  });

  test('command uses forward slashes in paths', () => {
    const spec = buildCommandSpec('PreToolUse');
    expect(spec.command).not.toMatch(/\\\\/);
  });

  test('Windows builds include shell: powershell and & prefix', () => {
    const origPlatform = process.platform;
    const installHooks = require('../../scripts/install-hooks.js');
    delete require.cache[require.resolve('../../scripts/install-hooks.js')];

    const mod = require('module');
    const origLoad = mod._load;
    let capturedIsWindows = null;

    const winScript = path.resolve(__dirname, '../../scripts/install-hooks.js');
    delete require.cache[require.resolve('../../scripts/install-hooks.js')];
    const src = fs.readFileSync(winScript, 'utf-8');
    const patched = src.replace(
      "const IS_WINDOWS = process.platform === 'win32';",
      "const IS_WINDOWS = true;"
    );
    const tmpPath = winScript + '.win-test.js';
    fs.writeFileSync(tmpPath, patched);
    try {
      const winMod = require(tmpPath);
      const spec = winMod.buildCommandSpec('SessionStart');
      expect(spec.shell).toBe('powershell');
      expect(spec.command).toMatch(/^& /);
      expect(spec.type).toBe('command');
    } finally {
      fs.unlinkSync(tmpPath);
      delete require.cache[tmpPath];
    }
  });

  test('POSIX builds do not include shell property', () => {
    const winScript = path.resolve(__dirname, '../../scripts/install-hooks.js');
    delete require.cache[require.resolve('../../scripts/install-hooks.js')];
    const src = fs.readFileSync(winScript, 'utf-8');
    const patched = src.replace(
      "const IS_WINDOWS = process.platform === 'win32';",
      "const IS_WINDOWS = false;"
    );
    const tmpPath = winScript + '.posix-test.js';
    fs.writeFileSync(tmpPath, patched);
    try {
      const posixMod = require(tmpPath);
      const spec = posixMod.buildCommandSpec('SessionStart');
      expect(spec.shell).toBeUndefined();
      expect(spec.command).not.toMatch(/^& /);
    } finally {
      fs.unlinkSync(tmpPath);
      delete require.cache[tmpPath];
    }
  });
});

describe('isOurEntry', () => {
  test('returns true for entry with MARKER in command', () => {
    const entry = {
      matcher: '',
      hooks: [{ type: 'command', command: 'node /path/clawdpet-notify/notify.js SessionStart' }]
    };
    expect(isOurEntry(entry)).toBe(true);
  });

  test('returns false for entry from other tools', () => {
    const entry = {
      matcher: '',
      hooks: [{ type: 'command', command: 'other-tool --check' }]
    };
    expect(isOurEntry(entry)).toBe(false);
  });

  test('returns false for null entry', () => {
    expect(isOurEntry(null)).toBe(false);
  });

  test('returns false for entry without hooks array', () => {
    expect(isOurEntry({ matcher: '' })).toBe(false);
  });

  test('returns false for entry with empty hooks array', () => {
    expect(isOurEntry({ matcher: '', hooks: [] })).toBe(false);
  });

  test('returns false for entry without command property', () => {
    const entry = { matcher: '', hooks: [{ type: 'command' }] };
    expect(isOurEntry(entry)).toBe(false);
  });
});

describe('detectLocalIp', () => {
  test('returns a valid IPv4 address', () => {
    const ip = detectLocalIp();
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  test('does not return loopback when external interface exists', () => {
    const interfaces = os.networkInterfaces();
    const hasExternal = Object.values(interfaces).some(
      (ifaces) => ifaces.some((i) => i.family === 'IPv4' && !i.internal)
    );
    const ip = detectLocalIp();
    if (hasExternal) {
      expect(ip).not.toBe('127.0.0.1');
    } else {
      expect(ip).toBe('127.0.0.1');
    }
  });
});

describe('install and uninstall (filesystem integration)', () => {
  const tmpDir = path.join(os.tmpdir(), `clawd-install-test-${Date.now()}`);
  const settingsDir = path.join(tmpDir, '.claude');
  const settingsFile = path.join(settingsDir, 'settings.json');

  let origHomedir;

  beforeEach(() => {
    fs.mkdirSync(settingsDir, { recursive: true });
    origHomedir = os.homedir;
    os.homedir = () => tmpDir;
  });

  afterEach(() => {
    os.homedir = origHomedir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../../scripts/install-hooks.js')];
  });

  function reloadInstaller() {
    delete require.cache[require.resolve('../../scripts/install-hooks.js')];
    return require('../../scripts/install-hooks.js');
  }

  test('install creates hooks for all 15 events', () => {
    fs.writeFileSync(settingsFile, '{}');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(Object.keys(settings.hooks)).toHaveLength(15);
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toHaveLength(1);
      expect(settings.hooks[event][0].matcher).toBe('');
      expect(settings.hooks[event][0].hooks[0].command).toContain('notify.js');
      expect(settings.hooks[event][0].hooks[0].command).toContain(event);
    }
    vi.restoreAllMocks();
  });

  test('install preserves existing hooks from other tools', () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'eslint --fix' }] }]
      }
    };
    fs.writeFileSync(settingsFile, JSON.stringify(existing));
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('eslint --fix');
    expect(settings.hooks.PreToolUse[1].hooks[0].command).toContain('notify.js');
    vi.restoreAllMocks();
  });

  test('install is idempotent — second run adds nothing', () => {
    fs.writeFileSync(settingsFile, '{}');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();
    installer.install();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toHaveLength(1);
    }
    vi.restoreAllMocks();
  });

  test('uninstall removes only clawdpet hooks', () => {
    const mixed = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'path/clawdpet-notify/notify.js SessionStart' }] },
          { matcher: '', hooks: [{ type: 'command', command: 'other-tool start' }] }
        ],
        PreToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'path/clawdpet-notify/notify.js PreToolUse' }] }
        ]
      }
    };
    fs.writeFileSync(settingsFile, JSON.stringify(mixed));
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.uninstall();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('other-tool start');
    expect(settings.hooks.PreToolUse).toBeUndefined();
    vi.restoreAllMocks();
  });

  test('uninstall cleans up empty hooks object', () => {
    const onlyOurs = {
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'clawdpet-notify/notify.js SessionStart' }] }
        ]
      }
    };
    fs.writeFileSync(settingsFile, JSON.stringify(onlyOurs));
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.uninstall();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(settings.hooks).toBeUndefined();
    vi.restoreAllMocks();
  });

  test('preserves non-hook settings on install', () => {
    const existing = { theme: 'dark', verbose: true };
    fs.writeFileSync(settingsFile, JSON.stringify(existing));
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.verbose).toBe(true);
    expect(settings.hooks).toBeDefined();
    vi.restoreAllMocks();
  });

  test('settings written atomically via .tmp + rename', () => {
    fs.writeFileSync(settingsFile, '{}');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const origRename = fs.renameSync;
    let renameCalled = false;
    fs.renameSync = (...args) => {
      renameCalled = true;
      return origRename(...args);
    };

    installer.install();

    expect(renameCalled).toBe(true);
    fs.renameSync = origRename;
    vi.restoreAllMocks();
  });

  test('install creates .claude directory when it does not exist', () => {
    fs.rmSync(settingsDir, { recursive: true, force: true });
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();

    expect(fs.existsSync(settingsFile)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(Object.keys(settings.hooks)).toHaveLength(15);
    vi.restoreAllMocks();
  });

  test('install handles corrupt settings.json gracefully', () => {
    fs.writeFileSync(settingsFile, 'not valid json!!!');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(Object.keys(settings.hooks)).toHaveLength(15);
    vi.restoreAllMocks();
  });

  test('uninstall on empty settings does not throw', () => {
    fs.writeFileSync(settingsFile, '{}');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => installer.uninstall()).not.toThrow();
    vi.restoreAllMocks();
  });

  test('install then uninstall leaves settings clean', () => {
    fs.writeFileSync(settingsFile, '{"theme":"dark"}');
    const installer = reloadInstaller();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    installer.install();
    installer.uninstall();

    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(settings.hooks).toBeUndefined();
    expect(settings.theme).toBe('dark');
    vi.restoreAllMocks();
  });
});
