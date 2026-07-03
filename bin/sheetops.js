#!/usr/bin/env node
/**
 * sheetops.js  –  Claude SheetOps CLI  v2.0.0
 * Usage: node "<SHEETOPS_ROOT>/bin/sheetops.js" <command> [options]
 *
 * Architecture (v2):
 *   Sheet operations  → Google Sheets REST API via lib/sheets-api.js (NO clasp run required)
 *   Script pull/push  → clasp pull / clasp push (no GCP project needed)
 *   Script execution  → clasp run (requires GCP setup — see: node sheetops.js setup-gcp)
 *
 * Commands:
 *   auth                                    Re-authenticate with full Sheets scope
 *   init                                    Verify tools + auth status
 *   add-sheet   --url | --spreadsheet-id | --script-id [--name]
 *   health      --project <name>
 *   snapshot    --project <name>
 *   read        --project <name> [--named-range | --sheet + --a1]
 *   backup      --project <name> --reason <text>
 *   dry-run-patch --project <name> --patch <file>
 *   apply-patch   --project <name> --patch <file> [--confirmed]
 *   validate      --project <name>
 *   pull-script   --project <name>
 *   push-script   --project <name> [--confirmed]
 *   log-summary   --project <name>
 *   setup-gcp     --project <name>          Guide for enabling clasp run
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { spawnSync } = require("child_process");

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, "..");
const PROJECTS    = path.join(ROOT, "projects");
const TEMPLATES   = path.join(ROOT, "templates");
const LOGS        = path.join(ROOT, "logs");
const CONFIG_FILE = path.join(ROOT, "sheetops.config.json");
const LIB         = path.join(ROOT, "lib", "sheets-api.js");

// ─── Colours ─────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m", bold:   "\x1b[1m",
  green:  "\x1b[32m", yellow: "\x1b[33m",
  red:    "\x1b[31m", cyan:   "\x1b[36m", grey: "\x1b[90m"
};
const ok   = (s) => console.log(`${C.green}✔${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset}  ${s}`);
const err  = (s) => console.error(`${C.red}✖${C.reset} ${s}`);
const info = (s) => console.log(`${C.cyan}→${C.reset} ${s}`);
const hdr  = (s) => console.log(`\n${C.bold}${s}${C.reset}`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(p)      { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, o)  { fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
function ensureDir(d)     { fs.mkdirSync(d, { recursive: true }); }

function loadRootConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    err("Run init first: node sheetops.js init"); process.exit(1);
  }
  return readJson(CONFIG_FILE);
}

function projectDir(name)  { return path.join(PROJECTS, name); }

function loadProjectConfig(name) {
  const p = path.join(projectDir(name), "project.config.json");
  if (!fs.existsSync(p)) { err(`Project '${name}' not found`); process.exit(1); }
  return readJson(p);
}

function safeName(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 64) || "sheet_project";
}

function spreadsheetIdFromUrl(url) {
  const m = url.match(/\/spreadsheets\/d\/([\w-]+)/);
  if (!m) throw new Error("Cannot extract spreadsheet ID from URL: " + url);
  return m[1];
}

function run(cmd, cwd, opts = {}) {
  const res = spawnSync("bash", ["-c", cmd], {
    cwd: cwd || ROOT,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` },
    encoding: "utf8", ...opts
  });
  if (res.status !== 0 && !opts.allowFail) throw new Error(res.stderr || res.stdout || `Failed: ${cmd}`);
  return (res.stdout || "").trim();
}

function runLive(cmd, cwd) {
  return spawnSync("bash", ["-c", cmd], {
    cwd: cwd || ROOT,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` },
    stdio: "inherit"
  }).status;
}

function globalLog(level, message, meta = {}) {
  ensureDir(LOGS);
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  const f = path.join(LOGS, `sheetops-${new Date().toISOString().slice(0,10)}.jsonl`);
  fs.appendFileSync(f, JSON.stringify(entry) + "\n");
}

function ts() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2), next = argv[i + 1];
      args[key] = (next && !next.startsWith("--")) ? (i++, next) : true;
    } else args._.push(a);
  }
  return args;
}

function requireProject(args) {
  const p = args["project"] || args["p"];
  if (!p) { err("--project <name> required"); process.exit(1); }
  return p;
}

function requirePatch(args) {
  const f = args["patch"];
  if (!f) { err("--patch <file> required"); process.exit(1); }
  if (!fs.existsSync(f)) { err("Patch file not found: " + f); process.exit(1); }
  return f;
}

/** Load the sheets-api module */
function api() {
  if (!fs.existsSync(LIB)) { err("lib/sheets-api.js not found. Framework may be corrupted."); process.exit(1); }
  return require(LIB);
}

/** Get spreadsheetId from project config, with helpful error if missing */
function getSpreadsheetId(projectName) {
  const cfg = loadProjectConfig(projectName);
  if (!cfg.spreadsheetId || cfg.spreadsheetId === "UNKNOWN") {
    err(`No spreadsheetId in project '${projectName}'.`);
    info(`Set it with: node sheetops.js add-sheet --spreadsheet-id ID --name ${projectName}`);
    process.exit(1);
  }
  return cfg.spreadsheetId;
}

/** Deep-merge b over a (objects only; arrays/scalars in b replace a). */
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) &&
        a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k], b[k]);
    } else out[k] = b[k];
  }
  return out;
}

