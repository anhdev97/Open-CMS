// Custom logic for the product type. Never overwritten by the generator.
import { defineHooks } from '@opencms/core';

export default defineHooks('product', {
  beforePublish: async (doc) => {
    const price = doc.shared.price as { amount: number } | null;
    if (price && price.amount < 0) throw new Error('Price cannot be negative');
  },
  afterPublish: async (doc, ctx) => {
    // e.g. call Next.js revalidateTag('product') or push to a search index
    console.log(`[hooks] product ${doc.documentId} published (${Object.keys(doc.translations).join(', ') || 'no translations'})`);
  },
});
