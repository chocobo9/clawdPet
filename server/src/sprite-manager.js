'use strict';

const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { PET_STATES } = require('./models.js');
const { BUILTIN_SKINS, STATE_SOURCE_MAP, STATE_INTERVAL_MAP } = require('./default-pet-data.js');

const MAX_SINGLE_FILE_SIZE = 2 * 1024 * 1024;
const MAX_ZIP_FILE_SIZE = 10 * 1024 * 1024;
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 128;
const SKIN_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ALLOWED_IMAGE_TYPES = ['image/gif', 'image/png', 'image/webp'];
const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_TYPES, 'application/zip', 'application/x-zip-compressed'];
const ALLOWED_EXTENSIONS = ['.gif', '.png', '.webp'];
const MAX_DECOMPRESSED_ENTRY_SIZE = 4 * 1024 * 1024;

function sanitizeFilename(name) {
  const base = path.basename(name);
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isSafePath(entryName, targetDir) {
  const targetPath = path.resolve(targetDir, entryName);
  const resolvedTarget = path.resolve(targetDir);
  return targetPath.startsWith(resolvedTarget + path.sep) || targetPath === resolvedTarget;
}

function readImageDimensions(buffer) {
  if (!buffer || buffer.length < 10) return null;

  if (buffer.length >= 10
      && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  }

  if (buffer.length >= 24
      && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  if (buffer.length >= 30
      && buffer[0] === 0x52 && buffer[1] === 0x49
      && buffer[2] === 0x46 && buffer[3] === 0x46
      && buffer[8] === 0x57 && buffer[9] === 0x45
      && buffer[10] === 0x42 && buffer[11] === 0x50) {
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      const width = (buffer.readUInt16LE(26) & 0x3FFF);
      const height = (buffer.readUInt16LE(28) & 0x3FFF);
      return { width, height };
    }
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3FFF) + 1;
      const height = ((bits >> 14) & 0x3FFF) + 1;
      return { width, height };
    }
  }

  return null;
}

function validateDimensions(dims) {
  if (!dims) return 'Could not read image dimensions';
  if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
    return `Image too small: ${dims.width}x${dims.height} (min ${MIN_DIMENSION}x${MIN_DIMENSION})`;
  }
  if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    return `Image too large: ${dims.width}x${dims.height} (max ${MAX_DIMENSION}x${MAX_DIMENSION})`;
  }
  return null;
}

