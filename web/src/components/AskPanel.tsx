import { useState, type FormEvent } from 'react';
import type { QueryResponse } from '../api/types';
import { AnswerCard } from './AnswerCard';

interface Props {
  isAsking: boolean;
  error: string | null;
  result: QueryResponse | null;
  readyItemCount: number;
  selectedCount: number;
  onClearSelection: () => void;
  onAsk: (question: string) => void;
  onFocusSource: (itemId: string | null) => void;
}

export function AskPanel({
  isAsking,
  error,
  result,
  readyItemCount,
  selectedCount,
  onClearSelection,
  onAsk,
  onFocusSource,
}: Props) {
  const [question, setQuestion] = useState('');
  const canAsk = !isAsking && question.trim().length >= 3;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canAsk) onAsk(question.trim());
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="question" className="text-sm font-semibold text-slate-900">
          Ask your inbox
        </label>

        <p className="mt-0.5 text-xs text-slate-500">
          {readyItemCount === 0 ? (
            'Nothing is indexed yet, so there is nothing to answer from.'
          ) : selectedCount > 0 ? (
            <>
              Restricted to {selectedCount} selected source{selectedCount === 1 ? '' : 's'}.{' '}
              <button type="button" onClick={onClearSelection} className="text-indigo-600 hover:underline">
                Search all instead
              </button>
            </>
          ) : (
            `Answered only from your ${readyItemCount} indexed source${readyItemCount === 1 ? '' : 's'}.`
          )}
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="question"
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What did I save about vector stores?"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <button
            type="submit"
            disabled={!canAsk}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isAsking ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {isAsking && !result && <AnswerSkeleton />}

      {result && !isAsking && <AnswerCard result={result} onFocusSource={onFocusSource} />}
    </div>
  );
}

function AnswerSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" aria-busy="true" aria-label="Generating answer">
      <div className="h-3 w-16 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}
