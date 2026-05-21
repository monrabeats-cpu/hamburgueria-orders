import { OrderStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/types';

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${STATUS_COLORS[status]} ${padding}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
