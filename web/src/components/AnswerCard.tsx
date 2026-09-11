import { Fragment, useState } from 'react';
import type { QueryResponse } from '../api/types';
import { formatScore, hostnameOf } from '../lib/format';

interface Props {
  result: QueryResponse;
  onFocusSource: (itemId: string | null) => void;
}

export function AnswerCard({ result, onFocusSource }: Props) {
  const [showRetrieval, setShowRetrieval] = useState(false);
  const isExtractive = result.meta.generator === 'extractive-fallback';
  const hasCitations = result.citations.length > 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Answer">
      <div className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Answer</p>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          <AnswerText text={result.answer} citationCount={result.citations.length} onFocusSource={onFocusSource} citations={result.citations} />
        </div>

        {isExtractive && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Extractive mode: no chat model is configured, so this is the retrieved text rather than a generated answer.
          </p>
        )}
      </div>

      {hasCitations && (
        <div className="border-t border-slate-100 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Sources ({result.citations.length})
          </p>
          <ul className="mt-2 space-y-2">
            {result.citations.map((citation) => (
              <li
                key={citation.chunkId}
                onMouseEnter={() => onFocusSource(citation.itemId)}
                onMouseLeave={() => onFocusSource(null)}
                className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200"
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold text-indigo-700">
                    {citation.marker}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{citation.title}</p>
                    {citation.url && (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        {hostnameOf(citation.url)}
                      </a>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500" title="Cosine similarity to the question">
                    {formatScore(citation.score)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{citation.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Retrieval internals, collapsed by default. A RAG answer you cannot
          inspect is a RAG answer you cannot debug. */}
      <div className="border-t border-slate-100 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setShowRetrieval((value) => !value)}
          aria-expanded={showRetrieval}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {showRetrieval ? 'Hide' : 'Show'} retrieval detail
        </button>

        {showRetrieval && (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
            <Stat label="Generator" value={result.meta.generator} />
            <Stat label="Model" value={result.meta.model} />
            <Stat label="Chunks scanned" value={String(result.meta.scannedChunks)} />
            <Stat label="Chunks retrieved" value={`${result.meta.retrievedChunks} of top ${result.meta.topK}`} />
            <Stat label="Retrieval" value={`${result.meta.retrievalMs} ms`} />
            <Stat label="Answer" value={`${result.meta.answerMs} ms`} />
          </dl>
        )}

        {showRetrieval && result.sources.length > 0 && (
          <ol className="mt-3 space-y-2">
            {result.sources.map((source, index) => (
              <li key={source.chunkId} className="rounded-lg bg-slate-50 p-2.5 text-xs ring-1 ring-slate-200">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-700">
                    {index + 1}. {source.title} <span className="text-slate-400">#{source.position}</span>
                  </span>
                  <span className="tabular-nums text-slate-500">{formatScore(source.score)}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-slate-500">{source.content}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}

/**
 * Renders `[n]` markers in the answer as interactive chips that highlight the
 * matching source, instead of leaving them as literal text the reader has to
 * match up by eye.
 */
function AnswerText({
  text,
  citationCount,
  citations,
  onFocusSource,
}: {
  text: string;
  citationCount: number;
  citations: QueryResponse['citations'];
  onFocusSource: (itemId: string | null) => void;
}) {
  if (citationCount === 0) return <>{text}</>;

  const parts = text.split(/(\[\d+\])/g);

  return (
    <>
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const citation = match ? citations.find((entry) => entry.marker === Number(match[1])) : undefined;

        if (!citation) return <Fragment key={index}>{part}</Fragment>;

        return (
          <button
            key={index}
            type="button"
            onMouseEnter={() => onFocusSource(citation.itemId)}
            onMouseLeave={() => onFocusSource(null)}
            title={citation.title}
            className="mx-0.5 inline-flex items-center rounded bg-indigo-100 px-1 text-xs font-semibold text-indigo-700 align-baseline hover:bg-indigo-200"
          >
            {citation.marker}
          </button>
        );
      })}
    </>
  );
}
