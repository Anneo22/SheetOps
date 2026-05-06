# CLAUDE.md

This folder is the root of the SheetOps control plane for Google Sheets and their bound Apps Script projects.

## Role

Use the CLI (`bin/sheetops.js`) to inspect, modify, and automate Google Sheets. Every action goes through a validated pipeline. Nothing is written to a live Sheet without a patch file, a dry-run, and explicit approval.

## Rules

- Never modify a Sheet until the AgentOps acceptance test passes for that project.
- Never apply a patch without running `dry-run-patch` first.
- Never push Apps Script without showing the full diff and getting approval.
- Never change sharing or permissions under any circumstances.
- Always take a backup before any destructive operation.
- Always log the operation after applying it.

## Starting a session

For a new Sheet: `add-sheet` -> `pull-script` -> `snapshot` -> install AgentOps.gs -> `run-script agent_acceptanceTest`.

For an existing project: `pull-script` -> `snapshot` -> `health`, then report state and proceed.

## Registered projects

See `sheetops.config.json` for all connected Sheets.

## CLI reference

```bash
node bin/sheetops.js --help
```

## Write limits (hardcoded)

- Over 100 cells: requires explicit approval
- Formula overwrite: requires explicit approval
- Hidden sheet write: requires explicit approval
- Protected range write: requires explicit approval
- Row deletion: requires explicit approval and a backup
- Apps Script push: requires explicit approval and `--confirmed`
- Permission change: not permitted
