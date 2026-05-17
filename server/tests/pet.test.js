import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
const { createPetEngine, decodeFrame, DEFAULT_INTERVAL_MS } = require('../static/pet.js');
const { CAPYBARA, STATE_SOURCE_MAP, STATE_INTERVAL_MAP } = require('../src/default-pet-data.js');
const { PET_STATES } = require('../src/models.js');

function createMockCanvas() {
  const fillRects = [];
  const clearRects = [];
  const drawImages = [];
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect: vi.fn(function (x, y, w, h) {
      fillRects.push({ x, y, w, h, color: ctx.fillStyle });
    }),
    clearRect: vi.fn(function (x, y, w, h) {
      clearRects.push({ x, y, w, h });
    }),
    drawImage: vi.fn(function (img, x, y) {
      drawImages.push({ img, x, y });
    })
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(function () { return ctx; })
  };
  return { canvas, ctx, fillRects, clearRects, drawImages };
}

function createJsonManifest(states) {
  return {
    name: 'test',
    format: 'json-frames',
    spriteWidth: 14,
    spriteHeight: 10,
    pixelScale: 3,
    palette: { 1: '#ff0000', 2: '#00ff00' },
    states: states || {
      idle: { file: 'idle.json', intervalMs: 800 },
      working: { file: 'working.json', intervalMs: 250 }
    }
  };
}

function createJsonStateData(frames, intervalMs) {
  return {
    frames: frames || ['00|10', '01|00'],
    intervalMs: intervalMs || 800,
    palette: { 1: '#ff0000', 2: '#00ff00' }
  };
}

function setupFetchMock(responses) {
  const fetchCalls = [];
  global.fetch = vi.fn(function (url) {
    fetchCalls.push(url);
    const handler = responses[url];
    if (!handler) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve(handler); }
    });
  });
  return fetchCalls;
}

describe('decodeFrame', function () {
  test('decodes single-row hex string', function () {
    const result = decodeFrame('0123');
    expect(result).toEqual([[0, 1, 2, 3]]);
  });

  test('decodes multi-row hex string separated by pipes', function () {
    const result = decodeFrame('ab|cd');
    expect(result).toEqual([[10, 11], [12, 13]]);
  });

  test('handles empty rows', function () {
    const result = decodeFrame('|');
    expect(result).toEqual([[], []]);
  });

  test('decodes full capybara-format frame (14x10)', function () {
    const frame = '00000000000700|00000000070000|00220000000000|02112220000000|02133112000000|00211511200000|00214441120000|00214444120000|00021111200000|00002222000000';
    const result = decodeFrame(frame);
    expect(result.length).toBe(10);
    expect(result[0].length).toBe(14);
    expect(result[0][11]).toBe(7);
    expect(result[3][1]).toBe(2);
  });

  test('preserves hex values 0-f', function () {
    const result = decodeFrame('0123456789abcdef');
    expect(result).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]);
  });
});

describe('createPetEngine - initialization', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 0; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('returns engine with all public methods', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    expect(engine.loadSkin).toBeTypeOf('function');
    expect(engine.setState).toBeTypeOf('function');
    expect(engine.render).toBeTypeOf('function');
    expect(engine.start).toBeTypeOf('function');
    expect(engine.stop).toBeTypeOf('function');
    expect(engine.getState).toBeTypeOf('function');
    expect(engine.isRunning).toBeTypeOf('function');
    expect(engine.getManifest).toBeTypeOf('function');
  });

  test('defaults to idle state', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    expect(engine.getState()).toBe('idle');
  });

  test('is not running initially', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    expect(engine.isRunning()).toBe(false);
  });

  test('has no manifest initially', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    expect(engine.getManifest()).toBeNull();
  });

  test('passes 2d to getContext', function () {
    const { canvas } = createMockCanvas();
    createPetEngine(canvas);
    expect(canvas.getContext).toHaveBeenCalledWith('2d');
  });
});

describe('createPetEngine - setState', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 0; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('changes current state', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.setState('working');
    expect(engine.getState()).toBe('working');
  });

  test('ignores setState with same state (no-op)', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.setState('idle');
    expect(engine.getState()).toBe('idle');
  });

  test('accepts any string state (engine does not validate)', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.setState('nonexistent');
    expect(engine.getState()).toBe('nonexistent');
  });
});

