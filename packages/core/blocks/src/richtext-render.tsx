import type { FieldTransforms } from '@puckeditor/core';
import type { PuckConfig } from './types';
import { normalizeRichText } from './richtext';

/** Stored rich text as HTML, always through `normalizeRichText` (never the raw stored string). */
export function RichTextHtml({ html }: { html: unknown }) {
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: normalizeRichText(html) }} />;
}

/**
 * Puck `fieldTransforms` for `Render`: `richtext` props become sanitized HTML rendered in place. Without it Puck wraps
 * each one in a Suspense whose fallback writes the stored HTML unsanitized.
 */
export const richTextFieldTransforms: FieldTransforms<PuckConfig> = {
  richtext: ({ value }) => <RichTextHtml html={value} />,
};
