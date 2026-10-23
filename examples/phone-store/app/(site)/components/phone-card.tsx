import Link from 'next/link';
import type { Phone } from '../content';

export function PhoneCard({
  phone,
  brandName,
  price,
}: {
  phone: Phone;
  brandName: string | null;
  price: string | null;
}) {
  return (
    <Link
      href={`/phones/${phone.slug}`}
      className="flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40"
    >
      <span className="flex aspect-square items-center justify-center bg-muted p-6">
        {phone.image ? (
          // Scraped files live in public/phones and are served as static paths.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={phone.image} alt="" className="max-h-full max-w-full object-contain" />
        ) : null}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-4">
        {brandName ? <span className="text-xs uppercase tracking-wide text-muted-foreground">{brandName}</span> : null}
        <span className="font-medium">{phone.name}</span>
        <span className="mt-auto pt-2 text-sm">
          {price}
          {phone.storageGb ? <span className="text-muted-foreground"> · {phone.storageGb} GB</span> : null}
        </span>
      </span>
    </Link>
  );
}
