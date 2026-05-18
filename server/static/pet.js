'use strict';

var DEFAULT_INTERVAL_MS = 800;

function decodeFrame(str) {
  if (typeof str !== 'string') return [];
  return str.split('|').map(function (row) {
    return Array.from(row).map(function (c) { return parseInt(c, 16); });
  });
}

function createPetEngine(canvas, options) {
  var ctx = canvas.getContext('2d');
  var baseUrl = (options && options.baseUrl) || '';

  var skinName = 'default';
  var manifest = null;
  var stateFrames = {};
  var currentState = 'idle';
  var frameIndex = 0;
  var lastFrameTime = 0;
  var animationId = null;
  var running = false;

  function loadSkin(name) {
    skinName = name || 'default';
    stateFrames = {};
    manifest = null;

    return fetch(baseUrl + '/api/skins/' + skinName + '/manifest.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load manifest');
        return res.json();
      })
      .then(function (m) {
        manifest = m;
        resizeCanvas();
        return loadAllStates();
      })
      .then(function () {
        frameIndex = 0;
        lastFrameTime = 0;
      });
  }

  function resizeCanvas() {
    if (!manifest) return;
    if (manifest.format === 'json-frames') {
      var w = (manifest.spriteWidth || 14) * (manifest.pixelScale || 3);
      var h = (manifest.spriteHeight || 10) * (manifest.pixelScale || 3);
      canvas.width = w;
      canvas.height = h;
    }
  }

  function loadAllStates() {
    if (!manifest || !manifest.states) return Promise.resolve();

    var promises = Object.keys(manifest.states).map(function (state) {
      return loadStateFrames(state);
    });

    return Promise.all(promises);
  }

  function loadStateFrames(state) {
    var stateInfo = manifest.states[state];
    if (!stateInfo) return Promise.resolve();

    if (manifest.format === 'json-frames') {
      return fetch(baseUrl + '/api/skins/' + skinName + '/' + stateInfo.file)
        .then(function (res) {
          if (!res.ok) throw new Error('Failed to load ' + stateInfo.file);
          return res.json();
        })
        .then(function (data) {
          stateFrames[state] = {
            type: 'json',
            frames: data.frames.map(decodeFrame),
            palette: data.palette || (manifest.palette) || {},
            intervalMs: stateInfo.intervalMs || data.intervalMs || DEFAULT_INTERVAL_MS
          };
        })
        .catch(function (err) {
          console.warn('[pet] Failed to load state:', state, err && err.message);
          stateFrames[state] = null;
        });
    }

    if (manifest.format === 'image-frames' && stateInfo.files) {
      var imagePromises = stateInfo.files.map(function (f) {
        return loadImage(baseUrl + '/api/skins/' + skinName + '/' + f);
      });
      return Promise.all(imagePromises).then(function (images) {
        stateFrames[state] = {
          type: 'images',
          images: images,
          intervalMs: stateInfo.intervalMs || DEFAULT_INTERVAL_MS
        };
        if (images.length > 0) {
          var first = images[0];
          if (!canvas.width || canvas.width < first.width) {
            canvas.width = first.width;
            canvas.height = first.height;
          }
        }
      }).catch(function (err) {
        console.warn('[pet] Failed to load image-frames:', state, err && err.message);
        stateFrames[state] = null;
      });
    }

    if (manifest.format === 'image') {
      var url = baseUrl + '/api/skins/' + skinName + '/' + stateInfo.file;
      return loadImage(url).then(function (img) {
        stateFrames[state] = {
          type: 'image',
          image: img,
          intervalMs: stateInfo.intervalMs || DEFAULT_INTERVAL_MS
        };
        if (!canvas.width || canvas.width < img.width) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
      }).catch(function (err) {
        console.warn('[pet] Failed to load image:', state, err && err.message);
        stateFrames[state] = null;
      });
    }

    return Promise.resolve();
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function setState(state) {
    if (state === currentState) return;
    currentState = state;
    frameIndex = 0;
    lastFrameTime = 0;
  }

  function render(timestamp) {
    var data = stateFrames[currentState];

    if (!data) {
      data = stateFrames['idle'];
    }
    if (!data) return;

    var interval = data.intervalMs || DEFAULT_INTERVAL_MS;
    if (timestamp && lastFrameTime) {
      if (timestamp - lastFrameTime >= interval) {
        var totalFrames = data.type === 'json' ? data.frames.length
          : data.type === 'images' ? data.images.length : 1;
        frameIndex = (frameIndex + 1) % totalFrames;
        lastFrameTime = timestamp;
      }
    } else {
      lastFrameTime = timestamp || performance.now();
    }

    ctx.imageSmoothingEnabled = false;

    if (data.type === 'json') {
      renderJsonFrame(data, frameIndex);
    } else if (data.type === 'images') {
      renderImagesFrame(data, frameIndex);
    } else if (data.type === 'image') {
      renderImageFrame(data);
    }
  }

  function renderJsonFrame(data, idx) {
    var frame = data.frames[idx];
    if (!frame) return;

    var palette = data.palette;
    var scale = (manifest && manifest.pixelScale) || 3;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (var y = 0; y < frame.length; y++) {
      var row = frame[y];
      for (var x = 0; x < row.length; x++) {
        var pixel = row[x];
        if (pixel === 0) continue;
        var color = palette[pixel];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  function renderImageFrame(data) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (data.image) {
      ctx.drawImage(data.image, 0, 0);
    }
  }

  function renderImagesFrame(data, idx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var img = data.images[idx];
    if (img) {
      ctx.drawImage(img, 0, 0);
    }
  }

  function animationLoop(timestamp) {
    if (!running) return;
    render(timestamp);
    animationId = requestAnimationFrame(animationLoop);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrameTime = 0;
    animationId = requestAnimationFrame(animationLoop);
  }

  function stop() {
    running = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function getState() {
    return currentState;
  }

  function isRunning() {
    return running;
  }

  function getManifest() {
    return manifest;
  }

  return {
    loadSkin: loadSkin,
    setState: setState,
    render: render,
    start: start,
    stop: stop,
    getState: getState,
    isRunning: isRunning,
    getManifest: getManifest
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPetEngine, decodeFrame, DEFAULT_INTERVAL_MS };
}
