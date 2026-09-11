import { useCallback, useMemo, useState } from 'react';
import type { Item } from './api/types';
import { AddSourceForm } from './components/AddSourceForm';
import { AskPanel } from './components/AskPanel';
import { ItemList } from './components/ItemList';
import { ProviderNotice } from './components/ProviderNotice';
import { useAsk } from './hooks/useAsk';
import { useHealth } from './hooks/useHealth';
import { useItems } from './hooks/useItems';

/**
 * Application shell and the only place cross-cutting state lives.
 *
 * State management is deliberately plain React: three purpose-built hooks own
 * the three independent slices (saved items, the current answer, server
 * health), and this component wires them together. There is no shared mutable
 * store to keep in sync, so Redux or Zustand would add indirection without
 * removing any problem.
 */
export default function App() {
  const { items, isLoading, error, hasWorkInFlight, refresh, addOptimistic, remove } = useItems();
  const { result, isAsking, error: askError, ask } = useAsk();

  // Bumping this re-reads /api/health after anything that changes the index.
  const [healthRevision, setHealthRevision] = useState(0);
  const { health, isOffline } = useHealth(healthRevision + (hasWorkInFlight ? 0 : items.length));

  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const readyItemCount = useMemo(() => items.filter((item) => item.status === 'ready').length, [items]);

  // Items backing the current answer stay outlined even when nothing is hovered,
  // so the answer and the list are visibly connected.
  const highlightedItemIds = useMemo(() => {
    if (focusedItemId) return new Set([focusedItemId]);
    return new Set(result?.citations.map((citation) => citation.itemId) ?? []);
  }, [focusedItemId, result]);

  const handleSaved = useCallback(
    (item: Item, deduplicated: boolean) => {
      if (deduplicated) void refresh();
      else addOptimistic(item);
      setHealthRevision((value) => value + 1);
    },
    [addOptimistic, refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await remove(id);
        setHealthRevision((value) => value + 1);
      } catch {
        // useItems already rolled the list back; the failure is visible there.
      }
    },
    [remove],
  );

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-base font-semibold text-slate-900">AI Knowledge Inbox</h1>
            <p className="text-xs text-slate-500">Save notes and links, then ask questions answered from them.</p>
          </div>
          {health && (
            <dl className="hidden gap-5 text-right sm:flex">
              <IndexStat label="Indexed" value={String(health.index.items.ready)} />
              <IndexStat label="Chunks" value={String(health.index.chunks)} />
              <IndexStat
                label="Model"
                value={health.providers.chat.remote ? health.providers.chat.model : 'fallback'}
              />
            </dl>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ProviderNotice health={health} isOffline={isOffline} />

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section aria-label="Saved sources" className="space-y-4">
            <AddSourceForm onSaved={handleSaved} />

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Saved{items.length > 0 && <span className="ml-1 text-slate-400">({items.length})</span>}
              </h2>
              {hasWorkInFlight && <span className="text-xs text-slate-500">Indexing in the background...</span>}
            </div>

            <ItemList
              items={items}
              isLoading={isLoading}
              error={error}
              highlightedItemIds={highlightedItemIds}
              onDelete={handleDelete}
            />
          </section>

          <section aria-label="Ask a question">
            <AskPanel
              isAsking={isAsking}
              error={askError}
              result={result}
              readyItemCount={readyItemCount}
              onAsk={(question) => ask(question)}
              onFocusSource={setFocusedItemId}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

function IndexStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-slate-700">{value}</dd>
    </div>
  );
}
