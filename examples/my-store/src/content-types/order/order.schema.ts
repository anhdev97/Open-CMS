// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencloudcms migrate:create`.
import { defineContentType, f } from '@opencloudcms/schema';

export default defineContentType({
  id: 'ct_order01',
  apiId: 'order',
  displayName: { 'en-US': 'Order', 'vi-VN': 'Đơn hàng' },
  group: 'shop',
  // Private: never served by /api/content, absent from the builders' type pickers, references and /media.
  // Orders are written by the server (scripts/seed-orders.ts, a checkout module) through PrivateEntriesService.
  private: true,
  fields: {
    code: f.text({ id: 'fld_order_code', required: true, unique: true }),
    // pending | paid | shipped | cancelled (no select field kind yet). Not `status`: that name is reserved for the
    // entry's draft/published status.
    orderStatus: f.text({ id: 'fld_order_status', required: true }),
    // readOnly: shown in the admin, written only by the server API.
    items: f.json({ id: 'fld_order_items', readOnly: true }),
    total: f.money({ id: 'fld_order_total', readOnly: true }),
    // Asset fields of a private type store private files (no /media URL, permission-checked download).
    invoice: f.asset({ id: 'fld_order_invoice', accept: ['application/pdf'] }),
  },
});
