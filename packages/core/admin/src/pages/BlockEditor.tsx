import { t } from '../i18n';
import { Link } from '../lib/nav';

/** Placeholder; the visual block editor arrives in a later task. */
export function BlockEditor() {
  return (
    <div className="p-6">
      <Link to="/settings/blocks" className="text-sm underline-offset-4 hover:underline">
        {t('blocks.back')}
      </Link>
    </div>
  );
}
