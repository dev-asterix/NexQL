import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Re-read PATH from a fresh shell and merge any new entries into
 * `process.env.PATH` for the current (long-lived) extension host process.
 *
 * VS Code inherits PATH from whatever shell/session launched it, so a global
 * install done in a terminal after activation (`npm install -g nexql-mcp`,
 * `cargo install nexql-mcp`, …) is invisible to `child_process.spawn('nexql-mcp', …)`
 * until the window reloads. This lets the Settings > MCP "Detect" button find
 * it in the same session instead of forcing a reload.
 */
export async function refreshProcessPathFromShell(): Promise<void> {
  const fresh = await readShellPath();
  if (!fresh) {
    return;
  }
  const current = process.env.PATH ?? '';
  const seen = new Set(current.split(path.delimiter).filter(Boolean));
  const additions = fresh.split(path.delimiter).filter((p) => p && !seen.has(p));
  if (additions.length === 0) {
    return;
  }
  process.env.PATH = [current, ...additions].filter(Boolean).join(path.delimiter);
}

function readShellPath(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return readWindowsPath();
  }
  return readPosixLoginShellPath();
}

function readPosixLoginShellPath(): Promise<string | undefined> {
  const shell = process.env.SHELL || '/bin/bash';
  const marker = '__NEXQL_PATH__';
  return runAndCapture(shell, ['-lic', `echo -n "${marker}$PATH"`]).then((out) => {
    const idx = out?.indexOf(marker);
    if (out === undefined || idx === undefined || idx === -1) {
      return undefined;
    }
    return out.slice(idx + marker.length).trim() || undefined;
  });
}

function readWindowsPath(): Promise<string | undefined> {
  // Registry-backed User + Machine PATH reflects installers that ran after
  // this window launched (unlike the inherited process env block).
  const script =
    "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + " +
    "[System.Environment]::GetEnvironmentVariable('Path','User')";
  return runAndCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).then(
    (out) => out?.trim() || undefined
  );
}

function runAndCapture(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, args, { shell: false, windowsHide: true });
      let out = '';
      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', (chunk: string) => {
        out += chunk;
      });
      proc.on('error', () => resolve(undefined));
      proc.on('close', (code) => resolve(code === 0 ? out : undefined));
    } catch {
      resolve(undefined);
    }
  });
}