/** Load design tokens: repo theme.json, deep-merged with projects/<name>/theme.json if present. */
function loadTheme(projectName) {
  const base = path.join(ROOT, "theme.json");
  let theme = fs.existsSync(base) ? readJson(base) : {};
  if (projectName) {
    const override = path.join(projectDir(projectName), "theme.json");
    if (fs.existsSync(override)) theme = deepMerge(theme, readJson(override));
  }
  return theme;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** auth — multi-account OAuth management */
async function cmdAuth(args) {
  hdr("SheetOps auth");
  const A        = api();
  const CREDS    = A.SHEETOPS_CREDS;

  // ── Sub-commands ────────────────────────────────────────────────────────

  // --list  →  show all authenticated accounts
  if (args["list"]) {
    // Auto-resolve any "default" account key
    const migrated = await A.migrateDefaultAccount();
    if (migrated) ok(`Account key resolved: "default" → ${C.cyan}${migrated}${C.reset}`);
    const accounts = A.listAccounts();
    if (!accounts.length) { info("No accounts authenticated yet."); return; }
    hdr("Authenticated accounts");
    accounts.forEach(a => {
      const tag = a.active ? C.green + " ← active" + C.reset : "";
      info(`${a.key}${tag}`);
      if (a.scope) console.log(`   ${C.grey}${a.scope}${C.reset}`);
    });
    return;
  }

  // --switch <email>  →  change active account
  if (args["switch"]) {
    A.switchAccount(args["switch"]);
    ok(`Active account switched to: ${args["switch"]}`);
    return;
  }

  // --remove <email>  →  remove an account
  if (args["remove"]) {
    const newActive = A.removeAccount(args["remove"]);
    ok(`Removed: ${args["remove"]}`);
    if (newActive) info(`Active account is now: ${newActive}`);
    else warn("No accounts remaining.");
    return;
  }

  // ── OAuth flow (add or re-auth an account) ──────────────────────────────
  let clientId     = args["client-id"];
  let clientSecret = args["client-secret"];

  // Re-use stored client credentials if not supplied
  if (!clientId && fs.existsSync(CREDS)) {
    try {
      const stored = readJson(CREDS);
      if (stored.client_id && stored.client_secret) {
        clientId     = stored.client_id;
        clientSecret = stored.client_secret;
        info(`Re-using stored OAuth client (${clientId.slice(0, 36)}...)`);
      }
    } catch(_) {}
  }

  if (!clientId || !clientSecret) {
    console.log(`
${C.bold}SheetOps: One-time Google OAuth Setup${C.reset}

SheetOps needs its own GCP OAuth client. This takes ~3 minutes and is done once per GCP project.

${C.bold}Step 1${C.reset} — Create a GCP project: https://console.cloud.google.com/
${C.bold}Step 2${C.reset} — Enable APIs → Library → "Google Sheets API" + "Google Drive API"
${C.bold}Step 3${C.reset} — Credentials → Create OAuth client ID → Desktop app → Copy ID + Secret
${C.bold}Step 4${C.reset} — Consent screen → Test users → add your Google email
${C.bold}Step 5${C.reset} — Run:
  node "${path.resolve(__dirname, "sheetops.js")}" auth \\
    --client-id YOUR_CLIENT_ID \\
    --client-secret YOUR_CLIENT_SECRET

${C.yellow}To add a second Google account later:${C.reset}
  node sheetops.js auth          (same client creds — just sign in with the other account)
  node sheetops.js auth --list   (see all accounts)
  node sheetops.js auth --switch other@gmail.com
`);
    process.exit(0);
  }

  info("Starting OAuth flow — your browser will open in a moment.");
  info("Scopes: spreadsheets + drive + script.projects");
  try {
    const result = await A.runAuthFlow(clientId, clientSecret);
    ok(`Authorisation complete!  Account: ${C.cyan}${result.email}${C.reset}`);
    ok(`Tokens saved to: ${CREDS}`);
    if (result.scope) info(`Scopes: ${result.scope}`);
    ok("Sheets API + Script Execution: ready ✓");
    info("To add another account: run auth again and sign in with a different Google account.");
  } catch(e) {
    err("Auth failed: " + e.message);
    process.exit(1);
  }
}

/** init — verify tools, show auth status */
async function cmdInit() {
  hdr("SheetOps init  v2.0.0");
  ensureDir(PROJECTS); ensureDir(TEMPLATES); ensureDir(LOGS);
  if (!fs.existsSync(CONFIG_FILE)) {
    writeJson(CONFIG_FILE, { version: "2.0.0", created: new Date().toISOString(), root: ROOT, projects: [] });
    ok("Created sheetops.config.json");
  } else info("sheetops.config.json exists");

  hdr("Tool checks");
  for (const { name, cmd } of [
    { name: "node",  cmd: "node --version" },
    { name: "npm",   cmd: "npm --version"  },
    { name: "git",   cmd: "git --version"  },
    { name: "clasp", cmd: "clasp --version"}
  ]) {
    try { ok(`${name}: ${run(cmd)}`); }
    catch(_) { err(`${name}: NOT FOUND`); }
  }

  hdr("Auth status");
  const A = api();
  // Auto-migrate "default" account key → real email
  const migrated = await A.migrateDefaultAccount();
  if (migrated) ok(`Account key resolved: "default" → ${C.cyan}${migrated}${C.reset}`);
  const accounts = A.listAccounts();
  if (accounts.length) {
    accounts.forEach(a => {
      const tag = a.active ? C.green + " ← active" + C.reset : "";
      ok(`Account: ${C.cyan}${a.key}${C.reset}${tag}`);
      if (a.key === "default") {
        warn(`  Account key is "default" (email not yet resolved). Run: node sheetops.js auth   to re-authenticate and resolve to your Google email address.`);
      }
    });
    ok("Sheets API scope: present ✓");
  } else {
    const clasprc = path.join(os.homedir(), ".clasprc.json");
    if (fs.existsSync(clasprc) && A.hasSpreadsheetScope()) {
      info("clasp fallback auth (limited). Run: node sheetops.js auth for full setup.");
    } else {
      warn("Not authenticated. Run: node sheetops.js auth");
    }
  }

  hdr("Registered projects");
  const cfg = readJson(CONFIG_FILE);
  if (!cfg.projects || cfg.projects.length === 0) {
    info("No projects yet. Add one with: node sheetops.js add-sheet --url \"SHEET_URL\"");
  } else {
    cfg.projects.forEach(p => {
      try {
        const pc = loadProjectConfig(p);
        info(`${p}  [${pc.status}]  ${pc.spreadsheetId || "no-id"}`);
      } catch(_) { warn(`${p}: config missing`); }
    });
  }

  ok(`\nFramework ready. Root: ${ROOT}`);
}

/** add-sheet — scaffold a new per-sheet project */
async function cmdAddSheet(args) {
  hdr("SheetOps add-sheet");
  let spreadsheetId = args["spreadsheet-id"] || null;
  let scriptId      = args["script-id"]       || null;
  const url         = args["url"]              || null;

  if (url) {
    try { spreadsheetId = spreadsheetIdFromUrl(url); info(`Spreadsheet ID: ${spreadsheetId}`); }
    catch(e) { err(e.message); process.exit(1); }
  }
  if (!spreadsheetId && !scriptId) {
    err("Provide --url, --spreadsheet-id, or --script-id"); process.exit(1);
  }

  let projectName = args["name"] ||
    (spreadsheetId ? safeName("sheet_" + spreadsheetId.slice(0, 12)) : safeName("script_" + scriptId.slice(0, 12)));

  const pDir = projectDir(projectName);
  if (fs.existsSync(pDir)) {
    // Update existing project if new info provided
    warn(`Project '${projectName}' already exists — updating config`);
    const pc = loadProjectConfig(projectName);
    if (spreadsheetId && !pc.spreadsheetId) { pc.spreadsheetId = spreadsheetId; }
    if (scriptId      && !pc.scriptId)      { pc.scriptId      = scriptId; }
    writeJson(path.join(pDir, "project.config.json"), pc);
    ok("Updated project.config.json");
    process.exit(0);
  }

  info(`Creating project: ${projectName}`);
  [pDir, "appsscript","ops/patches","ops/snapshots","ops/backups","ops/logs","docs"]
    .forEach(d => ensureDir(path.join(pDir, d)));
  ok("Created directory structure");

  const cfg = {
    version: "2.0.0", created: new Date().toISOString(),
    projectName, spreadsheetId: spreadsheetId || null,
    scriptId: scriptId || null, sourceUrl: url || null,
    status: "initializing", agentOpsInstalled: false,
    lastSnapshot: null, lastBackup: null
  };
  writeJson(path.join(pDir, "project.config.json"), cfg);
  ok("Wrote project.config.json");

  // CLAUDE.md from template
  const tplPath = path.join(TEMPLATES, "CLAUDE.sheet-project.md");
  if (fs.existsSync(tplPath)) {
    const content = fs.readFileSync(tplPath, "utf8")
      .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
      .replace(/\{\{SPREADSHEET_ID\}\}/g, spreadsheetId || "TBD")
      .replace(/\{\{SCRIPT_ID\}\}/g, scriptId || "TBD");
    fs.writeFileSync(path.join(pDir, "CLAUDE.md"), content);
    ok("Wrote CLAUDE.md");
  }

  // Copy operating protocol
  const opSrc = path.join(TEMPLATES, "operating-protocol.md");
  if (fs.existsSync(opSrc)) {
    fs.copyFileSync(opSrc, path.join(pDir, "docs", "operating-protocol.md"));
    ok("Copied operating-protocol.md");
  }

  // Attempt clasp clone if we have a scriptId
  if (scriptId) {
    info(`Cloning Apps Script: ${scriptId}`);
    const code = runLive(`clasp clone '${scriptId}' --rootDir .`, path.join(pDir, "appsscript"));
    if (code === 0) ok("clasp clone succeeded");
    else warn("clasp clone failed. Run pull-script after fixing any auth issues.");
  } else {
    writeJson(path.join(pDir, "appsscript", ".clasp.json"), { scriptId: "UNKNOWN", rootDir: "." });
    info("No scriptId — skipping clasp clone.");
  }

  // Git init
  const gitDir = path.join(pDir, "appsscript");
  if (!fs.existsSync(path.join(gitDir, ".git"))) {
    try { run("git init && git add -A && git commit -m 'Initial commit' --allow-empty", gitDir); ok("Git initialised"); }
    catch(e) { warn("Git init: " + e.message); }
  }

  // Stub docs
  fs.writeFileSync(path.join(pDir, "docs", "workbook-map.md"),
    `# Workbook Map: ${projectName}\n\n_Run \`sheetops snapshot\` to populate._\n\n## Sheets\n\n| Name | Hidden | Rows | Cols |\n|------|--------|------|------|\n\n## Named Ranges\n\n| Name | Range |\n|------|-------|\n`);
  fs.writeFileSync(path.join(pDir, "docs", "apps-script-map.md"),
    `# Apps Script Map: ${projectName}\n\n_Run \`sheetops pull-script\` to populate._\n\n## Files\n\n| File | Functions |\n|------|-----------|\n`);
  ok("Wrote stub docs");

  fs.writeFileSync(path.join(pDir, "README.md"),
    `# SheetOps: ${projectName}\n\nSpreadsheetId: \`${spreadsheetId || "TBD"}\`\nScriptId: \`${scriptId || "TBD"}\`\nCreated: ${new Date().toISOString()}\n`);

  // Register in root config
  const rootCfg = readJson(CONFIG_FILE);
  if (!rootCfg.projects) rootCfg.projects = [];
  if (!rootCfg.projects.includes(projectName)) { rootCfg.projects.push(projectName); writeJson(CONFIG_FILE, rootCfg); }
  ok("Registered in sheetops.config.json");

  globalLog("info", "add-sheet", { projectName, spreadsheetId, scriptId });
  ok(`\nProject '${projectName}' created at ${pDir}`);
  info(`Next: node "${ROOT}/bin/sheetops.js" snapshot --project ${projectName}`);
}

/** health — live healthcheck via Sheets API */
async function cmdHealth(args) {
  const name = requireProject(args);
  const sid  = getSpreadsheetId(name);
  hdr(`Health: ${name}`);
  try {
    const result = await api().healthcheck(sid);
    ok(`${result.spreadsheetName} (${result.sheetCount} sheets)`);
    result.sheets.forEach(s =>
      info(`  ${s.hidden ? "[hidden] " : ""}${s.name}  ${s.rowCount}r × ${s.colCount}c`));
    if (result.namedRanges.length)
      result.namedRanges.forEach(nr => info(`  named: ${nr.name}`));
    globalLog("info", "health", { name, spreadsheetId: sid });
  } catch(e) { err("Health failed: " + e.message); }
}

/** snapshot — full workbook snapshot */
async function cmdSnapshot(args) {
  const name = requireProject(args);
  const sid  = getSpreadsheetId(name);
  hdr(`Snapshot: ${name}`);
  try {
    const data = await api().snapshotWorkbook(sid);
    const pDir = projectDir(name);
    ensureDir(path.join(pDir, "ops", "snapshots"));
    const fname = `snapshot-${ts()}.json`;
    writeJson(path.join(pDir, "ops", "snapshots", fname), data);
    ok(`Saved: ops/snapshots/${fname}`);

    // Update project config
    const pc = loadProjectConfig(name);
    pc.lastSnapshot = new Date().toISOString();
    pc.lastSnapshotHash = data.snapshotHash;
    writeJson(path.join(pDir, "project.config.json"), pc);

    // Regenerate workbook-map.md
    const sheetRows = data.sheets.map(s =>
      `| ${s.name} | ${s.hidden ? "✓" : ""} | ${s.lastRow} | ${s.lastColumn} |`).join("\n");
    const nrRows = data.namedRanges.map(nr =>
      `| ${nr.name} | ${JSON.stringify(nr.range)} |`).join("\n");
    const prRows = data.protectedRanges.map(p =>
      `| ${p.description || "(unnamed)"} | ${p.sheetName} | ${p.editors.join(", ")} |`).join("\n");
    fs.writeFileSync(path.join(pDir, "docs", "workbook-map.md"),
      `# Workbook Map: ${name}\n\n_Updated: ${new Date().toISOString()}_\n_Hash: \`${data.snapshotHash}\`_\n\n` +
      `## Sheets\n\n| Name | Hidden | Rows | Cols |\n|------|--------|------|------|\n${sheetRows || "_none_"}\n\n` +
      `## Named Ranges\n\n| Name | Range |\n|------|-------|\n${nrRows || "_none_"}\n\n` +
      `## Protected Ranges\n\n| Description | Sheet | Editors |\n|-------------|-------|--------|\n${prRows || "_none_"}\n`);
    ok("Updated workbook-map.md");
    ok(`Snapshot hash: ${data.snapshotHash}`);
    globalLog("info", "snapshot", { name, hash: data.snapshotHash });
  } catch(e) { err("Snapshot failed: " + e.message); }
}

/** read — read a range via Sheets API */
async function cmdRead(args) {
  const name = requireProject(args);
  const sid  = getSpreadsheetId(name);
  hdr(`Read: ${name}`);
  let target;
  if (args["named-range"])             target = { namedRange: args["named-range"] };
  else if (args["sheet"] && args["a1"]) target = { sheetName: args["sheet"], a1: args["a1"] };
  else { err("Provide --named-range or --sheet + --a1"); process.exit(1); }
  try {
    const result = await api().readRange(sid, target);
    ok(`${result.sheet}!${result.a1}  (${result.rows}×${result.cols})`);
    ok(`Hash: ${result.hash}`);
    console.log(C.grey + JSON.stringify(result.values, null, 2) + C.reset);
    globalLog("info", "read", { name, target });
  } catch(e) { err("Read failed: " + e.message); }
}

/** backup — copy spreadsheet in Drive */
async function cmdBackup(args) {
  const name   = requireProject(args);
  const sid    = getSpreadsheetId(name);
  const reason = args["reason"] || "manual backup";
  hdr(`Backup: ${name}`);
  try {
    const pc     = loadProjectConfig(name);
    const result = await api().backupSpreadsheet(sid, pc.spreadsheetName || name, reason);
    ok(`Backup: ${result.backupName}`);
    ok(`Drive ID: ${result.backupId}`);
    const cfgPath = path.join(projectDir(name), "project.config.json");
    const cfg = readJson(cfgPath);
    cfg.lastBackup = new Date().toISOString(); cfg.lastBackupId = result.backupId;
    writeJson(cfgPath, cfg);
    globalLog("info", "backup", { name, backupId: result.backupId, reason });
  } catch(e) { err("Backup failed: " + e.message); warn("Drive access may require re-auth: node sheetops.js auth"); }
}

/** dry-run-patch — preview without writing */
async function cmdDryRunPatch(args) {
  const name  = requireProject(args);
  const pFile = requirePatch(args);
  const sid   = getSpreadsheetId(name);
  hdr(`Dry-run patch: ${name}`);
  const patch = loadAndValidatePatch(pFile, name);
  info(`operationId: ${patch.operationId}`);
  info(`reason: ${patch.reason}`);
  info(`operations: ${patch.operations.length}`);
  let allSafe = true;
  const A = api();
  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i];
    info(`\n  [${i}] type=${op.type}  target=${JSON.stringify(op.target)}`);
    try {
      const dr = await A.writeRangeDryRun(sid, op.target, op.values || [], {
        expectedHash: op.expectedHash
      });
      if (!dr.ok && dr.error) { err(`  ${dr.error}`); allSafe = false; continue; }
      ok(`  cells: ${dr.totalCellsAffected}, warnings: ${dr.warnings.length}`);
      dr.warnings.forEach(w => warn("  " + w));
      if (dr.requiresApproval) { warn("  ⚠ Requires approval"); allSafe = false; }
    } catch(e) { err("  Error: " + e.message); allSafe = false; }
  }
  allSafe ? ok("\nDry-run passed.") : warn("\nDry-run has warnings — review before applying.");
}

