import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cn } from '@/lib/utils';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn('z-50 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-card-hover animate-in fade-in-0 zoom-in-95', className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}
function ContextMenuItem({ className, variant, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return <ContextMenuPrimitive.Item data-variant={variant} className={cn("relative flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold outline-none focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:text-destructive", className)} {...props} />;
}
function ContextMenuSub(props: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub {...props} />;
}
function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger className={cn("flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold outline-none focus:bg-secondary data-[state=open]:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg:not([class*='size-'])]:size-4", className)} {...props}>
      {children}<span className="ml-auto text-muted-foreground">›</span>
    </ContextMenuPrimitive.SubTrigger>
  );
}
function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent className={cn('z-50 min-w-[10rem] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-card-hover animate-in fade-in-0 zoom-in-95', className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}
function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent };
