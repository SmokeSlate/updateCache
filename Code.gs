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
  ids.forEach(function(id) {
    // 1. Fetch shortcut latest version
    const url = `https://rhapi.sm0ke.org/api/v1/shortcuts/${id}/versions/latest`;
    const resp = UrlFetchApp.fetch(url);
    const content = resp.getContentText();

    // 2. Encode file content in base64 (required by GitHub API)
    const encoded = Utilities.base64Encode(content);

    // 3. Upload file to GitHub
    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${folder}/${id}.txt`;

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


function test() {
  uploadShortcutsToGitHub("SmokeSlate", "Shortcuts","scVersions", getShortcuts(), "")
}
