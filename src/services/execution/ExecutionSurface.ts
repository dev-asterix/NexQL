import * as vscode from 'vscode';

/** Execution context for notebook cells or Query Studio sessions. */
export type ExecutionSurface =
  | { kind: 'notebook'; uri: vscode.Uri; cell?: vscode.NotebookCell }
  | { kind: 'studio'; uri: vscode.Uri };

export function getSessionKey(surface: ExecutionSurface): string {
  return surface.uri.toString();
}

export function isNotebookSurface(surface: ExecutionSurface): surface is Extract<ExecutionSurface, { kind: 'notebook' }> {
  return surface.kind === 'notebook';
}

export function isStudioSurface(surface: ExecutionSurface): surface is Extract<ExecutionSurface, { kind: 'studio' }> {
  return surface.kind === 'studio';
}

/** Active Query Studio session registry (Pro). */
export interface QueryStudioSessionState {
  uri: vscode.Uri;
  sql: string;
  selection?: { start: number; end: number };
  lastResult?: unknown;
  lastError?: unknown;
  connectionId?: string;
  database?: string;
}

const activeStudioSessions = new Map<string, QueryStudioSessionState>();
let activeStudioUri: string | undefined;

export function registerStudioSession(state: QueryStudioSessionState): void {
  activeStudioSessions.set(state.uri.toString(), state);
  activeStudioUri = state.uri.toString();
}

export function setActiveStudioSession(uri: vscode.Uri | undefined): void {
  activeStudioUri = uri?.toString();
}

export function updateStudioSession(uri: vscode.Uri, patch: Partial<QueryStudioSessionState>): void {
  const key = uri.toString();
  const existing = activeStudioSessions.get(key);
  if (existing) {
    activeStudioSessions.set(key, { ...existing, ...patch });
  }
}

export function getStudioSession(uri: vscode.Uri): QueryStudioSessionState | undefined {
  return activeStudioSessions.get(uri.toString());
}

export function getActiveStudioSession(): QueryStudioSessionState | undefined {
  if (activeStudioUri) {
    return activeStudioSessions.get(activeStudioUri);
  }
  return undefined;
}

export function clearStudioSession(uri: vscode.Uri): void {
  const key = uri.toString();
  activeStudioSessions.delete(key);
  if (activeStudioUri === key) {
    activeStudioUri = undefined;
  }
}
