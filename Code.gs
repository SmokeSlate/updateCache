const ROUTINEHUB_API_ROOT = "https://rhapi.sm0ke.org/api/v1";
const RUN_HISTORY_KEY = "RUN_HISTORY";
const RUN_HISTORY_MAX = 10;
const SHORTCUT_PREVIEW_LIMIT = 12;
const SCHEDULE_TRIGGER_HANDLER = "runScheduledSync";


function getShortcuts(routineHubToken) {
  if (!routineHubToken) {
    throw new Error("Missing RoutineHub token. Please add it on the setup page.");
  }

  const endpoint = `${ROUTINEHUB_API_ROOT}/${encodeURIComponent(routineHubToken)}/shortcuts`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: "get",
    headers: {
      Accept: "application/json"
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status >= 300) {
    const snippet = body ? body.substring(0, 160) : "";
    throw new Error(
      `RoutineHub request failed (${status}). ${snippet ? "Response: " + snippet : ""}`
    );
  }

  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch (error) {
    throw new Error("RoutineHub response was not valid JSON.");
  }

  const shortcuts = [];
  const seen = new Set();
  const payload = data && data.shortcuts ? data.shortcuts : {};
  const entries = Array.isArray(payload) ? payload : Object.values(payload);

  entries.forEach(function (item) {
    if (!item) {
      return;
    }
    const published = item.published === true || item.published === "true";
    const identifier = item.id !== undefined ? String(item.id).trim() : "";
    if (published && identifier && !seen.has(identifier)) {
      seen.add(identifier);
      shortcuts.push(identifier);
    }
  });

  Logger.log(`RoutineHub returned ${shortcuts.length} shortcuts.`);
  return shortcuts;
}


function getSettings() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  return {
    owner: scriptProps.getProperty("GITHUB_OWNER") || "",
    repo: scriptProps.getProperty("GITHUB_REPO") || "",
    folder: scriptProps.getProperty("GITHUB_FOLDER") || "",
    token: userProps.getProperty("GITHUB_TOKEN") || "",
    routineHubToken: scriptProps.getProperty("ROUTINEHUB_TOKEN") || "",
    manualMode: scriptProps.getProperty("MANUAL_MODE") === "true",
    manualShortcuts: scriptProps.getProperty("MANUAL_SHORTCUTS") || ""
  };
}


function saveSettings(form) {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  const settings = {
    owner: (form.owner || "").trim(),
    repo: (form.repo || "").trim(),
    folder: (form.folder || "").trim(),
    token: (form.token || "").trim(),
    routineHubToken: (form.routineHubToken || "").trim(),
    manualMode:
      form.manualMode === true ||
      form.manualMode === "true" ||
      form.manualMode === "on" ||
      form.manualMode === "1",
    manualShortcuts: normalizeManualShortcutInput(form.manualShortcuts)
  };

  scriptProps.setProperty("GITHUB_OWNER", settings.owner);
  scriptProps.setProperty("GITHUB_REPO", settings.repo);
  scriptProps.setProperty("GITHUB_FOLDER", settings.folder);

  if (settings.routineHubToken) {
    scriptProps.setProperty("ROUTINEHUB_TOKEN", settings.routineHubToken);
  } else {
    scriptProps.deleteProperty("ROUTINEHUB_TOKEN");
  }

  scriptProps.setProperty("MANUAL_MODE", settings.manualMode ? "true" : "false");

  if (settings.manualShortcuts) {
    scriptProps.setProperty("MANUAL_SHORTCUTS", settings.manualShortcuts);
  } else {
    scriptProps.deleteProperty("MANUAL_SHORTCUTS");
  }

  if (settings.token) {
    userProps.setProperty("GITHUB_TOKEN", settings.token);
  } else {
    userProps.deleteProperty("GITHUB_TOKEN");
  }

  ensureHourlyTrigger();

  return getSetupContext();
}


function tokenizeManualShortcuts(input) {
  if (!input) {
    return [];
  }

  const rawPieces = String(input)
    .split(/[\s,;]+/)
    .map(function (piece) {
      return piece.trim();
    })
    .filter(Boolean);

  const tokens = [];
  const seen = new Set();

  rawPieces.forEach(function (value) {
    if (!seen.has(value)) {
      seen.add(value);
      tokens.push(value);
    }
  });

  return tokens;
}


function normalizeManualShortcutInput(input) {
  return tokenizeManualShortcuts(input).join("\n");
}


function parseManualShortcutIds(input) {
  return tokenizeManualShortcuts(input);
}


function combineShortcutIds(primaryIds, extraIds) {
  const combined = [];
  const seen = new Set();

  function addMany(list) {
    (list || []).forEach(function (value) {
      const id = value !== undefined && value !== null ? String(value).trim() : "";
      if (id && !seen.has(id)) {
        seen.add(id);
        combined.push(id);
      }
    });
  }

  addMany(primaryIds);
  addMany(extraIds);

  return combined;
}


function getRunHistory() {
  const scriptProps = PropertiesService.getScriptProperties();
  const raw = scriptProps.getProperty(RUN_HISTORY_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    Logger.log("Failed to parse run history: " + error);
    return [];
  }
}


