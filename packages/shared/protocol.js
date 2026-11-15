"use strict";

const PROTOCOL_VERSION = "2";
const SAFE_ACTIONS = ["status", "report", "draft", "meeting-message", "agent-chat"];
const CONFIRMED_ACTIONS = ["restart", "update", "model-change", "external-send", "delete"];

function now() {
  return new Date().toISOString();
}

function safeText(value, max = 2000) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

// Pair-scoped direct conversations. The id is stable regardless of who starts it.
function conversationFor(a, b) {
  return `dm:${[safeText(a, 80), safeText(b, 80)].sort().join("--")}`;
}

function conversationParticipants(conversationId) {
  const value = String(conversationId || "");
  return value.startsWith("dm:") ? value.slice(3).split("--").filter(Boolean) : [];
}

function isParticipant(conversationId, nodeId) {
  return conversationParticipants(conversationId).includes(String(nodeId || ""));
}

module.exports = { PROTOCOL_VERSION, SAFE_ACTIONS, CONFIRMED_ACTIONS, now, safeText, conversationFor, conversationParticipants, isParticipant };
