import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root className={cn('inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-[3px]', className)} {...props} />;
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=on]:bg-foreground data-[state=on]:text-background [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

export { ToggleGroup, ToggleGroupItem };
