import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnswerCard } from '../src/components/AnswerCard';
import { makeQueryResponse } from './helpers';

describe('AnswerCard', () => {
  it('renders the answer and its cited sources', () => {
    render(<AnswerCard result={makeQueryResponse()} onFocusSource={vi.fn()} />);

    expect(screen.getByLabelText('Answer')).toHaveTextContent('They live in SQLite');
    expect(screen.getByText('Sources (1)')).toBeInTheDocument();
    expect(screen.getByText('Vector store choice')).toBeInTheDocument();
    expect(screen.getByText('Embeddings are stored as float32 blobs.')).toBeInTheDocument();
  });

  it('turns each [n] marker into a control that focuses its source', async () => {
    const onFocusSource = vi.fn();
    render(<AnswerCard result={makeQueryResponse()} onFocusSource={onFocusSource} />);

    const marker = screen.getByRole('button', { name: '1' });
    await userEvent.hover(marker);

    expect(onFocusSource).toHaveBeenCalledWith('item-1');
  });

  it('shows the relevance score as a percentage', () => {
    render(<AnswerCard result={makeQueryResponse()} onFocusSource={vi.fn()} />);
    expect(screen.getByText('82%')).toBeInTheDocument();
  });

  it('keeps retrieval internals collapsed until asked for', async () => {
    render(<AnswerCard result={makeQueryResponse()} onFocusSource={vi.fn()} />);

    expect(screen.queryByText('Chunks scanned')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /show retrieval detail/i }));

    expect(screen.getByText('Chunks scanned')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('1 of top 6')).toBeInTheDocument();
  });

  it('warns when the answer came from the extractive fallback', () => {
    const result = makeQueryResponse({
      answer: 'Extracted passage.',
      meta: { ...makeQueryResponse().meta, generator: 'extractive-fallback', model: 'none' },
    });

    render(<AnswerCard result={result} onFocusSource={vi.fn()} />);
    expect(screen.getByText(/Extractive mode/i)).toBeInTheDocument();
  });

  it('renders an answer with no citations as plain text', () => {
    const result = makeQueryResponse({
      answer: 'Nothing has been indexed yet.',
      citations: [],
      sources: [],
    });

    render(<AnswerCard result={result} onFocusSource={vi.fn()} />);

    expect(screen.getByLabelText('Answer')).toHaveTextContent('Nothing has been indexed yet.');
    expect(screen.queryByText(/^Sources/)).not.toBeInTheDocument();
  });

  it('leaves a marker as text when no citation matches it', () => {
    // Defensive: the server strips unknown markers, so this should not happen.
    // If it ever does, the answer must still render rather than crash.
    const result = makeQueryResponse({ answer: 'Claim from nowhere [9].' });

    render(<AnswerCard result={result} onFocusSource={vi.fn()} />);

    expect(screen.getByLabelText('Answer')).toHaveTextContent('Claim from nowhere [9].');
    expect(screen.queryByRole('button', { name: '9' })).not.toBeInTheDocument();
  });
});
