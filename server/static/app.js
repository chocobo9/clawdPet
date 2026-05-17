'use strict';

var _appExports = (function () {
  var WARNING_THRESHOLD = 0.75;
  var DANGER_THRESHOLD = 0.90;
  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 30000;
  var TIMER_CIRCUMFERENCE = 2 * Math.PI * 10;
  var SESSION_WINDOW_SECONDS = 5 * 60 * 60;

  var ws = null;
  var retryCount = 0;
  var retryTimer = null;
  var countdownInterval = null;
  var sessionResetTimestamp = null;

  var petEngine = null;

  var dom = {};

  function init() {
    cacheDom();
    initPetEngine();
    connect();
  }

  function cacheDom() {
    dom.connDot = document.getElementById('conn-dot');
    dom.connText = document.getElementById('conn-text');
    dom.petState = document.getElementById('pet-state');
    dom.sessionReset = document.getElementById('session-reset');
    dom.weeklyReset = document.getElementById('weekly-reset');
    dom.sessionUsageValue = document.getElementById('session-usage-value');
    dom.sessionUsageFill = document.getElementById('session-usage-fill');
    dom.weeklyOpusValue = document.getElementById('weekly-opus-value');
    dom.weeklyOpusFill = document.getElementById('weekly-opus-fill');
    dom.weeklySonnetValue = document.getElementById('weekly-sonnet-value');
    dom.weeklySonnetFill = document.getElementById('weekly-sonnet-fill');
    dom.timerCircle = document.getElementById('timer-circle');
    dom.timerText = document.getElementById('timer-text');
    dom.errorBanner = document.getElementById('error-banner');
    dom.errorText = document.getElementById('error-text');
  }

  function initPetEngine() {
    var canvas = document.getElementById('pet-canvas');
    if (!canvas || typeof createPetEngine === 'undefined') return;

    petEngine = createPetEngine(canvas);
    petEngine.loadSkin('default').then(function () {
      petEngine.start();
    }).catch(function (err) {
      console.warn('[app] Failed to load default skin:', err.message);
    });
  }

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
      scheduleReconnect();
    };

    ws.onerror = function () {
      // onclose fires after onerror
    };
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
      dom.connText.textContent = 'Connected';
    } else if (status === 'reconnecting') {
      dom.connDot.classList.add('dot-reconnecting');
      dom.connText.textContent = 'Reconnecting...';
    } else {
      dom.connDot.classList.add('dot-disconnected');
      dom.connText.textContent = 'Disconnected';
    }
  }

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

    updatePercentageBar(
      dom.sessionUsageFill,
      dom.sessionUsageValue,
      data.sessionUsage
    );

    updatePercentageBar(
      dom.weeklyOpusFill,
      dom.weeklyOpusValue,
      data.weeklyOpusUsage != null ? data.weeklyOpusUsage : data.weeklyUsage
    );

    updatePercentageBar(
      dom.weeklySonnetFill,
      dom.weeklySonnetValue,
      data.weeklySonnetUsage
    );

    if (data.sessionResetAt) {
      sessionResetTimestamp = new Date(data.sessionResetAt).getTime();
      startCountdown();
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

  function showError(errorType) {
    if (!dom.errorBanner || !dom.errorText) return;
    var messages = {
      'no-credentials': 'No credentials found',
      'timeout': 'Request timed out',
      'rate-limited': 'Rate limited, retrying...',
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

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);

    updateCountdownDisplay();
    countdownInterval = setInterval(updateCountdownDisplay, 1000);
  }

  function updateCountdownDisplay() {
    if (!sessionResetTimestamp) return;

    var now = Date.now();
    var remaining = Math.max(0, sessionResetTimestamp - now);

    if (remaining <= 0) {
      if (dom.timerText) dom.timerText.textContent = 'Reset!';
      if (dom.timerCircle) dom.timerCircle.setAttribute('stroke-dashoffset', '0');
      if (dom.sessionReset) dom.sessionReset.textContent = 'Reset!';
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      return;
    }

    var text = formatCountdown(remaining);
    if (dom.timerText) dom.timerText.textContent = text;
    if (dom.sessionReset) dom.sessionReset.textContent = text;

    var totalSeconds = remaining / 1000;
    var progress = Math.min(totalSeconds / SESSION_WINDOW_SECONDS, 1);
    var offset = TIMER_CIRCUMFERENCE * (1 - progress);
    if (dom.timerCircle) {
      dom.timerCircle.setAttribute('stroke-dashoffset', offset.toFixed(2));
    }
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

  function updatePetState(data) {
    if (!data || !data.resolvedState) return;

    var state = data.resolvedState;
    if (dom.petState) dom.petState.textContent = state;

    if (petEngine) {
      petEngine.setState(state);
    }

    if (data.event === 'Stop' || data.event === 'Notification') {
      callAndroidBridge('playAlarm', 'notification');
    } else if (data.event === 'Elicitation') {
      callAndroidBridge('playAlarm', 'alarm');
    }
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
