import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap [&>svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-card text-secondary-foreground shadow-card',
      accent: 'bg-accent text-accent-foreground',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      destructive: 'bg-destructive/10 text-destructive',
      outline: 'border border-border bg-background text-muted-foreground',
      tag: 'bg-secondary text-secondary-foreground px-2.5 font-semibold text-xs',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