/** apply-patch — apply validated patch */
async function cmdApplyPatch(args) {
  const name  = requireProject(args);
  const pFile = requirePatch(args);
  const sid   = getSpreadsheetId(name);
  hdr(`Apply patch: ${name}`);
  const patch = loadAndValidatePatch(pFile, name);
  if (patch.requiresApproval && !args["confirmed"]) {
    warn("requiresApproval:true. Add --confirmed to apply."); process.exit(1);
  }
  const A = api();
  if (patch.backupRequired) {
    info("Taking backup…");
    try {
      const pc = loadProjectConfig(name);
      const bk = await A.backupSpreadsheet(sid, pc.spreadsheetName || name, "pre-patch: " + patch.operationId);
      ok("Backup: " + bk.backupName);
    } catch(e) { warn("Backup failed: " + e.message); }
  }
  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i];
    info(`\n  Applying [${i}] type=${op.type}  target=${JSON.stringify(op.target)}`);
    try {
      let result;
      switch (op.type) {
        case "setValues":
          result = await A.writeRange(sid, op.target, op.values, {
            expectedHash: op.expectedHash, confirmLarge: true
          });
          break;
        case "appendRows":
          result = await A.appendRows(sid, op.target.sheetName || op.target.namedRange, op.values);
          break;
        case "clearRange":
          if (!op.confirmDestructive) { err("  confirmDestructive:true required for clearRange"); process.exit(1); }
          result = await A.clearRange(sid, op.target);
          break;
        default:
          warn(`  Unknown type '${op.type}' — skipping`);
          continue;
      }
      ok("  Applied: " + JSON.stringify(result));
    } catch(e) { err("  Failed: " + e.message); process.exit(1); }
  }
  // Log the operation
  try {
    await A.logOperation(sid, {
      operationId: patch.operationId, type: "applyPatch",
      target: { patchFile: pFile }, status: "ok",
      message: `${patch.operations.length} op(s). ${patch.reason}`
    });
  } catch(_) {}
  // Move patch to applied/
  const appliedDir = path.join(projectDir(name), "ops", "patches", "applied");
  ensureDir(appliedDir);
  fs.renameSync(pFile, path.join(appliedDir, path.basename(pFile)));
  globalLog("info", "apply-patch", { name, operationId: patch.operationId });
  ok("\nPatch applied. Moved to ops/patches/applied/");
}

