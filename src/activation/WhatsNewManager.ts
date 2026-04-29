
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** Internal id for {@link vscode.window.createWebviewPanel} (not a sidebar view). */
const WHATS_NEW_PANEL_VIEW_TYPE = 'postgresExplorer.whatsNew';

export class WhatsNewManager {
  private static readonly globalStateKey = 'postgres-explorer.lastRunVersion';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri
  ) { }

  public async checkAndShow(manual: boolean = false): Promise<void> {
    const currentVersion = this.context.extension.packageJSON.version;
    const lastRunVersion = this.context.globalState.get<string>(WhatsNewManager.globalStateKey);

    if (manual || currentVersion !== lastRunVersion) {
      await this.showWhatsNew(currentVersion);
      await this.context.globalState.update(WhatsNewManager.globalStateKey, currentVersion);
    }
  }

  private async showWhatsNew(version: string): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
      WHATS_NEW_PANEL_VIEW_TYPE,
      `What's New in PgStudio ${version}`,
      column,
      {
        enableScripts: true,
        enableCommandUris: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
          vscode.Uri.joinPath(this.extensionUri, 'out')
        ]
      }
    );

    panel.webview.html = await this.getWebviewContent(panel.webview, version);
  }

  private async getWebviewContent(webview: vscode.Webview, version: string): Promise<string> {
    const changelogContent = await this.getChangelogContent();
    const logoPath = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'postgres-explorer.png'));
    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'marked.min.js'));

    const encodedChangelog = Buffer.from(changelogContent).toString('base64');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>What's New in PgStudio</title>
        <script src="${markedUri}"></script>
        <style>
          body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            font-size: 1em;
          }
          h1, h2, h3 {
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 0.3em;
          }
          h1 { font-size: 2em; margin-top: 0; }
          h2 { font-size: 1.5em; margin-top: 1.5em; }
          h3 { font-size: 1.25em; margin-top: 1em; color: var(--vscode-editor-foreground); border-bottom: none; }

          .header {
            display: flex;
            align-items: center;
            margin-bottom: 2rem;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 1rem;
            flex-direction: row;
            text-align: left;
          }
          .logo {
            width: 64px;
            height: 64px;
            margin-right: 1.5rem;
            margin-bottom: 0;
          }
          .version-badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.9em;
            margin-left: 1rem;
            vertical-align: middle;
          }

          .content {
            margin-top: 1rem;
          }
          .content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
          }
          .content a:hover {
            text-decoration: underline;
          }
          .content code {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textBlockQuote-background);
            padding: 2px 4px;
            border-radius: 3px;
          }
          .content pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 1rem;
            overflow-x: auto;
            border-radius: 4px;
          }
          .content pre code {
            background-color: transparent;
            padding: 0;
          }
          .content blockquote {
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            margin: 0;
            padding-left: 1rem;
            color: var(--vscode-descriptionForeground);
          }
          .content ul, .content ol {
            padding-left: 2rem;
          }
          .content li {
            margin-bottom: 0.5rem;
          }

          .footer {
            margin-top: 3rem;
            padding-top: 1rem;
            border-top: 1px solid var(--vscode-widget-border);
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${logoPath}" alt="PgStudio Logo" class="logo">
          <div>
            <h1>PgStudio <span class="version-badge">v${version}</span></h1>
            <p>Thanks for using PgStudio! Here are the latest updates.</p>
          </div>
        </div>

        <div id="markdown-content" class="content"></div>

        <div class="footer">
          <p>
            <a href="https://github.com/dev-asterix/PgStudio/issues">Report Issue</a> |
            <a href="https://github.com/dev-asterix/PgStudio">GitHub Repository</a>
          </p>
        </div>

        <script>
          const rawContent = "${encodedChangelog}";
          const decodedContent = atob(rawContent);
          document.getElementById('markdown-content').innerHTML = marked.parse(decodedContent);
        </script>
      </body>
      </html>
    `;
  }

  private async getChangelogContent(): Promise<string> {
    const variants = ['CHANGELOG.md', 'changelog.md', 'Changelog.md'];

    for (const variant of variants) {
      try {
        const changelogPath = path.join(this.extensionUri.fsPath, variant);
        return await fs.promises.readFile(changelogPath, 'utf8');
      } catch {
        // Try next variant
      }
    }

    let files: string[] = [];
    try {
      files = await fs.promises.readdir(this.extensionUri.fsPath);
    } catch {
      files = ['(unable to list directory)'];
    }

    return `# Error\nUnable to load CHANGELOG.md\n\nExtension path: \`${this.extensionUri.fsPath}\`\n\nFiles in extension root:\n${files.map(f => `- ${f}`).join('\n')}`;
  }
}
