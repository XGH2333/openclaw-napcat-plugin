import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import { resetNapCatGroupTriggerState } from "../dist/src/groupTrigger.js";
import { setNapCatConfig, setNapCatRuntime } from "../dist/src/runtime.js";
import { handleNapCatWebhook } from "../dist/src/webhook.js";

const SECRET = "group-trigger-fixture-secret";

async function deliver(event) {
  const raw = Buffer.from(JSON.stringify(event));
  const req = Readable.from([raw]);
  Object.assign(req, {
    url: "/napcat",
    method: "POST",
    headers: { "x-signature": "sha1=" + createHmac("sha1", SECRET).update(raw).digest("hex") },
  });
  const res = { statusCode: 200, setHeader() {}, end() {} };
  await handleNapCatWebhook(req, res, async () => ({ payload: {}, failures: [] }));
}

function installRuntime(contexts) {
  setNapCatRuntime({
    config: { current: () => ({}) },
    channel: {
      routing: {
        resolveAgentRoute: () => ({ agentId: "main", accountId: "default", sessionKey: "fixture" }),
      },
      reply: {
        createReplyDispatcher: (options) => options,
        dispatchReplyFromConfig: async ({ ctx }) => contexts.push(ctx),
      },
    },
  });
}

const baseEvent = {
  post_type: "message",
  message_type: "group",
  group_id: 987654321,
  user_id: 123456789,
  self_id: 555555555,
  message: [{ type: "text", data: { text: "hello" } }],
  raw_message: "hello",
};

test("non-admin @ follows random rules while an administrator @ bypasses cooldown", async () => {
  resetNapCatGroupTriggerState();
  const contexts = [];
  installRuntime(contexts);
  setNapCatConfig({
    webhookSecret: SECRET,
    enableInboundLogging: false,
    enablePrivateTypingStatus: false,
    conversationConfigDir: "",
    enableGroupMessages: true,
    groupMentionOnly: false,
    groupTriggerProbability: 1,
    groupTriggerCooldownMinutes: 10,
    adminUsers: ["987654321"],
  });

  await deliver({ ...baseEvent, message_id: 8001 });
  assert.equal(contexts.length, 1);

  await deliver({ ...baseEvent, message_id: 8002 });
  assert.equal(contexts.length, 1, "a second non-admin message must be blocked by cooldown");

  await deliver({
    ...baseEvent,
    message_id: 8003,
    raw_message: "[CQ:at,qq=555555555] hello",
  });
  assert.equal(contexts.length, 1, "a non-admin @ must still use the cooldown path");

  await deliver({
    ...baseEvent,
    message_id: 8004,
    user_id: 987654321,
    raw_message: "[CQ:at,qq=555555555] hello",
  });
  assert.equal(contexts.length, 2, "an administrator @ must bypass the cooldown");
});

test("curfew rejects non-admins with a sleeping reply and only lets administrator @ through", async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 1 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    resetNapCatGroupTriggerState();
    const contexts = [];
    installRuntime(contexts);

    const format = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 60_000);
    const end = new Date(now.getTime() + 2 * 60_000);
    setNapCatConfig({
      webhookSecret: SECRET,
      enableInboundLogging: false,
      enablePrivateTypingStatus: false,
      conversationConfigDir: "",
      url: baseUrl,
      enableGroupMessages: true,
      groupMentionOnly: false,
      groupTriggerProbability: 1,
      groupMentionAlwaysTriggers: true,
      adminUsers: ["987654321"],
      curfewEnabled: true,
      curfewStartTime: format(start),
      curfewEndTime: format(end),
      curfewReplyText: "😴",
    });

    await deliver({ ...baseEvent, message_id: 8101 });
    assert.equal(contexts.length, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/send_group_msg");
    assert.deepEqual(requests[0].body, { group_id: "987654321", message: "😴" });

    await deliver({ ...baseEvent, message_id: 8102, raw_message: "[CQ:at,qq=555555555] hello" });
    assert.equal(contexts.length, 0, "a non-admin @ is still blocked during curfew");
    assert.equal(requests.length, 2, "even a non-admin @ receives the sleeping reply");

    await deliver({ ...baseEvent, message_id: 8103, user_id: 987654321 });
    assert.equal(contexts.length, 0, "an administrator must still @ during curfew");
    assert.equal(requests.length, 2, "administrator non-@ messages do not receive the sleeping reply");

    await deliver({
      ...baseEvent,
      message_id: 8104,
      user_id: 987654321,
      raw_message: "[CQ:at,qq=555555555] hello",
    });
    assert.equal(contexts.length, 1, "an administrator @ wakes the bot during curfew");
    assert.equal(requests.length, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
