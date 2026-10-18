import { toast } from 'sonner';
import i18n from '@/i18n';
import { isAppError } from '@/lib/types';

/** Shows a translated toast for a backend error and returns its code (or 'unknown'). */
export function reportError(e: unknown): string {
  if (isAppError(e)) {
    const key = `errors.${e.code}`;
    toast.error(i18n.exists(key) ? i18n.t(key) : i18n.t('errors.generic', { message: e.message }));
    return e.code;
  }
  toast.error(i18n.t('errors.generic', { message: e instanceof Error ? e.message : String(e) }));
  return 'unknown';
}
