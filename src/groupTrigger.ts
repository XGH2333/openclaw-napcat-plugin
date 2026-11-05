// Configuration and in-memory state for probabilistic group triggering.
//
// The old behaviour was binary: with groupMentionOnly=false every group message was handled.
// That becomes a random, rate-limited trigger instead: group messages are only considered after
// a cooldown, and a successful trigger starts the next cooldown. A failed probability roll leaves
// the group immediately available so another member can try again. An administrator @ bypasses
// both by default.

export type NapCatGroupTriggerSettings = {
  probability: number;
  cooldownMs: number;
  mentionAlwaysTriggers: boolean;
};

export type NapCatGroupTriggerReason =
  | "mention"
  | "probability"
  | "cooldown"
  | "mention-required"
  | "probability-miss";

export type NapCatGroupTriggerDecision = NapCatGroupTriggerSettings & {
  trigger: boolean;
  reason: NapCatGroupTriggerReason;
};

const DEFAULT_PROBABILITY = 0.2;
const DEFAULT_COOLDOWN_MINUTES = 10;
const MAX_TRACKED_GROUPS = 5000;

// Group id -> time of the last successful trigger. A failed probability roll is deliberately not
// recorded, so other members can immediately attempt to trigger the bot again.
const lastTriggeredAtByGroup = new Map<string, number>();

function finiteNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveNapCatGroupTriggerSettings(config: any): NapCatGroupTriggerSettings {
  const probability = Math.min(1, Math.max(0, finiteNumber(config?.groupTriggerProbability, DEFAULT_PROBABILITY)));
  const cooldownMinutes = Math.max(0, finiteNumber(config?.groupTriggerCooldownMinutes, DEFAULT_COOLDOWN_MINUTES));
  return {
    probability,
    cooldownMs: cooldownMinutes * 60_000,
    mentionAlwaysTriggers: config?.groupMentionAlwaysTriggers !== false,
  };
}

function rememberTrigger(groupId: string, now: number): void {
  // Refresh insertion order so the cap evicts the least recently active group.
  lastTriggeredAtByGroup.delete(groupId);
  if (lastTriggeredAtByGroup.size >= MAX_TRACKED_GROUPS) {
    const oldest = lastTriggeredAtByGroup.keys().next().value;
    if (oldest !== undefined) lastTriggeredAtByGroup.delete(oldest);
  }
  lastTriggeredAtByGroup.set(groupId, now);
}

export function decideNapCatGroupTrigger(params: {
  groupId: string;
  mentioned: boolean;
  mentionOnly: boolean;
  isAdmin?: boolean;
  config: any;
  now?: number;
  random?: () => number;
}): NapCatGroupTriggerDecision {
  const settings = resolveNapCatGroupTriggerSettings(params.config);
  const now = params.now ?? Date.now();
  const groupId = String(params.groupId || "");

  // Only administrators get the guaranteed @ path. A non-admin @ intentionally falls through to
  // the same probability/cooldown rules as an unmentioned message.
  if (params.mentioned && params.isAdmin === true && settings.mentionAlwaysTriggers) {
    rememberTrigger(groupId, now);
    return { ...settings, trigger: true, reason: "mention" };
  }

  if (params.mentionOnly && !params.mentioned) {
    return { ...settings, trigger: false, reason: "mention-required" };
  }

  const lastTriggeredAt = lastTriggeredAtByGroup.get(groupId);
  if (lastTriggeredAt !== undefined && now - lastTriggeredAt < settings.cooldownMs) {
    return { ...settings, trigger: false, reason: "cooldown" };
  }

  const random = params.random || Math.random;
  if (random() < settings.probability) {
    // Only a successful trigger opens the cooldown window. A miss is not recorded, which lets
    // another member retry immediately on the next message.
    rememberTrigger(groupId, now);
    return { ...settings, trigger: true, reason: "probability" };
  }
  return { ...settings, trigger: false, reason: "probability-miss" };
}

// Test-only reset; also useful if the owner ever wants to clear the window after changing config.
export function resetNapCatGroupTriggerState(): void {
  lastTriggeredAtByGroup.clear();
}
