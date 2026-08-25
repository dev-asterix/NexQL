import type * as vscode from 'vscode';

/** Dedicated language id for Query Studio scratch SQL — avoids built-in SQL LS taking over file+sql. */
export const NEXQL_STUDIO_SQL_LANGUAGE = 'nexql-studio-sql';

export const NEXQL_STUDIO_SQL_SELECTOR: vscode.DocumentFilter = {
  scheme: 'file',
  language: NEXQL_STUDIO_SQL_LANGUAGE,
};

/** Language-only selector — matches studio scratch SQL regardless of URI scheme quirks. */
export const NEXQL_STUDIO_SQL_LANGUAGE_SELECTOR: vscode.DocumentFilter = {
  language: NEXQL_STUDIO_SQL_LANGUAGE,
};

export function isNexqlStudioSqlLanguage(languageId: string): boolean {
  return languageId === NEXQL_STUDIO_SQL_LANGUAGE;
}