/** validate — run standard + custom checks */
async function cmdValidate(args) {
  const name = requireProject(args);
  const sid  = getSpreadsheetId(name);
  hdr(`Validate: ${name}`);
  const checks = [{ type: "logSheetExists" }];
  const custom = path.join(projectDir(name), "docs", "validation.json");
  if (fs.existsSync(custom)) checks.push(...(readJson(custom).checks || []));
  try {
    const result = await api().runValidation(sid, checks);
    result.results.forEach(r =>
      r.pass ? ok(`  ${r.check.type}: PASS  ${r.note}`) : err(`  ${r.check.type}: FAIL  ${r.note}`)
    );
    result.allPassed ? ok("\nAll checks passed.") : err("\nSome checks failed.");
  } catch(e) { err("Validate failed: " + e.message); }
}

/** pull-script — clasp pull + git commit */
function cmdPullScript(args) {
  const name   = requireProject(args);
  const appDir = path.join(projectDir(name), "appsscript");
  hdr(`Pull script: ${name}`);
  const code = runLive("clasp pull", appDir);
  if (code === 0) {
    ok("clasp pull succeeded");
    try { run("git add -A && git commit -m 'clasp pull: " + new Date().toISOString() + "' || true", appDir); ok("Git committed"); }
    catch(e) { warn("Git: " + e.message); }
    updateAppsScriptMap(name, appDir);
    ok("Updated apps-script-map.md");
    globalLog("info", "pull-script", { name });
  } else err("clasp pull failed");
}

/** push-script — show diff, require --confirmed */
function cmdPushScript(args) {
  const name   = requireProject(args);
  const appDir = path.join(projectDir(name), "appsscript");
  hdr(`Push script: ${name}`);
  warn("Apps Script push requires explicit approval.");
  const diff = run("git diff HEAD", appDir, { allowFail: true });
  if (diff) console.log(C.grey + diff + C.reset);
  else info("No uncommitted changes.");
  if (!args["confirmed"]) { warn("\nAborted. Add --confirmed to push."); return; }
  const code = runLive("clasp push", appDir);
  if (code === 0) {
    ok("clasp push succeeded");
    try { run("git add -A && git commit -m 'clasp push: " + new Date().toISOString() + "' || true", appDir); ok("Git committed"); }
    catch(_) {}
    globalLog("info", "push-script", { name });
  } else err("clasp push failed");
}

/** log-summary — read __AGENT_OPS_LOG via Sheets API */
async function cmdLogSummary(args) {
  const name = requireProject(args);
  const sid  = getSpreadsheetId(name);
  hdr(`Log summary: ${name}`);
  try {
    const A   = api();
    const meta = await A.getSpreadsheetMeta(sid);
    const logExists = (meta.sheets || []).some(s => s.properties.title === "__AGENT_OPS_LOG");
    if (!logExists) { warn("__AGENT_OPS_LOG not found. Run snapshot or apply a patch first."); return; }
    const snap = await A.readRange(sid, { sheetName: "__AGENT_OPS_LOG", a1: "A1:I1000" });
    const rows = snap.values.slice(1).filter(r => r[0]).slice(-20);
    if (!rows.length) { info("Log is empty."); return; }
    rows.forEach(r => {
      const marker = r[6] === "ok" ? C.green + "✔" : C.red + "✖";
      console.log(`${marker}${C.reset} ${r[0]}  ${C.cyan}${r[2]}${C.reset}  ${r[7]}`);
    });
  } catch(e) { err("Log summary failed: " + e.message); }

  // Local logs
  hdr("Local logs (today)");
  const today = new Date().toISOString().slice(0, 10);
  const lf = path.join(LOGS, `sheetops-${today}.jsonl`);
  if (fs.existsSync(lf)) {
    fs.readFileSync(lf, "utf8").trim().split("\n").slice(-10).forEach(l => {
      try { const e = JSON.parse(l); info(`${e.ts}  ${e.message}`); } catch(_) {}
    });
  } else info("No local log today.");
}

/** stats — workbook summary statistics */
async function cmdStats(args) {
  hdr("SheetOps stats");
  const projectName = requireProject(args);
  const A           = api();
  const spreadsheetId = getSpreadsheetId(projectName);

  info(`Loading stats for '${projectName}'...`);
  const meta = await A.getSpreadsheetMeta(spreadsheetId);

  const allSheets  = meta.sheets || [];
  const visible    = allSheets.filter(s => !s.properties.hidden);
  const hidden     = allSheets.filter(s =>  s.properties.hidden);
  const namedRanges = meta.namedRanges || [];

  let totalRows = 0, totalCols = 0;
  allSheets.forEach(s => {
    const g = s.properties.gridProperties || {};
    totalRows += g.rowCount || 0;
    totalCols += g.columnCount || 0;
  });

  hdr(`${meta.properties.title}`);
  ok(`Sheets total  : ${allSheets.length}  (${visible.length} visible, ${hidden.length} hidden)`);
  ok(`Named ranges  : ${namedRanges.length}`);
  ok(`Total grid    : ${totalRows.toLocaleString()} rows × ${totalCols.toLocaleString()} cols`);

  hdr("Sheets by size");
  const bySize = [...allSheets].sort((a, b) => {
    const ga = a.properties.gridProperties || {}, gb = b.properties.gridProperties || {};
    return (gb.rowCount || 0) - (ga.rowCount || 0);
  }).slice(0, 10);
  bySize.forEach(s => {
    const g = s.properties.gridProperties || {};
    const hid = s.properties.hidden ? C.grey + " [hidden]" + C.reset : "";
    info(`${s.properties.title.padEnd(30)} ${(g.rowCount || 0).toString().padStart(6)} r × ${(g.columnCount || 0).toString().padStart(4)} c${hid}`);
  });

  if (namedRanges.length) {
    hdr("Named ranges");
    namedRanges.forEach(nr => info(`${nr.name}`));
  }

  // Check project snapshot age
  const pc = loadProjectConfig(projectName);
  if (pc.lastSnapshot) info(`Last snapshot : ${pc.lastSnapshot}`);
  else warn("No snapshot yet. Run: node sheetops.js snapshot --project " + projectName);
}

/** export — export a sheet range to CSV or JSON */
async function cmdExport(args) {
  hdr("SheetOps export");
  const projectName = requireProject(args);
  const sheetName   = args["sheet"];
  const a1          = args["a1"]     || null;
  const format      = (args["format"] || "csv").toLowerCase();
  const outFile     = args["out"]    || null;

  if (!sheetName) { err("--sheet <name> required"); process.exit(1); }
  if (!["csv","json","both"].includes(format)) { err("--format must be csv, json, or both"); process.exit(1); }

  const A           = api();
  const spreadsheetId = getSpreadsheetId(projectName);
  const target      = a1 ? { sheetName, a1 } : { sheetName, a1: "A1:ZZ" };

  info(`Exporting '${sheetName}'${a1 ? " " + a1 : ""} as ${format}...`);

  const result = await A.exportRange(spreadsheetId, target, format);
  ok(`${result.rows} rows × ${result.cols} cols`);

  if (outFile) {
    const content = format === "json"
      ? JSON.stringify(result.json, null, 2)
      : (format === "both" ? JSON.stringify(result, null, 2) : result.csv);
    fs.writeFileSync(outFile, content, "utf8");
    ok(`Saved to: ${outFile}`);
  } else {
    if (format === "json" || format === "both") {
      console.log("\n" + C.cyan + "JSON:" + C.reset);
      console.log(JSON.stringify(result.json ? result.json.slice(0, 5) : [], null, 2));
      if (result.json && result.json.length > 5) info(`... (${result.json.length - 5} more rows — use --out <file> to save all)`);
    }
    if (format === "csv" || format === "both") {
      console.log("\n" + C.cyan + "CSV preview (first 5 rows):" + C.reset);
      result.csv.split("\n").slice(0, 5).forEach(l => console.log(l));
      const total = result.csv.split("\n").length;
      if (total > 5) info(`... (${total - 5} more rows — use --out <file> to save all)`);
    }
  }
}

