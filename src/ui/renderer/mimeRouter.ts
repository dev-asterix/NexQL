import type { ActivationFunction, RendererContext } from 'vscode-notebook-renderer';
import type { NoticeLogEntry } from '../../common/types';
import {
  renderNoticesLiveStream,
} from '../../renderer/components/notices/NoticesPanel';
import { createTopBar, type TopBarOptions } from '../../renderer/components/TopBar';
import type { SentinelNotebookHeaderPayload } from '../../features/sentinel/types';
import { renderPostgresNotebookResult } from './queryResult/renderQueryResult';

const HEADER_MIME = 'application/x-postgres-notebook-header+json';

interface ExecutionStatePayload {
  isExecuting: boolean;
  backendPid: number | null;
  connectionId: string;
  databaseName: string;
  cellUri: string;
}

function payloadToTopBarOptions(payload: SentinelNotebookHeaderPayload): TopBarOptions {
  return {
    connectionName: payload.connectionName,
    host: payload.host,
    port: payload.port,
    database: payload.database,
    username: payload.username,
    environment: payload.environment,
    readOnlyMode: payload.readOnlyMode,
    isConnected: payload.isConnected,
    showContextStrip: payload.enabled,
    onRunAll: () => { /* wired via postMessage below */ },
    onClearOutputs: () => {},
    onAddCodeCell: () => {},
    onAddMarkdownCell: () => {},
  };
}

function renderNotebookHeader(
  context: RendererContext<void>,
  payload: SentinelNotebookHeaderPayload,
  element: HTMLElement,
  executionState?: ExecutionStatePayload,
): void {
  element.replaceChildren();

  if (!payload.enabled) {
    return;
  }

  const postMessage = (msg: unknown) => {
    void context.postMessage?.(msg);
  };

  const options = payloadToTopBarOptions(payload);
  options.isExecuting = executionState?.isExecuting ?? false;
  options.onRunAll = () => postMessage({ type: 'runAll' });
  options.onClearOutputs = () => postMessage({ type: 'clearOutputs' });
  options.onAddCodeCell = () => postMessage({ type: 'addCodeCell' });
  options.onAddMarkdownCell = () => postMessage({ type: 'addMarkdownCell' });
  if (executionState?.isExecuting) {
    options.onCancel = () => {
      postMessage({
        type: 'cancel_query',
        backendPid: executionState.backendPid,
        connectionId: executionState.connectionId,
        databaseName: executionState.databaseName,
        cellUri: executionState.cellUri,
      });
    };
  }

  element.appendChild(createTopBar(options, postMessage));
}

export const activate: ActivationFunction = (context) => {
  let headerElement: HTMLElement | undefined;
  let lastHeaderPayload: SentinelNotebookHeaderPayload | undefined;
  let lastExecutionState: ExecutionStatePayload | undefined;

  context.onDidReceiveMessage?.((message: unknown) => {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const typed = message as { type?: string; payload?: SentinelNotebookHeaderPayload } & ExecutionStatePayload;

    if (typed.type === 'executionState' && headerElement && lastHeaderPayload) {
      lastExecutionState = {
        isExecuting: typed.isExecuting,
        backendPid: typed.backendPid,
        connectionId: typed.connectionId,
        databaseName: typed.databaseName,
        cellUri: typed.cellUri,
      };
      renderNotebookHeader(context, lastHeaderPayload, headerElement, lastExecutionState);
      return;
    }

    if (typed.type === 'sentinel/header' && headerElement) {
      lastHeaderPayload = typed.payload;
      renderNotebookHeader(context, lastHeaderPayload!, headerElement, lastExecutionState);
    }
  });

  return {
    renderOutputItem(data, element) {
      if (data.mime === HEADER_MIME) {
        const payload = data.json() as SentinelNotebookHeaderPayload;
        headerElement = element;
        lastHeaderPayload = payload;
        renderNotebookHeader(context, payload, element, lastExecutionState);
        return;
      }

      if (data.mime === 'application/vnd.postgres-notebook.notices-live') {
        const live = data.json() as { notices?: NoticeLogEntry[] };
        const entries = Array.isArray(live?.notices) ? live.notices : [];
        element.replaceChildren(renderNoticesLiveStream(entries));
        return;
      }

      renderPostgresNotebookResult(context, data, element);
    },
  };
};
