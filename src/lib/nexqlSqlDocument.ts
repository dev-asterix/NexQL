import * as vscode from 'vscode';
import { isNexqlStudioSqlLanguage, NEXQL_STUDIO_SQL_LANGUAGE, NEXQL_STUDIO_SQL_SELECTOR } from './nexqlStudioSqlLanguage';

export { NEXQL_STUDIO_SQL_LANGUAGE, NEXQL_STUDIO_SQL_SELECTOR, NEXQL_STUDIO_SQL_LANGUAGE_SELECTOR } from './nexqlStudioSqlLanguage';

/** Native Query Studio scratch SQL under globalStorage/query-studio/.../query.sql */
export function isQueryStudioSqlDocument(document: vscode.TextDocument): boolean {
  if (isNexqlStudioSqlLanguage(document.languageId)) {
    return true;
  }
  if (document.uri.scheme !== 'file') {
    return false;
  }
  const normalized = document.uri.path.replace(/\\/g, '/').toLowerCase();
  return isQueryStudioSqlPath(normalized);
}

export function isNexqlNotebookSqlCell(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === 'vscode-notebook-cell' &&
    (document.languageId === 'sql' || document.languageId === 'postgres')
  );
}

export function isNexqlManagedSqlDocument(document: vscode.TextDocument): boolean {
  return isNexqlNotebookSqlCell(document) || isQueryStudioSqlDocument(document);
}

export const QUERY_STUDIO_PATH_MARKER = '/query-studio/';
export const QUERY_STUDIO_SQL_SUFFIXES = ['/query.nexql', '/query.sql'] as const;

/** @deprecated Use QUERY_STUDIO_SQL_SUFFIXES */
export const QUERY_STUDIO_SQL_SUFFIX = '/query.nexql';

function isQueryStudioSqlPath(normalizedPath: string): boolean {
  return (
    normalizedPath.includes(QUERY_STUDIO_PATH_MARKER) &&
    QUERY_STUDIO_SQL_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix))
  );
}

/** @deprecated Use NEXQL_STUDIO_SQL_SELECTOR */
export const QUERY_STUDIO_FILE_SQL_SELECTOR = NEXQL_STUDIO_SQL_SELECTOR;

export function gateCompletionProvider(
  inner: vscode.CompletionItemProvider,
  supports: (doc: vscode.TextDocument) => boolean,
): vscode.CompletionItemProvider {
  return {
    provideCompletionItems: (doc, pos, token, ctx) => {
      if (!supports(doc)) {
        return Promise.resolve([]);
      }
      return inner.provideCompletionItems(doc, pos, token, ctx);
    },
  };
}

export function gateSignatureHelpProvider(
  inner: vscode.SignatureHelpProvider,
  supports: (doc: vscode.TextDocument) => boolean,
): vscode.SignatureHelpProvider {
  return {
    provideSignatureHelp: (doc, pos, token, ctx) => {
      if (!supports(doc)) {
        return undefined;
      }
      return inner.provideSignatureHelp(doc, pos, token, ctx);
    },
  };
}

export function gateCodeLensProvider(
  inner: vscode.CodeLensProvider,
  supports: (doc: vscode.TextDocument) => boolean,
): vscode.CodeLensProvider {
  return {
    onDidChangeCodeLenses: inner.onDidChangeCodeLenses,
    provideCodeLenses: (doc, token) => {
      if (!supports(doc)) {
        return [];
      }
      return inner.provideCodeLenses(doc, token);
    },
  };
}

export function gateCodeActionsProvider(
  inner: vscode.CodeActionProvider,
  supports: (doc: vscode.TextDocument) => boolean,
): vscode.CodeActionProvider {
  return {
    provideCodeActions: (doc, range, ctx, token) => {
      if (!supports(doc)) {
        return [];
      }
      return inner.provideCodeActions(doc, range, ctx, token);
    },
  };
}

export function gateDocumentDropProvider(
  inner: vscode.DocumentDropEditProvider,
  supports: (doc: vscode.TextDocument) => boolean,
): vscode.DocumentDropEditProvider {
  return {
    provideDocumentDropEdits: (doc, pos, dataTransfer, token) => {
      if (!supports(doc)) {
        return undefined;
      }
      return inner.provideDocumentDropEdits(doc, pos, dataTransfer, token);
    },
  };
}

export function getQueryStudioSidecarUri(sqlUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(sqlUri, '..', 'session.meta.json');
}

export function findTextEditorForDocument(document: vscode.TextDocument): vscode.TextEditor | undefined {
  const key = document.uri.toString();
  const active = vscode.window.activeTextEditor;
  if (active?.document.uri.toString() === key) {
    return active;
  }
  return vscode.window.visibleTextEditors.find((ed) => ed.document.uri.toString() === key);
}
