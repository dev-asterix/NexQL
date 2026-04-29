import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import {
  DASHBOARD_LOADING_SHELL_MARKER,
  getErrorHtml,
  getHtmlForWebview,
  getLoadingHtml,
} from '../../../dashboard/DashboardHtml';

describe('DashboardHtml (extra)', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns fallback error HTML when template loading fails', async () => {
    const readFileStub = sandbox.stub().rejects(new Error('missing template file'));
    sandbox.stub(vscode.workspace, 'fs').value({ readFile: readFileStub } as any);
    sandbox.stub(vscode.Uri, 'joinPath').callsFake((base, ...segments) => {
      return { fsPath: [base.fsPath, ...segments].join('/') } as vscode.Uri;
    });

    const html = await getHtmlForWebview(
      { cspSource: 'vscode-resource:' } as vscode.Webview,
      { fsPath: '/extension' } as vscode.Uri,
      {
        dbName: 'demo',
        owner: 'owner',
        size: '0 MB',
        activeConnections: 0,
        idleConnections: 0,
        waitingConnections: 0,
        totalConnections: 0,
        maxConnections: 100,
        extensionCount: 0,
        topTables: [],
        connectionStates: [],
        objectCounts: { schemas: 0, tables: 0, views: 0, functions: 0, sequences: 0 },
        activeQueries: [],
        blockingLocks: [],
        metrics: {
          xact_commit: 0,
          xact_rollback: 0,
          blks_read: 0,
          blks_hit: 0,
          deadlocks: 0,
          conflicts: 0,
          temp_bytes: 0,
          temp_files: 0,
          checkpoints_timed: 0,
          checkpoints_req: 0,
          tuples_fetched: 0,
          tuples_returned: 0
        },
        waitEvents: [],
        longRunningQueries: 0
      } as any
    );

    expect(html).to.contain('Dashboard Error');
    expect(html).to.contain('Failed to load dashboard resources');
    expect(html).to.contain('missing template file');
  });

  it('renders helper HTML snippets', () => {
    const loading = getLoadingHtml();
    expect(loading).to.contain(DASHBOARD_LOADING_SHELL_MARKER);
    expect(loading).to.contain('Loading dashboard metrics...');

    const error = getErrorHtml('boom');
    expect(error).to.contain('Dashboard Error');
    expect(error).to.contain('<pre>boom</pre>');
  });
});
