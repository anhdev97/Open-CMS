export default function HomePage() {
  return (
    <main data-opencms-site="" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">my-store</h1>
      <p className="text-muted-foreground">A website and its OpenCMS admin, served by one Next.js app.</p>
      <p>
        <a
          href="/admin"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open admin
        </a>
      </p>
    </main>
  );
}
