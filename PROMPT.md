# Ready-to-paste prompt for a coding agent

Updated: 2026-11-18 · `docs/RESUME.md` remains the source of truth

```text
You are resuming work on the Agents HQ repo at /home/jason/Agent-DashBoard.

1. Read docs/RESUME.md in full before doing anything. Then read README.md and the files
   listed in RESUME.md §9.
2. Run `git status --short` and `git diff --stat`. All work through 2026-11-18 is committed
   and pushed. A temporary second Staff Portal at :3201 runs from a throwaway worktree —
   leave it running unless the user asks for cleanup. If the tree is dirty, inspect changes
   before touching README.md, STATUS.md, PROMPT.md, or docs/RESUME.md.
3. Summarize back to me: what the project does, the current git state, and the status of
   RESUME.md §8 (all earlier items are done; new candidates are listed there).
4. Do NOT change code yet. Ask me what to work on next. Only after I choose should you
   implement it.
5. Constraints: Node.js >= 22.13, CommonJS, zero npm dependencies, keep endpoint names,
   config keys, element IDs and `*.local.json` shape stable. Never add secrets to tracked
   files. Never expose the Hub publicly. Do not reset the Hub password unless explicitly
   asked.
6. When implementing, follow RESUME.md §5.3 for direct-message work, run `npm run check`
   and `npm test`, plus `node --check` on any touched browser/shared files, perform the
   manual check in §10, and update RESUME.md with what changed.
```
