'use client';
// The admin with the page-builder blocks of this project (src/blocks). A client component: the block
// registry holds functions, which a server component cannot pass to AdminApp.
import AdminApp from '@opencloudcms/core/admin';
import blocks from '../../../src/blocks';

export default function AdminWithBlocks() {
  return <AdminApp blocks={blocks} />;
}
