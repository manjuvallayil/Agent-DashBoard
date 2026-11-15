# RESUME HERE — Agents HQ handover notes

> **Purpose:** if this chat session is lost, start by reading this file.
> Last updated: 2026-11-16 · Maintainer: Manju (intern)

---

## 0. Instructions for the next coding agent (read this first)

You are resuming a handover. This file is the source of truth; do not guess.

- **Repo:** `/home/jason/Agent-DashBoard` · branch `main`. Run `git log -1 --oneline`
  for the current HEAD. The earlier handover is in `c44a0ca` and `f4b69e7`.
- **Working tree:** Option B is committed and pushed. Start with `git status --short` and
  `git diff --stat`; if the tree is dirty, inspect the changes before touching them. Do
  **not** discard or reformat `README.md`, `STATUS.md`, `PROMPT.md`, or this file.
- **Stack:** plain Node.js >= 22.13, CommonJS, **zero npm dependencies**. Do not add
  frameworks, build steps, or packages. Keep the existing dense style rather than
  reformatting whole files.
- **Keep stable:** URLs, endpoint paths, config keys, HTML element IDs, and the
  `*.local.json` shape. Other devices and the frontend depend on them.
- **Secrets:** `*.local.json`, `*.identity.json`, and `data/` are gitignored. Never move
  keys, password hashes, or tokens into tracked files.
- **Services may not be running.** Check ports `3000`/`3100`/`3200`, then start with
  `npm run hub`, `npm run node`, `npm run staff` (each in its own terminal).
- **Hub password:** configured locally, plaintext unknown. Do **not** reset it unless the
  user explicitly asks. If asked, back up `packages/hub/config/hub.local.json` first.
- **Option B is implemented and committed** (pair-scoped `dm:` threads; see §5). Do not
  revert staff direct messages to the shared `private:<agentNodeId>` thread. The leftover
  decisions in §5.4 are still open.
- **Immediate next step:** ask which §8 task to take. Do not stack unrelated changes on
  top of the completed Option B work.
- **Before finishing:** run `npm run check` and the manual check in §10.
- **Do not** expose the Hub to the public internet, add an admin "shell" endpoint, or let
  Staff Portals dispatch tasks — those are intentional trust-boundary decisions.

---

## 1. What this project is (30-second version)

Agents HQ is a **LAN coordination layer for AI agents and the people who work with them**.
It is **not** an AI agent itself. It connects to an agent that already runs on a machine
(here: OpenClaw agent `xiaoyi`) and lets approved devices chat with it and with each other.

```text
  Human                      One trusted PC                  AI machine
┌──────────────┐          ┌──────────────────┐          ┌─────────────────────┐
│ Staff Portal │  signed  │       Hub        │  signed  │     Agent Node      │
│   :3200      │ ───────► │      :3000       │ ◄─────── │       :3100         │
│  chat only   │          │ roster/chat/task │  polls   │ dashboard + adapter │
└──────────────┘          └──────────────────┘          └──────────┬──────────┘
                                                                   │
                                                                   ▼
                                                          OpenClaw agent `xiaoyi`
```

| Component | Folder | Port | Role |
|---|---|---|---|
| **Hub** | `packages/hub` | **3000** | Roster, approvals, chat, tasks, audit log, admin UI |
| **Agent Node** | `packages/node` | **3100** | Local dashboard + bridge to the AI |
| **Staff Portal** | `packages/staff` | **3200** | Human chat client (no shell/task powers) |
| **Online chat** | `online/` | 3400 | Optional public website chat widget |

**Which is which:** `:3000` = Hub · `:3100` = Agent Node · `:3200` = Staff Portal.
The Agent Node is **not** the AI; it is the AI's dashboard and phone line.

---

## 2. First 60 seconds after resuming

```bash
cd /home/jason/Agent-DashBoard
node -v              # expect v22.13 or newer (seen: v24.22.2)
npm run check        # syntax check for all four servers

# Start each in its own terminal
npm run hub          # http://127.0.0.1:3000
npm run node         # http://127.0.0.1:3100
npm run staff        # http://127.0.0.1:3200
```

Or start interactively with `./start-dashboard.sh` and choose 1 / 2 / 3.

