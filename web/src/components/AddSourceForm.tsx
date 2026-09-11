import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Item } from '../api/types';

type Mode = 'note' | 'url';

interface Props {
  onSaved: (item: Item, deduplicated: boolean) => void;
}

/**
 * Add a note or a URL. One form with two modes rather than two forms: the
 * submit path, error handling and busy state are identical, and a tab switch
 * reads faster than a wall of inputs.
 */
export function AddSourceForm({ onSaved }: Props) {
  const [mode, setMode] = useState<Mode>('note');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !isSaving && (mode === 'note' ? note.trim().length > 0 : url.trim().length > 0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSaving(true);
    setError(null);

    try {
      const response =
        mode === 'note'
          ? await api.ingestNote(note.trim(), title.trim() || undefined)
          : await api.ingestUrl(url.trim(), title.trim() || undefined);

      onSaved(response.item, response.deduplicated);
      setNote('');
      setUrl('');
      setTitle('');
    } catch (caught) {
      // Field-level detail when the server gave it, so the message points at
      // the input that is actually wrong.
      const detail = caught instanceof ApiError ? caught.fieldErrors?.[0] : undefined;
      setError(
        detail
          ? `${detail.field}: ${detail.message}`
          : caught instanceof ApiError
            ? caught.message
            : 'Could not save that.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Add to your inbox</h2>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="Source type">
          {(['note', 'url'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {value === 'note' ? 'Note' : 'URL'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'note' ? (
        <label className="block">
          <span className="sr-only">Note text</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder="Paste a snippet, a meeting note, anything you want to ask about later."
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </label>
      ) : (
        <label className="block">
          <span className="sr-only">Page URL</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            The server fetches the page and extracts its readable text. Client-rendered pages and login walls will fail.
          </p>
        </label>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title (optional)"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}
    </form>
  );
}
