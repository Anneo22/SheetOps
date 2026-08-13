---
Modified: 2026-07-03T11:15
---
# SheetOps — Agent Operating Protocol

This file governs every agent session that interacts with Google Sheets via SheetOps. It applies to Claude, Codex, Cursor, and any other agent with access to this directory.

Read this file before doing anything else in this project.

---

## What SheetOps is

A local Node.js CLI that sits between you and Google Sheets. Every read goes through the Sheets REST API or the Apps Script Execution API. Every write goes through a patch file, a dry-run preview, and a backup before anything touches live data. Apps Script projects are pulled, diffed, and pushed via clasp.

CLI entry point: `node bin/sheetops.js <command>`

Project config (per connected Sheet): `projects/<name>/project.config.json`

---

## Part 1: Onboarding a New Sheet

Run these steps in order before doing anything else with a new Sheet.

**Step 1: Register the project**

```bash
node bin/sheetops.js add-sheet --url "SHEET_URL" [--name "my-name"]
# or with explicit IDs:
node bin/sheetops.js add-sheet --spreadsheet-id "ID" --script-id "SCRIPT_ID"
```

**Step 2: Pull the bound Apps Script project**

```bash
node bin/sheetops.js pull-script --project PROJECT_NAME
```

If the clone fails due to auth or permissions, note the blocker and continue with sheet inspection only.

**Step 3: Confirm git initialised**

`add-sheet` initialises git automatically. Verify:

```bash
cd projects/PROJECT_NAME/appsscript && git log --oneline
```

**Step 4: Snapshot the workbook**

```bash
node bin/sheetops.js snapshot --project PROJECT_NAME
```

This writes `docs/workbook-map.md` automatically.

**Step 5: Review the maps**

Read and annotate:

- `docs/workbook-map.md`: all sheets, named ranges, protected ranges, triggers
- `docs/apps-script-map.md`: all .gs files, functions, triggers

Add any risky areas to the project's `CLAUDE.md` (or agent-specific notes file).

**Step 6: Identify risks**

Check for: hidden sheets, protected ranges, formulas that drive other calculations, external service calls (`UrlFetchApp`, Gmail, Drive, Calendar), triggers (time-driven, form submit, on-edit), shared or published deployments.

**Step 7: Install AgentOps.gs**

Only after showing the diff and receiving explicit approval:

1. Copy `templates/AgentOps.gs` into `appsscript/`
2. Show the diff: `git diff`
3. Explain what AgentOps.gs does
4. After approval: `node bin/sheetops.js push-script --project PROJECT_NAME --confirmed`

**Step 8: Run the acceptance test**

```bash
node bin/sheetops.js run-script --project PROJECT_NAME --function agent_acceptanceTest
```

All 12 checks must show `pass: true`.

**Step 9: Fix failures and repeat**

Fix any failing test, re-push with approval, re-run until all pass.

**Step 10: Declare ready**

Update `project.config.json`: set `agentOpsInstalled: true` and `status: "ready"`.

---

## Part 2: Formula Awareness

Formulas are first-class data. A cell showing `£42,500` might be `=SUMIF(B:B,"Jan",C:C)`. The formula tells you how the sheet works; the value tells you only what it shows right now.

`agent_readRange` returns both `values` and `formulas` for every cell. Always inspect both. Never report a cell's contents without checking whether a formula is behind it — the user should not have to ask.

Rules:

- When reporting cell contents, lead with the formula if one exists. State what it references and what it derives.
- Before writing to any cell, read the range first and check whether a formula is already there. Decide explicitly whether the patch replaces the formula or preserves it. Flag this to the user.
- If a formula references another sheet, a named range, or an external source (`IMPORTRANGE`, `QUERY`, `GOOGLEFINANCE`, etc.), say so explicitly.
- Formulas are valid values in a patch. Write them as strings starting with `=`:

```json
{
  "type": "setValues",
  "target": { "namedRange": "ProfitCalc" },
  "values": [["=C2-D2", "=E2/C2*100"]]
}
```

When creating a Sheet with `create-sheet`, prefer formulas over static values wherever data should update automatically. A well-built sheet uses formulas to derive totals, rates, and summaries — not hardcoded numbers the user has to maintain by hand.

---

## Part 3: Every Task on a Sheet

Follow this checklist for every task.

**Pre-task**

