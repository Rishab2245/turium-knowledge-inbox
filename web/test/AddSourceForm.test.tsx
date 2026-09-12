import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddSourceForm } from '../src/components/AddSourceForm';
import { errorResponse, makeItem, stubFetch } from './helpers';

describe('AddSourceForm', () => {
  it('disables submit until there is something to save', async () => {
    stubFetch({});
    render(<AddSourceForm onSaved={vi.fn()} />);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox', { name: /note text/i }), 'a note');
    expect(save).toBeEnabled();
  });

  it('submits a note and reports the created item', async () => {
    const item = makeItem({ status: 'pending' });
    const { calls } = stubFetch({ 'POST /api/ingest': () => ({ item, jobId: 'job-1', deduplicated: false }) });
    const onSaved = vi.fn();

    render(<AddSourceForm onSaved={onSaved} />);
    await userEvent.type(screen.getByRole('textbox', { name: /note text/i }), 'Vectors live in SQLite');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(item, false));
    expect(calls[0]!.body).toEqual({ type: 'note', content: 'Vectors live in SQLite' });
  });

  it('clears the input after a successful save', async () => {
    stubFetch({ 'POST /api/ingest': () => ({ item: makeItem(), jobId: 'j', deduplicated: false }) });

    render(<AddSourceForm onSaved={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: /note text/i });

    await userEvent.type(textarea, 'something');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('switches to URL mode and posts a url payload', async () => {
    const { calls } = stubFetch({ 'POST /api/ingest': () => ({ item: makeItem({ sourceType: 'url' }), jobId: 'j', deduplicated: false }) });

    render(<AddSourceForm onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await userEvent.type(screen.getByRole('textbox', { name: /page url/i }), 'https://example.com/post');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ type: 'url', url: 'https://example.com/post' });
  });

  it('includes an optional title when given', async () => {
    const { calls } = stubFetch({ 'POST /api/ingest': () => ({ item: makeItem(), jobId: 'j', deduplicated: false }) });

    render(<AddSourceForm onSaved={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: /note text/i }), 'body text');
    await userEvent.type(screen.getByPlaceholderText('Title (optional)'), 'My title');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({ title: 'My title' });
  });

  it('shows the field-level message from a validation error', async () => {
    stubFetch({
      'POST /api/ingest': () =>
        errorResponse(400, {
          error: {
            code: 'validation_error',
            message: 'The request body failed validation',
            details: [{ field: 'url', message: 'url must be a valid absolute URL' }],
            requestId: 'req-9',
          },
        }),
    });

    render(<AddSourceForm onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await userEvent.type(screen.getByRole('textbox', { name: /page url/i }), 'https://nope.invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('url: url must be a valid absolute URL');
  });

  it('reports a deduplicated save so the caller can refresh instead of duplicating', async () => {
    const existing = makeItem({ sourceType: 'url' });
    stubFetch({ 'POST /api/ingest': () => ({ item: existing, jobId: null, deduplicated: true }) });
    const onSaved = vi.fn();

    render(<AddSourceForm onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('tab', { name: 'URL' }));
    await userEvent.type(screen.getByRole('textbox', { name: /page url/i }), 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(existing, true));
  });
});
