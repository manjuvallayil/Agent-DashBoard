# Ready-to-paste prompt for a coding agent

Updated: 2026-11-16 · matches `docs/RESUME.md` §11

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
