import type { HealthResponse } from '../api/types';

/**
 * Surfaces the two facts that otherwise only exist in server logs: which models
 * are wired up, and whether the API is reachable at all. Without this, running
 * with no API key looks like a broken app rather than a configured fallback.
 */
export function ProviderNotice({ health, isOffline }: { health: HealthResponse | null; isOffline: boolean }) {
  if (isOffline) {
    return (
      <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
        <p className="font-medium">The API is not reachable.</p>
        <p className="mt-0.5 text-xs">
          Start it with <code className="rounded bg-rose-100 px-1">npm run dev</code> in <code>server/</code>, then
          reload.
        </p>
      </div>
    );
  }

  if (!health || health.providers.chat.remote) return null;

  return (
    <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <p className="font-medium">Running without a model provider.</p>
      <p className="mt-0.5 text-xs">
        Embeddings use the local hashed fallback and answers are extracted rather than generated. Set
        <code className="mx-1 rounded bg-amber-100 px-1">OPENAI_API_KEY</code>
        in <code>server/.env</code> and restart for semantic search and synthesised answers.
      </p>
    </div>
  );
}
