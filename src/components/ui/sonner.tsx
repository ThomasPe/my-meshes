import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{ classNames: { toast: '!rounded-xl !border-border !bg-foreground !text-background !shadow-card-hover !font-semibold !text-[13px]', description: '!text-background/70' } }}
      {...props}
    />
  );
}

export { Toaster };
