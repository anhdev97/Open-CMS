import { CircleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ApiError } from '@/lib/api-error';
import { formatIssue } from '@/lib/format-issue';

/** Shows an API (or plain) error: its message, plus every issue as `path: message`. Renders nothing for `null`. */
export function ErrorAlert({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const issues = 'issues' in error && Array.isArray(error.issues) ? error.issues : [];
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{error.message}</AlertTitle>
      {issues.length > 0 && (
        <AlertDescription>
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((issue, i) => (
              <li key={i}>{formatIssue(issue)}</li>
            ))}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
