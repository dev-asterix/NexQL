import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { SqlCompletionProvider } from '../../providers/SqlCompletionProvider';
import { ConnectionManager } from '../../services/ConnectionManager';

function createNotebookCellDocument(text: string, uriSuffix = 'cell-1') {
  const uri = vscode.Uri.parse(`vscode-notebook-cell:/sql-completion/${uriSuffix}`);
  return new vscode.TextDocument(text, uri, 'sql');
}

function attachNotebook(document: vscode.TextDocument, metadata: any) {
  const notebook = new vscode.NotebookDocument(vscode.Uri.file('/workspace/sql-notebook.pgsql'), metadata);
  const cell = new vscode.NotebookCell(document, 0, vscode.NotebookCellKind.Code);
  notebook.getCells = () => [cell];
  vscode.workspace.notebookDocuments = [notebook];
  return notebook;
}

describe('SqlCompletionProvider', () => {
  let sandbox: sinon.SinonSandbox;
  let getConfigurationStub: sinon.SinonStub;
  let getPooledClientStub: sinon.SinonStub;
  let queryStub: sinon.SinonStub;
  let releaseStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    vscode.workspace.notebookDocuments = [];

    getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns({
      get: sandbox.stub().returns([])
    } as any);

    queryStub = sandbox.stub();
    releaseStub = sandbox.stub();
    getPooledClientStub = sandbox.stub().resolves({ query: queryStub, release: releaseStub });
    sandbox.stub(ConnectionManager, 'getInstance').returns({
      getPooledClient: getPooledClientStub
    } as any);
  });

  afterEach(() => {
    sandbox.restore();
    vscode.workspace.notebookDocuments = [];
  });

  it('returns empty completions for unsupported documents', async () => {
    const provider = new SqlCompletionProvider();

    const nonNotebook = new vscode.TextDocument('SELECT 1', vscode.Uri.file('/tmp/query.sql'), 'sql');
    const wrongLanguage = new vscode.TextDocument('SELECT 1', vscode.Uri.parse('vscode-notebook-cell:/sql-completion/file'), 'markdown');
    const emptyNotebook = createNotebookCellDocument('   ');

    expect(await provider.provideCompletionItems(nonNotebook, new vscode.Position(0, 0), {} as any, {} as any)).to.deep.equal([]);
    expect(await provider.provideCompletionItems(wrongLanguage, new vscode.Position(0, 0), {} as any, {} as any)).to.deep.equal([]);
    expect(await provider.provideCompletionItems(emptyNotebook, new vscode.Position(0, 0), {} as any, {} as any)).to.deep.equal([]);
    expect(getPooledClientStub.called).to.be.false;
  });

  it('returns keyword-only completions when the connection is missing from settings', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections' ? [] : undefined)
    } as any);

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument('SELECT * FROM public.users;');
    attachNotebook(document, { connectionId: 'missing', databaseName: 'appdb' });

    const items = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);
    const labels = items.map(item => item.label);

    expect(getPooledClientStub.called).to.be.false;
    expect(labels).to.include('SELECT');
    expect(labels).to.not.include('users');
    expect(labels).to.not.include('email');
  });

  it('loads table and column completions from cache and reuses them on subsequent calls', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections'
        ? [{ id: 'conn-1', name: 'Main', host: 'localhost', port: 5432, username: 'postgres' }]
        : undefined)
    } as any);

    queryStub.onFirstCall().resolves({
      rows: [
        { schema: 'public', object_name: 'users', object_type: 'table' },
        { schema: 'sales', object_name: 'orders', object_type: 'table' },
        { schema: 'sales', object_name: 'monthly_sales', object_type: 'view' },
        { schema: 'sales', object_name: 'recompute_totals', object_type: 'function', arguments: 'customer_id integer, include_tax boolean', call_arguments: 'customer_id integer, include_tax boolean' },
        { schema: 'sales', object_name: 'sync_inventory', object_type: 'procedure', arguments: 'warehouse_id integer', call_arguments: 'warehouse_id integer' }
      ]
    });
    queryStub.onSecondCall().resolves({
      rows: [
        { schema: 'public', table_name: 'users', column_name: 'user_id', data_type: 'integer' },
        { schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        { schema: 'sales', table_name: 'orders', column_name: 'order_total', data_type: 'numeric' }
      ]
    });

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument(
      'SELECT u.user_id, o.order_total FROM public.users u JOIN sales.orders o ON o.user_id = u.user_id;'
    );
    attachNotebook(document, { connectionId: 'conn-1', databaseName: 'appdb' });

    const firstItems = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);
    const secondItems = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);

    const firstLabels = firstItems.map(item => item.label);
    expect(getPooledClientStub.calledOnce).to.be.true;
    expect(releaseStub.calledOnce).to.be.true;
    expect(queryStub.calledTwice).to.be.true;
    expect(queryStub.firstCall.args[0]).to.contain('NULL::text as arguments');
    expect(queryStub.firstCall.args[0]).to.contain('pg_get_function_arguments(p.oid) AS arguments');
    expect(queryStub.firstCall.args[0]).to.contain('pg_get_function_identity_arguments(p.oid) AS call_arguments');
    expect(firstLabels).to.include('SELECT');
    expect(firstLabels).to.include('users');
    expect(firstLabels).to.include('orders');
    expect(firstLabels).to.include('user_id');
    expect(firstLabels).to.include('order_total');
    expect(firstLabels).to.include('recompute_totals');
    expect(firstLabels).to.include('sync_inventory');

    const usersItem = firstItems.find(item => item.label === 'users');
    const emailItem = firstItems.find(item => item.label === 'email');
    const orderTotalItem = firstItems.find(item => item.label === 'order_total');
    const recomputeTotalsItem = firstItems.find(item => item.label === 'recompute_totals');
    const syncInventoryItem = firstItems.find(item => item.label === 'sync_inventory');

    expect(usersItem?.sortText).to.equal('0-users');
    expect(emailItem?.sortText).to.equal('0-email');
    expect(orderTotalItem?.sortText).to.equal('0-order_total');
    expect(emailItem?.insertText).to.equal('u.email');
    expect(orderTotalItem?.insertText).to.equal('o.order_total');
    expect((recomputeTotalsItem?.insertText as any)?.value || recomputeTotalsItem?.insertText).to.equal('recompute_totals(${1:customer_id}, ${2:include_tax})');
    expect((syncInventoryItem?.insertText as any)?.value || syncInventoryItem?.insertText).to.equal('sync_inventory(${1:warehouse_id})');
    expect(secondItems.map(item => item.label)).to.deep.equal(firstLabels);

    const fallbackDocument = createNotebookCellDocument('SELECT 1;', 'cell-2');
    attachNotebook(fallbackDocument, { connectionId: 'conn-1', databaseName: 'appdb' });
    const fallbackItems = await provider.provideCompletionItems(fallbackDocument, new vscode.Position(0, fallbackDocument.text.length), {} as any, {} as any);
    expect(fallbackItems.length).to.be.greaterThan(0);
    expect(getPooledClientStub.calledOnce).to.be.true;
  });

  it('deduplicates repeated database objects before returning completions', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections'
        ? [{ id: 'conn-1', name: 'Main', host: 'localhost', port: 5432, username: 'postgres' }]
        : undefined)
    } as any);

    queryStub.onFirstCall().resolves({
      rows: [
        { schema: 'public', object_name: 'users', object_type: 'table' },
        { schema: 'public', object_name: 'users', object_type: 'table' },
        { schema: 'sales', object_name: 'orders', object_type: 'table' }
      ]
    });
    queryStub.onSecondCall().resolves({
      rows: [
        { schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        { schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        { schema: 'sales', table_name: 'orders', column_name: 'order_total', data_type: 'numeric' }
      ]
    });

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument('SELECT * FROM public.users;');
    attachNotebook(document, { connectionId: 'conn-1', databaseName: 'appdb' });

    const items = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);
    const labels = items.map(item => item.label);

    expect(labels.filter(label => label === 'users')).to.have.length(1);
    expect(labels.filter(label => label === 'email')).to.have.length(1);
    expect(labels.filter(label => label === 'orders')).to.have.length(1);
  });

  it('keeps the schema context when inserting objects from a schema-prefixed completion', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections'
        ? [{ id: 'conn-1', name: 'Main', host: 'localhost', port: 5432, username: 'postgres' }]
        : undefined)
    } as any);

    queryStub.onFirstCall().resolves({
      rows: [
        { schema: 'public', object_name: 'users', object_type: 'table' },
        { schema: 'sales', object_name: 'orders', object_type: 'table' },
        { schema: 'sales', object_name: 'monthly_sales', object_type: 'view' },
        { schema: 'sales', object_name: 'recompute_totals', object_type: 'function' }
      ]
    });
    queryStub.onSecondCall().resolves({ rows: [] });

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument('SELECT * FROM sales.');
    attachNotebook(document, { connectionId: 'conn-1', databaseName: 'appdb' });

    const items = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);
    const labels = items.map(item => item.label);
    const ordersItem = items.find(item => item.label === 'orders');
    const usersItem = items.find(item => item.label === 'users');

    expect(labels).to.include('orders');
    expect(labels).to.include('monthly_sales');
    expect(labels).to.include('recompute_totals');
    expect(labels).to.not.include('users');
    expect(ordersItem?.insertText).to.equal('orders');
    expect(usersItem).to.be.undefined;
  });

  it('narrows column completions to the relation in the current query context', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections'
        ? [{ id: 'conn-1', name: 'Main', host: 'localhost', port: 5432, username: 'postgres' }]
        : undefined)
    } as any);

    queryStub.onFirstCall().resolves({
      rows: [
        { schema: 'public', object_name: 'users', object_type: 'table' },
        { schema: 'sales', object_name: 'orders', object_type: 'table' }
      ]
    });
    queryStub.onSecondCall().resolves({
      rows: [
        { schema: 'public', table_name: 'users', column_name: 'id', data_type: 'integer' },
        { schema: 'public', table_name: 'users', column_name: 'email', data_type: 'text' },
        { schema: 'sales', table_name: 'orders', column_name: 'order_total', data_type: 'numeric' }
      ]
    });

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument('SELECT * FROM public.users u');
    attachNotebook(document, { connectionId: 'conn-1', databaseName: 'appdb' });

    const items = await provider.provideCompletionItems(document, new vscode.Position(0, document.text.length), {} as any, {} as any);
    const labels = items.map(item => item.label);
    const idItem = items.find(item => item.label === 'id');

    expect(labels).to.include('id');
    expect(labels).to.include('email');
    expect(labels).to.not.include('order_total');
    expect(idItem?.insertText).to.equal('u.id');
  });

  it('does not duplicate an already typed column qualifier', async () => {
    (getConfigurationStub as sinon.SinonStub).returns({
      get: (key: string) => (key === 'postgresExplorer.connections'
        ? [{ id: 'conn-1', name: 'Main', host: 'localhost', port: 5432, username: 'postgres' }]
        : undefined)
    } as any);

    queryStub.onFirstCall().resolves({
      rows: [
        { schema: 'public', object_name: 'users', object_type: 'table' }
      ]
    });
    queryStub.onSecondCall().resolves({
      rows: [
        { schema: 'public', table_name: 'users', column_name: 'created_at', data_type: 'timestamp with time zone' }
      ]
    });

    const provider = new SqlCompletionProvider();
    const document = createNotebookCellDocument('SELECT tn. FROM public.users tn');
    attachNotebook(document, { connectionId: 'conn-1', databaseName: 'appdb' });

    const items = await provider.provideCompletionItems(document, new vscode.Position(0, 'SELECT tn.'.length), {} as any, {} as any);
    const createdAtItem = items.find(item => item.label === 'created_at');

    expect(createdAtItem?.insertText).to.equal('created_at');
  });
});