Health checks:

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3100/api/status
curl -s http://127.0.0.1:3200/api/status
ss -ltnp | grep -E ':(3000|3100|3200)\b'
```

Browser tabs to open: **3000** (Hub admin), **3100** (Agent Node), **3200** (Staff Portal).
Press **Ctrl+R** after any HTML/JS edit — static files are served with `no-store`,
but the open tab still needs a reload. Server files are loaded at start: restart the
affected component after editing a `server/index.js` (the Hub was restarted for Option B).

If the Staff Portal shows `NOT REGISTERED`, click **Check In** and wait for Hub approval.
If the Hub asks for a password and you do not know it, see §7.

---

## 3. The relay flow (how a message reaches the AI)

This is the core thing to understand. The Hub **never calls the AI directly**.
The Agent Node is the only component that talks to the local AI.

```text
Staff Portal (:3200)        Hub (:3000)                 Agent Node (:3100)        Local AI (OpenClaw)
      │                        │                              │                          │
      │ 1. staff message       │                              │                          │
      ├───────────────────────►│                              │                          │
      │   signed request       │ 2. postMessage()             │                          │
      │                        │    - append to state.messages│                          │
      │                        │    - find recipients()       │                          │
      │                        │    - inbox[nodeId].push()    │                          │
      │                        │                              │                          │
      │                        │◄─────────────────────────────┤ 3. poll inbox every 3s   │
      │                        ├─────────────────────────────►│    (Node initiates)      │
      │                        │ 4. deliver new messages      │                          │
      │                        │                              │ 5. requiresReply === true?│
      │                        │                              ├─────────────────────────►│
      │                        │                              │◄─────────────────────────┤ 6. answer
      │                        │◄─────────────────────────────┤ 7. POST /api/node/messages
      │                        │ 8. broadcast + save reply    │                          │
      │◄───────────────────────┤                              │                          │
      ▼                        │                              │                          │
  Staff sees the reply         │                              │                          │
```

Key properties of this design:

1. **Outbound-only for the Node.** The Node polls the Hub; the Hub never opens a
   connection into the Node. This works behind NAT/firewalls and keeps the Hub from
   having shell access to agent machines.
2. **`requiresReply` is the switch.** The Node only calls the AI when the delivered
   message has `requiresReply: true`.
3. **Direct conversations are scoped.** New staff↔agent threads use
   `dm:<nodeA>--<nodeB>` and reach only those two participants. Legacy
   `private:<nodeId>` still reaches only that node. `topic:general` fans out to every
   approved device.
4. **The Node also works alone.** Its local dashboard and `/api/chat` call the AI
   directly, so it keeps working when the Hub is offline.

---

## 4. Important implementation details

### Pairing and trust

- Each Node/Staff device generates a **2048-bit RSA keypair** on first run and stores it
  locally in `*.identity.json` (mode `0600`, gitignored).
- First contact sends `/api/pair/request` with the public key. An admin must approve it
  from the Hub's **local browser**.
- After approval, every request is signed over:
  `timestamp + "\n" + method + "\n" + pathname + "\n" + rawBody`
  using headers `x-pitt-node`, `x-pitt-time`, `x-pitt-signature`.
- The Hub rejects signatures older/newer than **90 seconds** and verifies the device's
  `clientType` (`node` vs `staff`).
- The Hub stores only public keys and fingerprints. Revoking a device sets `revoked:true`
  and drops its runtime state/inbox.
- **Admin endpoints are local-only** (`127.0.0.1` / `::1`). Remote devices never get
  Hub admin access.

### Discovery

- Hub listens on UDP **35100** for `PITT_HUB_DISCOVER_V2` and replies with
  `PITT_HUB_HERE_V2` containing its URL.
- Hub HTTP is TCP **3000**. Local dashboards are loopback-only on 3100/3200.
- Current local configs use a fixed `hubUrl` of `http://127.0.0.1:3000` and have
  discovery disabled.

### State and limits

- All Hub state is one file: `data/hub-state.json` (gitignored).
- Messages are capped at 800, events at 500, per-node inbox at 500.
- Hub config: `packages/hub/config/hub.local.json` (gitignored).
- Node config: `packages/node/config/node.local.json` (gitignored).
- Staff config: `packages/staff/config/staff.local.json` (gitignored).
- The Hub binds `0.0.0.0:3000` for LAN use; keep it on a trusted private network.

### Agent adapter (Node)

- `agentAdapter.type` is `auto` / `openclaw` / `ollama` / `command` / `disabled`.
- `auto` tries OpenClaw, then falls back to Ollama if OpenClaw is missing.
- Current machine: OpenClaw **2026.11.3**, agent **`xiaoyi`** (default).
  Ollama, Hermes, and NVIDIA tooling are **not installed**.

