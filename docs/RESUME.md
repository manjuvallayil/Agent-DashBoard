# RESUME HERE — Agents HQ handover notes

> **Purpose:** if this chat session is lost, start by reading this file.
> Last updated: 2026-11-20 · Maintainer: Manju (intern)

---

## 0. Instructions for the next coding agent (read this first)

You are resuming a handover. This file is the source of truth; do not guess.

- **Ready-to-paste prompt:** copy `PROMPT.md` from the repo root into a new coding-agent
  session; it points back here as the source of truth.
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
- **Services may not be running.** Check ports `3000`/`3100`/`3200`, plus `3201` for the
  temporary second Staff Portal. Start with `npm run hub`, `npm run node`, `npm run staff`.
- **Temporary test fixture:** the `:3201` portal runs from a throwaway worktree. Leave it
  running unless the user asks for cleanup; see §7 and README "Temporary local verification setup".
- **Hub password:** configured locally (reset on 2026-11-18); plaintext is not recorded here.
  Do **not** reset it unless the user explicitly asks. If asked, back up
  `packages/hub/config/hub.local.json` first.
- **Option B is implemented and committed** (pair-scoped `dm:` threads; see §5). Do not
  revert staff direct messages to the shared `private:<agentNodeId>` thread. The leftover
  decisions in §5.4 are still open.
- **Immediate next step:** all seven §8 items were completed on 2026-11-18 (see §6/§8).
  Review the working tree before committing, then pick a new task. Do not stack unrelated
  changes on top of the completed work.
