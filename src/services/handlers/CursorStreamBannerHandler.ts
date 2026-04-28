import * as vscode from 'vscode';
import { IMessageHandler } from '../MessageHandler';
import { CursorStreamBannerPolicy } from '../CursorStreamBannerPolicy';

/** Notebook renderer: user dismissed streaming cursor banner (snooze). */
export class CursorStreamBannerDismissHandler implements IMessageHandler {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async handle(_message: unknown): Promise<void> {
    await CursorStreamBannerPolicy.recordDismiss(this.context.workspaceState);
  }
}

/** Notebook renderer: user muted the banner permanently. */
export class CursorStreamBannerMuteHandler implements IMessageHandler {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async handle(_message: unknown): Promise<void> {
    await CursorStreamBannerPolicy.recordMuteForever(this.context.globalState);
  }
}
