# updateCache

Cache shortcut updates from RoutineHub and push them to a GitHub repository.

## Setup

1. Open the Apps Script project and choose **Run > Test deployments > doGet** to launch the setup page, or deploy it as a web app.
2. Use the form to provide:
   - GitHub owner or organization name
   - Repository name
   - Folder path inside the repository where the shortcut files should be stored
   - A GitHub personal access token with `repo` scope
3. Save the form. The non-sensitive values are stored in Script Properties; the personal access token is stored in your User Properties.

Once saved, you can run `test` (or `uploadShortcutsFromSettings`) to fetch the latest published shortcuts and upload them to your configured repository.
