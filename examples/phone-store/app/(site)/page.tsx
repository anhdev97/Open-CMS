import Link from "next/link";
import { createTranslator } from "@opencms/core";
import { PhoneCard } from "./components/phone-card";
import { formatPrice, listBrands, listPhones } from "./content";
import { getSiteLocale } from "./locale";
import { messages } from "./messages";

export default async function HomePage() {
  const locale = await getSiteLocale();
  const t = createTranslator(messages, locale);
  const [brands, featured] = await Promise.all([
    listBrands(locale),
    listPhones(locale, { featured: "true" }),
  ]);

  const brandName = new Map(
    brands.map((brand) => [brand.documentId, brand.name]),
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("brand")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("home.lead")}</p>
      </div>
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">{t("home.featured")}</h2>
          <Link
            href="/phones"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("catalog.title")}
          </Link>
        </div>
        {featured.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((phone) => (
              <PhoneCard
                key={phone.documentId}
                phone={phone}
                brandName={
                  phone.brand ? (brandName.get(phone.brand) ?? null) : null
                }
                price={formatPrice(phone.price, locale)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8">
            <p className="font-medium">{t("home.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("home.emptyHint")}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
