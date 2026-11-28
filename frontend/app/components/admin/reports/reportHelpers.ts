import type { AdminReportGroup } from '@brigadasos/nadeshiko-sdk';
import type { AdminTone } from '../ui/Badge.vue';

export type ReportGroup = AdminReportGroup;
export type ReportGroupItem = AdminReportGroup['reports'][number];

export const ALL_STATUSES = ['OPEN', 'PROCESSING', 'FIXED', 'DISMISSED'] as const;

export const statusTone = (status: string): AdminTone => {
  switch (status) {
    case 'OPEN':
      return 'warning';
    case 'PROCESSING':
      return 'info';
    case 'FIXED':
      return 'success';
    default:
      return 'neutral';
  }
};

export const sourceTone = (source: string): AdminTone => (source === 'USER' ? 'violet' : 'neutral');

/** Dot colour matching `statusTone`, for menus and segmented filters that draw a dot without a badge. */
export const statusDot = (status: string): string => {
  switch (statusTone(status)) {
    case 'warning':
      return 'bg-amber-400';
    case 'info':
      return 'bg-sky-400';
    case 'success':
      return 'bg-emerald-400';
    default:
      return 'bg-ink-faint';
  }
};
