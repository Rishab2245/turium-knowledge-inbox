import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { itemsResponse, makeHealth, makeItem, makeQueryResponse, stubFetch } from './helpers';

describe('App', () => {
  it('shows the empty state before anything is saved', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([]),
      'GET /api/health': () => makeHealth({ index: { ...makeHealth().index, items: { pending: 0, processing: 0, ready: 0, failed: 0 }, chunks: 0 } }),
    });

    render(<App />);

    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is indexed yet/i)).toBeInTheDocument();
  });

  it('warns when no model provider is configured', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([]),
      'GET /api/health': () =>
        makeHealth({
          providers: {
            embeddings: { id: 'local-hashed-ngram', model: 'local-hashed-ngram-512', remote: false },
            chat: { id: 'extractive-fallback', model: 'none', remote: false },
          },
        }),
    });

    render(<App />);
    expect(await screen.findByText(/Running without a model provider/i)).toBeInTheDocument();
  });

  it('tells the user plainly when the API is unreachable', async () => {
    stubFetch({ 'GET *': () => Promise.reject(new TypeError('Failed to fetch')) });

    render(<App />);
    expect(await screen.findByText(/The API is not reachable/i)).toBeInTheDocument();
  });

  it('asks a question and renders the cited answer', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'item-1', title: 'Vector store choice' })]),
      'GET /api/health': () => makeHealth(),
      'POST /api/query': () => makeQueryResponse(),
    });

    render(<App />);
    await screen.findByText('Vector store choice');

    await userEvent.type(screen.getByLabelText('Ask your inbox'), 'where are vectors stored?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    const answer = await screen.findByLabelText('Answer');
    expect(answer).toHaveTextContent('They live in SQLite');
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
  });

  it('loads a second page on demand', async () => {
    stubFetch({
      'GET /api/items': (url) =>
        url.includes('cursor=')
          ? itemsResponse([makeItem({ id: 'b', title: 'Older item' })])
          : itemsResponse([makeItem({ id: 'a', title: 'Newer item' })], 'cursor-1'),
      'GET /api/health': () => makeHealth(),
    });

    render(<App />);
    await screen.findByText('Newer item');
    expect(screen.queryByText('Older item')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Older item')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('restricts a question to the selected sources', async () => {
    const { calls } = stubFetch({
      'GET /api/items': () =>
        itemsResponse([
          makeItem({ id: 'wanted', title: 'Scaling notes' }),
          makeItem({ id: 'other', title: 'Unrelated notes' }),
        ]),
      'GET /api/health': () => makeHealth(),
      'POST /api/query': () => makeQueryResponse(),
    });

    render(<App />);
    await screen.findByText('Scaling notes');

    await userEvent.click(screen.getByLabelText('Restrict questions to Scaling notes'));
    expect(screen.getByText(/Restricted to 1 selected source/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Ask your inbox'), 'what is the migration path?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    const query = calls.find((call) => call.url.includes('/api/query'))!;
    expect(query.body).toMatchObject({ itemIds: ['wanted'] });
  });

  it('can clear a source restriction', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'one', title: 'Only note' })]),
      'GET /api/health': () => makeHealth(),
    });

    render(<App />);
    await screen.findByText('Only note');

    await userEvent.click(screen.getByLabelText('Restrict questions to Only note'));
    await userEvent.click(screen.getByRole('button', { name: /search all instead/i }));

    expect(screen.getByText(/Answered only from your 1 indexed source/i)).toBeInTheDocument();
  });

  it('cannot scope to an item that is not indexed yet', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'p', title: 'Still indexing', status: 'pending' })]),
      'GET /api/health': () => makeHealth(),
    });

    render(<App />);
    await screen.findByText('Still indexing');

    expect(screen.getByLabelText('Restrict questions to Still indexing')).toBeDisabled();
  });

  it('shows a failed item with the reason it failed', async () => {
    stubFetch({
      'GET /api/items': () =>
        itemsResponse([
          makeItem({
            id: 'f',
            title: 'https://example.com/missing',
            sourceType: 'url',
            url: 'https://example.com/missing',
            status: 'failed',
            error: 'Fetching the URL returned HTTP 404',
          }),
        ]),
      'GET /api/health': () => makeHealth(),
    });

    render(<App />);

    const row = (await screen.findByText('https://example.com/missing', { selector: 'p' })).closest('li')!;
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(within(row).getByText('Fetching the URL returned HTTP 404')).toBeInTheDocument();
  });

  it('removes an item when deleted', async () => {
    stubFetch({
      'GET /api/items': () => itemsResponse([makeItem({ id: 'doomed', title: 'Doomed note' })]),
      'GET /api/health': () => makeHealth(),
      'DELETE /api/items/doomed': () => new Response(null, { status: 204 }),
    });

    render(<App />);
    await screen.findByText('Doomed note');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Doomed note' }));

    await waitFor(() => expect(screen.queryByText('Doomed note')).not.toBeInTheDocument());
  });
});