### Who can invoke the AI today

| Source | `requiresReply` | Calls the AI? |
|---|---|---|
| Hub admin message (`/api/messages`) | `true` | **Yes** |
| Hub task dispatch (`/api/tasks`) | `true` (private message) | **Yes** |
| Agent Node reply (`/api/node/messages`) | `false` | No (prevents loops) |
| **Staff DM to an Agent Node (`/api/staff/messages`, `dm:`)** | **`true`** | **Yes** |
| Staff topic message or staff-to-staff DM | `false` | No |
| Legacy staff `private:<agentNodeId>` message | `false` | No (old clients only; kept as history) |

---

## 5. Resolved (Option B): staff direct messages now trigger the AI

**Status (2026-11-16):** implemented, manually verified, committed, and pushed.

- Staff Portal direct conversations now use pair-scoped `dm:<nodeA>--<nodeB>` ids
  (`conversationFor()` in `packages/shared/protocol.js`).
- A staff message in a `dm:` thread whose other participant is an approved Agent Node is
  queued with `requiresReply:true`. The Node answers into the same `dm:` id, and
  `recipients()` delivers the reply back to that staff member only.
- `topic:*` messages and staff-to-staff DMs still use `requiresReply:false`. The AI is
  never invoked from `# general`.
- `/api/staff/overview` now includes `dm:` threads where the staff member is a participant.
- Legacy `private:*` routing and display are unchanged for old messages and old clients.
  New staff threads never use `private:<agentNodeId>`, so two staff members no longer
  share one agent thread.

**How it was verified:** signed staff request to
`dm:intern-demo-node--intern-demo-staff` → `201`, `requiresReply:true` → Node → OpenClaw
replied `pong` → reply visible in `/api/staff/overview`; no reply loop after 8s. A topic
message returned `requiresReply:false`. Foreign, self, unknown-scheme, and
empty-`private:` ids were rejected with `400`.

**History (why this was not a one-line flag change):** a Staff Portal message used to be
delivered to the Agent Node and displayed, but the Node did **not** ask the AI for a reply.
Only Hub admin messages and tasks did.

**Where it lived before the change:**

- `packages/hub/server/index.js:94` — `/api/staff/messages` previously called
  `postMessage({..., origin:"staff", requiresReply:false, ...})`
- `packages/hub/server/index.js:95` — admin `/api/messages` uses `requiresReply:true`
- `packages/hub/server/index.js:66` — `postMessage()` stores the flag and queues the message
- `packages/node/server/index.js:48` — `pollInbox()` only calls `askAgent()` when
  `message.requiresReply` is true

**Why the old behavior existed:**

- Prevents every staff message in `# general` from triggering **every** agent (fan-out).
- Prevents accidental/spammy AI invocations and unexpected model cost.
- Keeps staff→staff direct chat purely human.

**The fix required a design decision**, not just a one-line flag change, because of a
second issue found while testing (below).

### Related issue (fixed for `dm:` threads): staff could not see agent replies in private threads

Verified on 2026-11-13: a signed node message was posted to `private:intern-demo-node`.
`GET /api/staff/overview` returned **zero** messages for that conversation.

Cause: `packages/hub/server/index.js:92` previously exposed only:

- all `topic:*` messages;
- messages in `private:<that staff member's own nodeId>`;
- messages whose `fromNodeId` is that staff member.

An agent's reply lives in `private:<agentNodeId>` with `fromNodeId = <agentNodeId>`, so it
is filtered out. The staff member sees their own outgoing line (because `fromNodeId` is
themselves) but not the agent's answer.

There is also a **privacy/modeling problem**: `private:<agentNodeId>` is a single shared
thread. If two staff members both message the same agent, they would read and write the
same conversation. The private model is node-centric, not pair-centric. New `dm:` threads
fix this; legacy `private:*` messages keep the old limitation by design.

**Decision made: Option B** (2026-11-16). The table below is kept for history.

