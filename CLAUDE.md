# CLAUDE.md

Read `AGENTS.md` first. That file contains the full operating protocol: onboarding steps, formula awareness rules, the write checklist, safety limits, patch naming, rollback, command reference, and the pre-flight checklist.

The rules in AGENTS.md are mandatory. Nothing below overrides them.

---

## Claude-specific notes

- The SheetOps plugin SKILL.md (loaded automatically in Claude Cowork) mirrors the protocol in AGENTS.md. If there is ever a conflict, AGENTS.md is the authority.
- `sheetops.config.json` is gitignored. It contains spreadsheet IDs and is never committed.
- The `projects/` folder is gitignored. All per-sheet data, patches, snapshots, and backups live there.

## Quick start

New Sheet: `add-sheet` -> `pull-script` -> `snapshot` -> install AgentOps.gs -> `run-script agent_acceptanceTest`

Existing project: `pull-script` -> `snapshot` -> `health`, then report state and proceed.

## Registered projects

See `sheetops.config.json` for all connected Sheets.
