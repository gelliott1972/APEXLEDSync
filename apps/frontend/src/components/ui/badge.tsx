import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        // Status variants (matching StageStatus values) - uses badge-text CSS class for dark mode
        not_started: 'border-slate-500/50 bg-slate-500/30 badge-text',
        in_progress: 'border-orange-500/50 bg-orange-500/30 badge-text',
        engineer_review: 'border-purple-500/50 bg-purple-500/30 badge-text',
        client_review: 'border-blue-500/50 bg-blue-500/30 badge-text',
        complete: 'border-emerald-500/50 bg-emerald-500/30 badge-text',
        on_hold: 'border-red-500/50 bg-red-500/30 badge-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
