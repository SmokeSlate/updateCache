function getShortcuts() {
  const response = UrlFetchApp.fetch(
    "https://rhapi.sm0ke.org/api/v1/cd3b83e8b088e26cc69b5ca8d5b1c9d9406672cb/shortcuts",
    {
      method: "get",
      headers: {
        "Accept": "application/json"
      },
      muteHttpExceptions: true
    }
  );
  const text = response.getContentText();
  const data = JSON.parse(text);
  var shortcuts = [];
  // data.shortcuts is an object, so use Object.values() to iterate its entries
  if (data.shortcuts) {
    Object.values(data.shortcuts).forEach((s) => {
      if (s.published === true || s.published === "true") {
        shortcuts.push(s.id.toString());
      }
    });
  }
  Logger.log(shortcuts);
  return shortcuts;
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
    Logger.log(`Uploaded ${id}: ${ghResp.getResponseCode()}`);
  });
}


function uploadShortcutsFromSettings() {
  const settings = getSettings();
  const ids = getShortcuts();

  const missing = [];
  if (!settings.owner) missing.push("GitHub owner");
  if (!settings.repo) missing.push("GitHub repo");
  if (!settings.folder) missing.push("GitHub folder");
  if (!settings.token) missing.push("GitHub token");

  if (missing.length) {
    throw new Error(
      "Missing required settings: " + missing.join(", ") + ". Please complete the setup page."
    );
  }

  uploadShortcutsToGitHub(
    settings.owner,
    settings.repo,
    settings.folder,
    ids,
    settings.token
  );
}


function test() {
  uploadShortcutsFromSettings();
}