- Pull latest: `node bin/sheetops.js pull-script --project NAME`
- Check git: `cd projects/NAME/appsscript && git status`
- Snapshot: `node bin/sheetops.js snapshot --project NAME`
- Read the ranges needed — check both values AND formulas for every target cell

**Planning**

- Propose a specific, concrete plan
- Identify exact ranges and named ranges affected
- Flag any formula, hidden sheet, or protected range risks

**Sheet content changes**

- Create a patch file at `projects/NAME/ops/patches/YYYYMMDD-HHMMSS-description.json`
- Validate against `templates/patch-schema.json`
- Dry-run: `node bin/sheetops.js dry-run-patch --project NAME --patch ops/patches/FILE.json`
- Review dry-run output for warnings
- Backup: `node bin/sheetops.js backup --project NAME --reason "..."`
- Present plan and dry-run summary, then wait for explicit approval
- Apply: `node bin/sheetops.js apply-patch --project NAME --patch ops/patches/FILE.json --confirmed`
- Validate: `node bin/sheetops.js validate --project NAME`
- **Presentation pass (Part 9):** after any data write, run `style-table` on the affected tab so nothing ships raw. Add a chart if the data is time-series or categorical; flag negatives/thresholds. Never leave a 100px-default, unformatted table.
- Commit local changes
- Report exactly what changed

**Apps Script changes**

- Pull latest
- Check git status
- Identify the specific functions being changed
- Modify only the local `.gs` file(s)
- Show the full diff: `cd projects/NAME/appsscript && git diff`
- Wait for explicit approval
- Push: `node bin/sheetops.js push-script --project NAME --confirmed`
- Validate
- Commit
- Report what changed

---

## Part 4: Safety Limits

These cannot be overridden by task context.

| Condition | Required |
|-----------|----------|
| Write over 100 cells | `confirmLarge: true` and explicit approval |
| Formula cell in target | `allowFormulaOverwrite: true` and explicit approval |
| Hidden sheet target | `allowHiddenSheet: true` and explicit approval |
| Protected range target | `allowProtected: true` and explicit approval |
| Row deletion | `confirmDestructive: true`, backup, and explicit approval |
| Range clear | `confirmDestructive: true` and explicit approval |
| Apps Script push | `--confirmed` flag and explicit approval |
| Trigger or deployment change | Explicit approval |
| Sharing or permission change | Not permitted |

---

## Part 5: Patch File Naming

```
projects/NAME/ops/patches/YYYYMMDD-HHMMSS-short-description.json
```

Example: `projects/myproject/ops/patches/20260507-143015-update-q1-targets.json`

After successful application, move patches to `ops/patches/applied/`.

---

## Part 6: Rollback

**Sheet data**

1. Open Google Drive and find the backup copy: `SHEET_NAME__backup__YYYYMMDD-HHMMSS`
2. Restore manually, or use the Sheet's File > Version history

**Apps Script**

```bash
cd projects/PROJECT_NAME/appsscript
git log --oneline              # find the target commit
git checkout <commit-hash> -- .
git diff HEAD                  # review
node bin/sheetops.js push-script --project PROJECT_NAME --confirmed
```

---

## Part 7: Command Reference

| Command | Description |
|---------|-------------|
| `auth` | OAuth setup or re-auth |
| `auth --list` | List authenticated accounts |
| `auth --switch <email>` | Switch active account |
| `init` | Verify tools and auth status |
| `add-sheet` | Register a project from a Sheet URL or ID |
| `create-sheet` | Create a new Sheet from a JSON schema |
| `health --project` | Live healthcheck via the Sheets API |
| `snapshot --project` | Snapshot workbook structure to disk |
| `compare-snapshots --project` | Diff the two most recent snapshots |
| `read --project` | Read a named range or A1 range |
| `backup --project --reason` | Create a Drive backup |
| `dry-run-patch --project --patch` | Preview a patch without writing |
| `apply-patch --project --patch` | Apply a patch file (requires `--confirmed`) |
| `validate --project` | Run validation checks |
| `pull-script --project` | clasp pull and git commit |
| `push-script --project` | clasp push (requires `--confirmed`) |
| `run-script --project --function` | Execute an Apps Script function |
| `list-functions --project` | List Apps Script functions |
| `format-range --project` | Apply cell formatting via batchUpdate |
| `autofit --project --sheet` | Fit column widths + row heights to content (max-width cap + wrap) |
| `style-table --project --sheet` | One-shot beautify from the theme (alias `beautify`) |
| `add-chart --project --sheet --data-range` | Embed a line/column/bar/pie chart |
| `conditional-format --project --sheet --a1` | Add a conditional-format rule (negatives/thresholds/heatmap) |
| `add-title --project --sheet --title` | Prepend a navy title band (+ optional subtitle) |
| `sparkline --project --sheet --source --target` | Inline `=SPARKLINE` per row |
| `mark-cells --project --sheet --a1` | Mark number inputs (blue) vs formulas (grey italic) |
| `add-tab --project --name` | Add a sheet tab |
| `delete-tab --project --name` | Delete a sheet tab |
| `rename-tab --project --from --to` | Rename a sheet tab |
| `export --project --sheet` | Export data as CSV or JSON |
| `find --project --value` | Search a value across all sheets |
| `stats --project` | Sheet count, grid size, top sheets by row count |
| `log-summary --project` | Recent log entries from `__AGENT_OPS_LOG` |
| `setup-gcp [--project]` | Guide for linking Apps Script to GCP |

