import { defineHooks } from "@opencloudcms/core";

export default defineHooks("product", {
  beforePublish: async (doc) => {
    const price = doc.shared.price as { amount: number } | null;
    if (price && price.amount < 0) throw new Error("Price cannot be negative");
  },
  afterPublish: async (doc, ctx) => {
    console.log(
      `[hooks] product ${doc.documentId} published (${Object.keys(doc.translations).join(", ") || "no translations"})`,
    );
  },
});