/** find — search for a value across a sheet */
async function cmdFind(args) {
  hdr("SheetOps find");
  const projectName = requireProject(args);
  const query       = args["value"] || args["q"];
  const sheetName   = args["sheet"] || null;
  const a1          = args["a1"]    || null;

  if (!query) { err("--value <text> required"); process.exit(1); }

  const A           = api();
  const spreadsheetId = getSpreadsheetId(projectName);

  // If no sheet specified, search all visible sheets
  const sheetsToSearch = [];
  if (sheetName) {
    sheetsToSearch.push(sheetName);
  } else {
    const meta = await A.getSpreadsheetMeta(spreadsheetId);
    (meta.sheets || []).filter(s => !s.properties.hidden).forEach(s => sheetsToSearch.push(s.properties.title));
  }

  info(`Searching for "${query}" across ${sheetsToSearch.length} sheet(s)...`);

  let totalMatches = 0;
  for (const sheet of sheetsToSearch) {
    try {
      const result = await A.findInSheet(spreadsheetId, sheet, query, a1);
      if (result.matchCount > 0) {
        hdr(`${sheet}  (${result.matchCount} match${result.matchCount !== 1 ? "es" : ""})`);
        result.matches.slice(0, 20).forEach(m => info(`  ${m.a1.padEnd(6)}  ${m.value}`));
        if (result.matchCount > 20) info(`  ... ${result.matchCount - 20} more`);
        totalMatches += result.matchCount;
      }
    } catch(_) { /* skip inaccessible sheets */ }
  }

  if (totalMatches === 0) info(`No matches found for "${query}"`);
  else ok(`Total: ${totalMatches} match${totalMatches !== 1 ? "es" : ""} across ${sheetsToSearch.length} sheet(s)`);
}

/** list-functions — list Apps Script functions in a project */
async function cmdListFunctions(args) {
  hdr("SheetOps list-functions");
  const projectName = requireProject(args);
  const cfg         = loadProjectConfig(projectName);
  const appDir      = path.join(projectDir(projectName), "appsscript");

  // Option 1: use run-script if script is configured
  if (cfg.scriptId && args["live"]) {
    info("Fetching live function list via run-script...");
    try {
      const A      = api();
      const result = await A.runScript(cfg.scriptId, "agent_listProjectFunctions", [], true);
      if (result) {
        // runScript returns the AgentOps envelope { ok, data, ts } — unwrap .data
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        const data   = (parsed.ok && parsed.data) ? parsed.data : parsed;
        ok(`${data.count || (data.functions || []).length} function(s) registered in AgentOps`);
        (data.functions || []).forEach(f => info(`  ${f}`));
        return;
      }
    } catch(_) { warn("Live fetch failed, falling back to local scan..."); }
  }

  // Option 2: parse local .gs files
  if (!fs.existsSync(appDir)) { warn("No local script files. Run pull-script first."); return; }

  const gsFiles = fs.readdirSync(appDir).filter(f => f.endsWith(".gs"));
  if (!gsFiles.length) { warn("No .gs files found."); return; }

  hdr("Functions by file");
  let total = 0;
  gsFiles.forEach(f => {
    const content = fs.readFileSync(path.join(appDir, f), "utf8");
    const fns     = [...content.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m => m[1]);
    if (fns.length) {
      info(`${C.bold}${f}${C.reset}  (${fns.length} functions)`);
      fns.forEach(fn => console.log(`   ${fn}`));
      total += fns.length;
    }
  });
  ok(`Total: ${total} functions in ${gsFiles.length} file(s)`);
  info("Pass --live to fetch from the live script (requires run-script setup)");
}

/** run-script — execute an Apps Script function via the Execution API */
async function cmdRunScript(args) {
  hdr("SheetOps run-script");
  const projectName = requireProject(args);
  const fnName      = args["function"] || args["fn"];
  if (!fnName) { err("--function <name> required"); process.exit(1); }

  const cfg = loadProjectConfig(projectName);
  if (!cfg.scriptId || cfg.scriptId === "UNKNOWN") {
    err(`No scriptId in project '${projectName}'.`);
    info(`Add it with: node sheetops.js add-sheet --script-id SCRIPT_ID --name ${projectName}`);
    process.exit(1);
  }

  let params = [];
  if (args["params"]) {
    try { params = JSON.parse(args["params"]); }
    catch(e) { err("--params must be a valid JSON array, e.g. '[\"arg1\", 42]'"); process.exit(1); }
  }

  const devMode = !args["prod"];  // default: dev mode (head); pass --prod for published version
  info(`Running ${fnName}() on project '${projectName}'`);
  info(`Script ID: ${cfg.scriptId}`);
  if (devMode) info("Mode: dev (latest saved) — pass --prod to run published version");

  try {
    const A      = api();
    const result = await A.runScript(cfg.scriptId, fnName, params, devMode);
    ok(`${fnName}() completed.`);
    if (result !== null && result !== undefined) {
      console.log(`\n${C.cyan}Result:${C.reset}`);
      console.log(JSON.stringify(result, null, 2));
    }
    globalLog("info", "run-script", { project: projectName, function: fnName, devMode });
  } catch(e) {
    err("Execution failed: " + e.message);
    if (e.message.includes("403") || e.message.includes("not been set up") || e.message.includes("API")) {
      warn("Apps Script Execution API not yet configured for this project.");
      info(`Run: node sheetops.js setup-gcp --project ${projectName}`);
    }
    process.exit(1);
  }
}

/** setup-gcp — link a script to the user's GCP project to enable Execution API */
function cmdSetupGcp(args) {
  const name = args["project"] ? requireProject(args) : null;
  const cfg  = name ? loadProjectConfig(name) : null;
  hdr("SheetOps: Enable Apps Script Execution (one-time per script)");
  console.log(`
${C.bold}Prerequisites:${C.reset} You need a Google Cloud Platform project with the Apps Script API enabled.
If you don't have one yet, create it at: ${C.bold}https://console.cloud.google.com/${C.reset}

${C.bold}Step 1 — Enable Apps Script API${C.reset} (once per GCP project)
  Open: ${C.bold}https://console.cloud.google.com/apis/library/script.googleapis.com${C.reset}
  Select your GCP project, then click "Enable".  (If it shows "Manage", it's already done.)
  Note your ${C.cyan}Project Number${C.reset} from the GCP project dashboard — you'll need it in Step 2.

${C.bold}Step 2 — Link this script to the GCP project${C.reset} (once per Apps Script)
  ${cfg && cfg.scriptId
    ? `Script ID for '${name}': ${C.cyan}${cfg.scriptId}${C.reset}\n  Open: https://script.google.com/home/projects/${cfg.scriptId}/edit`
    : "Open your Apps Script: go to the Sheet → Extensions → Apps Script"}
  Click the ${C.bold}⚙ gear icon → Project Settings${C.reset}
  Under "Google Cloud Platform (GCP) Project" → ${C.bold}Change project${C.reset}
  Enter your ${C.cyan}GCP Project Number${C.reset} (from Step 1)
  Click Set project.

${C.bold}Step 3 — Authenticate with the script.projects scope${C.reset} (if not already done)
  node "${path.resolve(__dirname, "sheetops.js")}" auth \\
    --client-id YOUR_CLIENT_ID \\
    --client-secret YOUR_CLIENT_SECRET
  (Sign in with the Google account that owns the GCP project.)

${C.bold}Step 4 — Test it${C.reset}
  node "${path.resolve(__dirname, "sheetops.js")}" run-script \\
    --project ${name || "<name>"} --function agent_healthcheck

${C.yellow}Note:${C.reset} devMode=true (default) runs your latest saved code — no deployment needed.
See SETUP.md for a full walkthrough of creating a GCP project and OAuth credentials.
`);
}

// ─── Sub-helpers ──────────────────────────────────────────────────────────────

function loadAndValidatePatch(pFile, projectName) {
  let patch;
  try { patch = readJson(pFile); } catch(e) { err("Invalid patch JSON: " + e.message); process.exit(1); }
  for (const k of ["operationId","project","reason","operations"]) {
    if (!patch[k]) { err("Patch missing: " + k); process.exit(1); }
  }
  if (patch.project !== projectName) warn(`Patch project '${patch.project}' ≠ --project '${projectName}'`);
  if (!Array.isArray(patch.operations) || !patch.operations.length) { err("Patch has no operations"); process.exit(1); }
  return patch;
}

function updateAppsScriptMap(name, appDir) {
  const files = [];
  try {
    fs.readdirSync(appDir).filter(f => f.endsWith(".gs") || f.endsWith(".html") || f === "appsscript.json")
      .forEach(f => {
        const c = fs.readFileSync(path.join(appDir, f), "utf8");
        files.push({ file: f, functions: [...c.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m => m[1]), lines: c.split("\n").length });
      });
  } catch(_) {}
  const fRows = files.map(f => `| ${f.file} | ${f.lines} lines | ${f.functions.join(", ")} |`).join("\n");
  fs.writeFileSync(path.join(projectDir(name), "docs", "apps-script-map.md"),
    `# Apps Script Map: ${name}\n\n_Updated: ${new Date().toISOString()}_\n\n## Files\n\n| File | Size | Functions |\n|------|------|----------|\n${fRows || "_none_"}\n`);
}