| Option | Change | Result | Cost |
|---|---|---|---|
| **A. Minimal** | Set `requiresReply` for staff→agent direct messages, and widen the staff overview filter to conversations the staff participated in | Works for one staff member, but multiple staff share the agent thread | Small |
| **B. Pair-scoped conversation (recommended)** | New conversation id such as `dm:<nodeA>--<nodeB>`; Hub `recipients()` delivers to both; Node replies in the same id | Correct two-way threads, no shared-thread leak | Medium; migration/back-compat for old `private:*` |
| **C. Reply channel** | Node replies to `private:<senderStaffNodeId>` while its local thread stays `private:<agentNodeId>` | Quick, but the thread appears split and UI needs merging | Small but hacky |
| **D. Keep as-is** | Staff do not invoke agents directly; Hub admin relays | Safe, least useful | None |

Remaining sequence: automate the scoping tests → consider rate limiting → decide the
§5.4 UI questions.

### 5.1 Historical reproduction of the old `private:*` limitation (copy-paste)

Run this from the repo root while the Hub is running. It signs a request as the Agent Node,
writes one clearly labelled demo message to a legacy `private:` thread, then reads the
Staff Portal overview as Manju. It is retained as a regression demo for legacy threads;
new behavior should be tested with a `dm:` id instead.

```js
// Save as /tmp/check-staff-reply.js, then: node /tmp/check-staff-reply.js
const fs = require("fs"), crypto = require("crypto");
const nodeCfg = JSON.parse(fs.readFileSync("packages/node/config/node.local.json"));
const nodeId  = JSON.parse(fs.readFileSync("packages/node/config/node.identity.json"));
const staffCfg = JSON.parse(fs.readFileSync("packages/staff/config/staff.local.json"));
const staffId  = JSON.parse(fs.readFileSync("packages/staff/config/staff.identity.json"));

function signed(id, deviceId, method, path, body) {
  const raw = body ? JSON.stringify(body) : "", ts = Date.now();
  const payload = `${ts}\n${method}\n${path}\n${raw}`;
  const sig = crypto.sign("sha256", Buffer.from(payload), id.privateKey).toString("base64");
  return { method, headers: { "content-type": "application/json", "x-pitt-node": deviceId,
    "x-pitt-time": String(ts), "x-pitt-signature": sig }, body: raw || undefined };
}

(async () => {
  const convo = `private:${nodeCfg.nodeId}`;
  const posted = await fetch("http://127.0.0.1:3000/api/node/messages",
    signed(nodeId, nodeCfg.nodeId, "POST", "/api/node/messages",
      { text: "TEST: agent-side reply visibility", conversationId: convo }));
  console.log("node post:", posted.status); // expected: 201

  const res = await fetch("http://127.0.0.1:3000/api/staff/overview",
    signed(staffId, staffCfg.nodeId, "GET", "/api/staff/overview"));
  const data = await res.json();
  const visible = (data.messages || []).filter(m => m.conversationId === convo);
  console.log("staff sees:", visible.map(m => `${m.from}: ${m.text}`));
  // current buggy result: [] even though the node posted 201
})();
```

Expected result: `[]` — this script demonstrates the legacy limitation and still adds one
demo message each time it runs. The `dm:` behavior is covered by §5.3 and the checks in §6.

### 5.2 Implementation sketch — Option A (historical, not chosen)

1. `packages/hub/server/index.js` `/api/staff/messages`:
   - compute `isAgentDirect = conversationId.startsWith("private:") && target &&
     !target.revoked && (target.clientType || "node") !== "staff"`;
   - pass `requiresReply: isAgentDirect` to `postMessage`.
2. Same file, `/api/staff/overview`:
   - build `participated = new Set(state.messages.filter(m =>
     m.fromNodeId === device.nodeId && m.conversationId.startsWith("private:"))
     .map(m => m.conversationId))`;
   - include messages whose `conversationId` is in `participated`.
3. No Node change: it already replies in the same `conversationId`.
4. Caveat: `private:<agentNodeId>` is one shared thread. Do not ship this silently if more
   than one staff member will message the same agent. Record the limitation in this file.

### 5.3 Implementation sketch — Option B (pair-scoped, implemented 2026-11-16)

1. Add one helper used by both sides, e.g. in `packages/shared/protocol.js`:
   `conversationFor(a, b)` → `` `dm:${[a, b].sort().join("--")}` ``.
2. `packages/hub/server/index.js` `recipients()`: if the id starts with `dm:`, split on
   `--`, return the participants (minus `exclude`) that exist and are not revoked.
3. `/api/staff/messages`: accept `dm:` ids, verify the staff `device.nodeId` is one of the
   two participants, verify the other is approved; set
   `requiresReply = origin is staff && other participant is an agent node`.
   Never set `requiresReply` for `topic:*`.
