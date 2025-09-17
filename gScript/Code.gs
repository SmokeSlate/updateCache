// name: RoutineHub Update Cache
// author: SmokeSlate
// version: 1.0
// url: https://github.com/SmokeSlate/updateCache/

const SCRIPT_PROP_KEYS = {
  owner: "GITHUB_OWNER",
  repo: "GITHUB_REPO",
  folder: "GITHUB_FOLDER",
  manualEnabled: "MANUAL_SHORTCUTS_ENABLED",
  manualList: "MANUAL_SHORTCUT_IDS",
  runLog: "RUN_LOG"
};

const USER_PROP_KEYS = {
  githubToken: "GITHUB_TOKEN",
  routineHubToken: "ROUTINEHUB_TOKEN"
};

const HOURLY_TRIGGER_HANDLER = "uploadShortcutsFromSettings";
const MAX_RUN_LOG_ENTRIES = 20;

function getConfig() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  return {
    owner: scriptProps.getProperty(SCRIPT_PROP_KEYS.owner) || "",
    repo: scriptProps.getProperty(SCRIPT_PROP_KEYS.repo) || "",
    folder: scriptProps.getProperty(SCRIPT_PROP_KEYS.folder) || "",
    token: userProps.getProperty(USER_PROP_KEYS.githubToken) || "",
    routineHubToken: userProps.getProperty(USER_PROP_KEYS.routineHubToken) || "",
    manualShortcutsEnabled: scriptProps.getProperty(SCRIPT_PROP_KEYS.manualEnabled) === "true",
    manualShortcuts: getManualShortcuts()
  };
}

function getSettings() {
  const config = getConfig();
  return Object.assign({}, config, {
    runLog: getRunLog(),
    hasHourlyTrigger: hasHourlyTrigger()
  });
}

function saveSettings(form) {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  const manualShortcutsEnabled =
    form && (form.manualShortcutsEnabled === true || form.manualShortcutsEnabled === "true");
  const manualShortcuts = normalizeShortcutIds(
    form && Object.prototype.hasOwnProperty.call(form, "manualShortcuts")
      ? form.manualShortcuts
      : []
  );

  const settings = {
    owner: (form && form.owner ? String(form.owner) : "").trim(),
    repo: (form && form.repo ? String(form.repo) : "").trim(),
    folder: (form && form.folder ? String(form.folder) : "").trim(),
    token: (form && form.token ? String(form.token) : "").trim(),
    routineHubToken: (form && form.routineHubToken ? String(form.routineHubToken) : "").trim(),
    manualShortcutsEnabled: manualShortcutsEnabled,
    manualShortcuts: manualShortcuts
  };

  scriptProps.setProperties(
    {
      [SCRIPT_PROP_KEYS.owner]: settings.owner,
      [SCRIPT_PROP_KEYS.repo]: settings.repo,
      [SCRIPT_PROP_KEYS.folder]: settings.folder,
      [SCRIPT_PROP_KEYS.manualEnabled]: settings.manualShortcutsEnabled ? "true" : "false"
    },
    true
  );

  settings.manualShortcuts = setManualShortcuts(settings.manualShortcuts);

  if (settings.token) {
    userProps.setProperty(USER_PROP_KEYS.githubToken, settings.token);
  } else {
    userProps.deleteProperty(USER_PROP_KEYS.githubToken);
  }

  if (settings.routineHubToken) {
    userProps.setProperty(USER_PROP_KEYS.routineHubToken, settings.routineHubToken);
  } else {
    userProps.deleteProperty(USER_PROP_KEYS.routineHubToken);
  }

  updateHourlyTriggerState(settings);

  return getSettings();
}

function updateHourlyTriggerState(settings) {
  if (settings.owner && settings.repo && settings.folder && settings.token) {
    ensureHourlyTrigger();
  } else {
    removeHourlyTrigger();
  }
}

function ensureHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let hasTrigger = false;
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === HOURLY_TRIGGER_HANDLER) {
      if (hasTrigger) {
        ScriptApp.deleteTrigger(trigger);
      }
      hasTrigger = true;
    }
  });

  if (!hasTrigger) {
    ScriptApp.newTrigger(HOURLY_TRIGGER_HANDLER).timeBased().everyHours(1).create();
  }
}

function removeHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === HOURLY_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function hasHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === HOURLY_TRIGGER_HANDLER;
  });
}

function getManualShortcuts() {
  const scriptProps = PropertiesService.getScriptProperties();
  const raw = scriptProps.getProperty(SCRIPT_PROP_KEYS.manualList);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeShortcutIds(parsed);
  } catch (error) {
    return normalizeShortcutIds(raw);
  }
}

function setManualShortcuts(ids) {
  const scriptProps = PropertiesService.getScriptProperties();
  const normalized = normalizeShortcutIds(ids);
  scriptProps.setProperty(SCRIPT_PROP_KEYS.manualList, JSON.stringify(normalized));
  return normalized;
}

function normalizeShortcutIds(ids) {
  if (Array.isArray(ids)) {
    return ids
      .map(function(value) {
        return value === null || value === undefined ? "" : String(value);
      })
      .map(function(value) {
        return value.trim();
      })
      .filter(function(value) {
        return value.length > 0;
      })
      .filter(function(value, index, array) {
        return array.indexOf(value) === index;
      });
  }

  if (typeof ids === "string") {
    return normalizeShortcutIds(ids.split(/[\s,]+/));
  }

  return [];
}

function getShortcuts() {
  const config = getConfig();
  if (config.manualShortcutsEnabled) {
    return config.manualShortcuts;
  }
  return fetchRoutineHubShortcutIds(config.routineHubToken);
}

