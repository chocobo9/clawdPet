'use strict';

const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ConfigSchema = z.object({
  claudeCredentialsPath: z.string().default('~/.claude/.credentials.json'),
  pollIntervalSeconds: z.number().min(10).max(600).default(60),
  host: z.string().default('0.0.0.0'),
  port: z.number().min(1024).max(65535).default(9870),
  hookSecret: z.string().default(''),
  oneshotDurationMs: z.number().min(1000).max(30000).default(5000),
  sleepTimeoutMs: z.number().min(10000).max(600000).default(120000)
});

function expandTilde(filePath) {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function getConfigDir() {
  if (process.env.CLAWD_PHONE_CONFIG_DIR) {
    return expandTilde(process.env.CLAWD_PHONE_CONFIG_DIR);
  }
  return path.join(os.homedir(), '.clawd-phone');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getDefaults() {
  return ConfigSchema.parse({});
}

function ensureConfigDir() {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function loadConfig() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    const defaults = getDefaults();
    ensureConfigDir();
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

function saveConfig(config) {
  const validated = ConfigSchema.parse(config);
  const configPath = getConfigPath();
  ensureConfigDir();
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
  fs.renameSync(tmpPath, configPath);
  return validated;
}

module.exports = {
  ConfigSchema,
  expandTilde,
  getConfigDir,
  getConfigPath,
  getDefaults,
  loadConfig,
  saveConfig
};