function recordRun(entry) {
  if (!entry || typeof entry !== "object") {
    return getRunHistory();
  }

  const scriptProps = PropertiesService.getScriptProperties();
  const history = getRunHistory();
  let entryCopy;
  try {
    entryCopy = JSON.parse(JSON.stringify(entry));
  } catch (error) {
    entryCopy = Object.assign({}, entry);
  }
  history.unshift(entryCopy);
  const trimmed = history.slice(0, RUN_HISTORY_MAX);
  scriptProps.setProperty(RUN_HISTORY_KEY, JSON.stringify(trimmed));
  return trimmed;
}


function buildShortcutSummary(settings) {
  const manualIds = parseManualShortcutIds(settings.manualShortcuts);
  const summary = {
    manualMode: Boolean(settings.manualMode),
    manualCount: manualIds.length,
    manualPreview: manualIds.slice(0, SHORTCUT_PREVIEW_LIMIT),
    manualHasMore: manualIds.length > SHORTCUT_PREVIEW_LIMIT,
    autoCount: 0,
    autoPreview: [],
    autoHasMore: false,
    totalCount: manualIds.length,
    fetchedAt: null,
    error: null
  };

  if (summary.manualMode) {
    return summary;
  }

  if (!settings.routineHubToken) {
    summary.error = "Add a RoutineHub token to fetch your published shortcuts.";
    return summary;
  }

  try {
    const autoIds = getShortcuts(settings.routineHubToken);
    summary.autoCount = autoIds.length;
    summary.autoPreview = autoIds.slice(0, SHORTCUT_PREVIEW_LIMIT);
    summary.autoHasMore = autoIds.length > summary.autoPreview.length;
    summary.totalCount = combineShortcutIds(autoIds, manualIds).length;
    summary.fetchedAt = new Date().toISOString();
  } catch (error) {
    summary.error = error && error.message ? error.message : String(error);
    summary.totalCount = manualIds.length;
  }

  return summary;
}


function getSetupContext() {
  const settings = getSettings();
  const runHistory = getRunHistory();

  return {
    settings: settings,
    shortcutSummary: buildShortcutSummary(settings),
    runHistory: runHistory,
    lastRun: runHistory.length ? runHistory[0] : null
  };
}


function ensureHourlyTrigger() {
  const existingTriggers = ScriptApp.getProjectTriggers();
  let hasScheduledTrigger = false;

  existingTriggers.forEach(function (trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === SCHEDULE_TRIGGER_HANDLER) {
      hasScheduledTrigger = true;
    } else if (handler === "uploadShortcutsFromSettings") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  if (!hasScheduledTrigger) {
    ScriptApp.newTrigger(SCHEDULE_TRIGGER_HANDLER).timeBased().everyHours(1).create();
  }
}


function runScheduledSync() {
  try {
    uploadShortcutsFromSettings("scheduled");
  } catch (error) {
    Logger.log("Scheduled sync failed: " + (error && error.message ? error.message : error));
    throw error;
  }
}


function runSyncNow() {
  try {
    const runRecord = uploadShortcutsFromSettings("manual");
    return {
      ok: true,
      run: runRecord,
      context: getSetupContext()
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
      context: getSetupContext()
    };
  }
}


function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }


