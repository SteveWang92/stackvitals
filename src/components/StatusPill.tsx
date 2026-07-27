import { AlertTriangle, CheckCircle2, CircleHelp } from 'lucide-react';
import { statusLabel } from '../lib/status';
import type { StatusLevel } from '../types';

export function StatusPill({ status }: { status: StatusLevel }) {
  const Icon = status === 'healthy' ? CheckCircle2 : status === 'unknown' ? CircleHelp : AlertTriangle;

  return (
    <span className={`status-pill status-${status}`}>
      <Icon aria-hidden="true" size={15} />
      {statusLabel[status]}
    </span>
  );
}
