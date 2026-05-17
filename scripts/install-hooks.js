'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MARKER = 'clawdpet-notify';
const NOTIFY_SCRIPT = path.resolve(__dirname, 'notify.js');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const IS_WINDOWS = process.platform === 'win32';

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'Notification', 'Elicitation',
  'WorktreeCreate'
];

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
  fs.renameSync(tmpPath, SETTINGS_PATH);
}

function buildCommandSpec(event) {
  const nodeBin = process.execPath;
  const scriptPath = NOTIFY_SCRIPT.replace(/\\/g, '/');
  const nodeQuoted = nodeBin.replace(/\\/g, '/');

  if (IS_WINDOWS) {
    return {
      type: 'command',
      shell: 'powershell',
      command: `& "${nodeQuoted}" "${scriptPath}" ${event}`
    };
  }
  return {
    type: 'command',
    command: `"${nodeQuoted}" "${scriptPath}" ${event}`
  };
}

function isOurEntry(entry) {
  if (!entry || !Array.isArray(entry.hooks)) return false;
  const scriptName = NOTIFY_SCRIPT.replace(/\\/g, '/');
  return entry.hooks.some((h) =>
    h.command && (h.command.includes(MARKER) || h.command.includes(scriptName))
  );
}

function install() {
  const settings = readSettings();
  if (!settings.hooks) {
    settings.hooks = {};
  }

  let added = 0;
  let skipped = 0;

  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }

    const alreadyInstalled = settings.hooks[event].some(isOurEntry);
    if (alreadyInstalled) {
      skipped++;
      continue;
    }

    settings.hooks[event].push({
      matcher: '',
      hooks: [buildCommandSpec(event)]
    });
    added++;
  }

  writeSettings(settings);
  console.log(`Installed: ${added} hooks added, ${skipped} already present.`);
  console.log(`Settings: ${SETTINGS_PATH}`);
  console.log(`Script: ${NOTIFY_SCRIPT}`);
}

function uninstall() {
  const settings = readSettings();
  if (!settings.hooks) {
    console.log('No hooks found in settings.');
    return;
  }

  let removed = 0;

  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(settings.hooks[event])) continue;

    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((entry) => !isOurEntry(entry));
    removed += before - settings.hooks[event].length;

    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);
  console.log(`Uninstalled: ${removed} hooks removed.`);
}

function detectLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--uninstall') || args.includes('-u')) {
    uninstall();
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node install-hooks.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --uninstall, -u  Remove clawdPet hooks');
    console.log('  --help, -h       Show this help');
    console.log('');
    console.log(`Detected LAN IP: ${detectLocalIp()}`);
    return;
  }

  const ip = detectLocalIp();
  console.log(`Detected LAN IP: ${ip}`);
  console.log(`Make sure your phone is configured to connect to http://${ip}:9870`);
  console.log('');

  install();
}

if (require.main === module) {
  main();
}

module.exports = {
  HOOK_EVENTS,
  MARKER,
  readSettings,
  writeSettings,
  buildCommandSpec,
  isOurEntry,
  install,
  uninstall,
  detectLocalIp
};
