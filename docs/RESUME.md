# RESUME HERE — Agents HQ handover notes

> **Purpose:** if this chat session is lost, start by reading this file.
> Last updated: 2026-11-13 · Maintainer: Manju (intern)

---

## 0. Instructions for the next coding agent (read this first)

You are resuming a handover. This file is the source of truth; do not guess.

- **Repo:** `/home/jason/Agent-DashBoard` · branch `main` · HEAD `9e57175`.
- **Uncommitted work exists:** 8 modified UI files (English translation) plus this
  untracked `docs/RESUME.md`. Do **not** discard or overwrite them. Run
  `git status --short` and `git diff` before touching anything.
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
- **Next task is UNDECIDED.** The user has not chosen A, B, C, or D in §5. Confirm the
  choice with the user **before** changing `requiresReply` or the conversation model.
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
but the open tab still needs a reload.

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
3. **Private conversations route to one device.** `private:<nodeId>` goes only to that
   node's inbox. `topic:general` fans out to every approved device.
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
| **Staff Portal message (`/api/staff/messages`)** | **`false`** | **No** ← the open question |

---

## 5. Open question / next discussion: staff messages do not trigger the AI

**Observed behavior:** a Staff Portal message is delivered to the Agent Node and displayed,
but the Node does **not** ask the AI for a reply. Only Hub admin messages and tasks do.

**Where it lives:**

- `packages/hub/server/index.js:94` — `/api/staff/messages` calls
  `postMessage({..., origin:"staff", requiresReply:false, ...})`
- `packages/hub/server/index.js:95` — admin `/api/messages` uses `requiresReply:true`
- `packages/hub/server/index.js:66` — `postMessage()` stores the flag and queues the message
- `packages/node/server/index.js:48` — `pollInbox()` only calls `askAgent()` when
  `message.requiresReply` is true

**Why it may currently be intentional:**

- Prevents every staff message in `# general` from triggering **every** agent (fan-out).
- Prevents accidental/spammy AI invocations and unexpected model cost.
- Keeps staff→staff direct chat purely human.

**Likely fix requires a design decision, not just a one-line flag change** — because of a
second issue found while testing (below).

### Related issue: staff cannot see agent replies in private threads

Verified on 2026-11-13: a signed node message was posted to `private:intern-demo-node`.
`GET /api/staff/overview` returned **zero** messages for that conversation.

Cause: `packages/hub/server/index.js:92` only exposes to a staff member:

- all `topic:*` messages;
- messages in `private:<that staff member's own nodeId>`;
- messages whose `fromNodeId` is that staff member.

An agent's reply lives in `private:<agentNodeId>` with `fromNodeId = <agentNodeId>`, so it
is filtered out. The staff member sees their own outgoing line (because `fromNodeId` is
themselves) but not the agent's answer.

There is also a **privacy/modeling problem**: `private:<agentNodeId>` is a single shared
thread. If two staff members both message the same agent, they would read and write the
same conversation. The private model is node-centric, not pair-centric.

**Decision needed before changing `requiresReply`.** Options:

| Option | Change | Result | Cost |
|---|---|---|---|
| **A. Minimal** | Set `requiresReply` for staff→agent direct messages, and widen the staff overview filter to conversations the staff participated in | Works for one staff member, but multiple staff share the agent thread | Small |
| **B. Pair-scoped conversation (recommended)** | New conversation id such as `dm:<nodeA>--<nodeB>`; Hub `recipients()` delivers to both; Node replies in the same id | Correct two-way threads, no shared-thread leak | Medium; migration/back-compat for old `private:*` |
| **C. Reply channel** | Node replies to `private:<senderStaffNodeId>` while its local thread stays `private:<agentNodeId>` | Quick, but the thread appears split and UI needs merging | Small but hacky |
| **D. Keep as-is** | Staff do not invoke agents directly; Hub admin relays | Safe, least useful | None |

Recommended sequence: choose A vs B → add tests → consider rate limiting → document the
chosen behavior in this file.

### 5.1 Reproduce the bug (copy-paste)

Run this from the repo root while the Hub is running. It signs a request as the Agent Node,
writes one clearly labelled demo message, then reads the Staff Portal overview as Manju.

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

Expected after a correct fix: the staff overview contains both the staff's messages and the
agent's reply in that thread. This script adds one demo message each time it runs.

