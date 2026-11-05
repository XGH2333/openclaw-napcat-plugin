import assert from "node:assert/strict";
import test from "node:test";

import {
  decideNapCatGroupTrigger,
  resetNapCatGroupTriggerState,
  resolveNapCatGroupTriggerSettings,
} from "../dist/src/groupTrigger.js";

test("group trigger settings default to 20%, 10 minutes, and admin @ always triggers", () => {
  assert.deepEqual(resolveNapCatGroupTriggerSettings({}), {
    probability: 0.2,
    cooldownMs: 10 * 60_000,
    mentionAlwaysTriggers: true,
  });
});

test("group trigger settings are configurable and invalid values are made safe", () => {
  assert.deepEqual(
    resolveNapCatGroupTriggerSettings({
      groupTriggerProbability: 1.7,
      groupTriggerCooldownMinutes: -3,
      groupMentionAlwaysTriggers: false,
    }),
    { probability: 1, cooldownMs: 0, mentionAlwaysTriggers: false },
  );
  assert.deepEqual(
    resolveNapCatGroupTriggerSettings({
      groupTriggerProbability: "not-a-number",
      groupTriggerCooldownMinutes: "not-a-number",
    }),
    { probability: 0.2, cooldownMs: 10 * 60_000, mentionAlwaysTriggers: true },
  );
});

test("a probability miss does not start the cooldown and another member can retry immediately", () => {
  resetNapCatGroupTriggerState();
  const config = { groupMentionOnly: false, groupTriggerProbability: 0.2, groupTriggerCooldownMinutes: 10 };

  const missed = decideNapCatGroupTrigger({
    groupId: "10001",
    mentioned: false,
    mentionOnly: false,
    config,
    now: 1_000_000,
    random: () => 0.2,
  });
  assert.equal(missed.trigger, false);
  assert.equal(missed.reason, "probability-miss");

  const retry = decideNapCatGroupTrigger({
    groupId: "10001",
    mentioned: false,
    mentionOnly: false,
    config,
    now: 1_000_001,
    random: () => 0.1,
  });
  assert.equal(retry.trigger, true);
  assert.equal(retry.reason, "probability");

  const tooSoon = decideNapCatGroupTrigger({
    groupId: "10001",
    mentioned: false,
    mentionOnly: false,
    config,
    now: 1_000_002,
    random: () => 0,
  });
  assert.equal(tooSoon.trigger, false);
  assert.equal(tooSoon.reason, "cooldown");
});

test("only an administrator @ bypasses probability and cooldown", () => {
  resetNapCatGroupTriggerState();
  const config = { groupMentionOnly: false, groupTriggerProbability: 0.2 };

  const nonAdminMentionMiss = decideNapCatGroupTrigger({
    groupId: "20002", mentioned: true, mentionOnly: false, isAdmin: false, config,
    now: 2_000_000, random: () => 0.99,
  });
  assert.equal(nonAdminMentionMiss.trigger, false);
  assert.equal(nonAdminMentionMiss.reason, "probability-miss");

  const adminMention = decideNapCatGroupTrigger({
    groupId: "20002", mentioned: true, mentionOnly: false, isAdmin: true, config,
    now: 2_000_001, random: () => 0.99,
  });
  assert.equal(adminMention.trigger, true);
  assert.equal(adminMention.reason, "mention");

  const nonAdminMentionDuringCooldown = decideNapCatGroupTrigger({
    groupId: "20002", mentioned: true, mentionOnly: false, isAdmin: false, config,
    now: 2_000_002, random: () => 0,
  });
  assert.equal(nonAdminMentionDuringCooldown.trigger, false);
  assert.equal(nonAdminMentionDuringCooldown.reason, "cooldown");
});

test("an administrator @ can be made subject to probability and cooldown", () => {
  resetNapCatGroupTriggerState();
  const config = { groupMentionOnly: false, groupMentionAlwaysTriggers: false };
  const missed = decideNapCatGroupTrigger({
    groupId: "30003", mentioned: true, mentionOnly: false, isAdmin: true, config,
    now: 3_000_000, random: () => 0.99,
  });
  assert.equal(missed.trigger, false);
  assert.equal(missed.reason, "probability-miss");

  const retry = decideNapCatGroupTrigger({
    groupId: "30003", mentioned: true, mentionOnly: false, isAdmin: true, config,
    now: 3_000_001, random: () => 0,
  });
  assert.equal(retry.trigger, true);
  assert.equal(retry.reason, "probability");

  const coolingDown = decideNapCatGroupTrigger({
    groupId: "30003", mentioned: true, mentionOnly: false, isAdmin: true, config,
    now: 3_000_002, random: () => 0,
  });
  assert.equal(coolingDown.trigger, false);
  assert.equal(coolingDown.reason, "cooldown");
});

test("mention-only mode rejects unmentioned messages without consuming the cooldown", () => {
  resetNapCatGroupTriggerState();
  const config = { groupMentionOnly: true };
  const ignored = decideNapCatGroupTrigger({
    groupId: "40004", mentioned: false, mentionOnly: true, isAdmin: false, config,
    now: 4_000_000, random: () => 0,
  });
  assert.equal(ignored.trigger, false);
  assert.equal(ignored.reason, "mention-required");

  const mentioned = decideNapCatGroupTrigger({
    groupId: "40004", mentioned: true, mentionOnly: true, isAdmin: true, config,
    now: 4_000_001, random: () => 0.99,
  });
  assert.equal(mentioned.trigger, true);
  assert.equal(mentioned.reason, "mention");
});

test("cooldown state is isolated per group", () => {
  resetNapCatGroupTriggerState();
  const config = { groupTriggerProbability: 1, groupTriggerCooldownMinutes: 10 };
  assert.equal(
    decideNapCatGroupTrigger({ groupId: "50005", mentioned: false, mentionOnly: false, config, now: 5_000_000 }).trigger,
    true,
  );
  assert.equal(
    decideNapCatGroupTrigger({ groupId: "50005", mentioned: false, mentionOnly: false, config, now: 5_000_001 }).trigger,
    false,
  );
  assert.equal(
    decideNapCatGroupTrigger({ groupId: "60006", mentioned: false, mentionOnly: false, config, now: 5_000_001 }).trigger,
    true,
  );
});
