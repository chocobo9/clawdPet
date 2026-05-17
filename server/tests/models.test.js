import { describe, test, expect } from 'vitest';
const {
  UsageBucketSchema,
  ExtraUsageSchema,
  UsageApiResponseSchema,
  UsageApiErrorSchema,
  UsageDataSchema,
  UsageErrorEnum,
  PetStateSchema,
  PET_STATES,
  STATE_PRIORITY,
  ONESHOT_STATES,
  SLEEP_SEQUENCE,
  HOOK_EVENTS,
  HookEventNameSchema,
  EVENT_TO_STATE,
  TaskEventSchema,
  WsMessageSchema,
  FIVE_HOUR_BLOCK_MS,
  SEVEN_DAY_WINDOW_MS
} = require('../src/models.js');

// --- Happy Path (≤50%) ---

describe('UsageApiResponseSchema - happy path', () => {
  test('parses a complete valid API response', () => {
    const response = {
      five_hour: { utilization: 42, resets_at: '2025-01-15T10:00:00Z' },
      seven_day: { utilization: 17, resets_at: '2025-01-20T00:00:00Z' },
      seven_day_sonnet: { utilization: 8, resets_at: '2025-01-20T00:00:00Z' },
      seven_day_opus: null,
      extra_usage: {
        is_enabled: true,
        monthly_limit: 400000,
        used_credits: 106,
        utilization: 0.026,
        currency: 'usd',
        disabled_reason: null
      }
    };

    const result = UsageApiResponseSchema.parse(response);
    expect(result.five_hour.utilization).toBe(42);
    expect(result.extra_usage.is_enabled).toBe(true);
  });

  test('parses minimal response with only required fields', () => {
    const response = {
      five_hour: { utilization: 0, resets_at: null },
      seven_day: null
    };

    const result = UsageApiResponseSchema.parse(response);
    expect(result.five_hour.utilization).toBe(0);
    expect(result.seven_day).toBeNull();
  });

  test('allows unknown cohort-specific keys via passthrough', () => {
    const response = {
      five_hour: { utilization: 50, resets_at: '2025-01-15T10:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2025-01-20T00:00:00Z' },
      iguana_necktie: { utilization: 5, resets_at: '2025-01-20T00:00:00Z' },
      tangelo: null
    };

    const result = UsageApiResponseSchema.parse(response);
    expect(result.iguana_necktie).toEqual({ utilization: 5, resets_at: '2025-01-20T00:00:00Z' });
  });
});

describe('UsageDataSchema - happy path', () => {
  test('parses valid processed usage data', () => {
    const data = {
      sessionUsage: 42,
      sessionResetAt: '2025-01-15T10:00:00Z',
      weeklyUsage: 17,
      weeklyResetAt: '2025-01-20T00:00:00Z',
      error: null,
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    };

    const result = UsageDataSchema.parse(data);
    expect(result.sessionUsage).toBe(42);
    expect(result.error).toBeNull();
  });
});

describe('TaskEventSchema - happy path', () => {
  test('parses valid task event', () => {
    const event = {
      event: 'UserPromptSubmit',
      sessionId: 'abc-123',
      cwd: '/home/user/project',
      timestamp: '2025-01-15T05:30:00Z'
    };

    const result = TaskEventSchema.parse(event);
    expect(result.event).toBe('UserPromptSubmit');
  });

  test('allows extra fields via passthrough', () => {
    const event = {
      event: 'PreToolUse',
      timestamp: '2025-01-15T05:30:00Z',
      toolName: 'Read',
      filePath: '/src/index.js'
    };

    const result = TaskEventSchema.parse(event);
    expect(result.toolName).toBe('Read');
  });
});

