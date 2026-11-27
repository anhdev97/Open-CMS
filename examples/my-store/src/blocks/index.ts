// Blocks of the page builder (/admin/pages): the core library plus the blocks of this store.
// This file is imported by the admin editor, the website renderer and the server (blockManifest in
// src/app.module.ts), so every block must be isomorphic: no server-only APIs, no data fetching in render
// (data comes in through b.entry / b.entries / b.link / b.image props), no CSS imports (Tailwind classes only).
//
// Blocks made in the admin Block Builder (Page builder > Blocks: ProductCard, ActiveProducts, the storefront
// StoreHeader, StoreHero, SectionHead, StoryBand, StoreFooter, the base page and overlay blocks StoreFrame,
// ContactModal, MobileMenu, the builder-component blocks HomeBanner, Faq, ProductTabs, ProductStrip, and Questions, a
// heading and a Collection list of `question` entries) live in
// src/blocks/<name>/<name>.block.ts and are listed in ./composed.ts, which the builder rewrites.
import { coreBlocks, defineBlocks } from '@opencloudcms/core/blocks';
import { composedBlocks } from './composed';
import ProductGrid from './product-grid/product-grid.block';

export default defineBlocks([...coreBlocks, ...composedBlocks, ProductGrid]);
