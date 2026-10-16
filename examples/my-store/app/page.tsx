export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem auto', maxWidth: '40rem', padding: '0 1rem' }}>
      <h1>my-store</h1>
      <p>
        This is the storefront (Next.js App Router), served at <code>/</code> through the Nest reverse-proxy.
      </p>
      <p>
        Open the admin at <a href="/admin">/admin</a>. Use <code>app/lib/cms.ts</code> when you want to load
        published entries from <code>/api/content/&lt;apiId&gt;</code>.
      </p>
      <p>
        Run <code>pnpm dev</code> to start the CMS and storefront.
      </p>
    </main>
  );
}