describe('createPetEngine - loadSkin', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 0; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('fetches manifest and all state files for json-frames format', async function () {
    const manifest = createJsonManifest();
    const idleData = createJsonStateData();
    const workingData = createJsonStateData(['10|01'], 250);

    const fetchCalls = setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData,
      '/api/skins/default/working.json': workingData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    expect(fetchCalls).toContain('/api/skins/default/manifest.json');
    expect(fetchCalls).toContain('/api/skins/default/idle.json');
    expect(fetchCalls).toContain('/api/skins/default/working.json');
  });

  test('resizes canvas to spriteWidth * pixelScale', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData();

    setupFetchMock({
      '/api/skins/test/manifest.json': manifest,
      '/api/skins/test/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('test');

    expect(canvas.width).toBe(42);
    expect(canvas.height).toBe(30);
  });

  test('uses baseUrl option in fetch calls', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData();

    const fetchCalls = setupFetchMock({
      'http://localhost:3000/api/skins/default/manifest.json': manifest,
      'http://localhost:3000/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas, { baseUrl: 'http://localhost:3000' });
    await engine.loadSkin('default');

    expect(fetchCalls[0]).toBe('http://localhost:3000/api/skins/default/manifest.json');
  });

  test('defaults skin name to default when called with falsy', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData();

    const fetchCalls = setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin(null);

    expect(fetchCalls[0]).toContain('/api/skins/default/');
  });

  test('sets manifest accessible via getManifest()', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData();

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    expect(engine.getManifest()).toEqual(manifest);
  });

  test('rejects when manifest fetch fails', async function () {
    global.fetch = vi.fn(function () {
      return Promise.resolve({ ok: false, status: 404 });
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);

    await expect(engine.loadSkin('missing')).rejects.toThrow('Failed to load manifest');
  });

  test('gracefully handles individual state file fetch failure', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(100);
    expect(engine.getManifest()).toEqual(manifest);
  });

  test('clears previous state when loading new skin', async function () {
    const manifest1 = createJsonManifest({ idle: { file: 'idle.json' } });
    const manifest2 = createJsonManifest({ working: { file: 'working.json' } });
    const idleData = createJsonStateData();
    const workingData = createJsonStateData(['10|01'], 250);

    let callCount = 0;
    global.fetch = vi.fn(function (url) {
      callCount++;
      if (callCount <= 2) {
        if (url.includes('manifest')) return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest1) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(idleData) });
      }
      if (url.includes('manifest')) return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest2) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(workingData) });
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('skin1');
    expect(engine.getManifest()).toEqual(manifest1);

    await engine.loadSkin('skin2');
    expect(engine.getManifest()).toEqual(manifest2);
  });
});