describe('WsMessageSchema - happy path', () => {
  test('parses usage_update message', () => {
    const msg = {
      type: 'usage_update',
      data: {
        sessionUsage: 50,
        sessionResetAt: '2025-01-15T10:00:00Z',
        weeklyUsage: 25,
        weeklyResetAt: '2025-01-20T00:00:00Z',
        error: null,
        lastUpdatedAt: '2025-01-15T05:00:00Z'
      }
    };

    const result = WsMessageSchema.parse(msg);
    expect(result.type).toBe('usage_update');
  });

  test('parses error message', () => {
    const msg = {
      type: 'error',
      message: 'Token expired'
    };

    const result = WsMessageSchema.parse(msg);
    expect(result.type).toBe('error');
    expect(result.message).toBe('Token expired');
  });
});

describe('State machine constants - happy path', () => {
  test('EVENT_TO_STATE maps all hook events to valid pet states', () => {
    for (const [event, state] of Object.entries(EVENT_TO_STATE)) {
      expect(HOOK_EVENTS).toContain(event);
      expect(PET_STATES).toContain(state);
    }
  });

  test('STATE_PRIORITY covers all PET_STATES', () => {
    for (const state of PET_STATES) {
      expect(STATE_PRIORITY[state]).toBeDefined();
      expect(typeof STATE_PRIORITY[state]).toBe('number');
    }
  });

  test('ONESHOT_STATES are all valid pet states', () => {
    for (const state of ONESHOT_STATES) {
      expect(PET_STATES).toContain(state);
    }
  });

  test('time constants are correct', () => {
    expect(FIVE_HOUR_BLOCK_MS).toBe(18000000);
    expect(SEVEN_DAY_WINDOW_MS).toBe(604800000);
  });
});

// --- Edge/Error Cases (≥30%) ---

describe('UsageBucketSchema - edge cases', () => {
  test('accepts null utilization and null resets_at', () => {
    const result = UsageBucketSchema.parse({ utilization: null, resets_at: null });
    expect(result.utilization).toBeNull();
  });

  test('accepts entire bucket as null', () => {
    const result = UsageBucketSchema.parse(null);
    expect(result).toBeNull();
  });

  test('rejects missing utilization field', () => {
    expect(() => UsageBucketSchema.parse({ resets_at: '2025-01-15T10:00:00Z' }))
      .toThrow();
  });

  test('rejects non-numeric utilization', () => {
    expect(() => UsageBucketSchema.parse({ utilization: 'high', resets_at: null }))
      .toThrow();
  });
});

describe('UsageDataSchema - edge cases', () => {
  test('rejects sessionUsage above 100', () => {
    expect(() => UsageDataSchema.parse({
      sessionUsage: 101,
      sessionResetAt: null,
      weeklyUsage: 0,
      weeklyResetAt: null,
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    })).toThrow();
  });

  test('rejects negative sessionUsage', () => {
    expect(() => UsageDataSchema.parse({
      sessionUsage: -1,
      sessionResetAt: null,
      weeklyUsage: 0,
      weeklyResetAt: null,
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    })).toThrow();
  });

  test('accepts boundary values 0 and 100', () => {
    const data = {
      sessionUsage: 0,
      sessionResetAt: null,
      weeklyUsage: 100,
      weeklyResetAt: null,
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    };
    const result = UsageDataSchema.parse(data);
    expect(result.sessionUsage).toBe(0);
    expect(result.weeklyUsage).toBe(100);
  });

  test('accepts all null usage with error set', () => {
    const data = {
      sessionUsage: null,
      sessionResetAt: null,
      weeklyUsage: null,
      weeklyResetAt: null,
      error: 'no-credentials',
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    };
    const result = UsageDataSchema.parse(data);
    expect(result.error).toBe('no-credentials');
  });
});

describe('UsageErrorEnum - edge cases', () => {
  test('rejects invalid error type', () => {
    expect(() => UsageErrorEnum.parse('unknown-error')).toThrow();
  });

  test('accepts all defined error types', () => {
    const validErrors = ['no-credentials', 'timeout', 'rate-limited', 'api-error', 'parse-error'];
    for (const err of validErrors) {
      expect(UsageErrorEnum.parse(err)).toBe(err);
    }
  });
});

