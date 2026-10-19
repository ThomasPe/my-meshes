import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Single-line text with an ellipsis that shows the full text in a tooltip, but only when it
 * is actually cut off (Explorer-style). Overflow is measured on hover, so resizing panels or
 * changing fonts never leaves a stale decision behind.
 */
export function Truncated({ text, className, as = 'span', delay = 350, ...rest }: { text: string; className?: string; as?: 'span' | 'div' | 'h4' | 'h1'; delay?: number } & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'>) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const Tag = as as 'span';
  const enter = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setOpen(false); };
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Tooltip open={open} onOpenChange={(o) => { if (!o) leave(); }}>
      <TooltipTrigger asChild>
        <Tag ref={ref} className={cn('block min-w-0 truncate', className)} onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave} data-truncated={open || undefined} {...rest}>{text}</Tag>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[60ch] break-words" data-testid="truncated-tooltip">{text}</TooltipContent>
    </Tooltip>
  );
}
