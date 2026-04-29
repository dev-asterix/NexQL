export const WEBVIEW_MESSAGE_TYPES = {
  EXPORT_REQUEST: 'export_request',
  RUN_DERIVED_QUERY: 'runDerivedQuery',
  RETRY_CELL: 'retryCell',
  GRID_COMMIT_PREFERENCE: 'gridCommitPreference',
  SHOW_ERROR_MESSAGE: 'showErrorMessage',
} as const;

export type WebviewMessageType =
  (typeof WEBVIEW_MESSAGE_TYPES)[keyof typeof WEBVIEW_MESSAGE_TYPES];
