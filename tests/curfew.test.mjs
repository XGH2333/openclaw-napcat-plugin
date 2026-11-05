import assert from "node:assert/strict";
import test from "node:test";

import {
  isNapCatAdmin,
  isNapCatCurfewActive,
  resolveNapCatCurfewSettings,
} from "../dist/src/curfew.js";

test("curfew is disabled by default and has configurable defaults", () => {
  assert.deepEqual(resolveNapCatCurfewSettings({}), {
    enabled: false,
    startTime: "22:00",
    endTime: "08:00",
    startMinutes: 22 * 60,
    endMinutes: 8 * 60,
    replyText: "😴",
    timezone: "",
  });
});

test("curfew settings validate and normalize times", () => {
  assert.deepEqual(
    resolveNapCatCurfewSettings({
      curfewEnabled: true,
      curfewStartTime: "8:05",
      curfewEndTime: "25:00",
      curfewReplyText: "  [CQ:face,id=123]  ",
      curfewTimezone: "Asia/Shanghai",
    }),
    {
      enabled: true,
      startTime: "08:05",
      endTime: "08:00",
      startMinutes: 8 * 60 + 5,
      endMinutes: 8 * 60,
      replyText: "[CQ:face,id=123]",
      timezone: "Asia/Shanghai",
    },
  );
});

test("administrator ids are read from config and compared as strings", () => {
  const config = { adminUsers: [123456789, " 987654321 "] };
  assert.equal(isNapCatAdmin(config, "123456789"), true);
  assert.equal(isNapCatAdmin(config, "987654321"), true);
  assert.equal(isNapCatAdmin(config, "555"), false);
  assert.equal(isNapCatAdmin({}, "123456789"), false);
});

test("overnight curfew is active across midnight and ends exactly at the configured time", () => {
  const config = { curfewEnabled: true, curfewStartTime: "22:00", curfewEndTime: "08:00" };
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 1, 21, 59)), false);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 1, 22, 0)), true);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 1, 23, 59)), true);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 2, 0, 0)), true);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 2, 7, 59)), true);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 2, 8, 0)), false);
  assert.equal(isNapCatCurfewActive(config, new Date(2026, 0, 2, 12, 0)), false);
});

test("same-day curfew windows and equal start/end are handled", () => {
  const sameDay = { curfewEnabled: true, curfewStartTime: "12:00", curfewEndTime: "14:00" };
  assert.equal(isNapCatCurfewActive(sameDay, new Date(2026, 0, 1, 11, 59)), false);
  assert.equal(isNapCatCurfewActive(sameDay, new Date(2026, 0, 1, 12, 0)), true);
  assert.equal(isNapCatCurfewActive(sameDay, new Date(2026, 0, 1, 13, 59)), true);
  assert.equal(isNapCatCurfewActive(sameDay, new Date(2026, 0, 1, 14, 0)), false);

  const equal = { curfewEnabled: true, curfewStartTime: "12:00", curfewEndTime: "12:00" };
  assert.equal(isNapCatCurfewActive(equal, new Date(2026, 0, 1, 12, 0)), false);
});

test("curfew timezone converts the current instant", () => {
  const config = {
    curfewEnabled: true,
    curfewStartTime: "22:00",
    curfewEndTime: "08:00",
    curfewTimezone: "Asia/Shanghai",
  };
  // 14:00 UTC is 22:00 in Asia/Shanghai.
  assert.equal(isNapCatCurfewActive(config, new Date("2026-01-01T14:00:00Z")), true);
  assert.equal(isNapCatCurfewActive(config, new Date("2026-01-01T20:00:00Z")), true);
  assert.equal(isNapCatCurfewActive(config, new Date("2026-01-01T00:00:00Z")), false);
  assert.equal(isNapCatCurfewActive(config, new Date("2026-01-01T04:00:00Z")), false);
});
