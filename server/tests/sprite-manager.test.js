import { describe, test, expect, beforeEach, afterEach } from 'vitest';
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const {
  createSpriteManager,
  sanitizeFilename,
  isSafePath,
  readImageDimensions,
  validateDimensions
} = require('../src/sprite-manager.js');

function createTestApp(skinsDir) {
  const manager = createSpriteManager({ skinsDir });
  const app = express();
  app.use(manager.router);
  return { app, manager };
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makePngBuffer(width, height) {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4E; buf[3] = 0x47;
  buf[4] = 0x0D; buf[5] = 0x0A; buf[6] = 0x1A; buf[7] = 0x0A;
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeGifBuffer(width, height) {
  const buf = Buffer.alloc(10);
  buf[0] = 0x47; buf[1] = 0x49; buf[2] = 0x46;
  buf[3] = 0x38; buf[4] = 0x39; buf[5] = 0x61;
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function makeValidZip(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  return zip.toBuffer();
}

// --- Unit Tests: Pure Functions ---

describe('sanitizeFilename', () => {
  test('strips path components', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
  });

  test('replaces special characters', () => {
    expect(sanitizeFilename('my file (1).png')).toBe('my_file__1_.png');
  });

  test('preserves safe characters', () => {
    expect(sanitizeFilename('idle-frame_01.gif')).toBe('idle-frame_01.gif');
  });
});

describe('isSafePath', () => {
  test('allows simple filename', () => {
    expect(isSafePath('idle.gif', '/skins/test')).toBe(true);
  });

  test('rejects path traversal', () => {
    expect(isSafePath('../../../etc/passwd', '/skins/test')).toBe(false);
  });

  test('rejects absolute paths on Windows-like entries', () => {
    expect(isSafePath('C:\\Windows\\System32\\cmd.exe', '/skins/test')).toBe(false);
  });
});

describe('readImageDimensions', () => {
  test('reads PNG dimensions', () => {
    const buf = makePngBuffer(32, 64);
    expect(readImageDimensions(buf)).toEqual({ width: 32, height: 64 });
  });

  test('reads GIF dimensions', () => {
    const buf = makeGifBuffer(48, 48);
    expect(readImageDimensions(buf)).toEqual({ width: 48, height: 48 });
  });

  test('returns null for unknown format', () => {
    expect(readImageDimensions(Buffer.from('notanimage'))).toBeNull();
  });

  test('returns null for too-small buffer', () => {
    expect(readImageDimensions(Buffer.alloc(5))).toBeNull();
  });
});

describe('validateDimensions', () => {
  test('passes valid dimensions', () => {
    expect(validateDimensions({ width: 32, height: 32 })).toBeNull();
  });

  test('rejects too small', () => {
    expect(validateDimensions({ width: 8, height: 8 })).toContain('too small');
  });

  test('rejects too large', () => {
    expect(validateDimensions({ width: 256, height: 256 })).toContain('too large');
  });

  test('rejects null dimensions', () => {
    expect(validateDimensions(null)).toContain('Could not read');
  });
});

// --- Happy Path (API) ---

describe('Sprite Manager - happy path', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-skins-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('lists skins includes default', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.skins).toBeInstanceOf(Array);
      expect(data.skins.find(s => s.name === 'default')).toBeDefined();
      expect(data.skins[0].stateCount).toBe(10);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('default active skin is "default"', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins/active`);
      const data = await res.json();

      expect(data.active).toBe('default');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('uploads zip skin and lists it', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zipBuffer = makeValidZip({
        'idle.gif': makeGifBuffer(32, 32),
        'working.png': makePngBuffer(32, 32)
      });

      const form = new FormData();
      form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'skin.zip');
      form.append('name', 'test-skin');

      const uploadRes = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });
      const uploadData = await uploadRes.json();

      expect(uploadRes.status).toBe(200);
      expect(uploadData.skin).toBe('test-skin');
      expect(uploadData.files).toContain('idle.gif');

      const listRes = await fetch(`${baseUrl}/api/skins`);
      const listData = await listRes.json();
      expect(listData.skins.find(s => s.name === 'test-skin')).toBeDefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('uploads single image for a state', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([makeGifBuffer(32, 32)], { type: 'image/gif' }), 'idle.gif');
      form.append('name', 'img-skin');
      form.append('state', 'idle');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.file).toBe('idle.gif');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('switches active skin', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zipBuffer = makeValidZip({ 'idle.gif': makeGifBuffer(32, 32) });
      const form = new FormData();
      form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'skin.zip');
      form.append('name', 'my-skin');
      await fetch(`${baseUrl}/api/skins/upload`, { method: 'POST', body: form });

      const switchRes = await fetch(`${baseUrl}/api/skins/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skin: 'my-skin' })
      });
      const switchData = await switchRes.json();

      expect(switchRes.status).toBe(200);
      expect(switchData.active).toBe('my-skin');

      const getRes = await fetch(`${baseUrl}/api/skins/active`);
      expect((await getRes.json()).active).toBe('my-skin');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('serves default skin state file', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins/default/manifest.json`);
      expect(res.status).toBe(200);

      const manifest = await res.json();
      expect(manifest.name).toBe('default');
      expect(manifest.states.idle).toBeDefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

// --- Edge/Error Cases ---

describe('Sprite Manager - edge/error cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-skins-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rejects invalid file type', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'bad.txt');
      form.append('name', 'bad-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects image with dimensions too small', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([makeGifBuffer(8, 8)], { type: 'image/gif' }), 'tiny.gif');
      form.append('name', 'tiny-skin');
      form.append('state', 'idle');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('too small');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects invalid skin name', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([makeGifBuffer(32, 32)], { type: 'image/gif' }), 'idle.gif');
      form.append('name', '../evil-path');
      form.append('state', 'idle');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects switching to nonexistent skin', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skin: 'nonexistent' })
      });

      expect(res.status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('returns 404 for missing skin file, no default fallback', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins/nonexistent/nosuchfile.gif`);
      expect(res.status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects missing state on single image upload', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([makeGifBuffer(32, 32)], { type: 'image/gif' }), 'idle.gif');
      form.append('name', 'nostate-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid state');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects PUT active with missing body', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/skins/active`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('Missing skin name');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('file-serve falls back to default skin for missing file', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zipBuffer = makeValidZip({ 'idle.gif': makeGifBuffer(32, 32) });
      const form = new FormData();
      form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'skin.zip');
      form.append('name', 'partial-skin');
      await fetch(`${baseUrl}/api/skins/upload`, { method: 'POST', body: form });

      const res = await fetch(`${baseUrl}/api/skins/partial-skin/idle.json`);
      expect(res.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('rejects overwriting default skin', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([makeGifBuffer(32, 32)], { type: 'image/gif' }), 'idle.gif');
      form.append('name', 'default');
      form.append('state', 'idle');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('Cannot overwrite');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

// --- Adversarial Cases ---

describe('Sprite Manager - adversarial', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-skins-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('zip with path traversal entry stays inside skin dir (adm-zip normalizes)', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zip = new AdmZip();
      zip.addFile('../../etc/evil.gif', makeGifBuffer(32, 32));
      const zipBuffer = zip.toBuffer();

      const form = new FormData();
      form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'evil.zip');
      form.append('name', 'traversal-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(fs.existsSync(path.join(tmpDir, '..', 'etc', 'evil.gif'))).toBe(false);

      const skinDir = path.join(tmpDir, 'traversal-skin');
      if (res.status === 200) {
        expect(fs.existsSync(skinDir)).toBe(true);
        const files = fs.readdirSync(skinDir);
        expect(files.some(f => f.endsWith('.gif'))).toBe(true);
      } else {
        expect(res.status).toBe(400);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('isSafePath rejects traversal (defense-in-depth for Zip Slip)', () => {
    expect(isSafePath('../../etc/passwd', '/skins/target')).toBe(false);
    expect(isSafePath('../sibling/file.gif', '/skins/target')).toBe(false);
    expect(isSafePath('subfolder/file.gif', '/skins/target')).toBe(true);
    expect(isSafePath('idle.gif', '/skins/target')).toBe(true);
  });

  test('zip with no valid images is rejected', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from('hello'));
      zip.addFile('script.js', Buffer.from('evil()'));

      const form = new FormData();
      form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'empty.zip');
      form.append('name', 'empty-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('no valid image');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('uploading same skin name twice overwrites', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form1 = new FormData();
      form1.append('file', new Blob([makeValidZip({ 'idle.gif': makeGifBuffer(32, 32) })], { type: 'application/zip' }), 'skin.zip');
      form1.append('name', 'overwrite-me');
      await fetch(`${baseUrl}/api/skins/upload`, { method: 'POST', body: form1 });

      const form2 = new FormData();
      form2.append('file', new Blob([makeValidZip({ 'idle.gif': makeGifBuffer(48, 48), 'working.gif': makeGifBuffer(48, 48) })], { type: 'application/zip' }), 'skin.zip');
      form2.append('name', 'overwrite-me');
      const res = await fetch(`${baseUrl}/api/skins/upload`, { method: 'POST', body: form2 });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.files).toContain('working.gif');

      const listRes = await fetch(`${baseUrl}/api/skins`);
      const listData = await listRes.json();
      const skin = listData.skins.find(s => s.name === 'overwrite-me');
      expect(skin.stateCount).toBe(2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('zip with oversized image dimensions is rejected', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const zip = new AdmZip();
      zip.addFile('idle.png', makePngBuffer(256, 256));

      const form = new FormData();
      form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'big.zip');
      form.append('name', 'big-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('too large');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('corrupted zip buffer returns error', async () => {
    const { app } = createTestApp(tmpDir);
    const { server, baseUrl } = await startServer(app);

    try {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('not a zip at all')], { type: 'application/zip' }), 'bad.zip');
      form.append('name', 'corrupt-skin');

      const res = await fetch(`${baseUrl}/api/skins/upload`, {
        method: 'POST',
        body: form
      });

      expect(res.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
