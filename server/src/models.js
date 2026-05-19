'use strict';

const { z } = require('zod');

// --- Usage API Schemas (ported from sirmalloc/ccstatusline test fixtures) ---

const UsageBucketSchema = z.object({
  utilization: z.number().nullable(),
  resets_at: z.string().nullable()
}).nullable();

const ExtraUsageSchema = z.object({
  is_enabled: z.boolean(),
  monthly_limit: z.number().nullable(),
  used_credits: z.number().nullable(),
  utilization: z.number().nullable(),
  currency: z.string().nullable().optional(),
  disabled_reason: z.string().nullable().optional()
}).nullable();

const UsageApiResponseSchema = z.object({
  five_hour: UsageBucketSchema,
  seven_day: UsageBucketSchema,
  seven_day_sonnet: UsageBucketSchema.optional(),
  seven_day_opus: UsageBucketSchema.optional(),
  seven_day_cowork: UsageBucketSchema.optional(),
  seven_day_oauth_apps: UsageBucketSchema.optional(),
  extra_usage: ExtraUsageSchema.optional()
}).passthrough();

const UsageApiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string()
  })
});

// --- Processed UsageData (what we broadcast to clients) ---

const UsageErrorEnum = z.enum([
  'no-credentials',
  'timeout',
  'rate-limited',
  'api-error',
  'parse-error'
]);

const UsageDataSchema = z.object({
  sessionUsage: z.number().min(0).max(100).nullable(),
  sessionResetAt: z.string().nullable(),
  weeklyUsage: z.number().min(0).max(100).nullable(),
  weeklyResetAt: z.string().nullable(),
  weeklySonnetUsage: z.number().min(0).max(100).nullable().optional(),
  weeklySonnetResetAt: z.string().nullable().optional(),
  weeklyOpusUsage: z.number().min(0).max(100).nullable().optional(),
  weeklyOpusResetAt: z.string().nullable().optional(),
  extraUsageEnabled: z.boolean().optional(),
  extraUsageLimit: z.number().nullable().optional(),
  extraUsageUsed: z.number().nullable().optional(),
  extraUsageUtilization: z.number().nullable().optional(),
  error: UsageErrorEnum.nullable().optional(),
  lastUpdatedAt: z.string()
});

// --- Pet State Machine (ported from rullerzhou-afk/clawd-on-desk) ---

const PET_STATES = Object.freeze([
  'idle', 'sleeping', 'thinking', 'working', 'error',
  'attention', 'juggling', 'sweeping', 'notification', 'carrying'
]);

const PetStateSchema = z.enum(PET_STATES);

const STATE_PRIORITY = Object.freeze({
  error: 8,
  notification: 7,
  sweeping: 6,
  attention: 5,
  carrying: 4,
  juggling: 4,
  working: 3,
  thinking: 2,
  idle: 1,
  sleeping: 0
});

const ONESHOT_STATES = Object.freeze([
  'attention', 'error', 'sweeping', 'notification', 'carrying'
]);

const SLEEP_SEQUENCE = Object.freeze([
  'yawning', 'dozing', 'collapsing', 'sleeping', 'waking'
]);

// --- Hook Events (ported from clawd-on-desk agents/claude-code.js) ---

const HOOK_EVENTS = Object.freeze([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Stop', 'StopFailure',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'Notification', 'Elicitation',
  'WorktreeCreate'
]);

const HookEventNameSchema = z.enum(HOOK_EVENTS);

const INTERNAL_EVENTS = Object.freeze([
  'OneshotReturn', 'SleepTimeout'
]);

const WsEventNameSchema = z.enum([...HOOK_EVENTS, ...INTERNAL_EVENTS]);

const EVENT_TO_STATE = Object.freeze({
  SessionStart: 'idle',
  SessionEnd: 'sleeping',
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
});

const AGENT_TYPES = Object.freeze([
  'claude', 'codex', 'cursor', 'gemini', 'windsurf'
]);

const AgentTypeSchema = z.enum(AGENT_TYPES);

const TaskEventSchema = z.object({
  event: HookEventNameSchema,
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  agentType: AgentTypeSchema.optional(),
  timestamp: z.string()
}).passthrough();

// --- WebSocket Messages ---

const WsUsageUpdateSchema = z.object({
  type: z.literal('usage_update'),
  data: UsageDataSchema
});

const WsTaskEventDataSchema = z.object({
  event: WsEventNameSchema,
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  agentType: AgentTypeSchema.optional(),
  timestamp: z.string(),
  resolvedState: z.string().optional()
}).passthrough();

const WsTaskEventSchema = z.object({
  type: z.literal('task_event'),
  data: WsTaskEventDataSchema
});

const WsErrorSchema = z.object({
  type: z.literal('error'),
  message: z.string()
});

const WsMessageSchema = z.discriminatedUnion('type', [
  WsUsageUpdateSchema,
  WsTaskEventSchema,
  WsErrorSchema
]);

// --- Time Constants (from ccstatusline) ---

const FIVE_HOUR_BLOCK_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  UsageBucketSchema,
  ExtraUsageSchema,
  UsageApiResponseSchema,
  UsageApiErrorSchema,
  UsageErrorEnum,
  UsageDataSchema,
  PetStateSchema,
  PET_STATES,
  STATE_PRIORITY,
  ONESHOT_STATES,
  SLEEP_SEQUENCE,
  HOOK_EVENTS,
  INTERNAL_EVENTS,
  HookEventNameSchema,
  WsEventNameSchema,
  EVENT_TO_STATE,
  TaskEventSchema,
  WsUsageUpdateSchema,
  WsTaskEventSchema,
  WsErrorSchema,
  WsMessageSchema,
  AGENT_TYPES,
  AgentTypeSchema,
  FIVE_HOUR_BLOCK_MS,
  SEVEN_DAY_WINDOW_MS
};