describe('createPetEngine - render (json-frames)', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 1000; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('renders nothing when no skin loaded', function () {
    const { canvas, ctx } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.render(100);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  test('renders json frame pixels at correct positions (scale=3)', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json', intervalMs: 800 } });
    const idleData = createJsonStateData(['01|10'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, ctx, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(100);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(fillRects.length).toBe(2);
    expect(fillRects[0]).toEqual({ x: 3, y: 0, w: 3, h: 3, color: '#ff0000' });
    expect(fillRects[1]).toEqual({ x: 0, y: 3, w: 3, h: 3, color: '#ff0000' });
  });

  test('disables imageSmoothingEnabled on every render', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData(['01'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, ctx } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    ctx.imageSmoothingEnabled = true;
    engine.render(100);
    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  test('advances frame after interval elapsed', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json', intervalMs: 100 } });
    const idleData = {
      frames: ['10|00', '00|01'],
      intervalMs: 100,
      palette: { 1: '#ff0000' }
    };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(1000);
    const firstRects = [...fillRects];
    expect(firstRects.length).toBe(1);
    expect(firstRects[0].x).toBe(0);
    expect(firstRects[0].y).toBe(0);

    fillRects.length = 0;
    engine.render(1200);
    expect(fillRects.length).toBe(1);
    expect(fillRects[0].x).toBe(3);
    expect(fillRects[0].y).toBe(3);
  });

  test('does not advance frame before interval', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json', intervalMs: 1000 } });
    const idleData = {
      frames: ['10|00', '00|01'],
      intervalMs: 1000,
      palette: { 1: '#ff0000' }
    };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(1000);
    fillRects.length = 0;

    engine.render(1500);
    expect(fillRects.length).toBe(1);
    expect(fillRects[0].x).toBe(0);
  });

  test('wraps frame index cyclically', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json', intervalMs: 100 } });
    const idleData = {
      frames: ['10', '01'],
      intervalMs: 100,
      palette: { 1: '#ff0000' }
    };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(1000);
    fillRects.length = 0;
    engine.render(1200);
    fillRects.length = 0;
    engine.render(1400);
    expect(fillRects[0].x).toBe(0);
  });

  test('falls back to idle frames when current state has no data', async function () {
    const manifest = createJsonManifest({
      idle: { file: 'idle.json', intervalMs: 800 }
    });
    const idleData = createJsonStateData(['10'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.setState('nonexistent');
    engine.render(100);

    expect(fillRects.length).toBe(1);
  });

  test('skips transparent pixels (value 0)', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = {
      frames: ['0100'],
      palette: { 1: '#ff0000' },
      intervalMs: 800
    };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(100);
    expect(fillRects.length).toBe(1);
    expect(fillRects[0].x).toBe(3);
  });

  test('skips pixels with no palette entry', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = {
      frames: ['19'],
      palette: { 1: '#ff0000' },
      intervalMs: 800
    };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(100);
    expect(fillRects.length).toBe(1);
    expect(fillRects[0].color).toBe('#ff0000');
  });
});

describe('createPetEngine - start/stop', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 42; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 0; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('start sets running and calls requestAnimationFrame', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(global.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  test('start is idempotent (no double rAF)', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.start();
    engine.start();
    expect(global.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  test('stop cancels animation frame', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  test('stop is safe when not running', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.stop();
    expect(engine.isRunning()).toBe(false);
    expect(global.cancelAnimationFrame).not.toHaveBeenCalled();
  });

  test('can restart after stop', function () {
    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    engine.start();
    engine.stop();
    engine.start();
    expect(engine.isRunning()).toBe(true);
    expect(global.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });
});

describe('createPetEngine - image format skin', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 0; }) };
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('loads image skin and renders via drawImage', async function () {
    const manifest = {
      name: 'img-skin',
      format: 'image',
      states: { idle: { file: 'idle.gif', intervalMs: 800 } }
    };

    setupFetchMock({
      '/api/skins/imgskin/manifest.json': manifest
    });

    global.Image = function () {
      this.width = 64;
      this.height = 48;
      this.onload = null;
      this.onerror = null;
      const self = this;
      Object.defineProperty(this, 'src', {
        set: function () {
          if (self.onload) Promise.resolve().then(function () { self.onload(); });
        },
        get: function () { return ''; }
      });
    };

    const { canvas, drawImages } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('imgskin');

    engine.render(100);
    expect(drawImages.length).toBe(1);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
  });

  test('sets stateFrames to null on image load error', async function () {
    const manifest = {
      name: 'broken',
      format: 'image',
      states: { idle: { file: 'broken.gif', intervalMs: 800 } }
    };

    setupFetchMock({
      '/api/skins/broken/manifest.json': manifest
    });

    global.Image = function () {
      this.onload = null;
      this.onerror = null;
      const self = this;
      Object.defineProperty(this, 'src', {
        set: function () {
          if (self.onerror) Promise.resolve().then(function () { self.onerror(new Error('fail')); });
        },
        get: function () { return ''; }
      });
    };

    const { canvas, ctx } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('broken');

    engine.render(100);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe('createPetEngine - edge cases', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 500; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('render uses performance.now as fallback when timestamp is 0', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData(['10'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(0);
    expect(global.performance.now).toHaveBeenCalled();
  });

  test('manifest with no states resolves loadSkin gracefully', async function () {
    const manifest = { name: 'empty', format: 'json-frames' };
    setupFetchMock({
      '/api/skins/empty/manifest.json': manifest
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('empty');
    expect(engine.getManifest()).toEqual(manifest);
  });

  test('setState resets frame index to 0', async function () {
    const manifest = createJsonManifest({
      idle: { file: 'idle.json', intervalMs: 50 },
      working: { file: 'working.json', intervalMs: 50 }
    });
    const idleData = { frames: ['10', '01'], intervalMs: 50, palette: { 1: '#f00' } };
    const workingData = { frames: ['10', '01'], intervalMs: 50, palette: { 1: '#0f0' } };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData,
      '/api/skins/default/working.json': workingData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(1000);
    engine.render(1100);

    engine.setState('working');
    fillRects.length = 0;
    engine.render(1200);
    expect(fillRects[0].x).toBe(0);
  });

  test('uses manifest palette as fallback when state data has none', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = { frames: ['10'], intervalMs: 800 };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(100);
    expect(fillRects[0].color).toBe('#ff0000');
  });

  test('uses state intervalMs from manifest when state data has none', async function () {
    const manifest = createJsonManifest({
      idle: { file: 'idle.json', intervalMs: 200 }
    });
    const idleData = { frames: ['10', '01'], palette: { 1: '#f00' } };

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas, fillRects } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    engine.render(1000);
    fillRects.length = 0;

    engine.render(1100);
    expect(fillRects[0].x).toBe(0);

    fillRects.length = 0;
    engine.render(1300);
    expect(fillRects[0].x).toBe(3);
  });
});

describe('default-pet-data - data integrity', function () {
  test('CAPYBARA palette has 7 entries with valid hex colors', function () {
    const keys = Object.keys(CAPYBARA.palette);
    expect(keys.length).toBe(7);
    for (const key of keys) {
      expect(CAPYBARA.palette[key]).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    }
  });

  test('CAPYBARA has 3 source states each with 2 frames', function () {
    for (const state of ['idle', 'running', 'waiting']) {
      expect(CAPYBARA[state]).toBeDefined();
      expect(CAPYBARA[state].length).toBe(2);
    }
  });

  test('each frame decodes to 10 rows x 14 columns', function () {
    for (const state of ['idle', 'running', 'waiting']) {
      for (const frame of CAPYBARA[state]) {
        const decoded = decodeFrame(frame);
        expect(decoded.length).toBe(10);
        for (const row of decoded) {
          expect(row.length).toBe(14);
        }
      }
    }
  });

  test('all pixel values are within palette range (0-7)', function () {
    for (const state of ['idle', 'running', 'waiting']) {
      for (const frame of CAPYBARA[state]) {
        const decoded = decodeFrame(frame);
        for (const row of decoded) {
          for (const pixel of row) {
            expect(pixel).toBeGreaterThanOrEqual(0);
            expect(pixel).toBeLessThanOrEqual(7);
          }
        }
      }
    }
  });

  test('STATE_SOURCE_MAP covers all 10 PET_STATES', function () {
    for (const state of PET_STATES) {
      expect(STATE_SOURCE_MAP[state]).toBeDefined();
      expect(['idle', 'running', 'waiting']).toContain(STATE_SOURCE_MAP[state]);
    }
  });

  test('STATE_INTERVAL_MAP covers all 10 PET_STATES with positive integers', function () {
    for (const state of PET_STATES) {
      expect(STATE_INTERVAL_MAP[state]).toBeDefined();
      expect(STATE_INTERVAL_MAP[state]).toBeGreaterThan(0);
      expect(Number.isInteger(STATE_INTERVAL_MAP[state])).toBe(true);
    }
  });

  test('DEFAULT_INTERVAL_MS is 800', function () {
    expect(DEFAULT_INTERVAL_MS).toBe(800);
  });
});

describe('decodeFrame - adversarial inputs', function () {
  test('returns empty array for null input', function () {
    expect(decodeFrame(null)).toEqual([]);
  });

  test('returns empty array for undefined input', function () {
    expect(decodeFrame(undefined)).toEqual([]);
  });

  test('returns empty array for numeric input', function () {
    expect(decodeFrame(123)).toEqual([]);
  });

  test('handles non-hex characters (produces NaN which is falsy)', function () {
    const result = decodeFrame('zz');
    expect(result.length).toBe(1);
    expect(result[0].length).toBe(2);
    expect(Number.isNaN(result[0][0])).toBe(true);
  });
});

describe('createPetEngine - adversarial', function () {
  beforeEach(function () {
    global.requestAnimationFrame = vi.fn(function () { return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance = { now: vi.fn(function () { return 1000; }) };
    global.Image = function () {};
  });

  afterEach(function () {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
    delete global.performance;
    delete global.Image;
    delete global.fetch;
  });

  test('render with NaN timestamp does not crash', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData(['10'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    expect(function () { engine.render(NaN); }).not.toThrow();
  });

  test('render with negative timestamp does not crash', async function () {
    const manifest = createJsonManifest({ idle: { file: 'idle.json' } });
    const idleData = createJsonStateData(['10'], 800);

    setupFetchMock({
      '/api/skins/default/manifest.json': manifest,
      '/api/skins/default/idle.json': idleData
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('default');

    expect(function () { engine.render(-100); }).not.toThrow();
  });

  test('concurrent loadSkin calls: second call overwrites first', async function () {
    const manifest1 = createJsonManifest({ idle: { file: 'idle.json' } });
    const manifest2 = { name: 'second', format: 'json-frames', spriteWidth: 8, spriteHeight: 8, pixelScale: 2, states: {} };

    let resolveFirst;
    const firstPromise = new Promise(function (r) { resolveFirst = r; });

    let callIndex = 0;
    global.fetch = vi.fn(function (url) {
      callIndex++;
      if (callIndex === 1) {
        return firstPromise.then(function () {
          return { ok: true, json: function () { return Promise.resolve(manifest1); } };
        });
      }
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve(manifest2); }
      });
    });

    const { canvas } = createMockCanvas();
    const engine = createPetEngine(canvas);

    const p1 = engine.loadSkin('slow');
    const p2 = engine.loadSkin('fast');

    await p2;
    expect(engine.getManifest()).toEqual(manifest2);

    resolveFirst();
    await p1;
    expect(engine.getManifest()).toEqual(manifest1);
  });

  test('unknown format in manifest is handled gracefully', async function () {
    const manifest = {
      name: 'weird',
      format: 'unknown-format',
      states: { idle: { file: 'idle.dat' } }
    };

    setupFetchMock({
      '/api/skins/weird/manifest.json': manifest
    });

    const { canvas, ctx } = createMockCanvas();
    const engine = createPetEngine(canvas);
    await engine.loadSkin('weird');

    engine.render(100);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
