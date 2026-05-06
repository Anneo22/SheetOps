# Session Starter Templates

Copy one of these into any Claude chat to start a SheetOps session.
Replace `<SHEETOPS_ROOT>` with the absolute path to your SheetOps installation.

---

## Template A: Connect a new Sheet

```
You are operating in SheetOps mode.

Framework root: <SHEETOPS_ROOT>
CLI: node "<SHEETOPS_ROOT>/bin/sheetops.js"

SheetOps is a local control plane for safely working with Google Sheets and their bound Apps Script projects. All writes go through validated patch files with dry-run first. All destructive operations require explicit approval. The full protocol is in templates/operating-protocol.md.

Sheet to connect:
[PASTE YOUR GOOGLE SHEET URL HERE]

Steps:
1. Add the Sheet (sheetops add-sheet)
2. Pull the bound Apps Script (sheetops pull-script)
3. Snapshot the workbook (sheetops snapshot)
4. Show me the workbook map and apps-script map
5. Install AgentOps.gs after showing me the diff and getting my approval
6. Run the acceptance test
7. Report what you found and what the framework can now do with this Sheet
```

---

## Template B: Resume an existing project

```
You are operating in SheetOps mode.

Framework root: <SHEETOPS_ROOT>
CLI: node "<SHEETOPS_ROOT>/bin/sheetops.js"
Project: [PROJECT_NAME]

Start by:
1. Pull latest: sheetops pull-script --project [PROJECT_NAME]
2. Snapshot: sheetops snapshot --project [PROJECT_NAME]
3. Health check: sheetops health --project [PROJECT_NAME]

Report the current state (last snapshot hash, AgentOps installed, any warnings), then wait for my instructions.

Task for this session: [DESCRIBE WHAT YOU WANT TO DO]
```

---

## Template C: Read-only inspection

```
You are operating in SheetOps mode.

Framework root: <SHEETOPS_ROOT>
CLI: node "<SHEETOPS_ROOT>/bin/sheetops.js"
Project: [PROJECT_NAME]

Read-only. Do not create patch files or write anything until I explicitly ask.

1. Pull latest: sheetops pull-script --project [PROJECT_NAME]
2. Snapshot: sheetops snapshot --project [PROJECT_NAME]
3. Read: [DESCRIBE WHAT YOU WANT TO READ, e.g. named range "BudgetSummary" or Sheet1!A1:E20]
4. Report what you see and give me your analysis
```

---

## Template D: Apply a change

```
You are operating in SheetOps mode.

Framework root: <SHEETOPS_ROOT>
CLI: node "<SHEETOPS_ROOT>/bin/sheetops.js"
Project: [PROJECT_NAME]

Change I want to make:
[DESCRIBE THE CHANGE IN PLAIN ENGLISH]

Follow the full protocol:
1. Pull latest and snapshot
2. Read only the ranges you need
3. Propose a specific plan
4. Create a patch file
5. Dry-run and show me the summary
6. Take a backup
7. Ask for my approval
8. Apply only after I confirm
9. Validate and report what changed
```

---

## Template E: Apps Script change

```
You are operating in SheetOps mode.

Framework root: <SHEETOPS_ROOT>
CLI: node "<SHEETOPS_ROOT>/bin/sheetops.js"
Project: [PROJECT_NAME]

Script change I want:
[DESCRIBE THE CHANGE]

Protocol:
1. Pull latest script
2. Check git status
3. Identify the exact functions to modify
4. Make local code changes
5. Show me the full git diff
6. Ask for my approval
7. Push only after I confirm
8. Validate and commit
```

---

## Quick reference

```bash
SHEETOPS="node '<SHEETOPS_ROOT>/bin/sheetops.js'"

$SHEETOPS init
$SHEETOPS add-sheet --url "SHEET_URL"
$SHEETOPS add-sheet --spreadsheet-id "ID" [--name "name"]
$SHEETOPS create-sheet --schema schema.json --folder "Folder" --register --name "name"
$SHEETOPS health               --project "PROJECT"
$SHEETOPS snapshot             --project "PROJECT"
$SHEETOPS compare-snapshots    --project "PROJECT"
$SHEETOPS read                 --project "PROJECT" --named-range "NAME"
$SHEETOPS read                 --project "PROJECT" --sheet "Sheet1" --a1 "A1:E10"
$SHEETOPS export               --project "PROJECT" --sheet "Sheet1" --format csv
$SHEETOPS find                 --project "PROJECT" --value "search term"
$SHEETOPS backup               --project "PROJECT" --reason "reason"
$SHEETOPS dry-run-patch        --project "PROJECT" --patch "ops/patches/FILE.json"
$SHEETOPS apply-patch          --project "PROJECT" --patch "ops/patches/FILE.json" --confirmed
$SHEETOPS validate             --project "PROJECT"
$SHEETOPS pull-script          --project "PROJECT"
$SHEETOPS push-script          --project "PROJECT" --confirmed
$SHEETOPS run-script           --project "PROJECT" --function "functionName"
$SHEETOPS list-functions       --project "PROJECT"
$SHEETOPS format-range         --project "PROJECT" --sheet "Sheet1" --a1 "A1:D1" --bold --bg "#4CAF50"
$SHEETOPS add-tab              --project "PROJECT" --name "NewTab" --color "#ff6d00"
$SHEETOPS rename-tab           --project "PROJECT" --from "OldName" --to "NewName"
$SHEETOPS delete-tab           --project "PROJECT" --name "TabName"
$SHEETOPS log-summary          --project "PROJECT"
$SHEETOPS stats                --project "PROJECT"
$SHEETOPS setup-gcp            --project "PROJECT"
```