### 5.2 Implementation sketch — Option A (minimal)

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

### 5.3 Implementation sketch — Option B (pair-scoped, recommended)

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

### 5.4 Open decisions to confirm with the user

- A (quick, shared thread) vs B (correct, pair-scoped)?
- Should all staff invoke agents, or only staff with a configured role?
- Cooldown/rate limit per staff member and per agent?
- Show a "thinking…" state in the Staff UI while the Node calls the AI?
- Does the reply belong in the same conversation only, or also in `# general`?

---

## 6. Work completed in this session (uncommitted)

**Repo snapshot at handover:** branch `main`, HEAD `9e57175`, **8 modified tracked files**
and **1 untracked file** (`docs/RESUME.md`). Services were running on 3000/3100/3200 when
this was written, but they may stop when the chat session ends.

1. **Renamed the demo staff member** to **`Manju (demo staff)`** through the Staff Portal
   `/api/profile` endpoint. Updated:
   - `packages/staff/config/staff.local.json` (gitignored)
   - Hub device entry and online worker entry in `data/hub-state.json` (gitignored)
2. **Translated every UI string to English.** No CJK characters remain in any tracked
   text file. Changed 8 tracked files:
   - `packages/hub/public/index.html`
   - `packages/hub/public/js/app.js`
   - `packages/hub/public/js/roles.js`
   - `packages/node/public/index.html`
   - `packages/node/public/js/app.js`
   - `packages/staff/public/index.html`
   - `packages/staff/public/js/app.js`
   - `online/widget/chat.js`
   Also changed `<html lang="zh-CN">` to `lang="en"`.

Verification used:

```bash
npm run check
node --check packages/hub/public/js/app.js
node --check packages/node/public/js/app.js
node --check packages/staff/public/js/app.js
node --check online/widget/chat.js
```

A CJK scan script was used over `*.js|html|css|md|json|sh|bat` (excluding `.git`,
`data`, `node_modules`) and now reports zero matches.

**Nothing has been committed.** Check with `git status --short`.

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
  `intern-demo-staff` ("Manju (demo staff)").
- Stale pending requests still present: `Gauss`, `Bowen`, `Jane`, `Pisro`, `Pitt`.

---

## 8. Known issues / candidate next tasks

1. **No reject action for pending devices.** Only `approve` and `revoke` exist, so the
   five stale requests cannot be cleared from the UI. Good first small PR.
2. **Staff messages do not trigger agent replies**, and staff cannot see agent replies in
   private threads — see §5 for the verified cause and the A/B/C/D options.
3. **Update URL mismatch.** `start-dashboard.sh` enrolls
   `https://github.com/jilajial/Agent-DashBoard.git`, but this clone's remote is
   `https://github.com/manjuvallayil/Agent-DashBoard.git`.
4. **Stale naming.** `package.json` name is `pitt-meeting-hub`;
   `docs/ARCHITECTURE.md` still says "Pitt Meeting Hub"; packet headers use `x-pitt-*`.
5. **No automated tests.** `npm run check` only parses the four servers.
6. **No rate limiting** on the unauthenticated `/api/pair/request` endpoint.
7. **`tasks` are unbounded**, unlike messages/events/inbox.

---

## 9. Files to read, in order

1. `README.md` — product-level overview.
2. `docs/RESUME.md` — this file.
3. `packages/shared/protocol.js` — version, safe text, action allowlists.
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
2. Run `git status --short` and `git diff --stat`. The 8 modified UI files and untracked
   docs/RESUME.md are intentional handover work. Do not discard or reformat them.
3. Summarize back to me: what the project does, what is currently uncommitted, and the
   open staff-to-agent reply problem in RESUME.md §5.
4. Do NOT change code yet. Ask me to choose Option A, B, C, or D from RESUME.md §5.
   Only after I choose should you implement it.
5. Constraints: Node.js >= 22.13, CommonJS, zero npm dependencies, keep endpoint names,
   config keys, element IDs and `*.local.json` shape stable. Never add secrets to tracked
   files. Never expose the Hub publicly.
6. When implementing, follow the relevant sketch in RESUME.md §5.2 or §5.3, run
   `npm run check`, and perform the manual check in §10. Update RESUME.md with what changed.
```

That prompt forces the agent to re-establish context and get your decision before editing,
which is the safest way to resume this particular task.
