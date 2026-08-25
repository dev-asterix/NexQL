/** Bridge between result-view DOM and extension host (notebook or studio webview). */
export interface ResultViewBridge {
  postMessage(message: unknown): void;
  asRendererContext(): {
    postMessage?: (message: unknown) => void;
    workspace?: unknown;
  };
}

export function createWebviewResultBridge(
  postMessage: (message: unknown) => void,
): ResultViewBridge {
  return {
    postMessage,
    asRendererContext() {
      return { postMessage };
    },
  };
}

export function createNotebookResultBridge(
  postMessage: (message: unknown) => void,
): ResultViewBridge {
  return createWebviewResultBridge(postMessage);
}