function createSpriteManager({ skinsDir }) {
  fs.mkdirSync(skinsDir, { recursive: true });
  ensureDefaultSkin(skinsDir);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ZIP_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type: ${file.mimetype}`));
      }
    }
  });

  const router = express.Router();

  router.get('/api/skins', (_req, res) => {
    const skins = listSkins(skinsDir);
    res.json({ skins });
  });

  router.get('/api/skins/active', (_req, res) => {
    const activePath = path.join(skinsDir, '.active');
    let active = 'default';
    if (fs.existsSync(activePath)) {
      active = fs.readFileSync(activePath, 'utf-8').trim() || 'default';
    }
    res.json({ active });
  });

  router.put('/api/skins/active', express.json(), (req, res) => {
    const { skin } = req.body || {};
    if (!skin || typeof skin !== 'string') {
      res.status(400).json({ error: 'Missing skin name' });
      return;
    }
    if (!SKIN_NAME_RE.test(skin)) {
      res.status(400).json({ error: 'Invalid skin name' });
      return;
    }
    const skinDir = path.join(skinsDir, skin);
    if (!fs.existsSync(skinDir) || !fs.statSync(skinDir).isDirectory()) {
      res.status(404).json({ error: `Skin not found: ${skin}` });
      return;
    }
    const activePath = path.join(skinsDir, '.active');
    fs.writeFileSync(activePath, skin, 'utf-8');
    res.json({ active: skin });
  });

  router.post('/api/skins/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const skinName = req.body.name;
    if (!skinName || !SKIN_NAME_RE.test(skinName)) {
      res.status(400).json({ error: 'Invalid or missing skin name' });
      return;
    }

    if (skinName === 'default') {
      res.status(400).json({ error: 'Cannot overwrite default skin' });
      return;
    }

    const isZip = req.file.mimetype === 'application/zip'
               || req.file.mimetype === 'application/x-zip-compressed';

    if (isZip) {
      const result = extractZipSkin(req.file.buffer, skinName, skinsDir);
      if (result.error) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ skin: skinName, files: result.files });
    } else {
      const state = req.body.state;
      if (!state || !PET_STATES.includes(state)) {
        res.status(400).json({ error: `Invalid state. Must be one of: ${PET_STATES.join(', ')}` });
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        res.status(400).json({ error: `Invalid file extension: ${ext}` });
        return;
      }

      if (req.file.size > MAX_SINGLE_FILE_SIZE) {
        res.status(413).json({ error: 'File too large (max 2MB for single images)' });
        return;
      }

      const dimError = validateDimensions(readImageDimensions(req.file.buffer));
      if (dimError) {
        res.status(400).json({ error: dimError });
        return;
      }

      const skinDir = path.join(skinsDir, skinName);
      fs.mkdirSync(skinDir, { recursive: true });
      const filename = `${state}${ext}`;
      fs.writeFileSync(path.join(skinDir, filename), req.file.buffer);

      updateManifestForImage(skinDir, skinName, state, filename);
      res.json({ skin: skinName, file: filename });
    }
  });

  router.get('/api/skins/:name/:file', (req, res) => {
    const { name, file } = req.params;

    if (!SKIN_NAME_RE.test(name)) {
      res.status(400).json({ error: 'Invalid skin name' });
      return;
    }

    const safeName = sanitizeFilename(file);
    const filePath = path.join(skinsDir, name, safeName);

    if (!isSafePath(filePath, skinsDir)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      const fallbackPath = path.join(skinsDir, 'default', safeName);
      if (fs.existsSync(fallbackPath)) {
        res.sendFile(fallbackPath);
        return;
      }
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.sendFile(filePath);
  });

  router.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File too large' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err.message && err.message.startsWith('Invalid file type')) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error('[sprite-manager] Unexpected error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { router, listSkins: () => listSkins(skinsDir) };
}

function extractZipSkin(buffer, skinName, skinsDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return { error: 'Invalid zip file' };
  }

  const entries = zip.getEntries();
  const skinDir = path.join(skinsDir, skinName);
  const extractedFiles = [];
  let manifestData = null;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    if (!isSafePath(entry.entryName, skinDir)) {
      return { error: `Path traversal detected: ${entry.entryName}` };
    }

    const entryBasename = path.basename(entry.entryName);
    const sanitized = sanitizeFilename(entryBasename);

    if (sanitized === 'manifest.json') {
      try {
        manifestData = JSON.parse(entry.getData().toString('utf-8'));
      } catch {
        return { error: 'Invalid manifest.json in zip' };
      }
      continue;
    }

    const ext = path.extname(sanitized).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) continue;

    if (entry.header && entry.header.size > MAX_DECOMPRESSED_ENTRY_SIZE) {
      return { error: `${sanitized}: decompressed size exceeds ${MAX_DECOMPRESSED_ENTRY_SIZE} bytes` };
    }

    const data = entry.getData();
    const dimError = validateDimensions(readImageDimensions(data));
    if (dimError) {
      return { error: `${sanitized}: ${dimError}` };
    }

    extractedFiles.push({ name: sanitized, data });
  }

  if (extractedFiles.length === 0) {
    return { error: 'Zip contains no valid image files' };
  }

  fs.mkdirSync(skinDir, { recursive: true });

  for (const file of extractedFiles) {
    fs.writeFileSync(path.join(skinDir, file.name), file.data);
  }

  if (manifestData) {
    fs.writeFileSync(path.join(skinDir, 'manifest.json'), JSON.stringify(manifestData, null, 2), 'utf-8');
  } else {
    generateManifestFromFiles(skinDir, skinName, extractedFiles.map(f => f.name));
  }

  return { files: extractedFiles.map(f => f.name) };
}

function generateManifestFromFiles(skinDir, skinName, filenames) {
  const states = {};
  for (const filename of filenames) {
    const baseName = path.basename(filename, path.extname(filename));
    if (PET_STATES.includes(baseName)) {
      states[baseName] = { file: filename };
    }
  }
  const manifest = { name: skinName, format: 'image', states };
  fs.writeFileSync(path.join(skinDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

function updateManifestForImage(skinDir, skinName, state, filename) {
  const manifestPath = path.join(skinDir, 'manifest.json');
  let manifest = { name: skinName, format: 'image', states: {} };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      // start fresh
    }
  }
  manifest.states = { ...manifest.states, [state]: { file: filename } };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function listSkins(skinsDir) {
  if (!fs.existsSync(skinsDir)) return [];

  const entries = fs.readdirSync(skinsDir, { withFileTypes: true });
  const skins = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(skinsDir, entry.name, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        skins.push({
          name: entry.name,
          format: manifest.format || 'unknown',
          stateCount: Object.keys(manifest.states || {}).length
        });
      } catch {
        skins.push({ name: entry.name, format: 'unknown', stateCount: 0 });
      }
    }
  }

  return skins;
}

function ensureBuiltinSkin(skinsDir, skinName, petData) {
  const skinDir = path.join(skinsDir, skinName);
  const manifestPath = path.join(skinDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) return;

  fs.mkdirSync(skinDir, { recursive: true });

  const manifest = {
    name: skinName,
    format: 'json-frames',
    spriteWidth: 14,
    spriteHeight: 10,
    pixelScale: 3,
    palette: petData.palette,
    states: {}
  };

  for (const state of PET_STATES) {
    const source = STATE_SOURCE_MAP[state];
    const intervalMs = STATE_INTERVAL_MAP[state];
    const filename = `${state}.json`;

    manifest.states[state] = {
      file: filename,
      source,
      frameCount: 2,
      intervalMs
    };

    const stateData = {
      source,
      frameCount: 2,
      intervalMs,
      palette: petData.palette,
      frames: petData[source] || petData['waiting']
    };
    fs.writeFileSync(path.join(skinDir, filename), JSON.stringify(stateData, null, 2), 'utf-8');
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function ensureDefaultSkin(skinsDir) {
  for (const [skinName, petData] of Object.entries(BUILTIN_SKINS)) {
    ensureBuiltinSkin(skinsDir, skinName, petData);
  }
}

module.exports = {
  createSpriteManager,
  sanitizeFilename,
  isSafePath,
  readImageDimensions,
  validateDimensions
};
