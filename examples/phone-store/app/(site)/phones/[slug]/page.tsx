import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator } from "@opencloudcms/core";
import {
  formatPrice,
  listBrands,
  listCategories,
  listPhones,
} from "../../content";
import { getSiteLocale } from "../../locale";
import { messages } from "../../messages";

export default async function PhonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const locale = await getSiteLocale();
  const t = createTranslator(messages, locale);
  const { slug } = await params;
  const [phones, brands, categories] = await Promise.all([
    listPhones(locale, { slug }),
    listBrands(locale),
    listCategories(locale),
  ]);
  console.log(phones);
  const phone = phones[0];
  if (!phone) notFound();
  const brand = brands.find((entry) => entry.documentId === phone.brand);
  const category = categories.find(
    (entry) => entry.documentId === phone.category,
  );
  const price = formatPrice(phone.price, locale);
  const specs = [
    [t("detail.brand"), brand?.name],
    [t("detail.category"), category?.name],
    [t("detail.storage"), phone.storageGb ? `${phone.storageGb} GB` : null],
    [t("detail.ram"), phone.ramGb ? `${phone.ramGb} GB` : null],
    [t("detail.color"), phone.color],
    [t("detail.screen"), phone.screen],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-6 py-10 md:grid-cols-2">
      <div className="flex aspect-square items-center justify-center rounded-xl bg-muted p-8">
        {phone.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={phone.image}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <Link
          href="/phones"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t("detail.back")}
        </Link>
        {brand?.name ? (
          <p className="text-sm uppercase tracking-wide text-muted-foreground">
            {brand.name}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">{phone.name}</h1>
        {price ? <p className="text-2xl">{price}</p> : null}
        {phone.description ? (
          <p className="whitespace-pre-wrap text-muted-foreground">
            {phone.description}
          </p>
        ) : null}
        <dl className="mt-2 divide-y rounded-xl border">
          {specs.map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-4 px-4 py-3 text-sm"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
