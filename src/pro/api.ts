import * as vscode from 'vscode';
import { ConnectionManager } from '../services/ConnectionManager';
import { SecretStorageService } from '../services/SecretStorageService';
import { LicenseService } from '../services/LicenseService';
import { TelemetryService } from '../services/TelemetryService';
import { MessageHandlerRegistry } from '../services/MessageHandler';
import { NotebookBuilder } from '../commands/helper';

/**
 * Minimal interface for the chat view provider that core code may call.
 * The concrete ChatViewProvider class lives in packages/pro/src — core only
 * ever holds this type-safe interface reference.
 */
export interface IChatViewProvider {
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void>;
  sendToChat(data: { query: string; results?: string; message: string }): void | Promise<void>;
  attachDbObject(dbObject: any): void | Promise<void>;
  syncSentinelContext?(context: any): void;
  handleExplainError?(error: string, query: string): void | Promise<void>;
  handleFixQuery?(error: string, query: string): void | Promise<void>;
  handleAnalyzeData?(data: any, query: string, rowCount: number): void | Promise<void>;
  handleOptimizeQuery?(query: string, executionTime: number): void | Promise<void>;
}

/**
 * Minimal interface for the MCP host that core settings UI may call.
 * Concrete impl: `NexqlMcpStdioHost` in packages/pro (stdio spawn of nexql-mcp).
 */
export interface McpServerStatus {
  mode: 'stdio' | 'http';
  ready: boolean;
  /** Absolute path to the nexql-mcp binary (stdio). */
  binaryPath: string;
  /** Ephemeral config.toml path (stdio). */
  configPath?: string;
  binarySource?: string;
  version?: string;
  /** Legacy HTTP fields — unused after Phase 7 stdio cutover. */
  port?: number;
  token?: string;
  /** Connections omitted from the ephemeral profile (e.g. SSH-tunneled). */
  skippedConnections?: string[];
}

export interface IMcpServer {
  start(): Promise<McpServerStatus>;
  restart(): Promise<McpServerStatus>;
  readonly info: McpServerStatus | undefined;
  getInstance?(): IMcpServer | undefined;
}

/**
 * NexqlCoreApi defines the surface area of public core services
 * shared with the premium (Pro) components.
 */
export interface NexqlCoreApi {
  apiVersion: string;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  connectionManager: ConnectionManager;
  secretStorageService: SecretStorageService;
  licenseService: LicenseService;
  telemetryService: TelemetryService;
  messageHandlerRegistry: MessageHandlerRegistry;
  notebookBuilder: typeof NotebookBuilder;

  // Decoupled chat view provider accessors
  setChatViewProvider(provider: IChatViewProvider | undefined): void;
  getChatViewProvider(): IChatViewProvider | undefined;

  // Optional: MCP server accessor (set by pro during activatePro)
  setMcpServer?(server: IMcpServer): void;
  getMcpServer?(): IMcpServer | undefined;

  // Optional: AI Service accessor (set by pro during activatePro)
  setAiService?(service: any): void;
  getAiService?(): any;
}