/** create-sheet — create a new Google Spreadsheet from a JSON schema */
async function cmdCreateSheet(args) {
  hdr("SheetOps create-sheet");
  const A = api();

  // Load schema from file or inline JSON
  let schema;
  if (args["schema"]) {
    const f = args["schema"];
    if (!fs.existsSync(f)) { err(`Schema file not found: ${f}`); process.exit(1); }
    schema = JSON.parse(fs.readFileSync(f, "utf8"));
  } else if (args["title"]) {
    // Minimal inline schema
    schema = { title: args["title"], sheets: [{ name: "Sheet1" }] };
  } else {
    err("--schema <file.json>  or  --title <name>  required");
    process.exit(1);
  }

  // Resolve folder
  let folderId = args["folder-id"] || null;
  if (!folderId && args["folder"]) {
    info(`Looking up folder: "${args["folder"]}"...`);
    const parentName = args["parent-folder"] || null;
    let parentId = null;
    if (parentName) {
      const parent = await A.findDriveFolder(parentName);
      if (!parent) { err(`Parent folder not found: ${parentName}`); process.exit(1); }
      parentId = parent.id;
    }
    const found = await A.findDriveFolder(args["folder"], parentId);
    if (found) {
      folderId = found.id;
      info(`Folder found: "${found.name}" (${found.id})`);
    } else if (args["create-folder"]) {
      const created = await A.createDriveFolder(args["folder"], parentId);
      folderId = created.id;
      ok(`Created folder: "${created.name}" (${created.id})`);
    } else {
      err(`Folder "${args["folder"]}" not found. Add --create-folder to create it.`);
      process.exit(1);
    }
  }

  info(`Creating spreadsheet: "${schema.title}"...`);
  if (folderId) info(`Target folder: ${folderId}`);

  const result = await A.createSpreadsheet(schema, folderId);

  ok(`Spreadsheet created!`);
  ok(`Title: ${result.title}`);
  ok(`URL:   ${result.url}`);
  ok(`ID:    ${result.spreadsheetId}`);
  info(`Sheets: ${result.sheets.join(", ")}`);

  // Optionally register as a SheetOps project
  if (args["register"]) {
    const name = args["name"] || schema.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    info(`Registering as project: ${name}`);
    const projectPath = projectDir(name);
    ensureDir(projectPath);
    ensureDir(path.join(projectPath, "ops", "patches"));
    ensureDir(path.join(projectPath, "ops", "snapshots"));
    ensureDir(path.join(projectPath, "ops", "backups"));
    ensureDir(path.join(projectPath, "docs"));
    writeJson(path.join(projectPath, "project.config.json"), {
      spreadsheetId: result.spreadsheetId,
      scriptId: null,
      name,
      status: "active",
      created: new Date().toISOString()
    });
    const globalCfg = readJson(CONFIG_FILE);
    if (!globalCfg.projects) globalCfg.projects = [];
    if (!globalCfg.projects.includes(name)) {
      globalCfg.projects.push(name);
      writeJson(CONFIG_FILE, globalCfg);
    }
    ok(`Registered as project: ${name}`);
    info(`Run: node sheetops.js snapshot --project ${name}`);
  }
}

/** format-range — apply rich formatting to a range */
async function cmdFormatRange(args) {
  hdr("SheetOps format-range");
  const A           = api();
  const projectName = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);

  // Any one recognised shorthand flag (or raw --requests) is enough to proceed.
  const CELL_FLAGS = ["bold", "italic", "bg", "fg", "font-size", "align", "number-format"];
  const wantsCellFormat = CELL_FLAGS.some(k => args[k] !== undefined);
  const wantsFreeze     = args["freeze-rows"] !== undefined || args["freeze-cols"] !== undefined;
  if (!args["requests"] && !wantsCellFormat && !wantsFreeze) {
    err('Provide --requests <json-array> or shorthand flags ' +
        '(--bold, --italic, --bg #hex, --fg #hex, --align left|center|right, --font-size N, ' +
        '--number-format "pattern" [--number-type TYPE], --freeze-rows N, --freeze-cols N)');
    process.exit(1);
  }
  // Cell-format flags need a target range.
  if (wantsCellFormat && !(args["sheet"] && args["a1"])) {
    err("Cell formatting flags (--bold, --italic, --bg, --fg, --font-size, --align, --number-format) require --sheet <name> and --a1 <range>.");
    process.exit(1);
  }
  if (args["number-format"] === true) {
    err('--number-format requires a pattern value, e.g. --number-format "£#,##0.00"');
    process.exit(1);
  }

  const requests = [];

  // Raw requests passthrough
  if (args["requests"]) {
    const raw = JSON.parse(args["requests"]);
    requests.push(...(Array.isArray(raw) ? raw : [raw]));
  }

  // Local helpers (no direct googleapis dependency — this module never imports `google`).
  const hexToColor = (hex) => {
    const h = (hex || "").replace("#", "").padEnd(6, "0");
    return { red: parseInt(h.substring(0,2),16)/255, green: parseInt(h.substring(2,4),16)/255, blue: parseInt(h.substring(4,6),16)/255 };
  };
  // Pick a numberFormat `type` from an explicit --number-type, else infer from the pattern.
  const numberType = (pattern, explicit) => {
    if (explicit && explicit !== true) return String(explicit).toUpperCase();
    const p = pattern || "";
    if (/%/.test(p))              return "PERCENT";
    if (/[£$€¥₹]|\[\$/.test(p))   return "CURRENCY";
    if (/[eE]\+?0/.test(p))       return "SCIENTIFIC";
    return "NUMBER";
  };

  // Resolve sheet metadata once, via the lib (getSpreadsheetMeta uses the authed client internally).
  let meta = null;
  if ((args["sheet"] && args["a1"]) || wantsFreeze) meta = await A.getSpreadsheetMeta(spreadsheetId);
  const sheetIdByTitle = (title) => {
    const s = (meta.sheets || []).find(x => x.properties.title === title);
    return s ? s.properties.sheetId : null;
  };

  // Shorthand cell formatting: --sheet --a1 + --bold/--italic/--bg/--fg/--font-size/--align/--number-format
  if (args["sheet"] && args["a1"]) {
    const sheetId = sheetIdByTitle(args["sheet"]);
    if (sheetId === null) { err(`Sheet not found: ${args["sheet"]}`); process.exit(1); }

    // Parse the A1 range → GridRange. A single cell ("A1") maps to exactly that cell;
    // a block ("A1:D10") maps to the block. (Previously a single cell was left open-ended,
    // which formatted the whole sheet from that corner.)
    const a1 = args["a1"];
    const startMatch = a1.match(/^([A-Z]+)(\d+)/i);
    const endMatch   = a1.match(/:([A-Z]+)(\d+)/i);
    const colToIdx   = c => c.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const startCol = startMatch ? colToIdx(startMatch[1]) : 0;
    const startRow = startMatch ? parseInt(startMatch[2]) - 1 : 0;
    const gr = {
      sheetId,
      startColumnIndex: startCol,
      startRowIndex:    startRow,
      endColumnIndex:   endMatch ? colToIdx(endMatch[1]) + 1 : (startMatch ? startCol + 1 : undefined),
      endRowIndex:      endMatch ? parseInt(endMatch[2])     : (startMatch ? startRow + 1 : undefined)
    };

    const cellFmt = { textFormat: {} };
    const fields = [];
    if (args["bold"] !== undefined)    { cellFmt.textFormat.bold     = args["bold"] !== "false"; fields.push("userEnteredFormat.textFormat.bold"); }
    if (args["italic"] !== undefined)  { cellFmt.textFormat.italic   = args["italic"] !== "false"; fields.push("userEnteredFormat.textFormat.italic"); }
    if (args["font-size"])             { cellFmt.textFormat.fontSize  = parseInt(args["font-size"]); fields.push("userEnteredFormat.textFormat.fontSize"); }
    if (args["fg"])                    { cellFmt.textFormat.foregroundColor = hexToColor(args["fg"]); fields.push("userEnteredFormat.textFormat.foregroundColor"); }
    if (args["bg"])                    { cellFmt.backgroundColor     = hexToColor(args["bg"]); fields.push("userEnteredFormat.backgroundColor"); }
    if (args["align"])                 { cellFmt.horizontalAlignment = args["align"].toUpperCase(); fields.push("userEnteredFormat.horizontalAlignment"); }
    if (args["number-format"] !== undefined) {
      cellFmt.numberFormat = { type: numberType(args["number-format"], args["number-type"]), pattern: args["number-format"] };
      fields.push("userEnteredFormat.numberFormat");
    }

    if (fields.length) requests.push({ repeatCell: { range: gr, cell: { userEnteredFormat: cellFmt }, fields: fields.join(",") } });
  }

  if (wantsFreeze) {
    const title   = args["sheet"] || (meta.sheets[0] && meta.sheets[0].properties.title);
    const resolved = title ? sheetIdByTitle(title) : null;
    const sheetId  = resolved !== null ? resolved : (meta.sheets[0] ? meta.sheets[0].properties.sheetId : 0);
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount:    args["freeze-rows"] !== undefined ? parseInt(args["freeze-rows"]) : undefined,
            frozenColumnCount: args["freeze-cols"] !== undefined ? parseInt(args["freeze-cols"]) : undefined
          }
        },
        fields: [
          args["freeze-rows"] !== undefined ? "gridProperties.frozenRowCount" : null,
          args["freeze-cols"] !== undefined ? "gridProperties.frozenColumnCount" : null
        ].filter(Boolean).join(",")
      }
    });
  }

  if (!requests.length) { warn("No formatting requests generated."); return; }

  info(`Applying ${requests.length} formatting request(s) to ${projectName}...`);
  await A.formatRange(spreadsheetId, requests);
  ok(`Formatting applied.`);
}

