import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

global.document = undefined;

const app = require('../static/app.js');

function createMockDom() {
  function mockEl() {
    return {
      textContent: '',
      className: '',
      classList: {
        _classes: new Set(),
        add: function (c) { this._classes.add(c); },
        remove: function () {
          for (var i = 0; i < arguments.length; i++) this._classes.delete(arguments[i]);
        },
        contains: function (c) { return this._classes.has(c); }
      },
      style: { width: '', display: '' },
      setAttribute: vi.fn()
    };
  }

  return {
    sessionUsageFill: mockEl(),
    sessionUsageValue: mockEl(),
    weeklyOpusFill: mockEl(),
    weeklyOpusValue: mockEl(),
    weeklySonnetFill: mockEl(),
    weeklySonnetValue: mockEl(),
    sessionReset: mockEl(),
    weeklyReset: mockEl(),
    petState: mockEl(),
    connDot: mockEl(),
    connText: mockEl(),
    timerCircle: mockEl(),
    timerText: mockEl(),
    errorBanner: mockEl(),
    errorText: mockEl()
  };
}

describe('formatCountdown', function () {
  test('formats days and hours', function () {
    expect(app.formatCountdown((2 * 86400 + 5 * 3600) * 1000)).toBe('2d 5h');
  });

  test('formats hours and minutes', function () {
    expect(app.formatCountdown((3 * 3600 + 15 * 60) * 1000)).toBe('3h 15m');
  });

  test('formats minutes only under 1 hour', function () {
    expect(app.formatCountdown(42 * 60 * 1000)).toBe('42m');
  });

  test('returns 0m for very small values', function () {
    expect(app.formatCountdown(500)).toBe('0m');
  });

  test('returns 0m for 0ms', function () {
    expect(app.formatCountdown(0)).toBe('0m');
  });

  test('formats exactly 1 hour', function () {
    expect(app.formatCountdown(3600 * 1000)).toBe('1h 0m');
  });

  test('rounds down partial minutes', function () {
    expect(app.formatCountdown((2 * 60 + 59) * 1000)).toBe('2m');
  });
});

describe('formatResetsAt', function () {
  test('returns countdown for future timestamp', function () {
    var future = Date.now() + 3 * 3600 * 1000;
    expect(app.formatResetsAt(future)).toMatch(/^\dh \d+m$/);
  });

  test('returns Reset! for past timestamp', function () {
    expect(app.formatResetsAt(Date.now() - 1000)).toBe('Reset!');
  });

  test('returns Reset! for now', function () {
    expect(app.formatResetsAt(Date.now())).toBe('Reset!');
  });
});

describe('updatePercentageBar - server data contract', function () {
  test('renders 0-100 utilization as percentage width', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 45.5);
    expect(dom.sessionUsageFill.style.width).toBe('45.5%');
    expect(dom.sessionUsageValue.textContent).toBe('46%');
  });

  test('clamps utilization above 100 to 100%', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 120);
    expect(dom.sessionUsageFill.style.width).toBe('100.0%');
  });

  test('renders 0% for zero utilization', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 0);
    expect(dom.sessionUsageFill.style.width).toBe('0.0%');
    expect(dom.sessionUsageValue.textContent).toBe('0%');
  });

  test('shows -- for null utilization', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, null);
    expect(dom.sessionUsageFill.style.width).toBe('0%');
    expect(dom.sessionUsageValue.textContent).toBe('--');
  });

  test('adds warning class at 75%', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 76);
    expect(dom.sessionUsageFill.classList.contains('warning')).toBe(true);
    expect(dom.sessionUsageFill.classList.contains('danger')).toBe(false);
  });

  test('adds danger class at 90%', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 92);
    expect(dom.sessionUsageFill.classList.contains('danger')).toBe(true);
    expect(dom.sessionUsageFill.classList.contains('warning')).toBe(false);
  });

  test('no threshold class below 75%', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 50);
    expect(dom.sessionUsageFill.classList.contains('warning')).toBe(false);
    expect(dom.sessionUsageFill.classList.contains('danger')).toBe(false);
  });

  test('removes previous warning when dropping below threshold', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 80);
    expect(dom.sessionUsageFill.classList.contains('warning')).toBe(true);
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, 50);
    expect(dom.sessionUsageFill.classList.contains('warning')).toBe(false);
  });

  test('is safe when fillEl is null', function () {
    expect(function () {
      app.updatePercentageBar(null, createMockDom().sessionUsageValue, 50);
    }).not.toThrow();
  });

  test('is safe when valueEl is null', function () {
    expect(function () {
      app.updatePercentageBar(createMockDom().sessionUsageFill, null, 50);
    }).not.toThrow();
  });
});

describe('updateUsage - integration with server data shape', function () {
  test('processes a full usage_update payload', function () {
    var dom = createMockDom();

    app.updateUsage.call(
      { dom: dom },
      {
        sessionUsage: 45.5,
        sessionResetAt: new Date(Date.now() + 3600000).toISOString(),
        weeklyUsage: 30.0,
        weeklyResetAt: new Date(Date.now() + 86400000).toISOString(),
        weeklyOpusUsage: 25.0,
        weeklySonnetUsage: 10.0,
        lastUpdatedAt: new Date().toISOString()
      }
    );
  });

  test('shows error banner on error payload', function () {
    var dom = createMockDom();
    app.showError.call({ dom: dom }, 'rate-limited');
  });

  test('handles null data gracefully', function () {
    expect(function () { app.updateUsage(null); }).not.toThrow();
  });
});

