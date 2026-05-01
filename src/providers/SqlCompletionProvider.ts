import * as vscode from 'vscode';
import { ConnectionManager } from '../services/ConnectionManager';

interface TableInfo {
  schema: string;
  objectName: string;
  objectType: string;
  arguments?: string;
  callArguments?: string;
}

interface ColumnInfo {
  schema: string;
  tableName: string;
  columnName: string;
  dataType: string;
}

interface RelationContext {
  schema: string | null;
  objectName: string;
  alias: string | null;
}

type RelationAliasMap = Map<string, string>;

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private objectCache: Map<string, TableInfo[]> = new Map();
  private columnCache: Map<string, ColumnInfo[]> = new Map();
  private lastCacheUpdate: Map<string, number> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const completionItems: vscode.CompletionItem[] = [];

    try {
      // Get connection info from notebook metadata or active connection
      const connectionInfo = await this._getConnectionInfo(document);
      if (!connectionInfo) {
        return [];
      }

      const { connectionId, database } = connectionInfo;
      const cacheKey = `${connectionId}-${database}`;

      // Update cache if needed
      if (this._shouldUpdateCache(cacheKey)) {
        await this._updateCache(connectionId, database, cacheKey);
      }

      // Get current line and word being typed
      const lineText = document.lineAt(position).text;

      // Parse query to find referenced tables
      const fullText = document.getText();
      const referencedTables = this._extractTableNames(fullText);
      const schemaContext = this._extractSchemaContext(document, position);
      const relationContext = this._extractRelationContext(document, position);
      const relationAliases = this._extractRelationAliases(document, position);
      const hasQualifiedColumnPrefix = this._hasQualifiedColumnPrefix(lineText, position);

      // Add SQL keywords
      completionItems.push(...this._getSqlKeywords());

      // Add database object suggestions with high priority
      const objects = this.objectCache.get(cacheKey) || [];
      completionItems.push(...this._getObjectCompletions(objects, referencedTables, schemaContext));

      // Add column suggestions based on context
      const columns = this.columnCache.get(cacheKey) || [];
      completionItems.push(...this._getColumnCompletions(columns, referencedTables, lineText, schemaContext, relationContext, relationAliases, hasQualifiedColumnPrefix));

    } catch (error) {
      console.error('SQL completion error:', error);
    }

    return completionItems;
  }

  private async _getConnectionInfo(document: vscode.TextDocument): Promise<{ connectionId: string; database: string } | null> {
    // For notebooks, get from metadata
    if (document.uri.scheme === 'vscode-notebook-cell') {
      const notebook = vscode.workspace.notebookDocuments.find(nb =>
        nb.getCells().some(cell => cell.document.uri.toString() === document.uri.toString())
      );

      if (notebook?.metadata) {
        const metadata = notebook.metadata;
        return {
          connectionId: metadata.connectionId,
          database: metadata.databaseName || 'postgres'
        };
      }
    }

    // For regular files, try to get from workspace state or recent connection
    // This is a fallback - ideally user should use notebooks for better context
    return null;
  }

  private _shouldUpdateCache(cacheKey: string): boolean {
    const lastUpdate = this.lastCacheUpdate.get(cacheKey);
    if (!lastUpdate) {
      return true;
    }
    return Date.now() - lastUpdate > this.CACHE_TTL;
  }

  private async _updateCache(connectionId: string, database: string, cacheKey: string): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration();
      const connections = config.get<any[]>('postgresExplorer.connections') || [];
      const connection = connections.find(c => c.id === connectionId);

      if (!connection) {
        return;
      }

      let client;
      try {
        client = await ConnectionManager.getInstance().getPooledClient({
          id: connection.id,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          database: database,
          name: connection.name
        });

        // Fetch catalog objects
        const objectsQuery = `
              SELECT 'table' as object_type, table_schema as schema, table_name as object_name, NULL::text as arguments, NULL::text as call_arguments
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
                    UNION ALL
              SELECT 'view', table_schema, table_name, NULL::text, NULL::text
                    FROM information_schema.views
                    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                    UNION ALL
              SELECT 'materialized view', schemaname, matviewname, NULL::text, NULL::text
                    FROM pg_matviews
                    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                    UNION ALL
                    SELECT
                        CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END,
                        n.nspname,
                        p.proname,
                pg_get_function_arguments(p.oid) AS arguments,
                pg_get_function_identity_arguments(p.oid) AS call_arguments
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE p.prokind IN ('f', 'p')
                      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY schema, object_name
                `;
        const objectsResult = await client.query(objectsQuery);
        const objects: TableInfo[] = this._dedupeTables(objectsResult.rows.map(row => ({
          schema: row.schema,
          objectName: row.object_name,
          objectType: row.object_type
          ,arguments: row.arguments,
          callArguments: row.call_arguments
        })));

        // Fetch columns
        const columnsQuery = `
                    SELECT 
                        table_schema as schema,
                        table_name,
                        column_name,
                        data_type
                    FROM information_schema.columns
                    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY table_schema, table_name, ordinal_position
                `;
        const columnsResult = await client.query(columnsQuery);
        const columns: ColumnInfo[] = this._dedupeColumns(columnsResult.rows.map(row => ({
          schema: row.schema,
          tableName: row.table_name,
          columnName: row.column_name,
          dataType: row.data_type
        })));

        this.objectCache.set(cacheKey, objects);
        this.columnCache.set(cacheKey, columns);
        this.lastCacheUpdate.set(cacheKey, Date.now());
      } finally {
        if (client) client.release();
      }
    } catch (error) {
      console.error('Cache update error:', error);
    }
  }

  private _extractTableNames(sqlText: string): Set<string> {
    const tables = new Set<string>();
    const text = sqlText.toLowerCase();

    // Match FROM clause
    const fromRegex = /from\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
    let match;
    while ((match = fromRegex.exec(text)) !== null) {
      const tableName = match[1].split('.').pop() || match[1];
      tables.add(tableName);
    }

    // Match JOIN clauses
    const joinRegex = /join\s+([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi;
    while ((match = joinRegex.exec(text)) !== null) {
      const tableName = match[1].split('.').pop() || match[1];
      tables.add(tableName);
    }

    return tables;
  }

  private _extractSchemaContext(document: vscode.TextDocument, position: vscode.Position): string | null {
    const textBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const schemaMatch = textBeforeCursor.match(/(?:from|join|update|into|table|delete\s+from|truncate\s+table|call)\s+([a-z_][a-z0-9_]*)\.[a-z_0-9]*$/i);
    return schemaMatch?.[1] || null;
  }

  private _extractRelationContext(document: vscode.TextDocument, position: vscode.Position): RelationContext | null {
    const textBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const relationRegex = /(?:from|join|update|into|table|delete\s+from|truncate\s+table|call)\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;

    let match: RegExpExecArray | null;
    let lastRelation: RelationContext | null = null;

    while ((match = relationRegex.exec(textBeforeCursor)) !== null) {
      const relation = match[1];
      const alias = match[2] || null;
      const [schema, objectName] = relation.includes('.') ? relation.split('.', 2) : [null, relation];

      lastRelation = {
        schema,
        objectName,
        alias,
      };
    }

    return lastRelation;
  }

  private _extractRelationAliases(document: vscode.TextDocument, position: vscode.Position): RelationAliasMap {
    const textBeforeCursor = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const relationRegex = /(?:from|join|update|into|table|delete\s+from|truncate\s+table|call)\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
    const aliases: RelationAliasMap = new Map();

    let match: RegExpExecArray | null;
    while ((match = relationRegex.exec(textBeforeCursor)) !== null) {
      const relation = match[1];
      const alias = match[2] || null;
      const [schema, objectName] = relation.includes('.') ? relation.split('.', 2) : [null, relation];
      const relationKey = `${schema || ''}.${objectName}`.toLowerCase();

      aliases.set(relationKey, alias || objectName);
      aliases.set(objectName.toLowerCase(), alias || objectName);
    }

    return aliases;
  }

  private _hasQualifiedColumnPrefix(lineText: string, position: vscode.Position): boolean {
    const textBeforeCursor = lineText.slice(0, position.character);
    return /\.[a-z_0-9]*$/i.test(textBeforeCursor);
  }

  private _getSqlKeywords(): vscode.CompletionItem[] {
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
      'ON', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL',
      'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET',
      'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
      'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
      'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
    ];

    return keywords.map(keyword => {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.sortText = `3-${keyword}`; // Lower priority than tables and columns
      return item;
    });
  }

  private _getObjectCompletions(
    objects: TableInfo[],
    referencedTables: Set<string>,
    schemaContext: string | null
  ): vscode.CompletionItem[] {
    const normalizedSchema = schemaContext?.toLowerCase() || null;

    return objects
      .filter(object => !normalizedSchema || object.schema.toLowerCase() === normalizedSchema)
      .map(object => {
        const item = new vscode.CompletionItem(
          object.objectName,
          object.objectType === 'function' ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Class
        );

        const objectLabel = object.objectType === 'materialized view'
          ? 'Materialized View'
          : object.objectType.replace(/\b\w/g, ch => ch.toUpperCase());
        item.detail = `${objectLabel} (${object.schema})`;
        if (object.arguments) {
          item.detail += ` · (${object.arguments})`;
        }
        item.documentation = new vscode.MarkdownString(`**${objectLabel}:** \`${object.schema}.${object.objectName}\``);
        if (object.arguments) {
          item.documentation.appendMarkdown(`\n\n**Signature:** \`${object.objectName}(${object.arguments})\``);
        }

        // Higher priority for already referenced objects or objects in the active schema
        if (normalizedSchema && object.schema.toLowerCase() === normalizedSchema) {
          item.sortText = `0-${object.objectName}`;
        } else if (referencedTables.has(object.objectName.toLowerCase())) {
          item.sortText = `0-${object.objectName}`;
        } else {
          item.sortText = `1-${object.objectName}`;
        }

        if (object.objectType === 'function' || object.objectType === 'procedure') {
          const callArguments = object.callArguments || '';
          const argumentNames = this._extractArgumentNames(callArguments);
          const routineSnippet = argumentNames.length > 0
            ? `${object.objectName}(${argumentNames.map((argumentName, index) => `\${${index + 1}:${argumentName}}`).join(', ')})`
            : `${object.objectName}()`;
          item.insertText = new vscode.SnippetString(routineSnippet);
        } else {
          item.insertText = schemaContext ? object.objectName : `${object.schema}.${object.objectName}`;
        }
        item.filterText = `${object.schema}.${object.objectName} ${object.objectName} ${object.objectType}`;

        return item;
      });
  }

  private _getColumnCompletions(
    columns: ColumnInfo[],
    referencedTables: Set<string>,
    lineText: string,
    schemaContext: string | null,
    relationContext: RelationContext | null,
    relationAliases: RelationAliasMap,
    hasQualifiedColumnPrefix: boolean
  ): vscode.CompletionItem[] {
    const completions: vscode.CompletionItem[] = [];

    const relationName = relationContext?.objectName.toLowerCase() || null;
    const relationSchema = relationContext?.schema?.toLowerCase() || null;

    // Filter columns by referenced tables
    const relevantColumns = columns.filter(col =>
      (
        (relationName && col.tableName.toLowerCase() === relationName && (!relationSchema || col.schema.toLowerCase() === relationSchema)) ||
        referencedTables.has(col.tableName.toLowerCase())
      ) && (!schemaContext || col.schema.toLowerCase() === schemaContext.toLowerCase())
    );

    // Add all columns, but prioritize relevant ones
    const allColumns = relevantColumns.length > 0
      ? relevantColumns
      : (schemaContext ? columns.filter(col => col.schema.toLowerCase() === schemaContext.toLowerCase()) : columns);

    for (const column of allColumns) {
      const item = new vscode.CompletionItem(
        column.columnName,
        vscode.CompletionItemKind.Field
      );

      item.detail = `${column.dataType} (${column.schema}.${column.tableName})`;
      item.documentation = new vscode.MarkdownString(
        `**Column:** \`${column.columnName}\`\n\n` +
        `**Type:** \`${column.dataType}\`\n\n` +
        `**Table:** \`${column.schema}.${column.tableName}\``
      );

      // Highest priority for columns from referenced tables
      if (referencedTables.has(column.tableName.toLowerCase())) {
        item.sortText = `0-${column.columnName}`;
      } else {
        item.sortText = `2-${column.columnName}`;
      }

      const columnAlias = relationAliases.get(`${column.schema}.${column.tableName}`.toLowerCase())
        || relationAliases.get(column.tableName.toLowerCase())
        || column.tableName;

      item.insertText = hasQualifiedColumnPrefix
        ? column.columnName
        : `${columnAlias}.${column.columnName}`;
      item.filterText = `${column.schema}.${column.tableName}.${column.columnName} ${column.tableName}.${column.columnName} ${column.columnName}`;

      completions.push(item);
    }

    return completions;
  }

  private _dedupeTables(tables: TableInfo[]): TableInfo[] {
    const seen = new Set<string>();

    return tables.filter(table => {
      const key = `${table.schema}.${table.objectName}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private _extractArgumentNames(argumentsText: string): string[] {
    if (!argumentsText.trim()) {
      return [];
    }

    return argumentsText
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map((part, index) => {
        const withoutDefault = part.replace(/\s+default\s+.+$/i, '').trim();
        const tokens = withoutDefault.split(/\s+/).filter(Boolean);
        const modeTokens = new Set(['in', 'out', 'inout', 'variadic', 'table']);
        const firstToken = tokens[0]?.toLowerCase();
        const candidate = modeTokens.has(firstToken || '') ? tokens[1] : tokens[0];
        return candidate || `arg${index + 1}`;
      });
  }

  private _dedupeColumns(columns: ColumnInfo[]): ColumnInfo[] {
    const seen = new Set<string>();

    return columns.filter(column => {
      const key = `${column.schema}.${column.tableName}.${column.columnName}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }
}