describe('TaskEventSchema - edge cases', () => {
  test('rejects unknown event type', () => {
    expect(() => TaskEventSchema.parse({
      event: 'InvalidEvent',
      timestamp: '2025-01-15T05:30:00Z'
    })).toThrow();
  });

  test('rejects missing timestamp', () => {
    expect(() => TaskEventSchema.parse({
      event: 'SessionStart'
    })).toThrow();
  });
});

describe('UsageApiErrorSchema - edge cases', () => {
  test('parses rate limit error response', () => {
    const errorResp = {
      error: {
        message: 'Rate limited. Please try again later.',
        type: 'rate_limit_error'
      }
    };
    const result = UsageApiErrorSchema.parse(errorResp);
    expect(result.error.type).toBe('rate_limit_error');
  });

  test('rejects error without message', () => {
    expect(() => UsageApiErrorSchema.parse({
      error: { type: 'rate_limit_error' }
    })).toThrow();
  });
});

// --- Adversarial/Boundary Cases (≥20%) ---

describe('UsageApiResponseSchema - adversarial', () => {
  test('rejects completely empty object', () => {
    expect(() => UsageApiResponseSchema.parse({})).toThrow();
  });

  test('rejects string where object expected', () => {
    expect(() => UsageApiResponseSchema.parse('not an object')).toThrow();
  });

  test('rejects array input', () => {
    expect(() => UsageApiResponseSchema.parse([1, 2, 3])).toThrow();
  });

  test('rejects five_hour with wrong inner shape', () => {
    expect(() => UsageApiResponseSchema.parse({
      five_hour: { wrong_field: 42 },
      seven_day: null
    })).toThrow();
  });
});

describe('WsMessageSchema - adversarial', () => {
  test('rejects message with unknown type', () => {
    expect(() => WsMessageSchema.parse({
      type: 'malicious_type',
      data: {}
    })).toThrow();
  });

  test('rejects usage_update with invalid data', () => {
    expect(() => WsMessageSchema.parse({
      type: 'usage_update',
      data: { sessionUsage: 'not a number' }
    })).toThrow();
  });

  test('rejects null input', () => {
    expect(() => WsMessageSchema.parse(null)).toThrow();
  });

  test('rejects undefined input', () => {
    expect(() => WsMessageSchema.parse(undefined)).toThrow();
  });
});

describe('HookEventNameSchema - adversarial', () => {
  test('rejects empty string', () => {
    expect(() => HookEventNameSchema.parse('')).toThrow();
  });

  test('rejects case-different event name', () => {
    expect(() => HookEventNameSchema.parse('sessionstart')).toThrow();
  });

  test('rejects event with extra whitespace', () => {
    expect(() => HookEventNameSchema.parse(' SessionStart ')).toThrow();
  });

  test('rejects numeric input', () => {
    expect(() => HookEventNameSchema.parse(42)).toThrow();
  });
});

describe('ExtraUsageSchema - adversarial', () => {
  test('rejects object missing is_enabled', () => {
    expect(() => ExtraUsageSchema.parse({
      monthly_limit: 400000,
      used_credits: 100,
      utilization: 0.5
    })).toThrow();
  });

  test('accepts null as entire extra_usage', () => {
    const result = ExtraUsageSchema.parse(null);
    expect(result).toBeNull();
  });
});

describe('State machine immutability - adversarial', () => {
  test('STATE_PRIORITY is frozen', () => {
    expect(() => { STATE_PRIORITY.error = 999; }).toThrow();
  });

  test('ONESHOT_STATES is frozen', () => {
    expect(() => { ONESHOT_STATES.push('hacked'); }).toThrow();
  });

  test('SLEEP_SEQUENCE is frozen', () => {
    expect(() => { SLEEP_SEQUENCE[0] = 'hacked'; }).toThrow();
  });

  test('EVENT_TO_STATE is frozen', () => {
    expect(() => { EVENT_TO_STATE.SessionStart = 'hacked'; }).toThrow();
  });
});