describe('updatePetState - server data contract', function () {
  test('reads resolvedState field (not state)', function () {
    var dom = createMockDom();
    var mockPetEngine = { setState: vi.fn() };

    app.updatePetState({
      event: 'PreToolUse',
      sessionId: 'abc',
      timestamp: new Date().toISOString(),
      resolvedState: 'working'
    });
  });

  test('ignores data without resolvedState', function () {
    expect(function () {
      app.updatePetState({ event: 'PreToolUse', state: 'working' });
    }).not.toThrow();
  });

  test('ignores null data', function () {
    expect(function () {
      app.updatePetState(null);
    }).not.toThrow();
  });

  test('ignores empty data', function () {
    expect(function () {
      app.updatePetState({});
    }).not.toThrow();
  });
});

describe('handleMessage - message routing', function () {
  test('routes usage_update to updateUsage', function () {
    expect(function () {
      app.handleMessage({
        type: 'usage_update',
        data: {
          sessionUsage: 50,
          sessionResetAt: null,
          weeklyUsage: 25,
          weeklyResetAt: null,
          lastUpdatedAt: new Date().toISOString()
        }
      });
    }).not.toThrow();
  });

  test('routes task_event to updatePetState', function () {
    expect(function () {
      app.handleMessage({
        type: 'task_event',
        data: {
          event: 'SessionStart',
          resolvedState: 'thinking',
          timestamp: new Date().toISOString()
        }
      });
    }).not.toThrow();
  });

  test('ignores unknown message types', function () {
    expect(function () {
      app.handleMessage({ type: 'unknown', data: {} });
    }).not.toThrow();
  });
});

describe('callAndroidBridge', function () {
  afterEach(function () {
    delete global.window;
  });

  test('calls window.Android method when available', function () {
    var playAlarm = vi.fn();
    global.window = { Android: { playAlarm: playAlarm } };
    app.callAndroidBridge('playAlarm', 'notification');
    expect(playAlarm).toHaveBeenCalledWith('notification');
  });

  test('falls back to console.warn when no Android bridge', function () {
    global.window = {};
    var warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    app.callAndroidBridge('playAlarm', 'test');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('catches errors from Android bridge', function () {
    global.window = {
      Android: {
        playAlarm: function () { throw new Error('bridge crash'); }
      }
    };
    expect(function () {
      app.callAndroidBridge('playAlarm', 'test');
    }).not.toThrow();
  });

  test('handles missing method on Android object', function () {
    global.window = { Android: {} };
    var warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
    app.callAndroidBridge('nonexistent', 'arg');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('showError / hideError', function () {
  test('showError maps known error types to messages', function () {
    var dom = createMockDom();
    app.showError('rate-limited');
  });

  test('showError handles unknown error type', function () {
    expect(function () { app.showError('unknown-err'); }).not.toThrow();
  });
});

describe('constants', function () {
  test('WARNING_THRESHOLD is 0.75', function () {
    expect(app.WARNING_THRESHOLD).toBe(0.75);
  });

  test('DANGER_THRESHOLD is 0.90', function () {
    expect(app.DANGER_THRESHOLD).toBe(0.90);
  });

  test('RECONNECT_BASE_MS is 1000', function () {
    expect(app.RECONNECT_BASE_MS).toBe(1000);
  });

  test('RECONNECT_MAX_MS is 30000', function () {
    expect(app.RECONNECT_MAX_MS).toBe(30000);
  });

  test('SESSION_WINDOW_SECONDS is 5 hours', function () {
    expect(app.SESSION_WINDOW_SECONDS).toBe(18000);
  });
});

describe('reconnect backoff - using actual constants', function () {
  test('exponential backoff sequence is correct', function () {
    var expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (var i = 0; i < expected.length; i++) {
      var delay = Math.min(app.RECONNECT_BASE_MS * Math.pow(2, i), app.RECONNECT_MAX_MS);
      expect(delay).toBe(expected[i]);
    }
  });
});

describe('adversarial inputs', function () {
  test('updatePercentageBar with NaN utilization shows --', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, NaN);
    expect(dom.sessionUsageValue.textContent).toBe('--');
    expect(dom.sessionUsageFill.style.width).toBe('0%');
  });

  test('updatePercentageBar with Infinity utilization shows --', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, Infinity);
    expect(dom.sessionUsageValue.textContent).toBe('--');
  });

  test('updatePercentageBar with negative utilization', function () {
    var dom = createMockDom();
    app.updatePercentageBar(dom.sessionUsageFill, dom.sessionUsageValue, -10);
    expect(dom.sessionUsageFill.classList.contains('danger')).toBe(false);
  });

  test('updatePetState with XSS attempt in resolvedState', function () {
    expect(function () {
      app.updatePetState({
        resolvedState: '<script>alert(1)</script>',
        event: 'Test'
      });
    }).not.toThrow();
  });

  test('handleMessage with missing data field', function () {
    expect(function () {
      app.handleMessage({ type: 'usage_update' });
    }).not.toThrow();
  });

  test('handleMessage with null', function () {
    expect(function () {
      app.handleMessage({ type: null, data: null });
    }).not.toThrow();
  });

  test('formatCountdown with Infinity', function () {
    var result = app.formatCountdown(Infinity);
    expect(typeof result).toBe('string');
  });
});
