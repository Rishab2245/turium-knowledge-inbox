import type { Item } from '../api/types';
import { formatChars, hostnameOf, relativeTime } from '../lib/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  items: Item[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  highlightedItemIds: Set<string>;
  selectedItemIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onLoadMore: () => void;
  onDelete: (id: string) => void;
}

export function ItemList({
  items,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  highlightedItemIds,
  selectedItemIds,
  onToggleSelected,
  onLoadMore,
  onDelete,
}: Props) {
  if (isLoading) {
    return <SkeletonList />;
  }

  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
        {error}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-sm font-medium text-slate-700">Nothing saved yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Add a note or a URL above. Once it finishes indexing you can ask questions about it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            isHighlighted={highlightedItemIds.has(item.id)}
            isSelected={selectedItemIds.has(item.id)}
            onToggleSelected={() => onToggleSelected(item.id)}
            onDelete={() => onDelete(item.id)}
          />
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-full rounded-xl border border-slate-300 bg-white py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {isLoadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}

interface RowProps {
  item: Item;
  isHighlighted: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onDelete: () => void;
}

function ItemRow({ item, isHighlighted, isSelected, onToggleSelected, onDelete }: RowProps) {
  const host = hostnameOf(item.url);
  const isReady = item.status === 'ready';

  return (
    <li
      className={`group rounded-xl border bg-white p-3 transition ${
        // A source used by the current answer is outlined, so the answer's
        // citations and the item list read as one thing.
        isHighlighted ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Only indexed items can be searched, so only they can be scoped to. */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          disabled={!isReady}
          aria-label={`Restrict questions to ${item.title}`}
          className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900" title={item.title}>
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <StatusBadge status={item.status} />
            <span>{item.sourceType === 'url' ? (host ?? 'link') : 'note'}</span>
            <span aria-hidden="true">.</span>
            <span>{relativeTime(item.createdAt)}</span>
            {isReady && (
              <>
                <span aria-hidden="true">.</span>
                <span>
                  {item.chunkCount} chunk{item.chunkCount === 1 ? '' : 's'}
                </span>
                <span aria-hidden="true">.</span>
                <span>{formatChars(item.charCount)}</span>
              </>
            )}
          </div>

          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 block truncate text-xs text-indigo-600 hover:underline"
            >
              {item.url}
            </a>
          )}

          {item.status === 'failed' && item.error && (
            <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{item.error}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${item.title}`}
          className="rounded-md px-2 py-1 text-xs text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading saved items">
      {[0, 1, 2].map((key) => (
        <li key={key} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}
