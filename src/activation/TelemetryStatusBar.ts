import * as vscode from 'vscode';

const TELEMETRY_CONFIG = 'postgresExplorer.telemetry';

/**
 * Status bar control for the current telemetry mode. Click opens the mode picker
 * (same as Command Palette: PgStudio: Set Telemetry Mode).
 */
export class TelemetryStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
    this.item.command = 'postgres-explorer.telemetry.openModePicker';
    this.disposables.push(
      this.item,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(TELEMETRY_CONFIG)) {
          this.refresh();
        }
      }),
    );
    this.refresh();
    this.item.show();
  }

  private refresh(): void {
    const mode = vscode.workspace.getConfiguration(TELEMETRY_CONFIG).get<string>('mode', 'basic');
    const icon =
      mode === 'off' ? '$(circle-slash)' : mode === 'basic' ? '$(pulse)' : '$(graph-line)';
    this.item.text = `${icon} PgStudio telemetry: ${mode}`;
    this.item.tooltip = `Telemetry mode: ${mode}. Click to switch between off, basic, or detailed.`;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