- **Before finishing:** run `npm run check` and `npm test`, plus the manual check in §10.
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
curl -s http://127.0.0.1:3201/api/status   # temporary second staff
ss -ltnp | grep -E ':(3000|3100|3200|3201)\b'
```

Browser tabs to open: **3000** (Hub admin), **3100** (Agent Node), **3200** (Staff Portal),
and **3201** for the temporary second staff while the verification fixture is in place.
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
- Messages are capped at 800, events at 500, per-node inbox at 500, and tasks at 200.
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
   A topic message must not trigger the AI; a `dm:` message must; an agent reply must
   trigger no further reply.

Implementation notes / small deviations:

- The browser has no CommonJS loader, so `packages/staff/public/js/app.js` keeps a
  two-line duplicate of `conversationFor()` with a comment pointing at the shared helper.
- `/api/staff/messages` still accepts legacy `private:` ids but always sends them with
  `requiresReply:false`; only new `dm:` threads wake the agent.
- Hub admin direct conversations still use `private:<nodeId>` so existing admin history
  stays reachable. Tasks also still use `private:<nodeId>`.
- `pair/revoke` with `purgeHistory` now also removes `dm:` messages involving the device.
- The `--` delimiter means node ids containing `--` cannot be used in `dm:` threads.
  Current ids (`intern-demo-node`, `intern-demo-staff`, `intern-demo-staff-2`) are safe.
- The two-staff case was verified end-to-end on 2026-11-18 with a temporary second device
  (§6); leave the fixture running until the user asks for cleanup.

### 5.4 Open decisions to confirm with the user

- ~~A (quick, shared thread) vs B (correct, pair-scoped)?~~ **B chosen 2026-11-16.**
- Should all staff invoke agents, or only staff with a configured role?
- ~~Cooldown/rate limit per staff member?~~ **Done (2026-11-18):** 10s cooldown. Per-agent
  cooldown is still open (§8).
- ~~Show a "thinking…" state in the Staff UI while the Node calls the AI?~~ **Done
  2026-11-18:** Option A, a lightweight client-side indicator in the Staff UI (§6/§8).
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

**Repo snapshot now:** branch `main`. All work through 2026-11-18 is committed and pushed;
run `git log -1 --oneline` for the exact commit. The earlier handover is in `c44a0ca` and
`f4b69e7`. Services are expected on 3000/3100/3200 (plus 3201 while the temporary fixture
is in place); they may stop when a chat session ends.

1. **Renamed the demo staff member** to **`Manju (intern staff #1)`** through the Staff
   Portal `/api/profile` endpoint (committed). Updated:
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
5. **Cleared the §8 backlog (2026-11-18).** All seven candidate tasks are done:
   - §8.1 Reject: `POST /api/pair/reject` (admin-only) and a Reject button in the Hub
     admin UI clear stale pending requests.
   - §8.2 Update URL: both launchers now enroll
     `https://github.com/manjuvallayil/Agent-DashBoard.git`.
   - §8.3 Naming: `package.json` and `docs/ARCHITECTURE.md` use "Agents HQ"; the Node
     discovery fallback name was updated too. `x-pitt-*` headers and `PITT_*` packets were
     deliberately left unchanged — they are part of the signed pairing/discovery contract.
   - §8.4 Tests: `npm test` runs `tests/protocol.test.js` (5 `node:test` cases, zero deps).
     `dmRecipients()` in `packages/shared/protocol.js` exposes the Hub's `dm:` routing for
     unit tests. The live two-staff e2e was verified on 2026-11-18 with a temporary second
     device (§7).
   - §8.5 Limits: 30 pairing requests/minute per IP and a 10s per-staff cooldown on
     AI-triggering DMs. Both limits are in-memory and reset on Hub restart.
   - §8.6 Tasks: capped at 200 entries, like messages/events/inbox.
   - §8.7 Thinking state: Option A — the Staff UI shows "<name> is thinking…" after
     sending to an agent in a `dm:` thread, cleared when the agent's reply arrives or
     after 190s. Frontend only; no state, endpoint, or protocol changes.
   Touched: `package.json`, `start-dashboard.sh`, `START-DASHBOARD.bat`,
   `docs/ARCHITECTURE.md`, `packages/shared/protocol.js`, `packages/hub/server/index.js`,
   `packages/hub/public/js/app.js`, `packages/node/server/index.js`,
   `packages/staff/public/js/app.js`, `packages/staff/public/css/app.css`,
   `tests/protocol.test.js`, plus `README.md`, this file and `STATUS.md`. All of it was
   committed together on 2026-11-18.
6. **Later fixes on 2026-11-18.** Documented the temporary two-staff fixture in README;
   made the Hub login gate a visible centred overlay (it had no CSS and the page cannot
   scroll); fixed the sidebar so pending requests scroll inside their pane instead of
   covering AUTHORIZED AGENTS; the local Hub password was reset from backup and a new one
   set by the user. Commits: `0cbbcc7`, `268a845`, `31b2187`.
7. **README flow diagram (2026-11-20).** Kept the original boxed Hub / Agent Node /
   Staff Portal topology, added a box for the local AI (OpenClaw `xiaoyi`) under the Node,
   and made the flow accurate: signed `POST /api/register` + admin approval, signed
   `POST /api/messages`, `requiresReply:true` only for a `dm:` to an Agent Node, the
   Hub-side `state.inbox[nodeId]` in `data/hub-state.json`, the Node's 3s
   `GET /api/node/inbox?after=<lastId>` poll, `askAgent()`, the reply via
   `POST /api/node/messages` with `requiresReply:false` (no loop), and the Staff Portal's
   10s `POST /api/refresh` → signed `GET /api/staff/overview`. Also clarified that
   `requiresReply` controls only the AI call: every message is still saved and queued.
   Docs-only: no endpoint, config key, element id, or `*.local.json` shape changed.
8. **STATUS.md updates (2026-11-20).** Added a first row summarising the intern's
   ownership of the staff-DM flow layer (pair-scoped `dm:` helpers/routing, the
   `requiresReply` decision, reply visibility, cooldown, and thinking UI), explicitly
   noting that the 3s Node poll, Hub inbox, and AI bridge were pre-existing (Jian).
   Existing rows renumbered 2–10; attribution checked with `git blame`. Also removed
   cross-references (`§8`, `Option B`) from the log so it reads standalone, and appended
   row 11 for today's README flow-diagram work and verification.

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

Verification for the 2026-11-18 batch:

```bash
npm run check
npm test
node --check packages/shared/protocol.js
node --check packages/hub/public/js/app.js
node --check packages/staff/public/js/app.js
bash -n start-dashboard.sh
```

Manual (Hub/Node/Staff restarted): topic `201 requiresReply:false`; `dm:` `201
requiresReply:true`; an immediate second DM was blocked by the cooldown (the staff server
surfaces the Hub's 429 as `400 Hub returned 429`); OpenClaw replied `pong` in the same
`dm:` thread and the thread length stayed 8→8 after 8s (no loop). `/api/pair/reject`
without an admin session returns `401`. 35 invalid `/api/pair/request` calls returned
23×400 and 12×429. The thinking indicator was checked by code review and `node --check`,
not in a browser.

---

## 7. Local environment facts

- OS host: `jason-HP-Compaq-Elite-8300-SFF` (Linux, desktop session available).
- Node.js: **v24.22.2**.
- OpenClaw: **2026.11.3**; agent **`xiaoyi`** is the default.
- Repo remote (actual): `https://github.com/manjuvallayil/Agent-DashBoard.git`.
- Hub admin password **is configured** in `hub.local.json` (reset from backup on 2026-11-18;
  a new one was set by the user). The plaintext is not recorded here. Do not reset it unless
  explicitly asked. If asked: back up `packages/hub/config/hub.local.json`, set
  `"auth": { "passwordHash": "" }`, restart the Hub, and let the user choose a new password
  of 12+ characters. This affects only this machine (the file is gitignored).
- Approved demo devices: `intern-demo-node` ("Intern Demo Agent"),
  `intern-demo-staff` ("Manju (intern staff #1)") and the **temporary**
  `intern-demo-staff-2` ("Manju (intern staff #2)") at `http://127.0.0.1:3201`.
  The second portal is a verification fixture from a throwaway worktree; see the
  "Temporary local verification setup" section in README for why it exists and how
  to clean it up.
- Stale pending requests still present: `Gauss`, `Bowen`, `Jane`, `Pisro`, `Pitt`.

---

## 8. Known issues / candidate next tasks

All seven items from the previous handover were completed on 2026-11-18. The notes are
kept for history.

1. ~~**No reject action for pending devices.**~~ **Done:** `POST /api/pair/reject`
   (admin-only) and a Reject button in the Hub admin UI clear stale requests.
2. ~~**Update URL mismatch.**~~ **Done:** both launchers now use
   `https://github.com/manjuvallayil/Agent-DashBoard.git`.
3. ~~**Stale naming.**~~ **Done (cosmetic only):** `package.json`, `docs/ARCHITECTURE.md`
   and the Node discovery fallback say Agents HQ. `x-pitt-*` headers and `PITT_*` packets
   stay unchanged by design — they are part of the signed device protocol.
4. ~~**No automated tests.**~~ **Done:** `npm test` runs `tests/protocol.test.js` with
   Node's built-in runner (zero deps), covering pair-scoped DM helpers. The live two-staff
   e2e was verified on 2026-11-18 with a temporary second device (see README
   "Temporary local verification setup"); routing is participant-scoped in code.
5. ~~**No rate limiting.**~~ **Done:** 30 pairing requests/minute per IP and a 10s
   per-staff cooldown on AI-triggering DMs, both in-memory and reset on restart.
6. ~~**`tasks` are unbounded.**~~ **Done:** capped at 200, like the other bounded lists.
7. ~~**No "thinking…" state.**~~ **Done (Option A):** the Staff UI shows a local
   "<name> is thinking…" bubble in `dm:` agent threads; no server/state changes.

New candidates (not implemented): per-agent cooldown, configurable limits via local
config, and a Hub-driven thinking state that survives page reload.

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
- [ ] `npm run check` and `npm test` pass.
- [ ] At least one manual end-to-end check: staff sends → Hub → Node → AI → reply visible.
- [ ] No secret values added to tracked files (`*.local.json` / `*.identity.json` stay gitignored).
- [ ] `git status --short` reviewed before committing.
- [ ] Docs updated: this file plus any behavior change in §5.

