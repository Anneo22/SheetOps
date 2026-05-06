# SheetOps

A local control plane for AI agents working with Google Sheets. Every write goes through a patch file, a dry-run, and a backup before anything touches live data. Apps Script projects are pulled, diffed, and pushed via the CLI. No browser automation, no guesswork.

## Features

- Patch-based writes with dry-run preview, hash verification, and backup gate
- Apps Script pull, diff, push, and execution via the Execution API
- Sheet creation from a JSON schema: tabs, headers, formulas, colors, named ranges, conditional formatting
- Workbook snapshots and structural diff between any two snapshots
- Multi-account OAuth with instant account switching
- Every operation logged to `__AGENT_OPS_LOG`, a hidden sheet inside each workbook

## Requirements

- Node.js 18 or later
- [clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
- A Google Cloud Platform project with the Sheets API, Drive API, and Apps Script API enabled
- OAuth 2.0 Desktop app credentials from that GCP project

## Installation

```bash
git clone https://github.com/Anneo22/SheetOps.git
cd SheetOps
npm install
```

## Setup

### 1. Create a GCP project and OAuth credentials

Follow [SETUP.md](SETUP.md) for a full walkthrough. The short version:

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
2. Enable the Google Sheets API, Google Drive API, and Apps Script API
3. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID
4. Choose Desktop app and note the `client_id` and `client_secret`

### 2. Authenticate

```bash
node bin/sheetops.js auth \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET
```

A browser window opens for Google sign-in. Credentials go to `~/.sheetops-creds.json`, never to git.

### 3. Verify

```bash
node bin/sheetops.js init
```

## Usage

### Connect an existing Sheet

```bash
node bin/sheetops.js add-sheet --url "https://docs.google.com/spreadsheets/d/YOUR_ID/edit"
node bin/sheetops.js add-sheet --spreadsheet-id "YOUR_ID"
node bin/sheetops.js add-sheet --script-id "YOUR_SCRIPT_ID"
```

### Create a new Sheet from a schema

```bash
node bin/sheetops.js create-sheet --schema my-schema.json --folder "Reports" --register --name myproject
```

### Read data

```bash
node bin/sheetops.js read --project myproject --named-range "BudgetSummary"
node bin/sheetops.js read --project myproject --sheet "Sheet1" --a1 "A1:E20"
```

### Write data

All writes follow the same sequence: snapshot, dry-run, backup, apply.

```bash
node bin/sheetops.js snapshot --project myproject
node bin/sheetops.js dry-run-patch --project myproject --patch ops/patches/fix.json
node bin/sheetops.js backup --project myproject --reason "pre-patch"
node bin/sheetops.js apply-patch --project myproject --patch ops/patches/fix.json --confirmed
```

## Commands

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
| `add-tab --project --name` | Add a sheet tab |
| `delete-tab --project --name` | Delete a sheet tab |
| `rename-tab --project --from --to` | Rename a sheet tab |
| `export --project --sheet` | Export data as CSV or JSON |
| `find --project --value` | Search a value across all sheets |
| `stats --project` | Sheet count, grid size, top sheets by row count |
| `log-summary --project` | Recent log entries from `__AGENT_OPS_LOG` |
| `setup-gcp [--project]` | Guide for linking Apps Script to GCP |

## Sheet schema

```json
{
  "title": "My Spreadsheet",
  "locale": "en_GB",
  "timeZone": "Europe/London",
  "sheets": [
    {
      "name": "Revenue",
      "tabColor": "#0f9d58",
      "frozenRows": 1,
      "headers": ["Month", "Revenue", "Expenses", "Profit"],
      "data": [["Jan 2026", 50000, 30000, "=C2-D2"]],
      "headerFormat": {
        "bold": true,
        "backgroundColor": "#0f9d58",
        "foregroundColor": "#FFFFFF"
      },
      "columnWidths": { "A": 120, "B": 110 },
      "numberFormats": {
        "B:D": { "type": "CURRENCY", "pattern": "\"£\"#,##0.00" }
      },
      "conditionalFormats": [
        {
          "range": "D2:D100",
          "condition": { "type": "NUMBER_LESS", "values": [{ "userEnteredValue": "0" }] },
          "format": { "backgroundColor": "#FFCCCC" }
        }
      ],
      "namedRanges": [{ "name": "RevenueData", "a1": "A2:D100" }]
    }
  ]
}
```

## Patch format

```json
{
  "operationId": "20260101-143015-update-budget",
  "project": "myproject",
  "reason": "Update January budget figures after board approval",
  "requiresApproval": true,
  "backupRequired": true,
  "operations": [
    {
      "type": "setValues",
      "target": { "namedRange": "BudgetData" },
      "values": [["Jan 2026", 50000, 30000]],
      "expectedHash": "abc123...",
      "allowFormulaOverwrite": false,
      "confirmDestructive": false
    }
  ]
}
```

Full schema in `templates/patch-schema.json`.

## AgentOps.gs

SheetOps installs a bridge script into each bound Apps Script project. It handles server-side locking, logging, guarded writes, and the acceptance test suite.

| Function | Description |
|----------|-------------|
| `agent_healthcheck()` | Metadata, sheet list, named ranges |
| `agent_snapshotWorkbook()` | Full workbook snapshot |
| `agent_readRange(p)` | Read values, formulas, and notes |
| `agent_writeRangeDryRun(p)` | Preview a write without applying it |
| `agent_writeRange(p)` | Write with lock, hash check, and log |
| `agent_appendRows(p)` | Append rows |
| `agent_clearRange(p)` | Clear range (requires `confirmDestructive`) |
| `agent_deleteRows(p)` | Delete rows (requires `confirmDestructive` and backup) |
| `agent_backupSpreadsheet(p)` | Drive copy |
| `agent_logOperation(p)` | Append to `__AGENT_OPS_LOG` |
| `agent_runValidation(p)` | Run declared checks |
| `agent_acceptanceTest()` | 12-test self-test suite |

## Write safety rules

| Condition | Requirement |
|-----------|-------------|
| Any write | Patch file and dry-run before applying |
| Write over 100 cells | `confirmLarge: true` |
| Formula cell in target range | `allowFormulaOverwrite: true` |
| Hidden sheet target | `allowHiddenSheet: true` |
| Protected range target | `allowProtected: true` |
| Row deletion | `confirmDestructive: true` and a backup |
| Apps Script push | Diff shown and `--confirmed` flag set |
| Sharing or permission change | Not permitted |

## Project structure

```
SheetOps/
├── bin/
│   └── sheetops.js          CLI
├── lib/
│   └── sheets-api.js        Sheets and Drive REST API client
├── templates/
│   ├── AgentOps.gs          Apps Script bridge template
│   ├── patch-schema.json    Patch file JSON schema
│   └── operating-protocol.md
├── projects/                Per-sheet project folders (gitignored)
│   └── <name>/
│       ├── project.config.json
│       ├── appsscript/      clasp clone
│       ├── ops/patches/
│       ├── ops/snapshots/
│       ├── ops/backups/
│       └── docs/
│           ├── workbook-map.md
│           └── apps-script-map.md
├── logs/                    CLI logs (gitignored)
├── SETUP.md
└── package.json
```

## Multiple Google accounts

Credentials are stored per-account in `~/.sheetops-creds.json`.

```bash
# Add an account
node bin/sheetops.js auth --client-id YOUR_ID --client-secret YOUR_SECRET

# List accounts
node bin/sheetops.js auth --list

# Switch
node bin/sheetops.js auth --switch other@gmail.com
```

## Using with Claude

SheetOps is designed to run inside [Claude Cowork](https://claude.ai). The `.plugin` bundle installs a `SKILL.md` that gives Claude the operating protocol for this CLI.

Session prompt templates are in [SESSION-STARTER-TEMPLATE.md](SESSION-STARTER-TEMPLATE.md).

## License

[MIT](LICENSE) - Anneo22