function fetchRoutineHubShortcutIds(routineHubToken) {
  const options = {
    method: "get",
    headers: {
      Accept: "application/json"
    },
    muteHttpExceptions: true
  };

  if (routineHubToken) {
    options.headers.Authorization = `Bearer ${routineHubToken}`;
  }

  const response = UrlFetchApp.fetch(
    "https://rhapi.sm0ke.org/api/v1/cd3b83e8b088e26cc69b5ca8d5b1c9d9406672cb/shortcuts",
    options
  );
  const code = response.getResponseCode();
  if (code >= 400) {
    throw new Error(`Failed to fetch shortcuts from RoutineHub (HTTP ${code}).`);
  }

  const text = response.getContentText();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("RoutineHub response could not be parsed.");
  }

  const shortcuts = [];
  if (data && data.shortcuts) {
    Object.values(data.shortcuts).forEach(function(entry) {
      if (entry && (entry.published === true || entry.published === "true")) {
        shortcuts.push(String(entry.id));
      }
    });
  }

  return normalizeShortcutIds(shortcuts);
}

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
    const url = `https://rhapi.sm0ke.org/api/v1/shortcuts/${id}/versions/latest`;
    const resp = UrlFetchApp.fetch(url);
    const content = resp.getContentText();
    const encoded = Utilities.base64Encode(content);

    const ghPath = normalizedFolder ? `${normalizedFolder}/${id}.txt` : `${id}.txt`;
    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${ghPath}`;

    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json"
    };

    const existingResp = UrlFetchApp.fetch(
      ghUrl,
      {
        method: "get",
        headers: baseHeaders,
        muteHttpExceptions: true
      }
    );

    const existingStatus = existingResp.getResponseCode();
    let existingFile = null;
    if (existingStatus === 200) {
      try {
        existingFile = JSON.parse(existingResp.getContentText());
      } catch (error) {
        throw new Error(`Failed to parse existing GitHub file for shortcut ${id}.`);
      }
    } else if (existingStatus !== 404) {
      throw new Error(
        `Failed to check existing shortcut ${id} on GitHub (HTTP ${existingStatus}).`
      );
    }

    if (existingFile) {
      const existingEncoded = existingFile.content ? existingFile.content.replace(/\s/g, "") : "";
      if (existingEncoded === encoded) {
        Logger.log(`Skipped ${id}: no changes.`);
        return;
      }
    }

    const payload = {
      message: existingFile ? `Update shortcut ${id}` : `Add shortcut ${id}`,
      content: encoded
    };

    if (existingFile && existingFile.sha) {
      payload.sha = existingFile.sha;
    }

    const options = {
      method: "put",
      headers: baseHeaders,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const ghResp = UrlFetchApp.fetch(ghUrl, options);
    const status = ghResp.getResponseCode();
    if (status >= 400) {
      throw new Error(`Failed to upload shortcut ${id} to GitHub (HTTP ${status}).`);
    }
    Logger.log(`${existingFile ? "Updated" : "Uploaded"} ${id}: ${status}`);
  });
}

function uploadShortcutsFromSettings() {
  const config = getConfig();
  const missing = [];
  if (!config.owner) missing.push("GitHub owner");
  if (!config.repo) missing.push("GitHub repo");
  if (!config.folder) missing.push("GitHub folder");
  if (!config.token) missing.push("GitHub token");

  if (missing.length) {
    throw new Error(
      "Missing required settings: " + missing.join(", ") + ". Please complete the setup page."
    );
  }

  const start = Date.now();
  let ids = [];
  try {
    ids = getShortcuts();
    uploadShortcutsToGitHub(config.owner, config.repo, config.folder, ids, config.token);
    recordRun({
      status: "success",
      timestamp: new Date().toISOString(),
      count: ids.length,
      manual: config.manualShortcutsEnabled,
      durationMs: Date.now() - start
    });
  } catch (error) {
    recordRun({
      status: "error",
      timestamp: new Date().toISOString(),
      count: ids.length,
      manual: config.manualShortcutsEnabled,
      durationMs: Date.now() - start,
      message: error && error.message ? error.message : String(error)
    });
    throw error;
  }
}

function recordRun(entry) {
  const scriptProps = PropertiesService.getScriptProperties();
  const existing = getRunLog();
  const normalized = {
    status: entry.status || "unknown",
    timestamp: entry.timestamp || new Date().toISOString(),
    count: typeof entry.count === "number" ? entry.count : 0,
    manual: Boolean(entry.manual),
    durationMs: typeof entry.durationMs === "number" ? entry.durationMs : 0,
    message: entry.message || ""
  };

  existing.unshift(normalized);
  const limited = existing.slice(0, MAX_RUN_LOG_ENTRIES);
  scriptProps.setProperty(SCRIPT_PROP_KEYS.runLog, JSON.stringify(limited));
}

function getRunLog() {
  const scriptProps = PropertiesService.getScriptProperties();
  const raw = scriptProps.getProperty(SCRIPT_PROP_KEYS.runLog);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    Logger.log("Failed to parse run log: " + error);
    return [];
  }
}

function runNow() {
  try {
    uploadShortcutsFromSettings();
    return {
      success: true,
      settings: getSettings()
    };
  } catch (error) {
    return {
      success: false,
      message: error && error.message ? error.message : String(error),
      settings: getSettings()
    };
  }
}

function resetSetup() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  [
    SCRIPT_PROP_KEYS.owner,
    SCRIPT_PROP_KEYS.repo,
    SCRIPT_PROP_KEYS.folder,
    SCRIPT_PROP_KEYS.manualEnabled,
    SCRIPT_PROP_KEYS.manualList,
    SCRIPT_PROP_KEYS.runLog
  ].forEach(function(key) {
    scriptProps.deleteProperty(key);
  });

  [USER_PROP_KEYS.githubToken, USER_PROP_KEYS.routineHubToken].forEach(function(key) {
    userProps.deleteProperty(key);
  });

  removeHourlyTrigger();

  return getSettings();
}

function doGet() {
  const template = HtmlService.createTemplateFromFile("Setup");
  template.initialSettings = getSettings();
  return template.evaluate().setTitle("Shortcut Sync Setup");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
