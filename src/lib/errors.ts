import { toast } from 'sonner';
import { openFeedback } from '@/features/feedback/feedback';
import i18n from '@/i18n';
import { isAppError } from '@/lib/types';

// Expected outcomes of a user action: a conflict, an offline share, a duplicate name. Only
// the rest looks like a bug worth a report button on the toast.
const EXPECTED = new Set(['sidecar_conflict', 'root_offline', 'root_exists', 'not_a_directory', 'invalid_pattern', 'invalid_name', 'already_exists', 'not_allowed', 'ai_disabled', 'ai_unauthorized', 'ai_rate_limited', 'ai_unavailable']);

/** Shows a translated toast for a backend error and returns its code (or 'unknown'). */
export function reportError(e: unknown): string {
  const code = isAppError(e) ? e.code : 'unknown';
  const message = isAppError(e) ? e.message : e instanceof Error ? e.message : String(e);
  const key = `errors.${code}`;
  const text = isAppError(e) && i18n.exists(key) ? i18n.t(key, { message }) : i18n.t('errors.generic', { message });
  const action = EXPECTED.has(code) ? undefined : { label: i18n.t('feedback.report'), onClick: () => openFeedback({ kind: 'bug', title: message.slice(0, 120), details: `Error \`${code}\`: ${message}\n\n` }) };
  toast.error(text, { action });
  return code;
}
