import type { HealthResponse } from '../api/types';
import type { HealthStatus } from '../hooks/useHealth';

/**
 * Surfaces the facts that otherwise only exist in server logs: which models are
 * wired up, and whether the API is answering at all. Without this, running with
 * no API key looks like a broken app rather than a configured fallback.
 */
export function ProviderNotice({ health, status }: { health: HealthResponse | null; status: HealthStatus }) {
  // A server that has not answered yet is usually one that is waking up, not a
  // broken one. Say nothing until useHealth has actually given up.
  if (status === 'connecting') {
    return health ? null : (
      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        <p>Connecting to the API. A host that has been idle can take up to a minute to wake up.</p>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
        <p className="font-medium">The API is not answering.</p>
        <p className="mt-0.5 text-xs">
          {isLocal()
            ? 'Start it with `npm run dev` in server/, then reload.'
            : 'It may be restarting or waking from idle. This retries on its own, so leave the page open.'}
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
        <code className="mx-1 rounded bg-amber-100 px-1">GEMINI_API_KEY</code>
        (or <code className="mx-1 rounded bg-amber-100 px-1">OPENAI_API_KEY</code>) on the server and restart for
        semantic search and synthesised answers.
      </p>
    </div>
  );
}

/** Localhost advice is actively misleading on a deployed site. */
const isLocal = () =>
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
