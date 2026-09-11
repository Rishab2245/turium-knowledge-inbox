import type { ItemStatus } from '../api/types';

const STYLES: Record<ItemStatus, { label: string; className: string }> = {
  pending: { label: 'Queued', className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  processing: { label: 'Indexing', className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  ready: { label: 'Indexed', className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
  failed: { label: 'Failed', className: 'bg-rose-100 text-rose-800 ring-rose-200' },
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  const { label, className } = STYLES[status];
  const isBusy = status === 'pending' || status === 'processing';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {isBusy && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
      {label}
    </span>
  );
}
