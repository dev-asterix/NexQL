import type { QueryResults } from '../../common/types';
import type { ResultViewBridge } from './bridge';
import { renderPostgresNotebookResult } from '../renderer/queryResult/renderQueryResult';
import { MIME_QUERY_RESULT } from '../../services/execution/queryExecutionTypes';

export type { ResultViewBridge } from './bridge';

/**
 * Mount the shared NexQL result view (table, chart, explain, notices, …).
 */
export function mountResultView(
  container: HTMLElement,
  payload: QueryResults | Record<string, unknown>,
  bridge: ResultViewBridge,
): void {
  const ctx = bridge.asRendererContext();
  renderPostgresNotebookResult(ctx as any, {
    mime: MIME_QUERY_RESULT,
    json: () => payload,
  }, container);
}

export { renderPostgresNotebookResult } from '../renderer/queryResult/renderQueryResult';
