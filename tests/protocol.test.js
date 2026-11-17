"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROTOCOL_VERSION, safeText, conversationFor, conversationParticipants, isParticipant, dmRecipients } = require("../packages/shared/protocol");

test("pair-scoped conversation ids are stable and order independent", () => {
  const staff = "intern-demo-staff", agent = "intern-demo-node";
  assert.equal(conversationFor(staff, agent), conversationFor(agent, staff));
  assert.equal(conversationFor(staff, agent), "dm:intern-demo-node--intern-demo-staff");
  assert.match(conversationFor(staff, agent), /^dm:/);
});

test("two staff members never share one agent thread", () => {
  const agent = "intern-demo-node";
  const first = conversationFor("intern-demo-staff", agent);
  const second = conversationFor("second-staff", agent);
  assert.notEqual(first, second);
  assert.deepEqual(conversationParticipants(first), ["intern-demo-node", "intern-demo-staff"]);
  assert.equal(isParticipant(first, "intern-demo-staff"), true);
  assert.equal(isParticipant(first, "second-staff"), false);
  assert.equal(isParticipant(second, "second-staff"), true);
});

test("legacy and topic ids are not dm: participants", () => {
  assert.deepEqual(conversationParticipants("topic:general"), []);
  assert.deepEqual(conversationParticipants("private:intern-demo-node"), []);
  assert.equal(isParticipant("topic:general", "intern-demo-staff"), false);
  assert.equal(isParticipant("private:intern-demo-staff", "intern-demo-staff"), false);
});

test("dm recipients are limited to known, non-revoked, non-excluded participants", () => {
  const dm = conversationFor("staff-a", "agent-1");
  assert.deepEqual(dmRecipients(dm, ["staff-a", "agent-1", "staff-b"], "staff-a"), ["agent-1"]);
  assert.deepEqual(dmRecipients(dm, ["agent-1"], ""), ["agent-1"]);
  assert.deepEqual(dmRecipients(dm, [], ""), []);
  assert.deepEqual(dmRecipients("topic:general", ["agent-1"], ""), []);
});

test("safe text strips control characters and truncates", () => {
  assert.equal(safeText("  hi\u0000there\n"), "hi there");
  assert.equal(safeText("x".repeat(10), 4), "xxxx");
  assert.equal(safeText(undefined), "");
  assert.equal(PROTOCOL_VERSION, "2");
});