---

## Part 8: Pre-flight Checklist

Run before any real work on a new Sheet:

- Node, npm, git, clasp all respond to `--version`
- `clasp login --status` shows an authenticated account
- `add-sheet` creates the project directory
- `pull-script` clones the bound script, or logs a clear error
- Git has at least one commit in `appsscript/`
- `snapshot` writes a JSON file to `ops/snapshots/`
- `workbook-map.md` is populated with real sheet data
- `apps-script-map.md` lists real functions
- AgentOps.gs installed and pushed after approval
- `agent_healthcheck()` returns `ok: true`
- `agent_snapshotWorkbook()` returns `ok: true`
- `agent_readRange()` reads a small safe range successfully
- `agent_backupSpreadsheet()` creates a Drive copy
- `dry-run-patch` on a test patch returns no errors
- `agent_writeRange()` writes to `__AGENT_TEST` sheet successfully
- `agent_runValidation()` passes all standard checks
- `__AGENT_OPS_LOG` sheet exists and has entries
- `log-summary` shows recent log entries
- Rollback instructions are documented in the project's notes
- `project.config.json` shows `status: "ready"`

---

## Part 9: Presentation & Visualization

Every sheet SheetOps builds or touches comes out well-formatted **by default**. The operator should never hand-style a tab. Styling is theme-driven: you *apply the theme*, you never pick colours per sheet.

### The theme (design tokens)

`theme.json` at the repo root holds the design tokens — title/subtitle/header colours, banding, header border, alignment rules, standard number formats, autofit caps, chart palette, conditional-format colours. A project may override any token with `projects/<name>/theme.json` (deep-merged over the repo default).

Never hardcode a colour in a patch or command. If a sheet needs a different look, change the **token**, not the call. To match an existing workbook's house style, read its dashboards first and encode the palette as a project override, then apply it everywhere — workbook consistency beats per-sheet invention.

Seed palette (formalised from the finance workbook; contrast- and colourblind-checked): navy `#1b2f5a` titles, `#d0e4f7` subtitle strip, `#cfe2f3` header band, white/`#eef4fb` banding, currency `£#,##0.00`, Okabe-Ito chart colours.

### Commands (see `--help` for flags)

- `autofit --project P --sheet S` — fit column widths + row heights to content; cap at `maxColWidth`, wrap over-cap columns.
- `style-table --project P --sheet S` (alias `beautify`) — one-shot: header treatment + freeze + banding + header border + per-column alignment + number-format inference + autofit, all from the theme.
- `add-chart --project P --sheet S --data-range A1:C13 --type line|column|bar|pie` — embed a chart (first column = labels).
- `conditional-format --project P --sheet S --a1 R --rule negative-red|less-than|greater-than|heatmap`.
- `add-title --project P --sheet S --title "…" [--subtitle "…"]` — prepend a navy title band; run **after** `style-table` (it re-freezes to cover the band).
- `sparkline --project P --sheet S --source B2:M13 --target N [--type column]` — an inline `=SPARKLINE` per row (word-sized trend).
- `mark-cells --project P --sheet S --a1 R` — blue = number input, grey italic = computed (formula); text labels are left alone so the table isn't flooded with colour (`--include-text` to colour labels too).

### Post-write presentation checklist

After ANY data write (`create-sheet`, `apply-patch`, append, manual write), run a presentation pass before declaring done:

1. **Autofit** — `style-table` (or at least `autofit`) so nothing is clipped and no column is absurdly wide. Never leave 100px-default columns beside long text.
2. **Number formats** — currency / percent / date / integer columns consistent. No raw `1400` beside `£1,400.00`. `style-table` infers these; correct any misread with `format-range --number-format`.
3. **Header** — bold, filled, frozen, centered (`style-table` does this).
4. **Alignment** — numbers right, text left, dates/codes centered (`style-table` does this).
5. **Chart?** — time series → line; category breakdown → column/bar (sorted by value, axis from zero); pie only for 2-3 parts of a whole; skip for lookup tables. Direct-label, ≤1 accent colour, no 3D.
6. **Conditional formatting?** — negatives in red, thresholds flagged, heatmap for a matrix of magnitudes. Sparingly.
7. **Consistency** — match the workbook's existing house style, not a fresh look per tab.

**Chart chooser:** time/trend → line · compare categories → column (few) or bar (many / long labels, sorted) · parts of a whole (2-3) → pie, else bar · relationship → scatter · per-row inline trend → `=SPARKLINE` · exact lookups / many rows / mixed units → leave as a table.

Number-format inference is heuristic (header keywords + value sampling). Verify it on the readback and override per column when it guesses wrong (e.g. an ID column that looks numeric but must stay plain).

### Appending a column or row to an existing styled table

When you ADD data to a table that already has a house style (banding, a coloured header band, per-value range flags, number formats), you own making the new data look native. A raw append is a defect, even when the values are right.

1. **Read the neighbour's real formatting first**, don't guess: `getSheetVisuals` for conditional-format rules + banded ranges, and a `spreadsheets.get` with `includeGridData` for the adjacent column's per-cell `backgroundColor`, `numberFormat`, alignment, and the header cell. Colour coding is often **manual cell backgrounds**, not conditional formatting — check which before assuming either.
2. **Replicate** the number format, header band, banding and alignment onto the new column/row. `copyPaste` PASTE_FORMAT breaks on frozen rows / merged cells (`"can't paste merges that cross the boundary of a frozen region"`) — fall back to per-row `updateCells` built from the neighbour's read.
3. **Match the new column's WIDTH** to its neighbour (`updateDimensionProperties`, `dimension:"COLUMNS"`). A default-narrow 60px column beside 90/349px siblings is an obvious mismatch and wraps the header ugly.
4. **Extend the table's full-width bands and section bars across the new column** — title strip, sub-bands, and every `Category`/section header row. These are usually **merges** ending at the old last column. You typically **can't extend the merge** to the new column because a merge that already spans the frozen column A hits `"can't merge frozen and non-frozen columns"` (and the whole batchUpdate is atomic — one bad request rolls back everything). Instead, read the merge origin's `backgroundColor` per band row and **paint that colour into the new column's cells** so the bands read as continuous. Also confirm the neighbour's banding vertical extent and match it (don't extend past where the sibling stops).
5. **Re-derive per-value flags for the NEW data; never blind-copy the neighbour's flags.** An out-of-range highlight reflects *that column's* value against its range. Copying the previous column's red/orange onto a blank or in-range new cell is a correctness bug (it once put an orange "low ferritin" flag on a July cell that was never tested).
6. **Verify by reading the applied format back** — widths, per-cell backgrounds, number formats — and screenshot when the look matters, not just "the request returned ok".

Rule of thumb: touching a sheet means adapting it **as a whole** — width, bands, banding, header, flags, to the full extent of the table — never leave new data as the one unstyled thing in a styled table.

### Design standard (IBCS / Tufte / Knaflic)

The theme is built to this standard; keep to it when overriding.

1. **Grey by default, colour to carry meaning.** Neutral cells; colour is opt-in and must encode something. Against a neutral table, one accent pops.
2. **Same entity, same colour, everywhere** (IBCS *UNIFY*). A series keeps its colour across table, chart, and sparkline. A colour change must signal a data change, never decoration.
3. **≤ 6 colours in one view.** Beyond that, grey the rest and highlight one. Never a per-column rainbow.
4. **Sequential time is shade, not hue.** If periods need colour, one hue light→dark (order is meaningful); distinct per-month hues are chartjunk.
5. **Colour semantics reserved:** red = negative (baked into the number formats), the brand accent = the highlighted item only. Sparklines stay muted with one accent on the latest bar (`lastColor`), not every bar.
6. **Let whitespace and alignment carry structure**, not borders: right-aligned numerics, consistent decimals per column, a muted header, banding, a single header rule, gridlines off.