function renderSetupPage(context) {
  const safeContext = context && typeof context === "object" ? context : { settings: {}, shortcutSummary: null, runHistory: [] };
  const settings = safeContext.settings || {};
  const manualModeChecked = settings.manualMode ? "checked" : "";
  const manualBlockClass = settings.manualMode ? "manual-block show" : "manual-block";
  const contextJson = JSON.stringify(safeContext).replace(/</g, "\u003c");

  return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shortcut Sync Setup</title>
    <style>
      :root {
        color-scheme: light;
        --primary: #1a73e8;
        --primary-dark: #0b57d0;
        --surface: #ffffff;
        --muted: #5f6368;
        --danger: #a50e0e;
        --success: #0b5a2a;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 16px;
        font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
        background: linear-gradient(135deg, #e8f0fe 0%, #f8fbff 45%, #f3f7ff 100%);
        color: #202124;
      }
      .shell {
        width: 100%;
        max-width: 560px;
        background: var(--surface);
        border-radius: 18px;
        box-shadow: 0 20px 45px rgba(26, 115, 232, 0.16);
        padding: 36px 42px;
        display: grid;
        gap: 24px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      header .icon {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: rgba(26, 115, 232, 0.12);
        display: grid;
        place-items: center;
        font-size: 26px;
        color: var(--primary);
      }
      header h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
      }
      header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      form {
        display: grid;
        gap: 20px;
      }
      label {
        display: grid;
        gap: 8px;
      }
      label span {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 600;
      }
      input[type="text"],
      input[type="password"],
      textarea {
        padding: 12px 14px;
        font-size: 15px;
        border-radius: 10px;
        border: 1px solid rgba(32, 33, 36, 0.16);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        font-family: inherit;
      }
      input[type="text"]:focus,
      input[type="password"]:focus,
      textarea:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.12);
      }
      textarea {
        min-height: 112px;
        resize: vertical;
        line-height: 1.4;
      }
      .hint {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--muted);
      }
      .panel {
        border-radius: 16px;
        border: 1px solid rgba(32, 33, 36, 0.08);
        background: #f8faff;
        padding: 22px 20px;
        display: grid;
        gap: 16px;
      }
      .panel h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      .panel-subtitle {
        margin: -4px 0 4px;
        font-size: 13px;
        color: var(--muted);
      }
      .toggle {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(32, 33, 36, 0.1);
        background: #fff;
      }
      .toggle input[type="checkbox"] {
        appearance: none;
        width: 46px;
        height: 26px;
        border-radius: 999px;
        background: rgba(32, 33, 36, 0.18);
        position: relative;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      .toggle input[type="checkbox"]::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease;
      }
      .toggle input[type="checkbox"]:checked {
        background: var(--primary);
      }
      .toggle input[type="checkbox"]:checked::after {
        transform: translateX(20px);
      }
      .toggle .toggle-text {
        display: grid;
        gap: 2px;
      }
      .toggle-title {
        font-size: 14px;
        font-weight: 600;
        color: #202124;
      }
      .toggle-desc {
        font-size: 12px;
        color: var(--muted);
      }
      .manual-block {
        display: none;
        border-radius: 12px;
        border: 1px dashed rgba(32, 33, 36, 0.16);
        background: rgba(26, 115, 232, 0.04);
        padding: 16px;
        gap: 12px;
      }
      .manual-block.show {
        display: grid;
      }
      .summary-card {
        border-radius: 12px;
        border: 1px solid rgba(32, 33, 36, 0.08);
        background: #fff;
        padding: 16px;
        display: grid;
        gap: 12px;
      }
      .summary-card.error {
        border-color: rgba(165, 14, 14, 0.35);
        background: #fce8e6;
      }
      .summary-headline {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
      }
      .summary-note,
      .summary-meta {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
      }
      .summary-section {
        display: grid;
        gap: 6px;
      }
      .summary-subtitle {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 600;
      }
      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .pill {
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(26, 115, 232, 0.12);
        color: var(--primary-dark);
        font-size: 12px;
        font-weight: 600;
      }
      .pill.muted {
        background: rgba(32, 33, 36, 0.08);
        color: var(--muted);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: none;
        border-radius: 999px;
        padding: 12px 22px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
      }
      .btn.primary {
        color: #fff;
        background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      }
      .btn.secondary {
        color: var(--primary);
        background: #fff;
        border: 1px solid rgba(26, 115, 232, 0.35);
      }
      .btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 10px 25px rgba(26, 115, 232, 0.24);
      }
      .btn.secondary:hover:not(:disabled) {
        box-shadow: 0 8px 18px rgba(26, 115, 232, 0.18);
      }
      .btn:disabled {
        opacity: 0.7;
        cursor: default;
        box-shadow: none;
      }
      .btn .loading {
        display: none;
      }
      .btn.is-loading .label {
        display: none;
      }
      .btn.is-loading .loading {
        display: inline;
      }
      .link-button {
        padding: 4px 0;
        background: none;
        border: none;
        color: var(--primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .link-button:disabled {
        color: rgba(32, 33, 36, 0.4);
        cursor: default;
      }
      .status {
        display: none;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.4;
      }
      .status.show {
        display: block;
      }
      .status.info {
        background: rgba(26, 115, 232, 0.12);
        color: var(--primary-dark);
      }
      .status.success {
        background: #e6f4ea;
        color: var(--success);
      }
      .status.error {
        background: #fce8e6;
        color: var(--danger);
      }
      .history-panel {
        border-radius: 16px;
        border: 1px solid rgba(32, 33, 36, 0.08);
        background: #f8faff;
        padding: 22px 20px;
        display: grid;
        gap: 16px;
      }
      .history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .history-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      .history-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      .history-item {
        border-radius: 12px;
        border: 1px solid rgba(32, 33, 36, 0.08);
        background: #fff;
        padding: 14px 16px;
        display: grid;
        gap: 8px;
      }
      .history-item.success {
        border-color: rgba(11, 90, 42, 0.35);
      }
      .history-item.error {
        border-color: rgba(165, 14, 14, 0.35);
      }
      .history-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .badge {
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .badge.success {
        background: #e6f4ea;
        color: var(--success);
      }
      .badge.error {
        background: #fce8e6;
        color: var(--danger);
      }
      .history-time {
        font-size: 12px;
        color: var(--muted);
      }
      .history-message {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
      }
      .history-meta {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 12px;
        color: var(--muted);
      }
      .history-meta li {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .history-meta .meta-label {
        font-weight: 600;
        color: #202124;
      }
      .hint.empty {
        display: none;
      }
      .hint.empty.show {
        display: block;
      }
      @media (max-width: 640px) {
        .shell {
          padding: 28px 20px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div class="icon">⚙️</div>
        <div>
          <h1>Shortcut Sync Setup</h1>
          <p>Connect GitHub and RoutineHub so new shortcuts land exactly where you need them.</p>
        </div>
      </header>
      <form id="setup-form">
        <div class="panel">
          <h2>GitHub connection</h2>
          <p class="panel-subtitle">We use these details to create or update files in your repo.</p>
          <label>
            <span>GitHub owner</span>
            <input type="text" name="owner" id="owner" value="${escapeHtml(settings.owner || "")}" placeholder="octocat" required />
          </label>
          <label>
            <span>Repository</span>
            <input type="text" name="repo" id="repo" value="${escapeHtml(settings.repo || "")}" placeholder="shortcuts" required />
          </label>
          <label>
            <span>Repository folder</span>
            <input type="text" name="folder" id="folder" value="${escapeHtml(settings.folder || "")}" placeholder="scVersions" required />
            <p class="hint">The folder is created automatically if it doesn't exist yet.</p>
          </label>
          <label>
            <span>Personal access token</span>
            <input type="password" name="token" id="token" value="${escapeHtml(settings.token || "")}" placeholder="ghp_..." autocomplete="off" required />
            <p class="hint">Stored securely in your Apps Script user properties.</p>
          </label>
        </div>
        <div class="panel">
          <h2>Shortcut manager</h2>
          <p class="panel-subtitle">Control how shortcuts are discovered before they are uploaded.</p>
          <label>
            <span>RoutineHub token</span>
            <input type="password" name="routineHubToken" id="routine-hub-token" value="${escapeHtml(settings.routineHubToken || "")}" placeholder="rh_..." autocomplete="off" />
            <p class="hint">Used for the first RoutineHub API request to fetch your published shortcuts.</p>
          </label>
          <label class="toggle">
            <input type="checkbox" name="manualMode" id="manual-mode" ${manualModeChecked} />
            <div class="toggle-text">
              <span class="toggle-title">Manual shortcut mode</span>
              <span class="toggle-desc">Skip the RoutineHub fetch and upload only the IDs you provide below.</span>
            </div>
          </label>
          <div class="${manualBlockClass}" id="manual-block">
            <label>
              <span>Manual shortcut IDs</span>
              <textarea name="manualShortcuts" id="manual-shortcuts" rows="5" placeholder="12345&#10;67890">${escapeHtml(settings.manualShortcuts || "")}</textarea>
            </label>
            <p class="hint">Enter one ID per line or separate with commas. Duplicates are automatically removed.</p>
          </div>
          <div class="summary-card" id="shortcut-summary">
            <p class="summary-headline">Save your settings to preview which shortcuts will be synced.</p>
            <p class="summary-note">Summary reflects your last saved configuration.</p>
          </div>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary" id="save-button">
            <span class="label">Save settings</span>
            <span class="loading">Saving…</span>
          </button>
          <button type="button" class="btn secondary" id="run-button">
            <span class="label">Run sync now</span>
            <span class="loading">Running…</span>
          </button>
        </div>
      </form>
      <div id="status" class="status info show" role="status" aria-live="polite">Ready to configure your shortcut sync.</div>
      <section class="history-panel">
        <div class="history-header">
          <h2>Recent runs</h2>
          <button type="button" class="link-button" id="refresh-button">Refresh details</button>
        </div>
        <ul class="history-list" id="run-history"></ul>
        <p class="hint empty" id="history-empty">No runs recorded yet. Run the sync to start tracking history.</p>
      </section>
    </main>
    <script>
      const INITIAL_CONTEXT = ${contextJson};
      const state = {
        context:
          INITIAL_CONTEXT && typeof INITIAL_CONTEXT === 'object'
            ? INITIAL_CONTEXT
            : { settings: {}, shortcutSummary: null, runHistory: [] }
      };

      const form = document.getElementById('setup-form');
      const statusEl = document.getElementById('status');
      const saveButton = document.getElementById('save-button');
      const runButton = document.getElementById('run-button');
      const manualToggle = document.getElementById('manual-mode');
      const manualBlock = document.getElementById('manual-block');
      const manualTextarea = document.getElementById('manual-shortcuts');
      const summaryEl = document.getElementById('shortcut-summary');
      const historyList = document.getElementById('run-history');
      const historyEmpty = document.getElementById('history-empty');
      const refreshButton = document.getElementById('refresh-button');
      const refreshDefaultText = refreshButton ? refreshButton.textContent : '';
      const textFields = ['owner', 'repo', 'folder', 'token', 'routineHubToken'];

      function setStatus(message, kind) {
        if (!statusEl) {
          return;
        }
        const classes = ['status', kind || 'info'];
        if (message) {
          classes.push('show');
        }
        statusEl.className = classes.join(' ');
        statusEl.textContent = message || '';
      }

      function setLoading(isLoading) {
        if (!saveButton) {
          return;
        }
        saveButton.disabled = isLoading;
        saveButton.classList.toggle('is-loading', isLoading);
      }

      function setRunLoading(isLoading) {
        if (!runButton) {
          return;
        }
        runButton.disabled = isLoading;
        runButton.classList.toggle('is-loading', isLoading);
      }

      function setRefreshLoading(isLoading) {
        if (!refreshButton) {
          return;
        }
        refreshButton.disabled = isLoading;
        refreshButton.textContent = isLoading ? 'Refreshing…' : refreshDefaultText;
      }

      function toggleManualBlock() {
        if (!manualBlock || !manualToggle) {
          return;
        }
        manualBlock.classList.toggle('show', manualToggle.checked);
      }

      function getField(name) {
        return form ? form.elements.namedItem(name) : null;
      }

      function populateForm(settings) {
        textFields.forEach(function (field) {
          const input = getField(field);
          if (input) {
            input.value = settings && settings[field] ? settings[field] : '';
          }
        });
        if (manualToggle) {
          manualToggle.checked = Boolean(settings && settings.manualMode);
        }
        if (manualTextarea) {
          manualTextarea.value = (settings && settings.manualShortcuts) || '';
        }
        toggleManualBlock();
      }

      function applyContext(context) {
        if (!context || typeof context !== 'object') {
          return;
        }
        state.context = context;
        populateForm(context.settings || {});
        renderShortcutSummary(context.shortcutSummary);
        renderRunHistory(context.runHistory);
      }

      function renderShortcutSummary(summary) {
        if (!summaryEl) {
          return;
        }
        summaryEl.innerHTML = '';
        summaryEl.classList.remove('error');

        if (!summary || typeof summary !== 'object') {
          const empty = document.createElement('p');
          empty.className = 'summary-headline';
          empty.textContent = 'Save your settings to preview which shortcuts will be synced.';
          summaryEl.appendChild(empty);
          const note = document.createElement('p');
          note.className = 'summary-note';
          note.textContent = 'Summary reflects your last saved configuration.';
          summaryEl.appendChild(note);
          return;
        }

        const headline = document.createElement('p');
        headline.className = 'summary-headline';

        if (summary.manualMode) {
          if (summary.manualCount) {
            headline.textContent = `Manual mode is enabled. ${summary.manualCount} manual shortcut${summary.manualCount === 1 ? '' : 's'} will be uploaded each run.`;
          } else {
            headline.textContent = 'Manual mode is enabled. Add at least one shortcut ID to start syncing.';
          }
        } else if (summary.error) {
          summaryEl.classList.add('error');
          const manualInfo = summary.manualCount
            ? ` Manual additions waiting: ${summary.manualCount}.`
            : '';
          headline.textContent = summary.error + manualInfo;
        } else {
          const manualText = summary.manualCount
            ? ` and ${summary.manualCount} manual addition${summary.manualCount === 1 ? '' : 's'}`
            : '';
          headline.textContent = `Syncing ${summary.autoCount} RoutineHub shortcut${summary.autoCount === 1 ? '' : 's'}${manualText}. Total upload: ${summary.totalCount}.`;
        }

        summaryEl.appendChild(headline);

        if (!summary.manualMode && !summary.error && summary.autoCount) {
          summaryEl.appendChild(
            createPillRow(
              'RoutineHub preview',
              summary.autoPreview || [],
              summary.autoHasMore ? summary.autoCount - (summary.autoPreview || []).length : 0
            )
          );
        }

        if (summary.manualCount) {
          summaryEl.appendChild(
            createPillRow(
              summary.manualMode ? 'Manual shortcuts' : 'Manual additions',
              summary.manualPreview || [],
              summary.manualHasMore ? summary.manualCount - (summary.manualPreview || []).length : 0
            )
          );
        }

        const note = document.createElement('p');
        note.className = 'summary-note';
        note.textContent = 'Summary reflects your last saved configuration.';
        summaryEl.appendChild(note);

        if (summary.fetchedAt) {
          const meta = document.createElement('p');
          meta.className = 'summary-meta';
          meta.textContent = 'Last RoutineHub check: ' + formatDate(summary.fetchedAt);
          summaryEl.appendChild(meta);
        }
      }

      function createPillRow(title, values, remaining) {
        const wrapper = document.createElement('div');
        wrapper.className = 'summary-section';
        if (title) {
          const heading = document.createElement('span');
          heading.className = 'summary-subtitle';
          heading.textContent = title;
          wrapper.appendChild(heading);
        }
        const row = document.createElement('div');
        row.className = 'pill-row';
        (values || []).forEach(function (value) {
          const pill = document.createElement('span');
          pill.className = 'pill';
          pill.textContent = value;
          row.appendChild(pill);
        });
        if (remaining && remaining > 0) {
          const more = document.createElement('span');
          more.className = 'pill muted';
          more.textContent = `+${remaining} more`;
          row.appendChild(more);
        }
        wrapper.appendChild(row);
        return wrapper;
      }

      function renderRunHistory(history) {
        if (!historyList || !historyEmpty) {
          return;
        }

        historyList.innerHTML = '';

        if (!Array.isArray(history) || history.length === 0) {
          historyEmpty.classList.add('show');
          return;
        }

        historyEmpty.classList.remove('show');

        history.forEach(function (entry) {
          const item = document.createElement('li');
          item.className = 'history-item ' + (entry && entry.status === 'success' ? 'success' : 'error');

          const top = document.createElement('div');
          top.className = 'history-top';

          const badge = document.createElement('span');
          badge.className = 'badge ' + (entry && entry.status === 'success' ? 'success' : 'error');
          badge.textContent = entry && entry.status === 'success' ? 'Success' : 'Failed';
          top.appendChild(badge);

          const time = document.createElement('span');
          time.className = 'history-time';
          time.textContent = formatDate((entry && (entry.completedAt || entry.timestamp)) || '');
          top.appendChild(time);

          item.appendChild(top);

          if (entry && entry.message) {
            const message = document.createElement('p');
            message.className = 'history-message';
            message.textContent = entry.message;
            item.appendChild(message);
          }

          const meta = document.createElement('ul');
          meta.className = 'history-meta';
          addMeta(meta, 'Total', entry && entry.totalCount);
          addMeta(meta, 'RoutineHub', entry && entry.autoCount);
          addMeta(meta, 'Manual', entry && entry.manualCount);
          if (entry && entry.manualMode !== undefined) {
            addMeta(meta, 'Mode', entry.manualMode ? 'Manual only' : 'Auto + manual');
          }
          if (entry && entry.trigger) {
            addMeta(meta, 'Trigger', entry.trigger);
          }
          if (entry && entry.durationMs) {
            addMeta(meta, 'Duration', formatDuration(entry.durationMs));
          }
          if (entry && entry.repository) {
            addMeta(meta, 'Repository', entry.repository);
          }
          if (entry && entry.folder) {
            addMeta(meta, 'Folder', entry.folder);
          }

          if (meta.children.length) {
            item.appendChild(meta);
          }

          historyList.appendChild(item);
        });
      }

      function addMeta(list, label, value) {
        if (!list || value === undefined || value === null || value === '') {
          return;
        }
        const item = document.createElement('li');
        const labelEl = document.createElement('span');
        labelEl.className = 'meta-label';
        labelEl.textContent = label + ':';
        item.appendChild(labelEl);
        const valueEl = document.createElement('span');
        valueEl.textContent = String(value);
        item.appendChild(valueEl);
        list.appendChild(item);
      }

      function formatDate(value) {
        if (!value) {
          return '';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return String(value);
        }
        return date.toLocaleString();
      }

      function formatDuration(ms) {
        if (ms === undefined || ms === null) {
          return '';
        }
        if (ms < 1000) {
          return ms + ' ms';
        }
        const seconds = ms / 1000;
        if (seconds < 60) {
          return (seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10) + ' s';
        }
        const minutes = seconds / 60;
        return (minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10) + ' min';
      }

      function refreshContext(successMessage) {
        setRefreshLoading(true);
        google.script.run
          .withSuccessHandler(function (context) {
            setRefreshLoading(false);
            if (context) {
              applyContext(context);
            }
            if (successMessage) {
              setStatus(successMessage, 'success');
            }
          })
          .withFailureHandler(function (error) {
            setRefreshLoading(false);
            const message = error && error.message ? error.message : String(error || 'Unknown error');
            setStatus('Unable to refresh details: ' + message, 'error');
          })
          .getSetupContext();
      }

      if (manualToggle) {
        manualToggle.addEventListener('change', toggleManualBlock);
      }

      if (form) {
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          setStatus('Saving settings…', 'info');
          setLoading(true);
          const data = {};
          textFields.forEach(function (field) {
            const input = getField(field);
            if (input) {
              data[field] = input.value;
            }
          });
          data.manualMode = manualToggle ? manualToggle.checked : false;
          data.manualShortcuts = manualTextarea ? manualTextarea.value : '';

          google.script.run
            .withSuccessHandler(function (context) {
              setLoading(false);
              if (context) {
                applyContext(context);
              }
              setStatus('Settings saved successfully.', 'success');
            })
            .withFailureHandler(function (error) {
              setLoading(false);
              const message = error && error.message ? error.message : String(error || 'Unknown error');
              setStatus('Failed to save settings: ' + message, 'error');
            })
            .saveSettings(data);
        });
      }

      if (runButton) {
        runButton.addEventListener('click', function () {
          setStatus('Running sync…', 'info');
          setRunLoading(true);
          google.script.run
            .withSuccessHandler(function (result) {
              setRunLoading(false);
              if (result && result.context) {
                applyContext(result.context);
              }
              if (result && result.ok) {
                const message = result.run && result.run.message ? result.run.message : 'Sync completed successfully.';
                setStatus(message, 'success');
              } else {
                const message = result && result.error ? result.error : 'Sync failed.';
                setStatus('Sync failed: ' + message, 'error');
              }
            })
            .withFailureHandler(function (error) {
              setRunLoading(false);
              const message = error && error.message ? error.message : String(error || 'Unknown error');
              setStatus('Sync failed: ' + message, 'error');
            })
            .runSyncNow();
        });
      }

      if (refreshButton) {
        refreshButton.addEventListener('click', function () {
          setStatus('Refreshing details…', 'info');
          refreshContext('Details refreshed.');
        });
      }

      applyContext(state.context);
    </script>
  </body>
</html>`;
}


function doGet() {
  return HtmlService.createHtmlOutput(renderSetupPage(getSetupContext())).setTitle("Shortcut Sync Setup");
}

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}




function getSettings() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  return {
    owner: scriptProps.getProperty("GITHUB_OWNER") || "",
    repo: scriptProps.getProperty("GITHUB_REPO") || "",
    folder: scriptProps.getProperty("GITHUB_FOLDER") || "",
    token: userProps.getProperty("GITHUB_TOKEN") || ""
  };
}


function saveSettings(form) {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  const settings = {
    owner: (form.owner || "").trim(),
    repo: (form.repo || "").trim(),
    folder: (form.folder || "").trim(),
    token: (form.token || "").trim()
  };

  scriptProps.setProperties(
    {
      GITHUB_OWNER: settings.owner,
      GITHUB_REPO: settings.repo,
      GITHUB_FOLDER: settings.folder
    },
    true
  );

  if (settings.token) {
    userProps.setProperty("GITHUB_TOKEN", settings.token);
  } else {
    userProps.deleteProperty("GITHUB_TOKEN");
  }

  return getSettings();
}


function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function renderSetupPage(settings) {
  return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shortcut Sync Setup</title>
    <style>
      :root {
        color-scheme: light;
        --primary: #1a73e8;
        --primary-dark: #0b57d0;
        --surface: #ffffff;
        --muted: #5f6368;
        --danger: #a50e0e;
        --success: #0b5a2a;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 16px;
        font-family: 'Google Sans', Roboto, 'Segoe UI', sans-serif;
        background: linear-gradient(135deg, #e8f0fe 0%, #f8fbff 45%, #f3f7ff 100%);
        color: #202124;
      }
      .shell {
        width: 100%;
        max-width: 520px;
        background: var(--surface);
        border-radius: 18px;
        box-shadow: 0 20px 45px rgba(26, 115, 232, 0.16);
        padding: 36px 42px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      header .icon {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: rgba(26, 115, 232, 0.12);
        display: grid;
        place-items: center;
        font-size: 26px;
        color: var(--primary);
      }
      header h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
      }
      header p {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      form {
        margin-top: 28px;
        display: grid;
        gap: 20px;
      }
      label {
        display: grid;
        gap: 8px;
      }
      label span {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        font-weight: 600;
      }
      input[type="text"],
      input[type="password"] {
        padding: 12px 14px;
        font-size: 15px;
        border-radius: 10px;
        border: 1px solid rgba(32, 33, 36, 0.16);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      input[type="text"]:focus,
      input[type="password"]:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.12);
      }
      .hint {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--muted);
      }
      button {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: none;
        border-radius: 999px;
        padding: 12px 22px;
        font-size: 15px;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(135deg, var(--primary), var(--primary-dark));
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
      }
      button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 10px 25px rgba(26, 115, 232, 0.28);
      }
      button:disabled {
        opacity: 0.7;
        cursor: default;
        box-shadow: none;
      }
      button .loading {
        display: none;
      }
      button.is-loading .label {
        display: none;
      }
      button.is-loading .loading {
        display: inline;
      }
      .status {
        display: none;
        margin-top: 28px;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.4;
      }
      .status.show {
        display: block;
      }
      .status.info {
        background: rgba(26, 115, 232, 0.12);
        color: var(--primary-dark);
      }
      .status.success {
        background: #e6f4ea;
        color: var(--success);
      }
      .status.error {
        background: #fce8e6;
        color: var(--danger);
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header>
        <div class="icon">⚙️</div>
        <div>
          <h1>Shortcut Sync Setup</h1>
          <p>Connect to your GitHub repo so new shortcuts land exactly where you need them.</p>
        </div>
      </header>
      <form id="setup-form">
        <label>
          <span>GitHub owner</span>
          <input type="text" name="owner" value="${escapeHtml(settings.owner)}" placeholder="octocat" required />
        </label>
        <label>
          <span>Repository</span>
          <input type="text" name="repo" value="${escapeHtml(settings.repo)}" placeholder="shortcuts" required />
        </label>
        <label>
          <span>Repository folder</span>
          <input type="text" name="folder" value="${escapeHtml(settings.folder)}" placeholder="scVersions" required />
          <p class="hint">The folder will be created if it doesn't exist yet.</p>
        </label>
        <label>
          <span>Personal access token</span>
          <input type="password" name="token" value="${escapeHtml(settings.token)}" placeholder="ghp_..." autocomplete="off" required />
          <p class="hint">Stored securely inside your Apps Script user properties.</p>
        </label>
        <button type="submit" id="save-button">
          <span class="label">Save settings</span>
          <span class="loading">Saving…</span>
        </button>
      </form>
      <div id="status" class="status info show" role="status" aria-live="polite">Ready to save your GitHub settings.</div>
    </main>
    <script>
      const form = document.getElementById('setup-form');
      const statusEl = document.getElementById('status');
      const saveButton = document.getElementById('save-button');
      const fieldNames = ['owner', 'repo', 'folder', 'token'];

      function setStatus(message, kind) {
        const classes = ['status', kind || 'info'];
        if (message) {
          classes.push('show');
        }
        statusEl.className = classes.join(' ');
        statusEl.textContent = message || '';
      }

      function setLoading(isLoading) {
        saveButton.disabled = isLoading;
        saveButton.classList.toggle('is-loading', isLoading);
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        setStatus('Saving settings…', 'info');
        setLoading(true);
        const data = {};
        fieldNames.forEach((field) => {
          const input = form.elements.namedItem(field);
          if (input) {
            data[field] = input.value;
          }
        });

        google.script.run
          .withSuccessHandler((result) => {
            setLoading(false);
            setStatus('Settings saved successfully. You can close this window.', 'success');
            if (result && typeof result === 'object') {
              fieldNames.forEach((field) => {
                const input = form.elements.namedItem(field);
                if (input && field in result) {
                  input.value = result[field] || '';
                }
              });
            }
          })
          .withFailureHandler((error) => {
            setLoading(false);
            const message = error && error.message ? error.message : String(error || 'Unknown error');
            setStatus('Failed to save settings: ' + message, 'error');
          })
          .saveSettings(data);
      });
    </script>
  </body>
</html>`;
}


function doGet() {
  return HtmlService.createHtmlOutput(renderSetupPage(getSettings())).setTitle("Shortcut Sync Setup");
}


/**
 * Create a folder in a GitHub repo and upload shortcut files.
 *
 * @param {string} owner - GitHub username/org
 * @param {string} repo - GitHub repo name
 * @param {string} folder - Folder path inside repo (e.g., "shortcuts")
 * @param {string[]} ids - Array of shortcut IDs
 * @param {string} token - GitHub personal access token
 */
function uploadShortcutsToGitHub(owner, repo, folder, ids, token) {
  if (!owner) {
    throw new Error("Missing GitHub owner. Please configure the setup page.");
  }
  if (!repo) {
    throw new Error("Missing GitHub repo. Please configure the setup page.");
  }
  if (!token) {
    throw new Error("Missing GitHub token. Please configure the setup page.");
  }

  const normalizedFolder = (folder || "")
    .replace(/^[\s/]+/, "")
    .replace(/[\s/]+$/, "");

  ids.forEach(function(id) {
    // 1. Fetch shortcut latest version
    const url = `https://rhapi.sm0ke.org/api/v1/shortcuts/${id}/versions/latest`;
    const resp = UrlFetchApp.fetch(url);
    const content = resp.getContentText();

    // 2. Encode file content in base64 (required by GitHub API)
    const encoded = Utilities.base64Encode(content);

    // 3. Upload file to GitHub
    const ghPath = normalizedFolder ? `${normalizedFolder}/${id}.txt` : `${id}.txt`;
    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${ghPath}`;

    const payload = {
      message: `Add shortcut ${id}`,
      content: encoded
    };

    const options = {
      method: "put",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const ghResp = UrlFetchApp.fetch(ghUrl, options);
    const status = ghResp.getResponseCode();
    if (status >= 400) {
      const errorBody = ghResp.getContentText();
      throw new Error(
        `GitHub upload failed for ${id} (HTTP ${status}). ${errorBody ? errorBody.substring(0, 160) : ''}`
      );
    }
    Logger.log(`Uploaded ${id}: ${status}`);
  });
}


function uploadShortcutsFromSettings(source) {
  const startTime = Date.now();
  const trigger = source || "scheduled";
  const runRecord = {
    timestamp: new Date().toISOString(),
    completedAt: null,
    status: "error",
    message: "",
    manualMode: false,
    manualCount: 0,
    autoCount: 0,
    totalCount: 0,
    durationMs: 0,
    trigger: trigger,
    repository: "",
    folder: ""
  };

  try {
    const settings = getSettings();
    const manualIds = parseManualShortcutIds(settings.manualShortcuts);

    runRecord.manualMode = Boolean(settings.manualMode);
    runRecord.manualCount = manualIds.length;
    runRecord.repository = [settings.owner, settings.repo].filter(Boolean).join("/");
    runRecord.folder = settings.folder || "";

    const missing = [];
    if (!settings.owner) missing.push("GitHub owner");
    if (!settings.repo) missing.push("GitHub repo");
    if (!settings.folder) missing.push("GitHub folder");
    if (!settings.token) missing.push("GitHub token");
    if (!settings.manualMode && !settings.routineHubToken) {
      missing.push("RoutineHub token");
    }

    if (missing.length) {
      throw new Error(
        "Missing required settings: " + missing.join(", ") + ". Please complete the setup page."
      );
    }

    let autoIds = [];
    if (!settings.manualMode) {
      autoIds = getShortcuts(settings.routineHubToken);
      runRecord.autoCount = autoIds.length;
    }

    const allIds = settings.manualMode ? manualIds : combineShortcutIds(autoIds, manualIds);
    runRecord.totalCount = allIds.length;

    if (!runRecord.totalCount) {
      if (settings.manualMode) {
        throw new Error("Manual mode is enabled but no manual shortcut IDs were provided.");
      }
      throw new Error(
        "No shortcuts were returned from RoutineHub and no manual shortcuts were added."
      );
    }

    uploadShortcutsToGitHub(
      settings.owner,
      settings.repo,
      settings.folder,
      allIds,
      settings.token
    );

    if (settings.manualMode) {
      runRecord.message = `Uploaded ${runRecord.totalCount} manual shortcut${runRecord.totalCount === 1 ? '' : 's'} to GitHub.`;
    } else {
      const manualText = runRecord.manualCount
        ? `, manual: ${runRecord.manualCount}`
        : ", manual: 0";
      runRecord.message = `Uploaded ${runRecord.totalCount} shortcut${runRecord.totalCount === 1 ? '' : 's'} to GitHub (RoutineHub: ${runRecord.autoCount}${manualText}).`;
    }
    runRecord.status = "success";
    return runRecord;
  } catch (error) {
    runRecord.message = error && error.message ? error.message : String(error);
    runRecord.stack = error && error.stack ? String(error.stack) : "";
    throw error;
  } finally {
    runRecord.durationMs = Date.now() - startTime;
    runRecord.completedAt = new Date().toISOString();
    recordRun(runRecord);
  }
}


function test() {
  uploadShortcutsFromSettings("test");
  
}