4. `/api/staff/overview`: include messages where the staff id is a `dm:` participant.
   Use a small `isParticipant(conversationId, nodeId)` helper.
5. Staff UI (`packages/staff/public/js/app.js`):
   - private buttons/options must use `conversationFor(latest.nodeId, p.nodeId)`;
   - `current` may be a `dm:` id; the filter stays `m.conversationId === current`.
6. Node needs no protocol change: it receives the `dm:` id, replies to the same id, and
   `recipients()` delivers the reply to the staff member.
7. Back-compat: keep `private:*` routing/display so existing `data/hub-state.json` messages
   stay readable. New human↔agent threads use `dm:`.
8. Tests: two staff members message the same agent; each must see only their own thread.
   A staff message must not trigger the AI. An agent reply must trigger no further reply.

Implementation notes / small deviations:

- The browser has no CommonJS loader, so `packages/staff/public/js/app.js` keeps a
  two-line duplicate of `conversationFor()` with a comment pointing at the shared helper.
- `/api/staff/messages` still accepts legacy `private:` ids but always sends them with
  `requiresReply:false`; only new `dm:` threads wake the agent.
- Hub admin direct conversations still use `private:<nodeId>` so existing admin history
  stays reachable. Tasks also still use `private:<nodeId>`.
- `pair/revoke` with `purgeHistory` now also removes `dm:` messages involving the device.
- The `--` delimiter means node ids containing `--` cannot be used in `dm:` threads.
  Current ids (`intern-demo-node`, `intern-demo-staff`) are safe.
- Not yet covered end-to-end: two different staff members on the same agent. Only one
  staff device is approved locally, so that must be tested after a second staff portal is
  approved. Routing and overview filtering are participant-scoped in code.

### 5.4 Open decisions to confirm with the user

- ~~A (quick, shared thread) vs B (correct, pair-scoped)?~~ **B chosen 2026-11-16.**
- Should all staff invoke agents, or only staff with a configured role?
- Cooldown/rate limit per staff member and per agent?
- Show a "thinking…" state in the Staff UI while the Node calls the AI?
- Does the reply belong in the same conversation only, or also in `# general`?

### 5.5 Verify the new `dm:` behavior (copy-paste)

Run this while the Hub on `:3000`, the Agent Node on `:3100`, and OpenClaw are available.
It writes labelled demo messages to `data/hub-state.json` (gitignored) and makes one real
AI call. Expected: topic `requiresReply:false`, dm `requiresReply:true`, a new agent reply
visible to the staff member, and a stable message count after 8s (no loop). Invalid ids
(`dm:` not involving this staff member, self-dm, or an empty `private:`) should return
`400`.

```js
// Save as /tmp/check-dm.js, then: node /tmp/check-dm.js
const fs = require("fs"), crypto = require("crypto");
const { conversationFor } = require("/home/jason/Agent-DashBoard/packages/shared/protocol.js");
const repo = "/home/jason/Agent-DashBoard";
const nodeCfg = JSON.parse(fs.readFileSync(`${repo}/packages/node/config/node.local.json`));
const nodeId = JSON.parse(fs.readFileSync(`${repo}/packages/node/config/node.identity.json`));
const staffCfg = JSON.parse(fs.readFileSync(`${repo}/packages/staff/config/staff.local.json`));
const staffId = JSON.parse(fs.readFileSync(`${repo}/packages/staff/config/staff.identity.json`));

function signed(id, deviceId, method, path, body) {
  const raw = body ? JSON.stringify(body) : "", ts = Date.now();
  const sig = crypto.sign("sha256", Buffer.from(`${ts}\n${method}\n${path}\n${raw}`), id.privateKey).toString("base64");
  return { method, headers: { "content-type": "application/json", "x-pitt-node": deviceId,
    "x-pitt-time": String(ts), "x-pitt-signature": sig }, body: raw || undefined };
}
async function call(id, deviceId, method, path, body) {
  const res = await fetch("http://127.0.0.1:3000" + path, signed(id, deviceId, method, path, body));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  const dm = conversationFor(staffCfg.nodeId, nodeCfg.nodeId), tag = `[dm-check ${new Date().toISOString()}]`;
  const topic = await call(staffId, staffCfg.nodeId, "POST", "/api/staff/messages", { text: `${tag} topic`, conversationId: "topic:general" });
  const sent = await call(staffId, staffCfg.nodeId, "POST", "/api/staff/messages", { text: `${tag} reply with pong`, conversationId: dm });
  console.log("dm:", dm, "| topic requiresReply:", topic.data.requiresReply, "| dm requiresReply:", sent.data.requiresReply);
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const overview = await call(staffId, staffCfg.nodeId, "GET", "/api/staff/overview");
    const thread = (overview.data.messages || []).filter(m => m.conversationId === dm);
    const reply = thread.find(m => m.id > sent.data.id && m.fromNodeId === nodeCfg.nodeId);
    if (reply) {
      const before = thread.length;
      await new Promise(r => setTimeout(r, 8000));
      const after = (await call(staffId, staffCfg.nodeId, "GET", "/api/staff/overview")).data.messages
        .filter(m => m.conversationId === dm).length;
      console.log("reply visible:", reply.text, "| loop check:", before, "->", after);
      process.exitCode = before === after ? 0 : 1;
      return;
    }
  }
  console.log("TIMEOUT — check the Node and OpenClaw adapter"); process.exitCode = 1;
})();
```