/** autofit — auto-size columns (+ row heights) to content, with a max-width cap + wrap */
async function cmdAutofit(args) {
  hdr("SheetOps autofit");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  if (!sheetTitle) { err("--sheet <name> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  const af = theme.autofit || {};
  const maxWidth = args["max-width"] !== undefined ? parseInt(args["max-width"]) : af.maxColWidth;
  const minWidth = args["min-width"] !== undefined ? parseInt(args["min-width"]) : af.minColWidth;
  const wrap     = args["no-wrap"] ? false : (af.wrapOverCap !== false);
  info(`Auto-fitting columns on ${projectName}!${sheetTitle} (max ${maxWidth || "∞"}px, min ${minWidth || "—"}px, wrap ${wrap})...`);
  const r = await A.autofit(spreadsheetId, { sheetTitle, maxWidth, minWidth, wrap });
  ok(`Columns resized. ${r.capped.length} capped${r.rowsResized ? ", row heights refit" : ""}.`);
  info(`Widths: ${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);
}

/** style-table / beautify — one-shot theme styling of a tabular range */
async function cmdStyleTable(args) {
  hdr("SheetOps style-table");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  if (!sheetTitle) { err("--sheet <name> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  const opts = {
    sheetTitle, theme,
    range:      args["range"] || args["a1"] || undefined,
    headerRows: args["header-rows"] !== undefined ? parseInt(args["header-rows"]) : 1,
    freeze:     args["no-freeze"]         ? false : undefined,
    banding:    args["no-banding"]        ? false : undefined,
    borders:    args["no-borders"]        ? false : undefined,
    autofit:    args["no-autofit"]        ? false : undefined,
    inferNumberFormats: args["no-number-formats"] ? false : undefined
  };
  info(`Styling ${projectName}!${sheetTitle}${opts.range ? "!" + opts.range : " (used range)"} from theme...`);
  const r = await A.styleTable(spreadsheetId, opts);
  ok(`Styled ${r.numRows}×${r.numCols}. Header ${r.frozen ? "frozen" : "styled"}${r.banded ? ", banded" : ""}${r.autofit ? ", autofit" : ""}.`);
  info("Column types: " + r.columnTypes.map(c => `${c.column}:${c.type}`).join("  "));
}

/** add-chart — embed a line/column/bar/pie chart from a data range */
async function cmdAddChart(args) {
  hdr("SheetOps add-chart");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  const dataRange  = args["data-range"] || args["range"];
  if (!sheetTitle || !dataRange) { err("--sheet <name> and --data-range <A1:C13> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  info(`Adding ${args["type"] || "line"} chart on ${projectName}!${sheetTitle} from ${dataRange}...`);
  const r = await A.addChart(spreadsheetId, {
    sheetTitle, dataRange, theme,
    type:  args["type"]  || "line",
    title: args["title"] || "",
    anchor: args["anchor"] || "H2",
    targetSheetTitle: args["target-sheet"] || undefined,
    newSheet: !!args["new-sheet"]
  });
  ok(`Chart added: ${r.type} "${r.title}" (chartId ${r.chartId}) from ${dataRange}.`);
}

/** conditional-format — add a conditional-formatting rule (negative-red / thresholds / heatmap) */
async function cmdConditionalFormat(args) {
  hdr("SheetOps conditional-format");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  const range      = args["a1"] || args["range"];
  if (!sheetTitle || !range) { err("--sheet <name> and --a1 <range> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  const r = await A.conditionalFormat(spreadsheetId, {
    sheetTitle, range, theme,
    rule:  args["rule"] || "negative-red",
    value: args["value"],
    color: args["color"]
  });
  ok(`Conditional rule '${r.rule}' applied to ${sheetTitle}!${range}.`);
}

/** add-title — prepend a title band (+ optional subtitle) above the table */
async function cmdAddTitle(args) {
  hdr("SheetOps add-title");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  const title      = args["title"];
  if (!sheetTitle || !title) { err('--sheet <name> and --title "text" required'); process.exit(1); }
  const theme = loadTheme(projectName);
  info(`Adding title band to ${projectName}!${sheetTitle}...`);
  const r = await A.addTitle(spreadsheetId, {
    sheetTitle, title, theme,
    subtitle: (args["subtitle"] && args["subtitle"] !== true) ? args["subtitle"] : undefined,
    width:    args["width"]
  });
  ok(`Title band added (${r.bandRows} row${r.bandRows > 1 ? "s" : ""}, span ${r.width} cols, frozen ${r.frozenRowCount}).`);
}

/** sparkline — inline =SPARKLINE per row from a source block */
async function cmdSparkline(args) {
  hdr("SheetOps sparkline");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  const sourceRange = args["source"];
  const targetCol   = args["target"];
  if (!sheetTitle || !sourceRange || !targetCol) { err("--sheet <name>, --source <B2:M13> and --target <col letter> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  const r = await A.addSparklines(spreadsheetId, {
    sheetTitle, sourceRange, targetCol, theme,
    type:      args["type"],
    color:     args["color"],
    highColor: args["high-color"],
    lowColor:  args["low-color"],
    negColor:  args["neg-color"]
  });
  ok(`Wrote ${r.count} ${r.type} sparkline(s) to ${r.targetRange}.`);
}

/** mark-cells — style input (literal) vs computed (formula) cells */
async function cmdMarkCells(args) {
  hdr("SheetOps mark-cells");
  const A = api();
  const projectName   = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const sheetTitle = args["sheet"];
  const range      = args["a1"] || args["range"];
  if (!sheetTitle || !range) { err("--sheet <name> and --a1 <range> required"); process.exit(1); }
  const theme = loadTheme(projectName);
  info(`Marking input vs computed cells in ${projectName}!${sheetTitle}!${range}...`);
  const r = await A.markInputVsComputed(spreadsheetId, { sheetTitle, range, theme, includeText: !!args["include-text"] });
  ok(`Marked ${r.input} input + ${r.computed} computed cell(s).`);
}

/** add-tab — add a new sheet tab */
async function cmdAddTab(args) {
  hdr("SheetOps add-tab");
  const A           = api();
  const projectName = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const name = args["name"];
  if (!name) { err("--name <tab-name> required"); process.exit(1); }
  const options = {};
  if (args["color"])  options.tabColor = args["color"];
  if (args["index"] !== undefined) options.index = parseInt(args["index"]);
  if (args["hidden"]) options.hidden  = true;

  info(`Adding tab "${name}" to ${projectName}...`);
  const result = await A.addSheetTab(spreadsheetId, name, options);
  ok(`Tab added: "${result.name}" (sheetId: ${result.sheetId})`);
}

/** delete-tab — delete a sheet tab */
async function cmdDeleteTab(args) {
  hdr("SheetOps delete-tab");
  const A           = api();
  const projectName = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const name = args["name"];
  if (!name) { err("--name <tab-name> required"); process.exit(1); }
  if (!args["confirmed"]) {
    warn(`This will permanently delete tab "${name}". Add --confirmed to proceed.`);
    process.exit(0);
  }
  info(`Deleting tab "${name}" from ${projectName}...`);
  await A.deleteSheetTab(spreadsheetId, name);
  ok(`Tab deleted: "${name}"`);
}

/** rename-tab — rename a sheet tab */
async function cmdRenameTab(args) {
  hdr("SheetOps rename-tab");
  const A           = api();
  const projectName = requireProject(args);
  const spreadsheetId = getSpreadsheetId(projectName);
  const from = args["from"] || args["name"];
  const to   = args["to"]   || args["new-name"];
  if (!from || !to) { err("--from <old-name> --to <new-name>  required"); process.exit(1); }
  info(`Renaming "${from}" → "${to}" in ${projectName}...`);
  await A.renameSheetTab(spreadsheetId, from, to);
  ok(`Renamed: "${from}" → "${to}"`);
}

/** compare-snapshots — diff two snapshot files */
async function cmdCompareSnapshots(args) {
  hdr("SheetOps compare-snapshots");
  const projectName = requireProject(args);
  const snapDir = path.join(projectDir(projectName), "ops", "snapshots");

  // Resolve snapshot files: --snap1 / --snap2 or auto-select last two
  let files;
  if (args["snap1"] && args["snap2"]) {
    files = [args["snap1"], args["snap2"]];
  } else {
    const all = fs.existsSync(snapDir)
      ? fs.readdirSync(snapDir).filter(f => f.endsWith(".json")).sort()
      : [];
    if (all.length < 2) { err("Need at least 2 snapshots. Run: node sheetops.js snapshot --project " + projectName); process.exit(1); }
    files = [path.join(snapDir, all[all.length - 2]), path.join(snapDir, all[all.length - 1])];
    info(`Comparing: ${path.basename(files[0])}  vs  ${path.basename(files[1])}`);
  }

  const snap1 = JSON.parse(fs.readFileSync(files[0], "utf8"));
  const snap2 = JSON.parse(fs.readFileSync(files[1], "utf8"));
  const A     = api();
  const diff  = A.compareSnapshots(snap1, snap2);

  if (!diff.hashChanged) {
    ok("Snapshots are identical (same hash).");
    return;
  }

  hdr("Sheets");
  if (diff.sheets.added.length)   ok(`Added:   ${diff.sheets.added.join(", ")}`);
  if (diff.sheets.removed.length) err(`Removed: ${diff.sheets.removed.join(", ")}`);
  if (diff.sheets.changed.length) {
    warn("Changed:");
    diff.sheets.changed.forEach(c => info(`  ${c.name}:  ${c.diffs.join("  |  ")}`));
  }
  ok(`Unchanged: ${diff.sheets.unchanged} sheet(s)`);

  if (diff.namedRanges.added.length || diff.namedRanges.removed.length) {
    hdr("Named Ranges");
    if (diff.namedRanges.added.length)   ok(`Added:   ${diff.namedRanges.added.join(", ")}`);
    if (diff.namedRanges.removed.length) warn(`Removed: ${diff.namedRanges.removed.join(", ")}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const argv   = process.argv.slice(2);
const cmd    = argv[0];
const args   = parseArgs(argv.slice(1));

const asyncCmds = { auth: cmdAuth, init: cmdInit, "add-sheet": cmdAddSheet,
  health: cmdHealth, snapshot: cmdSnapshot, read: cmdRead,
  backup: cmdBackup, "dry-run-patch": cmdDryRunPatch, "apply-patch": cmdApplyPatch,
  validate: cmdValidate, "log-summary": cmdLogSummary, "run-script": cmdRunScript,
  stats: cmdStats, export: cmdExport, find: cmdFind, "list-functions": cmdListFunctions,
  "create-sheet": cmdCreateSheet, "format-range": cmdFormatRange,
  autofit: cmdAutofit, "style-table": cmdStyleTable, beautify: cmdStyleTable,
  "add-chart": cmdAddChart, "conditional-format": cmdConditionalFormat,
  "add-title": cmdAddTitle, sparkline: cmdSparkline, "mark-cells": cmdMarkCells,
  "add-tab": cmdAddTab, "delete-tab": cmdDeleteTab, "rename-tab": cmdRenameTab,
  "compare-snapshots": cmdCompareSnapshots };

const syncCmds = { "pull-script": cmdPullScript, "push-script": cmdPushScript, "setup-gcp": cmdSetupGcp };

if (asyncCmds[cmd]) {
  asyncCmds[cmd](args).catch(e => { err(e.message); process.exit(1); });
} else if (syncCmds[cmd]) {
  syncCmds[cmd](args);
} else {
  console.log(`${C.bold}SheetOps CLI${C.reset}  v2.0.0

${C.bold}Architecture:${C.reset}
  Sheet ops  → Google Sheets REST API  (no GCP project needed)
  pull/push  → clasp                   (no GCP project needed)
  run-script → Apps Script Exec API    (one-time GCP setup per script — see setup-gcp)

${C.bold}Commands:${C.reset}
  auth                                    OAuth setup / re-auth
  init                                    Verify tools + auth
  add-sheet  --url <url>                  Connect a Sheet by URL
             --spreadsheet-id <id>        Connect by Spreadsheet ID
             --script-id <id>             Connect by Script ID
             [--name <name>]
  health     --project <name>             Live healthcheck
  snapshot   --project <name>             Full workbook snapshot
  read       --project <name>             Read a range
             --named-range <name>
             --sheet <name> --a1 <a1>
  backup     --project <name> --reason    Drive copy backup
  dry-run-patch --project --patch         Preview patch
  apply-patch   --project --patch         Apply patch [--confirmed]
  validate      --project                 Run checks
  pull-script   --project                 clasp pull + git commit
  push-script   --project [--confirmed]   clasp push
  run-script    --project --function       Execute an Apps Script function
                [--params <json-array>]    e.g. '["arg1", 42]'
                [--prod]                   Run published version (default: latest saved)
  list-functions --project                 List all Apps Script functions (local)
                [--live]                   Fetch live from script
  stats         --project                  Workbook statistics summary
  export        --project --sheet <name>   Export a sheet to CSV or JSON
                [--a1 <range>]             Sub-range  [--format csv|json|both]
                [--out <filepath>]         Save to file (default: preview)
  find          --project --value <text>   Search for a value across all sheets
                [--sheet <name>]           Restrict to one sheet
  log-summary   --project                  Recent log entries
  setup-gcp     [--project]                Link script to GCP for Execution API

${C.bold}Creation & formatting:${C.reset}
  create-sheet  --schema <file.json>        Create a new Google Sheet from a schema file
                --title <name>              Minimal: create with one blank sheet
                [--folder <name>]           Target Drive folder name
                [--parent-folder <name>]    Parent folder for disambiguation
                [--create-folder]           Create folder if not found
                [--register] [--name <n>]   Register as a SheetOps project
  format-range  --project --sheet --a1      Apply formatting to a range
                [--bold] [--italic] [--bg #hex]   Quick flags
                [--fg #hex] [--align left|center|right]
                [--font-size N]
                [--number-format "pattern"] [--number-type TYPE]
                                            TYPE inferred from pattern if omitted
                                            (CURRENCY/PERCENT/SCIENTIFIC/NUMBER)
                [--freeze-rows N] [--freeze-cols N]
                [--requests <json-array>]   Raw batchUpdate requests
  add-tab       --project --name <n>        Add a new sheet tab
                [--color #hex] [--index N]
  delete-tab    --project --name <n>        Delete a sheet tab [--confirmed]
  rename-tab    --project --from <n> --to   Rename a sheet tab
  compare-snapshots --project               Diff the two most recent snapshots
                [--snap1 <file>] [--snap2]  or specify snapshot files explicitly

${C.bold}Presentation & visualization:${C.reset} (theme-driven — reads theme.json)
  autofit       --project --sheet <name>    Fit column widths (+ row heights) to content
                [--max-width N] [--min-width N] [--no-wrap]
  style-table   --project --sheet <name>    One-shot beautify: header + freeze + banding
   (beautify)   [--range A1:E13]            + borders + alignment + number-format inference
                [--header-rows N]           + autofit, all from the theme
                [--no-banding] [--no-freeze] [--no-borders] [--no-autofit] [--no-number-formats]
  add-chart     --project --sheet <name>    Embed a chart from a data range (col 1 = labels)
                --data-range A1:C13         [--type line|column|bar|area|scatter|pie]
                [--title <t>] [--anchor H2] [--target-sheet <name>] [--new-sheet]
  conditional-format --project --sheet      Add a conditional rule
                --a1 <range> [--rule negative-red|less-than|greater-than|heatmap]
                [--value N] [--color #hex]
  add-title     --project --sheet <name>    Prepend a navy title band (+ subtitle)
                --title "text" [--subtitle "text"] [--width N]
  sparkline     --project --sheet <name>    Inline =SPARKLINE per row
                --source B2:M13 --target N   [--type line|column|bar|winloss]
                [--color #hex] [--high-color #hex] [--low-color #hex] [--neg-color #hex]
  mark-cells    --project --sheet <name>    Mark number inputs (blue) vs formulas (grey italic)
                --a1 <range> [--include-text]  (--include-text also colours text labels)

${C.bold}Account management:${C.reset}
  auth                          Add / re-auth an account (opens browser)
  auth --list                   Show all authenticated accounts
  auth --switch <email>         Change active account
  auth --remove <email>         Remove an account
`);
}
