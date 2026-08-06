import * as vscode from 'vscode';
import type { SettingsHubHostContext, SettingsHubMessage, SettingsSectionHandler } from '../types';
import type { IMcpServer } from '../../../pro/api';

const DDL_ENABLED_KEY = 'nexql.ddlViewer.enabled';
const DDL_OPEN_ON_SELECTION_KEY = 'nexql.ddlViewer.openOnSelection';
const HISTORY_MAX_ITEMS_KEY = 'postgresExplorer.queryHistory.maxItems';
const AGENTIC_MAX_STEPS_KEY = 'postgresExplorer.ai.agenticMaxSteps';
const DEFAULT_AGENTIC_MAX_STEPS = 20;
const MAX_AGENTIC_MAX_STEPS = 100;

/**
 * Retrieves the MCP host from the coreApi if pro is loaded.
 * Returns undefined when running as a free build.
 */
function getMcpServerFromApi(): IMcpServer | undefined {
  try {
    const extModule = require('../../../extension') as any;
    return extModule._coreApi?.getMcpServer?.();
  } catch {
    return undefined;
  }
}

export class PreferencesSectionHandler implements SettingsSectionHandler {
  readonly section = 'prefs';

  constructor(private readonly host: SettingsHubHostContext) {}

  async handle(action: string, message: SettingsHubMessage): Promise<void> {
    switch (action) {
      case 'load':
        await this.sendState();
        break;
      case 'update':
        await this.update(String(message.key), message.value as boolean | number | string);
        break;
    }
  }

  private async sendState(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const mcpEnabled = config.get<boolean>('postgresExplorer.mcp.enabled', false);
    const mcpBinaryPath = config.get<string>('postgresExplorer.mcp.binaryPath', '') || '';

    let mcpStarted = false;
    let binaryPath = '';
    let binarySource = '';
    let version = '';
    let mcpError = '';
    let mcpSkippedConnections: string[] = [];

    const server = getMcpServerFromApi();
    if (server && mcpEnabled) {
      try {
        const info = await server.start();
        mcpStarted = !!info.ready;
        binaryPath = info.binaryPath || '';
        binarySource = info.binarySource || '';
        version = info.version || '';
        mcpSkippedConnections = info.skippedConnections ?? [];
      } catch (err) {
        mcpError = err instanceof Error ? err.message : String(err);
      }
    } else if (server?.info) {
      mcpStarted = !!server.info.ready;
      binaryPath = server.info.binaryPath || '';
      binarySource = server.info.binarySource || '';
      version = server.info.version || '';
      mcpSkippedConnections = server.info.skippedConnections ?? [];
    }

    this.host.post({
      type: 'prefs/state',
      prefs: {
        ddlEnabled: config.get<boolean>(DDL_ENABLED_KEY, true),
        ddlOpenOnSelection: config.get<boolean>(DDL_OPEN_ON_SELECTION_KEY, true),
        historyMaxItems: config.get<number>(HISTORY_MAX_ITEMS_KEY, 200),
        agenticMaxSteps: config.get<number>(AGENTIC_MAX_STEPS_KEY, DEFAULT_AGENTIC_MAX_STEPS),
        mcpEnabled,
        mcpBinaryPath,
        mcpStarted,
        mcpBinaryResolved: binaryPath,
        mcpBinarySource: binarySource,
        mcpVersion: version,
        mcpError,
        mcpSkippedConnections,
        // Legacy keys kept so older webview bundles don't throw.
        mcpPort: 0,
        mcpConfiguredPort: 0,
        mcpToken: '',
      },
    });
  }

  private async update(key: string, value: boolean | number | string): Promise<void> {
    try {
      if (key === 'ddlEnabled') {
        await vscode.commands.executeCommand('postgres-explorer.ddlViewer.toggleEnabled', value);
      } else if (key === 'ddlOpenOnSelection') {
        await vscode.workspace
          .getConfiguration()
          .update(DDL_OPEN_ON_SELECTION_KEY, value, vscode.ConfigurationTarget.Global);
      } else if (key === 'historyMaxItems') {
        const n = Math.max(10, Math.min(1000, Number(value)));
        await vscode.workspace
          .getConfiguration()
          .update(HISTORY_MAX_ITEMS_KEY, n, vscode.ConfigurationTarget.Global);
      } else if (key === 'agenticMaxSteps') {
        const raw = Number(value);
        const n = Number.isFinite(raw)
          ? Math.max(0, Math.min(MAX_AGENTIC_MAX_STEPS, Math.floor(raw)))
          : DEFAULT_AGENTIC_MAX_STEPS;
        await vscode.workspace
          .getConfiguration()
          .update(AGENTIC_MAX_STEPS_KEY, n, vscode.ConfigurationTarget.Global);
      } else if (key === 'mcpEnabled') {
        await vscode.workspace
          .getConfiguration()
          .update('postgresExplorer.mcp.enabled', value, vscode.ConfigurationTarget.Global);
      } else if (key === 'mcpBinaryPath') {
        await vscode.workspace
          .getConfiguration()
          .update(
            'postgresExplorer.mcp.binaryPath',
            String(value || ''),
            vscode.ConfigurationTarget.Global
          );
        const server = getMcpServerFromApi();
        if (server) {
          try {
            await server.restart();
          } catch (err) {
            this.host.post({
              type: 'prefs/error',
              error: `Failed to resolve nexql-mcp: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      } else if (key === 'mcpPort') {
        // Deprecated after stdio cutover — ignore silently for old webviews.
      } else {
        this.host.post({ type: 'prefs/error', error: `Unknown preference: ${key}` });
        return;
      }
      await this.sendState();
    } catch (err: unknown) {
      this.host.post({
        type: 'prefs/error',
        error: err instanceof Error ? err.message : String(err),
      });
      await this.sendState();
    }
  }
}