---

## 6. Work completed

**Repo snapshot now:** branch `main`. Option B and its docs are committed; run
`git log -1 --oneline` for the exact commit. The earlier handover is in `c44a0ca` and
`f4b69e7`. Services are expected on 3000/3100/3200; they may stop when a chat session ends.

1. **Renamed the demo staff member** to **`Manju (intern staff)`** through the Staff Portal
   `/api/profile` endpoint (committed). Updated:
   - `packages/staff/config/staff.local.json` (gitignored)
   - Hub device entry and online worker entry in `data/hub-state.json` (gitignored)
2. **Translated every UI string to English** (committed in `c44a0ca`). No CJK characters
   remain in any tracked text file. Changed 8 tracked files:
   - `packages/hub/public/index.html`
   - `packages/hub/public/js/app.js`
   - `packages/hub/public/js/roles.js`
   - `packages/node/public/index.html`
   - `packages/node/public/js/app.js`
   - `packages/staff/public/index.html`
   - `packages/staff/public/js/app.js`
   - `online/widget/chat.js`
   Also changed `<html lang="zh-CN">` to `lang="en"`.
3. **Implemented Option B — pair-scoped staff DMs.** Changed:
   - `packages/shared/protocol.js` — added `conversationFor(a,b)`,
     `conversationParticipants(conversationId)`, and
     `isParticipant(conversationId,nodeId)`.
   - `packages/hub/server/index.js` — `dm:` routing in `recipients()`;
     `/api/staff/messages` validates participant membership and sets `requiresReply` only
     for `dm:` threads whose other participant is an Agent Node; `/api/staff/overview`
     includes `dm:` threads for participants; revocation with `purgeHistory` also drops
     `dm:` messages; legacy `private:*` behavior is preserved.
   - `packages/staff/public/js/app.js` — direct buttons and dropdown use `dm:` ids, with an
     inline duplicate of `conversationFor()` because the browser has no CommonJS loader.
   - No Node change was needed: it already replies in the delivered `conversationId`.
4. **Synced handover docs.** `README.md` describes pair-scoped staff direct chats; this
   file records the decision and verification; `STATUS.md` has the work log; `PROMPT.md`
   holds the updated next-session prompt.

Verification used:

```bash
npm run check
node --check packages/shared/protocol.js
node --check packages/staff/public/js/app.js
node --check packages/hub/public/js/app.js
node --check packages/node/public/js/app.js
node --check online/widget/chat.js
```

A CJK scan script was used over `*.js|html|css|md|json|sh|bat` (excluding `.git`,
`data`, `node_modules`) and reports zero matches.

Manual end-to-end (2026-11-16, Hub restarted on the new code):

- signed staff request to `dm:intern-demo-node--intern-demo-staff` → `201`,
  `requiresReply:true`;
- the Node called OpenClaw, replied `pong`, and the reply appeared in
  `/api/staff/overview` for the staff member;
- the same flow through the Staff Portal server (`POST :3200/api/messages`, then
  `POST :3200/api/refresh`) also returned a new agent reply in the portal snapshot;
- no additional reply after 8s (no loop);
- `topic:general` → `201`, `requiresReply:false`;
- foreign `dm:`, self `dm:`, unknown scheme, and empty `private:` → `400`.

The manual test added a few clearly labelled `dm-check` demo messages to
`data/hub-state.json` (gitignored).

