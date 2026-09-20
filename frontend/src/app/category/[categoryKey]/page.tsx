import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { PublicProductDetail } from '@/lib/public-products';
import { getProductsByCategory, listPublicCategoryKeys } from '@/lib/public-stores';
import { getProductHref } from '@/lib/product-route';
import { getStoreHref } from '@/lib/store-route';
import { buildSeoKeywords, canonicalUrlForPath, categoryNameFromKey, defaultSocialImageUrl } from '@/lib/seo';
import { getOptimizableImageSource } from '@/lib/next-image-source';

type CategoryPageProps = {
  params: { categoryKey: string };
  searchParams?: { page?: string };
};

const PAGE_SIZE = 24;
const PLACEHOLDER_IMAGE = '/sedifex-logo.svg';

const parsePage = (pageParam?: string) => {
  const parsed = Number.parseInt(pageParam ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const cleanDisplayText = (value?: string, maxLength = 150) => {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
};

const formatMoney = (price?: number, currency?: string) => {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'Price unavailable';
  const normalizedCurrency = (currency ?? 'GHS').toUpperCase();
  const symbol = normalizedCurrency === 'GHS' || normalizedCurrency === 'GHC' ? 'GH₵' : normalizedCurrency === 'USD' ? '$' : normalizedCurrency;
  return `${symbol} ${price.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getProductImage = (product: PublicProductDetail) => getOptimizableImageSource(product.imageUrls[0], PLACEHOLDER_IMAGE);

const getProductCity = (product: PublicProductDetail) =>
  product.publicLocationCity ?? product.deliveryOriginCity ?? product.city ?? product.publicLocationArea ?? product.deliveryOriginArea ?? product.area ?? 'Ghana';

const getDeliveryInfo = (product: PublicProductDetail) => {
  if (product.sameDayDeliveryAvailable) return product.sameDayCutoffTime ? `Same-day delivery · order by ${product.sameDayCutoffTime}` : 'Same-day delivery available';
  if (product.deliveryAvailable) return 'Delivery available';
  if (product.pickupAvailable) return 'Pickup available';
  return 'Delivery details confirmed by store';
};

const getCtaLabel = (product: PublicProductDetail) => {
  const listingType = product.listingType?.trim().toLowerCase() || product.itemType?.trim().toLowerCase();
  if (listingType === 'service' || listingType === 'booking' || listingType === 'appointment') return 'View service';
  if (listingType === 'course') return 'View course';
  return 'Buy / view details';
};

export async function generateStaticParams() {
  const categoryKeys = await listPublicCategoryKeys();
  return categoryKeys.map((categoryKey) => ({ categoryKey }));
}

export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
  const categoryName = categoryNameFromKey(params.categoryKey) || params.categoryKey;
  const page = parsePage(searchParams?.page);
  const canonicalPath = page > 1 ? `/category/${params.categoryKey}?page=${page}` : `/category/${params.categoryKey}`;
  const canonical = canonicalUrlForPath(canonicalPath);
  const title = `Buy ${categoryName} in Ghana | Sedifex`;
  const description = `Browse ${categoryName} products from verified stores on Sedifex. Order directly via WhatsApp.`;

  return {
    title,
    description,
    keywords: buildSeoKeywords(`${categoryName} in ghana`, `buy ${categoryName.toLowerCase()} online ghana`),
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      siteName: 'Sedifex',
      images: [{ url: defaultSocialImageUrl() }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [defaultSocialImageUrl()],
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const page = parsePage(searchParams?.page);
  const { products, hasMore } = await getProductsByCategory(params.categoryKey, { page, pageSize: PAGE_SIZE });
  const categoryName = categoryNameFromKey(params.categoryKey) || params.categoryKey;

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: (page - 1) * PAGE_SIZE + index + 1,
      url: canonicalUrlForPath(getProductHref(product.id, product.productName, product.listingType)),
      name: product.productName,
    })),
  };

  const prevHref =
    page > 2
      ? `/category/${encodeURIComponent(params.categoryKey)}?page=${page - 1}`
      : page === 2
        ? `/category/${encodeURIComponent(params.categoryKey)}`
        : null;
  const nextHref = hasMore ? `/category/${encodeURIComponent(params.categoryKey)}?page=${page + 1}` : null;

  return (
    <main className="hero" style={{ maxWidth: 1180 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <p className="eyebrow">Category</p>
      <h1>Buy {categoryName} in Ghana</h1>
      <p>Compare {categoryName.toLowerCase()} from verified Sedifex stores, check city availability, and open each product page for secure checkout or WhatsApp ordering.</p>

      <section aria-label={`${categoryName} products`} style={{ marginTop: 24 }}>
        <ul style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', listStyle: 'none', margin: 0, padding: 0 }}>
          {products.map((product) => {
            const productHref = getProductHref(product.id, product.productName, product.listingType);
            const storeHref = getStoreHref(product.storeId, product.storeName);
            const city = getProductCity(product);
            const shortDescription = cleanDisplayText(product.description) || 'Product details, availability, and fulfillment options are confirmed by the seller.';

            return (
              <li key={product.id}>
                <article style={{ display: 'grid', gap: 12, height: '100%', border: '1px solid #e2e8f0', borderRadius: 18, padding: 14, background: '#fff', boxShadow: '0 16px 35px -28px rgba(15, 23, 42, .75)' }}>
                  <Link href={productHref} style={{ display: 'block', position: 'relative', height: 210, overflow: 'hidden', borderRadius: 14, background: '#f1f5f9' }}>
                    <Image src={getProductImage(product)} alt={product.productName} loading="lazy" width={420} height={320} sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </Link>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {product.verified ? <span className="verifiedBadge">Verified store</span> : null}
                      <span style={{ borderRadius: 999, background: '#f8fafc', color: '#334155', fontSize: '.72rem', fontWeight: 800, padding: '.35rem .55rem' }}>{city}</span>
                    </div>

                    <h2 style={{ fontSize: '1.08rem', lineHeight: 1.25, margin: 0 }}>
                      <Link href={productHref} style={{ color: 'inherit', textDecoration: 'none' }}>{product.productName}</Link>
                    </h2>

                    <strong style={{ color: '#0f172a', fontSize: '1.25rem', letterSpacing: '-.03em' }}>{formatMoney(product.price, product.currency)}</strong>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '.9rem', lineHeight: 1.45 }}>{shortDescription}</p>

                    <div style={{ display: 'grid', gap: 4, color: '#475569', fontSize: '.84rem' }}>
                      <span>
                        Store:{' '}
                        {storeHref ? <Link href={storeHref} style={{ color: '#334155', fontWeight: 800 }}>{product.storeName}</Link> : <strong>{product.storeName}</strong>}
                      </span>
                      <span>Delivery: {getDeliveryInfo(product)}</span>
                    </div>

                    <Link href={productHref} className="btn btnPrimary" style={{ marginTop: 4, justifyContent: 'center' }}>{getCtaLabel(product)}</Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>

        {products.length === 0 ? (
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: 16, padding: 18, background: '#fff', marginTop: 16 }}>
            <h2>No {categoryName.toLowerCase()} found yet</h2>
            <p>Verified stores will appear here as soon as they publish matching products in this category.</p>
          </div>
        ) : null}
      </section>

      <nav aria-label="Category pagination" style={{ display: 'flex', gap: 12, marginTop: 18, alignItems: 'center' }}>
        {prevHref ? <Link href={prevHref}>Previous page</Link> : <span aria-disabled="true">Previous page</span>}
        <span>Page {page}</span>
        {nextHref ? <Link href={nextHref}>Next page</Link> : <span aria-disabled="true">Next page</span>}
      </nav>
    </main>
  );
}
