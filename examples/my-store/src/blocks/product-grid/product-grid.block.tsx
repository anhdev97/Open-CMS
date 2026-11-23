// A store block: a grid of products, picked by hand or queried (e.g. the newest) in the page editor.
// `render` runs in the editor and on the website: it only formats the resolved `products` prop.
import { b, defineBlock, type ResolvedEntry } from '@opencloudcms/core/blocks';

// Tailwind only sees class names written out in full, so no `grid-cols-${columns}`.
const COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

function formatPrice(price: unknown): string | null {
  if (!price || typeof price !== 'object') return null;
  const { amount, currency } = price as { amount?: unknown; currency?: unknown };
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n) || typeof currency !== 'string') return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

function ProductCard({ product }: { product: ResolvedEntry }) {
  const price = formatPrice(product.price);
  return (
    <article className="flex flex-col gap-1 rounded-xl border bg-card px-5 py-4 text-card-foreground shadow-xs">
      <h3 className="font-semibold">{typeof product.name === 'string' ? product.name : product.documentId}</h3>
      {price ? <p className="text-sm text-muted-foreground">{price}</p> : null}
    </article>
  );
}

export default defineBlock({
  name: 'ProductGrid',
  label: { 'en-US': 'Product grid', 'vi-VN': 'Lưới sản phẩm' },
  category: 'commerce',
  icon: 'layout-grid',
  fields: {
    heading: b.text({ label: 'Heading', default: 'Featured' }),
    columns: b.select({ label: 'Columns', options: [2, 3, 4], default: 3 }),
    products: b.entries('product', { label: 'Products', limit: 12, sortable: true, filterable: true }),
  },
  render: ({ heading, columns, products }) => (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      {heading ? <h2 className="mb-6 text-2xl font-semibold tracking-tight">{heading}</h2> : null}
      {products.length ? (
        <div className={`grid gap-6 ${COLUMNS[columns]}`}>
          {products.map((p) => (
            <ProductCard key={p.documentId} product={p} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No products yet.</p>
      )}
    </section>
  ),
});
