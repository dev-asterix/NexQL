import { executeQueryImpl, cancelInFlightQuery } from '../providers/kernel/executeQueryImpl';
import type {
  ExecuteQueryHooks,
  ExecuteQueryRequest,
  ExecuteQueryResult,
  InFlightExecution,
} from './execution/queryExecutionTypes';

/**
 * Shared query execution kernel for notebooks and Query Studio.
 */
export class QueryExecutionService {
  private static instance: QueryExecutionService | undefined;

  private static readonly inFlight = new Map<string, InFlightExecution>();
  private static readonly executingBySession = new Map<string, string>();

  static getInstance(): QueryExecutionService {
    if (!QueryExecutionService.instance) {
      QueryExecutionService.instance = new QueryExecutionService();
    }
    return QueryExecutionService.instance;
  }

  static getInFlightMap(): Map<string, InFlightExecution> {
    return QueryExecutionService.inFlight;
  }

  static getExecutingBySession(): Map<string, string> {
    return QueryExecutionService.executingBySession;
  }

  static getExecutingKey(sessionKey: string): string | undefined {
    return QueryExecutionService.executingBySession.get(sessionKey);
  }

  static async cancelInFlight(executionKey: string): Promise<void> {
    await cancelInFlightQuery(executionKey);
  }

  async executeQuery(
    request: ExecuteQueryRequest,
    hooks?: ExecuteQueryHooks,
  ): Promise<ExecuteQueryResult> {
    return executeQueryImpl(request, hooks);
  }
}

export type {
  ExecuteQueryHooks,
  ExecuteQueryRequest,
  ExecuteQueryResult,
  QueryExecutionOutput,
} from './execution/queryExecutionTypes';

export {
  MIME_NOTICES_LIVE,
  MIME_QUERY_ERROR,
  MIME_QUERY_RESULT,
} from './execution/queryExecutionTypes';

export * from './execution/ExecutionSurface';
