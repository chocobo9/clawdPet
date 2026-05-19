'use strict';

var _appExports = (function () {
  var WARNING_THRESHOLD = 0.75;
  var DANGER_THRESHOLD = 0.90;
  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 30000;
  var SESSION_WINDOW_SECONDS = 5 * 60 * 60;
  var STALE_SESSION_MS = 10 * 60 * 1000;
  var PET_DISPLAY_SCALE = 2.5;

  var EVENT_TO_STATE = {
    SessionStart: 'idle',
    UserPromptSubmit: 'thinking',
    PreToolUse: 'working',
    PostToolUse: 'working',
    PostToolUseFailure: 'error',
    Stop: 'attention',
    StopFailure: 'error',
    SubagentStart: 'juggling',
    SubagentStop: 'working',
    PreCompact: 'sweeping',
    PostCompact: 'attention',
    Notification: 'notification',
    Elicitation: 'notification',
    WorktreeCreate: 'carrying'
  };

  var EVENT_MESSAGES = {
    SessionStart: 'Starting...',
    UserPromptSubmit: 'Thinking...',
    PreToolUse: 'Working...',
    PostToolUse: 'Working...',
    PostToolUseFailure: 'Tool error!',
    Stop: 'Task complete!',
    StopFailure: 'Error!',
    SubagentStart: 'Spawning agent...',
    SubagentStop: 'Agent done',
    PreCompact: 'Compacting...',
    PostCompact: 'Compacted',
    Notification: 'Notification!',
    Elicitation: 'Needs approval!',
    SessionEnd: 'Session ended',
    SleepTimeout: 'ZZZ...'
  };

  var STATE_MESSAGES = {
    idle: 'Watching...',
    sleeping: 'ZZZ...',
    thinking: 'Thinking...',
    working: 'Working...',
    error: 'Error!',
    attention: 'Attention!',
    juggling: 'Multi-tasking...',
    sweeping: 'Cleaning up...',
    notification: 'Notification!',
    carrying: 'Carrying...'
  };

  var STATE_DOT_CLASS = {
    working: 'dot-working',
    thinking: 'dot-working',
    juggling: 'dot-working',
    carrying: 'dot-working',
    sweeping: 'dot-working',
    error: 'dot-alert',
    attention: 'dot-alert',
    notification: 'dot-alert',
    idle: 'dot-idle',
    sleeping: 'dot-idle'
  };

  var STATE_STATUS_TEXT = {
    working: 'working',
    thinking: 'working',
    juggling: 'working',
    carrying: 'working',
    sweeping: 'working',
    error: 'alert',
    attention: 'alert',
    notification: 'alert',
    idle: 'idle',
    sleeping: 'idle'
  };

  var ws = null;
  var retryCount = 0;
  var retryTimer = null;
  var clockInterval = null;

  var petEngine = null;
  var currentSkinName = 'default';

  var sessions = {};
  var selectedSessionId = null;
  var lastUsageTimestamp = null;
  var sessionResetTimestamp = null;

  var dom = {};

  function init() {
    cacheDom();
    initPetEngine();
    initClock();
    initSessionSelector();
    initSkinSelector();
    fetchActiveSkin();
    connect();
  }

  function cacheDom() {
    dom.connDot = document.getElementById('conn-dot');
    dom.connText = document.getElementById('conn-text');
    dom.userName = document.getElementById('user-name');
    dom.sessionDot = document.getElementById('session-dot');
    dom.sessionName = document.getElementById('session-name');
    dom.sessionCapsule = document.getElementById('session-capsule');
    dom.sessionSelector = document.getElementById('session-selector');
    dom.sessionDropdown = document.getElementById('session-dropdown');
    dom.bubbleText = document.getElementById('bubble-text');
    dom.sessionReset = document.getElementById('session-reset');
    dom.weeklyReset = document.getElementById('weekly-reset');
    dom.sessionUsageValue = document.getElementById('session-usage-value');
    dom.sessionUsageFill = document.getElementById('session-usage-fill');
    dom.weeklyOpusValue = document.getElementById('weekly-opus-value');
    dom.weeklyOpusFill = document.getElementById('weekly-opus-fill');
    dom.weeklySonnetValue = document.getElementById('weekly-sonnet-value');
    dom.weeklySonnetFill = document.getElementById('weekly-sonnet-fill');
    dom.clockTime = document.getElementById('clock-time');
    dom.clockDate = document.getElementById('clock-date');
    dom.updatedAgo = document.getElementById('updated-ago');
    dom.skinOverlay = document.getElementById('skin-overlay');
    dom.skinGrid = document.getElementById('skin-grid');
    dom.skinClose = document.getElementById('skin-close');
    dom.skinFileInput = document.getElementById('skin-file-input');
    dom.errorBanner = document.getElementById('error-banner');
    dom.errorText = document.getElementById('error-text');
  }

  // ---- Pet Engine ----

  function initPetEngine() {
    var canvas = document.getElementById('pet-canvas');
    if (!canvas || typeof createPetEngine === 'undefined') return;

    petEngine = createPetEngine(canvas);
    petEngine.loadSkin('default').then(function () {
      petEngine.start();
      scalePetCanvas(canvas);
    }).catch(function (err) {
      console.warn('[app] Failed to load default skin:', err.message);
    });
  }

  function scalePetCanvas(canvas) {
    if (!canvas || !canvas.width) return;
    var targetSize = 110;
    var maxDim = Math.max(canvas.width, canvas.height);
    var scale = maxDim < targetSize ? Math.floor(targetSize / maxDim) : 1;
    canvas.style.width = Math.round(canvas.width * scale) + 'px';
    canvas.style.height = Math.round(canvas.height * scale) + 'px';
  }

  // ---- Display Name ----

  function getDisplayName(sessionId, session) {
    if (session && session.displayName) return session.displayName;
    if (sessionId.indexOf('process-') === 0) return 'Claude Code';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(sessionId)) {
      return sessionId.substring(0, 8);
    }
    return sessionId;
  }

  function extractDirName(cwdPath) {
    if (!cwdPath) return null;
    var parts = cwdPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }

  // ---- Stale Session Cleanup ----

  function cleanStaleSessions() {
    var now = Date.now();
    var changed = false;
    var ids = Object.keys(sessions);
    for (var i = 0; i < ids.length; i++) {
      if (now - sessions[ids[i]].updatedAt > STALE_SESSION_MS) {
        delete sessions[ids[i]];
        changed = true;
      }
    }
    if (changed) {
      if (!selectedSessionId || !sessions[selectedSessionId]) {
        var remaining = Object.keys(sessions);
        selectedSessionId = remaining.length > 0 ? remaining[0] : null;
      }
      updateSessionCapsule();
      updateBubbleForSession();
    }
  }

  // ---- Clock ----

  function initClock() {
    updateClock();
    clockInterval = setInterval(updateClock, 1000);
    setInterval(cleanStaleSessions, 60000);
  }

  function updateClock() {
    var now = new Date();
    if (dom.clockTime) {
      dom.clockTime.textContent = padZero(now.getHours()) + ':' + padZero(now.getMinutes());
    }

    if (dom.clockDate) {
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dom.clockDate.textContent =
        now.getFullYear() + '.' +
        padZero(now.getMonth() + 1) + '.' +
        padZero(now.getDate()) + ' ' +
        days[now.getDay()];
    }

    updateUpdatedAgo();
    updateSessionCountdown();
  }

  function padZero(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function updateUpdatedAgo() {
    if (!dom.updatedAgo) return;
    if (!lastUsageTimestamp) {
      dom.updatedAgo.textContent = '';
      return;
    }
    var minutes = Math.floor((Date.now() - lastUsageTimestamp) / 60000);
    if (minutes < 1) {
      dom.updatedAgo.textContent = 'Updated just now';
    } else if (minutes < 60) {
      dom.updatedAgo.textContent = 'Updated ' + minutes + 'm ago';
    } else {
      dom.updatedAgo.textContent = 'Updated ' + Math.floor(minutes / 60) + 'h ago';
    }
  }

  function updateSessionCountdown() {
    if (!sessionResetTimestamp || !dom.sessionReset) return;
    var remaining = Math.max(0, sessionResetTimestamp - Date.now());
    dom.sessionReset.textContent = remaining <= 0 ? 'Reset!' : formatCountdown(remaining);
  }

  // ---- Session Selector ----

  function initSessionSelector() {
    if (dom.sessionCapsule) {
      dom.sessionCapsule.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSessionDropdown();
      });
    }

    document.addEventListener('click', function (e) {
      if (dom.sessionSelector && !dom.sessionSelector.contains(e.target)) {
        closeSessionDropdown();
      }
    });
  }

  function toggleSessionDropdown() {
    if (!dom.sessionSelector) return;
    dom.sessionSelector.classList.toggle('open');
    if (dom.sessionSelector.classList.contains('open')) {
      renderSessionDropdown();
    }
  }

  function closeSessionDropdown() {
    if (dom.sessionSelector) {
      dom.sessionSelector.classList.remove('open');
    }
  }

  function renderSessionDropdown() {
    if (!dom.sessionDropdown) return;
    dom.sessionDropdown.innerHTML = '';

    var ids = Object.keys(sessions);
    if (ids.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'session-item';
      var emptyText = document.createElement('span');
      emptyText.className = 'session-item-task';
      emptyText.textContent = 'No active sessions';
      empty.appendChild(emptyText);
      dom.sessionDropdown.appendChild(empty);
      return;
    }

    ids.forEach(function (id) {
      var session = sessions[id];
      var item = document.createElement('div');
      item.className = 'session-item';

      var dot = document.createElement('span');
      dot.className = 'dot ' + (STATE_DOT_CLASS[session.state] || 'dot-idle');

      var info = document.createElement('div');
      info.className = 'session-item-info';

      var name = document.createElement('div');
      name.className = 'session-item-name';
      name.textContent = getDisplayName(id, session);

      var task = document.createElement('div');
      task.className = 'session-item-task';
      task.textContent = session.message || STATE_MESSAGES[session.state] || '';

      info.appendChild(name);
      info.appendChild(task);

      var status = document.createElement('span');
      status.className = 'session-item-status';
      status.textContent = STATE_STATUS_TEXT[session.state] || 'idle';

      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(status);

      item.addEventListener('click', function (e) {
        e.stopPropagation();
        selectSession(id);
        closeSessionDropdown();
      });

      dom.sessionDropdown.appendChild(item);
    });
  }

  function selectSession(sessionId) {
    selectedSessionId = sessionId;
    updateSessionCapsule();
    updateBubbleForSession();

    if (petEngine && sessions[selectedSessionId]) {
      petEngine.setState(sessions[selectedSessionId].state);
    }
  }

  function updateSessionCapsule() {
    if (!dom.sessionName || !dom.sessionDot) return;

    if (!selectedSessionId || !sessions[selectedSessionId]) {
      var ids = Object.keys(sessions);
      selectedSessionId = ids.length > 0 ? ids[0] : null;
    }

    if (!selectedSessionId) {
      dom.sessionName.textContent = '--';
      dom.sessionDot.className = 'dot dot-idle';
      return;
    }

    var session = sessions[selectedSessionId];
    dom.sessionName.textContent = getDisplayName(selectedSessionId, session);
    dom.sessionDot.className = 'dot ' + (STATE_DOT_CLASS[session.state] || 'dot-idle');
  }

  function updateBubbleForSession() {
    if (!dom.bubbleText) return;

    if (!selectedSessionId || !sessions[selectedSessionId]) {
      dom.bubbleText.textContent = 'Watching...';
      return;
    }

    var session = sessions[selectedSessionId];
    dom.bubbleText.textContent = session.message || STATE_MESSAGES[session.state] || 'Watching...';
  }

  // ---- Skin Selector ----

  function initSkinSelector() {
    var canvas = document.getElementById('pet-canvas');
    if (canvas) {
      canvas.addEventListener('click', function () {
        openSkinSelector();
      });
    }

    if (dom.skinClose) {
      dom.skinClose.addEventListener('click', function () {
        closeSkinSelector();
      });
    }

    if (dom.skinOverlay) {
      dom.skinOverlay.addEventListener('click', function (e) {
        if (e.target === dom.skinOverlay) {
          closeSkinSelector();
        }
      });
    }

    if (dom.skinFileInput) {
      dom.skinFileInput.addEventListener('change', handleSkinUpload);
    }
  }

  function fetchActiveSkin() {
    fetch('/api/skins/active')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.active && data.active !== 'default') {
          currentSkinName = data.active;
          if (petEngine) {
            var canvas = document.getElementById('pet-canvas');
            petEngine.loadSkin(currentSkinName).then(function () {
              scalePetCanvas(canvas);
            }).catch(function () {});
          }
        }
      })
      .catch(function () {});
  }

  function openSkinSelector() {
    if (!dom.skinOverlay) return;
    dom.skinOverlay.classList.add('visible');

    fetch('/api/skins')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        renderSkinGrid(data.skins || []);
      })
      .catch(function () {});
  }

  function closeSkinSelector() {
    if (dom.skinOverlay) {
      dom.skinOverlay.classList.remove('visible');
    }
  }

  function renderSkinGrid(skins) {
    if (!dom.skinGrid) return;
    dom.skinGrid.innerHTML = '';

    skins.forEach(function (skin) {
      var item = document.createElement('div');
      item.className = 'skin-item';
      if (skin.name === currentSkinName) {
        item.classList.add('selected');
      }

      var canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      canvas.style.width = '48px';
      canvas.style.height = '48px';
      item.appendChild(canvas);

      item.addEventListener('click', function () {
        chooseSkin(skin.name);
      });

      dom.skinGrid.appendChild(item);
      renderSkinPreview(canvas, skin.name);
    });

    var uploadItem = document.createElement('div');
    uploadItem.className = 'skin-item upload-item';
    uploadItem.textContent = '+';
    uploadItem.addEventListener('click', function () {
      if (dom.skinFileInput) dom.skinFileInput.click();
    });
    dom.skinGrid.appendChild(uploadItem);
  }

  function renderSkinPreview(canvas, skinName) {
    fetch('/api/skins/' + skinName + '/manifest.json')
      .then(function (res) {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(function (manifest) {
        if (!manifest.states || !manifest.states.idle) return;

        if (manifest.format === 'image-frames' && manifest.states.idle.files) {
          var firstFile = manifest.states.idle.files[0];
          var img = new Image();
          img.onload = function () {
            var ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            var scale = Math.min(canvas.width / img.width, canvas.height / img.height);
            var ox = Math.floor((canvas.width - img.width * scale) / 2);
            var oy = Math.floor((canvas.height - img.height * scale) / 2);
            ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
          };
          img.src = '/api/skins/' + skinName + '/' + firstFile;
          return;
        }

        if (manifest.format === 'json-frames' && manifest.states.idle.file) {
          return fetch('/api/skins/' + skinName + '/' + manifest.states.idle.file)
            .then(function (res) { return res.json(); })
            .then(function (data) {
              drawPreviewFrame(canvas, manifest, data);
            });
        }
      })
      .catch(function () {});
  }

  function drawPreviewFrame(canvas, manifest, data) {
    if (!data.frames || data.frames.length === 0) return;
    if (typeof decodeFrame !== 'function') return;

    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    var frame = decodeFrame(data.frames[0]);
    if (frame.length === 0) return;

    var palette = data.palette || manifest.palette || {};
    var spriteW = manifest.spriteWidth || 14;
    var spriteH = manifest.spriteHeight || 10;
    var scale = Math.min(canvas.width / spriteW, canvas.height / spriteH);
    var offsetX = Math.floor((canvas.width - spriteW * scale) / 2);
    var offsetY = Math.floor((canvas.height - spriteH * scale) / 2);

    for (var y = 0; y < frame.length; y++) {
      var row = frame[y];
      for (var x = 0; x < row.length; x++) {
        if (row[x] === 0) continue;
        var color = palette[row[x]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
      }
    }
  }

  function chooseSkin(skinName) {
    currentSkinName = skinName;

    fetch('/api/skins/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skin: skinName })
    }).catch(function () {});

    if (petEngine) {
      var canvas = document.getElementById('pet-canvas');
      petEngine.loadSkin(skinName).then(function () {
        scalePetCanvas(canvas);
      }).catch(function () {});
    }

    closeSkinSelector();
  }

  function handleSkinUpload() {
    var file = dom.skinFileInput.files && dom.skinFileInput.files[0];
    if (!file) return;

    var formData = new FormData();
    formData.append('file', file);
    var skinName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    formData.append('name', skinName);

    if (file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      formData.append('state', 'idle');
    }

    fetch('/api/skins/upload', { method: 'POST', body: formData })
      .then(function (res) { return res.json(); })
      .then(function () {
        chooseSkin(skinName);
        openSkinSelector();
      })
      .catch(function () {});

    dom.skinFileInput.value = '';
  }

  // ---- Session Fetch ----

  function fetchSessions() {
    fetch('/api/sessions')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.sessions) return;
        var serverSessions = data.sessions;
        var ids = Object.keys(serverSessions);
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          var s = serverSessions[id];
          if (!sessions[id]) {
            sessions[id] = {
              state: s.state || 'idle',
              event: null,
              message: STATE_MESSAGES[s.state] || 'Watching...',
              displayName: extractDirName(s.cwd),
              updatedAt: s.updatedAt || Date.now()
            };
          }
        }
        if (!selectedSessionId || !sessions[selectedSessionId]) {
          var remaining = Object.keys(sessions);
          selectedSessionId = remaining.length > 0 ? remaining[0] : null;
        }
        updateSessionCapsule();
        updateBubbleForSession();

        if (petEngine && data.resolvedState) {
          petEngine.setState(data.resolvedState);
        }
      })
      .catch(function () {});
  }

  // ---- WebSocket ----

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = protocol + '//' + location.host + '/ws';

    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn('[app] WebSocket creation failed:', err.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      retryCount = 0;
      setConnectionStatus('connected');
      fetchSessions();
    };

    ws.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.warn('[app] Invalid WebSocket message:', err.message);
        return;
      }
      handleMessage(msg);
    };

    ws.onclose = function () {
      setConnectionStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = function () {};
  }

  function scheduleReconnect() {
    if (retryTimer) return;

    var delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, retryCount), RECONNECT_MAX_MS);
    retryCount++;
    setConnectionStatus('reconnecting');

    retryTimer = setTimeout(function () {
      retryTimer = null;
      connect();
    }, delay);
  }

  function setConnectionStatus(status) {
    if (!dom.connDot) return;

    dom.connDot.className = 'dot';
    if (status === 'connected') {
      dom.connDot.classList.add('dot-connected');
      if (dom.connText) dom.connText.textContent = 'Connected';
    } else if (status === 'reconnecting') {
      dom.connDot.classList.add('dot-reconnecting');
      if (dom.connText) dom.connText.textContent = 'Reconnecting...';
    } else {
      dom.connDot.classList.add('dot-disconnected');
      if (dom.connText) dom.connText.textContent = 'Disconnected';
    }
  }

  // ---- Message Handling ----

  function handleMessage(msg) {
    if (msg.type === 'usage_update') {
      updateUsage(msg.data);
    } else if (msg.type === 'task_event') {
      updatePetState(msg.data);
    }
  }

  function updateUsage(data) {
    if (!data) return;

    if (data.error) {
      showError(data.error);
      return;
    }
    hideError();

    lastUsageTimestamp = data.lastUpdatedAt
      ? new Date(data.lastUpdatedAt).getTime()
      : Date.now();

    updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, data.sessionUsage);

    updatePercentageBar(
      dom.weeklyOpusFill,
      dom.weeklyOpusValue,
      data.weeklyOpusUsage != null ? data.weeklyOpusUsage : data.weeklyUsage
    );

    updatePercentageBar(dom.weeklySonnetFill, dom.weeklySonnetValue, data.weeklySonnetUsage);

    if (data.sessionResetAt) {
      sessionResetTimestamp = new Date(data.sessionResetAt).getTime();
    }

    if (data.weeklyResetAt && dom.weeklyReset) {
      dom.weeklyReset.textContent = formatResetsAt(new Date(data.weeklyResetAt).getTime());
    }
  }

  function updatePercentageBar(fillEl, valueEl, utilization) {
    if (!fillEl || !valueEl) return;

    if (utilization == null || !isFinite(utilization)) {
      fillEl.style.width = '0%';
      valueEl.textContent = '--';
      fillEl.classList.remove('warning', 'danger');
      return;
    }

    var pct = Math.min(utilization / 100, 1);
    fillEl.style.width = (pct * 100).toFixed(1) + '%';
    valueEl.textContent = utilization.toFixed(0) + '%';

    fillEl.classList.remove('warning', 'danger');
    if (pct >= DANGER_THRESHOLD) {
      fillEl.classList.add('danger');
    } else if (pct >= WARNING_THRESHOLD) {
      fillEl.classList.add('warning');
    }
  }

  function updatePetState(data) {
    if (!data) return;

    var sessionId = data.sessionId || 'default';
    var event = data.event;
    var resolvedState = data.resolvedState;

    if (event === 'SessionEnd') {
      delete sessions[sessionId];
    } else if (event !== 'OneshotReturn' && event !== 'SleepTimeout') {
      var sessionState = EVENT_TO_STATE[event] || 'idle';
      var prevSession = sessions[sessionId];
      var displayName = extractDirName(data.cwd)
        || (prevSession && prevSession.displayName)
        || null;
      sessions[sessionId] = {
        state: sessionState,
        event: event,
        message: EVENT_MESSAGES[event] || STATE_MESSAGES[sessionState] || 'Watching...',
        displayName: displayName,
        updatedAt: Date.now()
      };
    }

    if (!selectedSessionId || !sessions[selectedSessionId]) {
      var ids = Object.keys(sessions);
      selectedSessionId = ids.length > 0 ? ids[0] : null;
    }

    updateSessionCapsule();

    if (event === 'SleepTimeout') {
      if (dom.bubbleText) dom.bubbleText.textContent = 'ZZZ...';
    } else if (event !== 'OneshotReturn') {
      updateBubbleForSession();
    }

    var targetPetState = null;
    if (event === 'SleepTimeout') {
      targetPetState = 'sleeping';
    } else if (selectedSessionId && sessions[selectedSessionId]) {
      targetPetState = sessions[selectedSessionId].state;
    } else {
      targetPetState = resolvedState || 'idle';
    }

    if (petEngine && targetPetState) {
      petEngine.setState(targetPetState);
    }

    if (event === 'Stop' || event === 'Notification') {
      callAndroidBridge('playAlarm', 'finished');
    } else if (event === 'Elicitation') {
      callAndroidBridge('playAlarm', 'permission');
    }
  }

  // ---- Utilities ----

  function showError(errorType) {
    if (!dom.errorBanner || !dom.errorText) return;
    if (errorType === 'rate-limited' || errorType === 'timeout') {
      dom.errorBanner.style.display = 'none';
      return;
    }
    var messages = {
      'no-credentials': 'No credentials found',
      'api-error': 'API error',
      'parse-error': 'Data parse error'
    };
    dom.errorText.textContent = messages[errorType] || errorType;
    dom.errorBanner.style.display = 'block';
  }

  function hideError() {
    if (!dom.errorBanner) return;
    dom.errorBanner.style.display = 'none';
  }

  function formatCountdown(ms) {
    var totalSec = Math.floor(ms / 1000);
    var days = Math.floor(totalSec / 86400);
    var hours = Math.floor((totalSec % 86400) / 3600);
    var minutes = Math.floor((totalSec % 3600) / 60);

    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    return minutes + 'm';
  }

  function formatResetsAt(timestamp) {
    var remaining = Math.max(0, timestamp - Date.now());
    if (remaining <= 0) return 'Reset!';
    return formatCountdown(remaining);
  }

  function callAndroidBridge(method, arg) {
    if (typeof window !== 'undefined' && window.Android && typeof window.Android[method] === 'function') {
      try {
        window.Android[method](arg);
      } catch (err) {
        console.warn('[app] Android bridge error:', err.message);
      }
    } else {
      console.warn('[app] Android.' + method + '(' + arg + ') — bridge not available');
    }
  }

  // ---- Bootstrap ----

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return {
    formatCountdown: formatCountdown,
    formatResetsAt: formatResetsAt,
    updatePercentageBar: updatePercentageBar,
    updateUsage: updateUsage,
    updatePetState: updatePetState,
    handleMessage: handleMessage,
    showError: showError,
    hideError: hideError,
    callAndroidBridge: callAndroidBridge,
    WARNING_THRESHOLD: WARNING_THRESHOLD,
    DANGER_THRESHOLD: DANGER_THRESHOLD,
    RECONNECT_BASE_MS: RECONNECT_BASE_MS,
    RECONNECT_MAX_MS: RECONNECT_MAX_MS,
    SESSION_WINDOW_SECONDS: SESSION_WINDOW_SECONDS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _appExports;
}