**Option B and these doc updates are committed and pushed.** Check with
`git status --short`.

---

## 7. Local environment facts

- OS host: `jason-HP-Compaq-Elite-8300-SFF` (Linux, desktop session available).
- Node.js: **v24.22.2**.
- OpenClaw: **2026.11.3**; agent **`xiaoyi`** is the default.
- Repo remote (actual): `https://github.com/manjuvallayil/Agent-DashBoard.git`.
- Hub admin password **is configured** in `hub.local.json`, but the plaintext was not
  handed over. If unknown, reset it locally:
  1. stop the Hub;
  2. edit `packages/hub/config/hub.local.json`, remove the `auth` block or set
     `"auth": { "passwordHash": "" }`;
  3. restart the Hub and open `http://127.0.0.1:3000` to create a new password.
  This affects only this machine (the file is gitignored).
- Approved demo devices: `intern-demo-node` ("Intern Demo Agent") and
  `intern-demo-staff` ("Manju (intern staff)").
- Stale pending requests still present: `Gauss`, `Bowen`, `Jane`, `Pisro`, `Pitt`.

---

## 8. Known issues / candidate next tasks

1. **No reject action for pending devices.** Only `approve` and `revoke` exist, so the
   five stale requests cannot be cleared from the UI. Good first small PR.
2. **Update URL mismatch.** `start-dashboard.sh` enrolls
   `https://github.com/jilajial/Agent-DashBoard.git`, but this clone's remote is
   `https://github.com/manjuvallayil/Agent-DashBoard.git`.
3. **Stale naming.** `package.json` name is `pitt-meeting-hub`;
   `docs/ARCHITECTURE.md` still says "Pitt Meeting Hub"; packet headers use `x-pitt-*`.
4. **No automated tests.** `npm run check` only parses the four servers. There is also no
   automated two-staff scoping test for the new `dm:` threads (§5.3).
5. **No rate limiting** on the unauthenticated `/api/pair/request` endpoint, and no
   per-staff cooldown for AI-triggering staff DMs.
6. **`tasks` are unbounded**, unlike messages/events/inbox.
7. **No "thinking…" state** in the Staff UI while the Node calls the AI (§5.4).

---

## 9. Files to read, in order

1. `README.md` — product-level overview.
2. `docs/RESUME.md` — this file.
3. `packages/shared/protocol.js` — version, safe text, action allowlists, `dm:` helpers.
4. `packages/hub/server/index.js` — pairing, routing, admin auth, state.
5. `packages/node/server/index.js` — discovery, heartbeat, inbox polling, AI adapter.
6. `packages/staff/server/index.js` — messaging-only client.
7. `docs/ARCHITECTURE.md` — original trust-boundary notes (partly stale).

---

## 10. Definition of done for the next change

- [ ] The behavior change is described here (or in a linked issue).
- [ ] `npm run check` passes.
- [ ] At least one manual end-to-end check: staff sends → Hub → Node → AI → reply visible.
- [ ] No secret values added to tracked files (`*.local.json` / `*.identity.json` stay gitignored).
- [ ] `git status --short` reviewed before committing.
- [ ] Docs updated: this file plus any behavior change in §5.

---

## 11. Ready-to-paste prompt for a coding agent

Copy the block below into a new coding-agent session:

```text
You are resuming work on the Agents HQ repo at /home/jason/Agent-DashBoard.

1. Read docs/RESUME.md in full before doing anything. Then read README.md and the files
   listed in RESUME.md §9.
2. Run `git status --short` and `git diff --stat`. Option B is committed and pushed. If
   the tree is dirty, inspect the changes before touching README.md, STATUS.md,
   PROMPT.md, or docs/RESUME.md.
3. Summarize back to me: what the project does, the current git state, and the remaining
   items in RESUME.md §8.
4. Do NOT change code yet. Ask me which §8 task to take. Only after I choose should you
   implement it.
5. Constraints: Node.js >= 22.13, CommonJS, zero npm dependencies, keep endpoint names,
   config keys, element IDs and `*.local.json` shape stable. Never add secrets to tracked
   files. Never expose the Hub publicly.
6. When implementing, follow RESUME.md §5.3 for direct-message work, run `npm run check`
   plus `node --check` on any touched browser/shared files, perform the manual check in
   §10, and update RESUME.md with what changed.
```

Option B is already implemented. The prompt now protects that work and forces a decision
before the next change.
