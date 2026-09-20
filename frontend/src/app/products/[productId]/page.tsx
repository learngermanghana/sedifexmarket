import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormattedDescription } from '@/components/formatted-description';
import { ShareButton } from '@/components/share-button';
import { ProductPurchasePanel } from '@/components/product-purchase-panel';
import { ServiceBookingPanel } from '@/components/service-booking-panel';
import { ProductEngagementPanel } from '@/components/product-engagement-panel';
import { getPublicProductById } from '@/lib/public-products';
import { getStoreProfileById } from '@/lib/public-stores';
import { getStoreHref, getStoreRouteId } from '@/lib/store-route';
import { buildSeoKeywords, canonicalUrlForPath, defaultSocialImageUrl } from '@/lib/seo';
import { extractProductIdFromRouteParam, getProductHref } from '@/lib/product-route';
import { getFulfillmentOptions } from '@/lib/fulfillment-options';
import { listIntegrationProducts } from '@/lib/sedifex-integration-api';
import { RelatedMarketplaceItems } from '@/components/related-marketplace-items';
import { getOptimizableImageSource } from '@/lib/next-image-source';

type ProductPageProps = {
  params: { productId: string };
};

const buildLocation = (city?: string, country?: string) => {
  const parts = [city, country].filter(Boolean);
  if (parts.length === 0) return '';
  return ` in ${parts.join(', ')}`;
};

const buildLocationLabel = (...values: Array<string | undefined | null>) => {
  const parts = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return Array.from(new Set(parts)).join(', ');
};

const normalizeDisplayCurrency = (currency?: string) => {
  const normalizedCurrency = (currency ?? 'GHS').toUpperCase();
  return normalizedCurrency === 'USD' ? 'GHS' : normalizedCurrency;
};

const sanitizePhoneForTel = (value?: string) => {
  if (!value) return '';
  return value.replace(/[^\d+]/g, '');
};

const SEDIFEX_CALL_TO_ORDER_PHONE = '059 505 4266';
const SEDIFEX_CALL_TO_ORDER_TEL = sanitizePhoneForTel(SEDIFEX_CALL_TO_ORDER_PHONE);
const SEDIFEX_CALL_TO_ORDER_WHATSAPP = '233595054266';

const normalizedValues = (input: { itemType?: string; listingType?: string; serviceKind?: string; salesMode?: string }) =>
  [input.itemType, input.listingType, input.serviceKind, input.salesMode].map((v) => (v ?? '').trim().toLowerCase());

const isCourseLikeItem = (input: { itemType?: string; listingType?: string; serviceKind?: string; salesMode?: string }) =>
  normalizedValues(input).some((value) => ['course', 'class', 'training', 'registration', 'course_enrollment'].includes(value));

const isServiceLikeItem = (input: { itemType?: string; listingType?: string; serviceKind?: string; salesMode?: string }) => {
  const values = normalizedValues(input);
  return values.some((value) => ['service', 'course', 'event', 'appointment', 'booking', 'class', 'training', 'registration', 'course_enrollment'].includes(value));
};

const buildBookingExplainer = (input: { isCourse: boolean; storeName: string; hasWebsite: boolean }) => {
  if (input.isCourse) {
    return {
      title: 'How to register',
      heading: 'Register through the school website',
      body: `Visit ${input.storeName} website, open the registration or courses page, select this course, and complete your registration directly with the school. Sedifex Market does not take course payments on this page.`,
      steps: ['Visit the school website.', 'Open Registration, Courses, or Apply.', 'Select this course.', 'Complete registration directly with the school.'],
      websiteLabel: 'Visit school website',
      missingWebsite: 'This school has not added a website link yet. Contact the school directly to complete registration.',
    };
  }

  return {
    title: 'How to book',
    heading: 'Book through the business website',
    body: `Visit ${input.storeName} website, open the booking or services page, select this service, and complete your booking directly with the business. Sedifex Market does not take service payments on this page.`,
    steps: ['Visit the business website.', 'Open Booking, Services, or Appointments.', 'Select this service.', 'Complete booking directly with the business.'],
    websiteLabel: 'Visit business website',
    missingWebsite: 'This business has not added a website link yet. Contact the business directly to complete booking.',
  };
};

const buildMetadataDescription = (input: {
  productName: string;
  storeName: string;
  city?: string;
  country?: string;
  currency?: string;
  price?: number;
}) => {
  const location = buildLocation(input.city, input.country);
  const displayCurrency = normalizeDisplayCurrency(input.currency);
  const currencyLabel = displayCurrency === 'GHS' ? 'Cedis (GH₵)' : displayCurrency;
  const priceText = input.price == null ? 'Price unavailable' : `${currencyLabel} ${input.price}`;
  return `Buy ${input.productName} from verified store ${input.storeName}${location}. Price: ${priceText}. Secure checkout on Sedifex Market.`;
};

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const normalizedProductId = extractProductIdFromRouteParam(params.productId);
  const product = await getPublicProductById(normalizedProductId);

  if (!product) {
    return {
      title: 'Product not found | Sedifex Market',
      description: 'The requested product could not be found on Sedifex Market.',
      robots: { index: false, follow: false },
    };
  }

  const canonicalPath = getProductHref(product.id, product.productName, product.listingType);
  const canonicalUrl = canonicalUrlForPath(canonicalPath);
  const title = `${product.productName}${buildLocation(product.city)} | ${product.storeName} | Sedifex Market`;
  const description = buildMetadataDescription(product);
  const socialImages = product.imageUrls.length > 0 ? product.imageUrls.map((url) => ({ url })) : [{ url: defaultSocialImageUrl() }];

  return {
    title,
    description,
    keywords: buildSeoKeywords(
      `${product.productName.toLowerCase()} ghana`,
      `${product.storeName.toLowerCase()} products`,
      product.categoryKey ? `${product.categoryKey.toLowerCase()} ghana` : 'buy products online ghana',
    ),
    alternates: { canonical: canonicalUrl },
    openGraph: { type: 'website', url: canonicalUrl, title, description, siteName: 'Sedifex Market', images: socialImages },
    twitter: { card: 'summary_large_image', title, description, images: socialImages.map((image) => image.url) },
  };
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const normalizedProductId = extractProductIdFromRouteParam(params.productId);
  const product = await getPublicProductById(normalizedProductId);

  if (!product) notFound();

  const storeProfile = product.storeId ? await getStoreProfileById(product.storeId) : null;
  const resolvedStoreName = storeProfile?.storeName ?? product.storeName;
  const publicLocation = buildLocationLabel(
    storeProfile?.area,
    product.publicLocationArea ?? product.area,
    storeProfile?.city ?? product.publicLocationCity ?? product.city,
    storeProfile?.country ?? product.publicLocationCountry ?? product.country,
  ) || 'Location unavailable';
  const deliveryOrigin = buildLocationLabel(
    product.deliveryOriginArea ?? product.publicLocationArea ?? storeProfile?.area ?? product.area,
    product.deliveryOriginCity ?? product.publicLocationCity ?? storeProfile?.city ?? product.city,
    product.deliveryOriginCountry ?? product.publicLocationCountry ?? storeProfile?.country ?? product.country,
  ) || publicLocation;
  const pickupLocation = product.pickupAddress || storeProfile?.addressLine1 || publicLocation;
  const originalPrice = typeof (product as { originalPrice?: number }).originalPrice === 'number' ? (product as { originalPrice?: number }).originalPrice : null;
  const hasSedifexDeal = originalPrice != null && product.price != null && product.price < originalPrice;
  const resolvedStoreId = getStoreRouteId(storeProfile?.storeId ?? product.storeId, resolvedStoreName);
  const storeHref = getStoreHref(resolvedStoreId ?? undefined, resolvedStoreName);
  const hasStorePage = Boolean(storeHref);
  const hasWebsite = Boolean(storeProfile?.websiteUrl);
  const isVerifiedStore = storeProfile?.verified ?? product.verified ?? false;
  const checkoutProductId = product.sourceProductId?.trim() || product.id;
  const productListingType = (product as { listingType?: string }).listingType;
  const productServiceKind = (product as { serviceKind?: string }).serviceKind;
  const serviceLike = isServiceLikeItem({ itemType: product.itemType, listingType: productListingType, serviceKind: productServiceKind, salesMode: (product as { salesMode?: string }).salesMode });
  const courseLike = isCourseLikeItem({ itemType: product.itemType, listingType: productListingType, serviceKind: productServiceKind, salesMode: (product as { salesMode?: string }).salesMode });
  const bookingExplainer = serviceLike ? buildBookingExplainer({ isCourse: courseLike, storeName: resolvedStoreName, hasWebsite }) : null;

  const [sameStoreSameCategory, sameCategoryMarketplace, sameStoreItems, marketplaceFallback] = await Promise.all([
    listIntegrationProducts({ storeId: product.storeId, categoryKey: product.categoryKey, pageSize: 12, sort: 'latest' }).catch(() => ({ items: [] })),
    listIntegrationProducts({ categoryKey: product.categoryKey, pageSize: 24, sort: 'store-diverse' }).catch(() => ({ items: [] })),
    listIntegrationProducts({ storeId: product.storeId, pageSize: 24, sort: 'latest' }).catch(() => ({ items: [] })),
    listIntegrationProducts({ page: 1, pageSize: 60, sort: 'store-diverse' }).catch(() => ({ items: [] })),
  ]);

  const relatedPool = Array.from(new Map([...sameStoreSameCategory.items, ...sameCategoryMarketplace.items, ...sameStoreItems.items, ...marketplaceFallback.items]
    .filter((item) => item.id && item.id !== product.id)
    .map((item) => [item.id, item])).values()).map((item) => ({
      id: item.id,
      storeId: item.storeId,
      storeName: item.storeName,
      productName: item.productName,
      categoryKey: item.categoryKey,
      itemType: (item as { itemType?: string }).itemType,
      price: item.price,
      currency: item.currency,
      imageUrls: item.imageUrls,
      listingType: (item as { listingType?: string }).listingType,
      serviceKind: (item as { serviceKind?: string }).serviceKind,
      salesMode: (item as { salesMode?: string }).salesMode,
      marketplaceEnabled: (item as { marketplaceEnabled?: boolean }).marketplaceEnabled,
      public: (item as { public?: boolean }).public,
    }));

  const productPath = getProductHref(product.id, product.productName, productListingType);
  const productUrl = canonicalUrlForPath(productPath);
  const sedifexWhatsAppText = encodeURIComponent(`Hello Sedifex, I want to order ${product.productName} from ${resolvedStoreName}. Product link: ${productUrl}`);
  const storeUrl = storeHref ? canonicalUrlForPath(storeHref) : undefined;
  const availability = typeof product.stockCount === 'number' && product.stockCount <= 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock';
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': `${productUrl}#product`,
      name: product.productName,
      description: product.description,
      ...(product.imageUrls.length > 0 ? { image: product.imageUrls } : {}),
      ...(product.sku ? { sku: product.sku } : {}),
      brand: { '@type': 'Brand', name: resolvedStoreName },
      seller: { '@type': 'Organization', name: resolvedStoreName, ...(storeUrl ? { url: storeUrl } : {}) },
      ...(product.categoryKey ? { category: product.categoryKey } : {}),
      offers: {
        '@type': 'Offer',
        url: productUrl,
        priceCurrency: normalizeDisplayCurrency(product.currency),
        ...(product.price != null ? { price: product.price.toFixed(2) } : {}),
        availability,
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: resolvedStoreName },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalUrlForPath('/') },
        ...(storeUrl ? [{ '@type': 'ListItem', position: 2, name: resolvedStoreName, item: storeUrl }] : []),
        { '@type': 'ListItem', position: storeUrl ? 3 : 2, name: product.productName, item: productUrl },
      ],
    },
  ];

  const displayCurrency = normalizeDisplayCurrency(product.currency);
  const currencyLabel = displayCurrency === 'GHS' ? 'Cedis (GH₵)' : displayCurrency;
  const priceLabel = product.price == null ? 'Price unavailable' : `${currencyLabel} ${product.price.toFixed(2)}`;
  const availabilityLabel = typeof product.stockCount === 'number' ? (product.stockCount > 0 ? 'In stock' : 'Out of stock') : undefined;
  const fulfillmentOptions = serviceLike ? [] : getFulfillmentOptions();
  const sameDayFulfillment = fulfillmentOptions[0];
  const cutoffLabel = product.sameDayCutoffTime || '4:00 PM';
  const deliveryBadgeText = product.sameDayDeliveryAvailable === false ? 'Delivery fee confirmed before dispatch' : sameDayFulfillment?.available ? `Same-day delivery before ${cutoffLabel}` : `Delivery tomorrow after ${cutoffLabel}`;
  const deliveryHelperText = deliveryOrigin !== 'Location unavailable'
    ? `This item ships from ${deliveryOrigin}. Delivery fee depends on your area and will be shown or confirmed before dispatch.`
    : 'Delivery fee depends on your location and may be confirmed manually by Sedifex support before dispatch.';
  const localSeoLocation = buildLocationLabel(
    storeProfile?.city ?? product.publicLocationCity ?? product.city,
    storeProfile?.country ?? product.publicLocationCountry ?? product.country,
  );
  const visibleSeoHeading = localSeoLocation
    ? `${serviceLike ? (courseLike ? 'Register for' : 'Book') : 'Buy'} ${product.productName} in ${localSeoLocation}`
    : `${serviceLike ? (courseLike ? 'Register for' : 'Book') : 'Buy'} ${product.productName} on Sedifex Market`;
  const visibleSeoCheckoutText = serviceLike
    ? `${courseLike ? 'Registration' : 'Booking'} is completed directly on the ${courseLike ? 'school' : 'business'} website`
    : 'Secure checkout with instant receipt';

  return (
    <main className="productDetailPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="productDetailContent">
        <div className="productDetailMainColumn">
          <section className="productSummaryCard">
            {product.imageUrls.length > 0 ? (
              <section className="productImageGrid" aria-label="Product images">
                {product.imageUrls.map((imageUrl) => (
                  <Image key={imageUrl} src={getOptimizableImageSource(imageUrl)} alt={product.imageAlt?.trim() || `${product.productName} at ${resolvedStoreName}`} loading="lazy" className="productDetailImage" width={480} height={480} sizes="(max-width: 768px) 100vw, 33vw" />
                ))}
              </section>
            ) : null}
            <div>
              <h1>{product.productName}</h1>
              <p className="productTrustLine"><strong>{resolvedStoreName}</strong> {isVerifiedStore ? <span className="verifiedBadge">Verified store</span> : null}</p>
            </div>

            <section className="productLocalSeoCard" aria-label="Local purchase and checkout details">
              <h2>{visibleSeoHeading}</h2>
              <ul>
                <li>Available from {isVerifiedStore ? 'verified store' : 'listed store'} {resolvedStoreName}</li>
                {!serviceLike ? <li>{product.sameDayDeliveryAvailable === false ? 'Delivery timing confirmed before dispatch where available' : 'Same-day delivery before 4PM where available'}</li> : null}
                <li>{visibleSeoCheckoutText}</li>
              </ul>
            </section>

            <div className="productStats">
              <p className="productPriceLine">{priceLabel}</p>
              {!serviceLike ? (
                <div aria-label="Delivery and pickup options" style={{ border: '1px solid #bfdbfe', background: 'linear-gradient(135deg, #eff6ff, #f0fdf4)', borderRadius: 18, padding: '12px 14px', display: 'grid', gap: 8 }}>
                  <strong style={{ color: '#0f172a' }}>🚚 {deliveryBadgeText}</strong>
                  <span style={{ color: '#334155' }}>📍 Ships from: <strong>{deliveryOrigin}</strong></span>
                  <span style={{ color: '#334155' }}>🏬 Pickup area: {pickupLocation}</span>
                  <small style={{ color: '#64748b', lineHeight: 1.55 }}>{deliveryHelperText}</small>
                  <small style={{ color: '#64748b', lineHeight: 1.55 }}>If delivery fee is confirmed manually and you do not accept it, you may cancel for a refund before dispatch.</small>
                </div>
              ) : null}
              {hasSedifexDeal ? <p><strong>Sedifex online deal:</strong> Order through Sedifex to get this price.</p> : null}
              <p className="productTrustMessage">{serviceLike ? `${courseLike ? 'Registration' : 'Booking'} and any payment happen directly on the ${courseLike ? 'school' : 'business'} website; Sedifex Market does not take payment for this listing.` : 'Verified checkout and payment record on Sedifex.'}</p>
              {availabilityLabel && !serviceLike ? <p><strong>Availability:</strong> {availabilityLabel}</p> : null}
              {product.categoryKey ? <p><strong>Category:</strong> <Link href={`/category/${encodeURIComponent(product.categoryKey)}`}>{product.categoryKey}</Link></p> : null}
            </div>

            {bookingExplainer ? (
              <section className="productContentSection bookingExplainerCard" aria-label={bookingExplainer.title}>
                <p className="eyebrow">{bookingExplainer.title}</p>
                <h2>{bookingExplainer.heading}</h2>
                <p>{bookingExplainer.body}</p>
                <ol>{bookingExplainer.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                {hasWebsite ? <a className="requestButton bookingExplainerButton" href={storeProfile?.websiteUrl} target="_blank" rel="noopener noreferrer">{bookingExplainer.websiteLabel}</a> : <p className="requestFeedback error">{bookingExplainer.missingWebsite}</p>}
              </section>
            ) : null}

            <section className="productContentSection" aria-label="About this product">
              <h2>{serviceLike ? `About this ${courseLike ? 'course' : 'service'}` : 'About this product'}</h2>
              {product.description ? <FormattedDescription text={product.description} className="formattedDescription" /> : <p>No description available for this {serviceLike ? (courseLike ? 'course' : 'service') : 'product'} yet.</p>}
            </section>
          </section>

          {!serviceLike ? (
            <section className="productStoreCard" aria-label="Sedifex call to order" style={{ border: '1px solid #fed7aa', background: 'linear-gradient(135deg, #fff7ed, #ffffff)' }}>
              <p className="eyebrow">Call to order</p>
              <h2>Need help placing this order?</h2>
              <p>Call or WhatsApp Sedifex on <strong>{SEDIFEX_CALL_TO_ORDER_PHONE}</strong>. We will help you place this order on Sedifex Market, confirm delivery or pickup, and keep the order record on Sedifex.</p>
              <div className="productStoreActions">
                <a className="requestButton" href={`tel:${SEDIFEX_CALL_TO_ORDER_TEL}`}>Call Sedifex</a>
                <a className="secondaryButton" href={`https://wa.me/${SEDIFEX_CALL_TO_ORDER_WHATSAPP}?text=${sedifexWhatsAppText}`} target="_blank" rel="noopener noreferrer">WhatsApp Sedifex</a>
              </div>
              <p className="checkoutHint">Store phone numbers are not shown before Sedifex checkout so the sale stays inside Sedifex Market.</p>
            </section>
          ) : null}

          <section className="productStoreCard" aria-label="Store contact details">
            <h2>{courseLike ? 'School information' : serviceLike ? 'Business information' : 'Store information'}</h2>
            <p><strong>Name:</strong> {resolvedStoreName} {isVerifiedStore ? <span className="verifiedBadge">Verified</span> : null}</p>
            <p><strong>Store area:</strong> {publicLocation}</p>
            {!serviceLike ? <p><strong>Delivery from:</strong> {deliveryOrigin}</p> : null}
            {!serviceLike ? <p><strong>Pickup area:</strong> {pickupLocation}</p> : null}
            <p><strong>Sedifex connection:</strong> {serviceLike ? `Sedifex Market lists this ${courseLike ? 'course' : 'service'} for discovery. Customers continue to the ${courseLike ? 'school' : 'business'} website for ${courseLike ? 'registration' : 'booking'} and any payment.` : 'Customers can order through Sedifex Market or use the Sedifex call-to-order number for help placing the order.'}</p>
            <div className="productStoreActions">
              {hasStorePage ? <Link href={storeHref ?? '#'}>View store details</Link> : null}
              <ShareButton className="secondaryButton" url={productPath} title={product.productName || 'Product on Sedifex'} text={`Check out ${product.productName || 'this product'} on Sedifex.`} label="Share product" />
              {hasWebsite ? <a href={storeProfile?.websiteUrl} target="_blank" rel="noopener noreferrer">{courseLike ? 'Visit school website' : serviceLike ? 'Visit business website' : 'Visit store website'}</a> : null}
            </div>
          </section>

          {!serviceLike ? (
            <section className="productStoreCard" aria-label="Verified store trust details" style={{ border: '1px solid #bbf7d0', background: 'linear-gradient(135deg, #f0fdf4, #ffffff)' }}>
              <p className="eyebrow">Verified Store</p>
              <h2>Buy with a Sedifex order record</h2>
              <p>Pay safely through Sedifex first. After payment, you receive an order record, receipt, and store follow-up details.</p>
              <ul>
                <li>{isVerifiedStore ? 'Verified store listing' : 'Store listed on Sedifex Market'}</li>
                <li>Store area shown: {publicLocation}</li>
                <li>Delivery origin shown: {deliveryOrigin}</li>
                <li>Secure Paystack checkout</li>
                <li>Sedifex payment and order record</li>
                <li>Receipt after payment</li>
              </ul>
              <p className="checkoutHint">If there is an issue, Sedifex can help trace the store, order, and payment record.</p>
            </section>
          ) : null}

          <section className="productStoreCard productWhyCard" aria-label={serviceLike ? 'Why use Sedifex discovery' : 'Why order through Sedifex'}>
            <h2>{serviceLike ? `Why find this ${courseLike ? 'course' : 'service'} on Sedifex` : 'Why buy on Sedifex'}</h2>
            {serviceLike ? (
              <ul><li>Verified {courseLike ? 'school' : 'business'} listing</li><li>Direct link to the official {courseLike ? 'school' : 'business'} website where available</li><li>No Sedifex Market payment is collected for this {courseLike ? 'course' : 'service'}</li><li>Customers complete {courseLike ? 'registration' : 'booking'} directly with the {courseLike ? 'school' : 'business'}</li></ul>
            ) : (
              <ul><li>Verified store listing</li><li>Order receipt</li><li>Payment record</li><li>Store follow-up</li><li>Sedifex support if there is an issue</li></ul>
            )}
            <p className="checkoutHint">{serviceLike ? `Use the official ${courseLike ? 'school' : 'business'} website button above to continue.` : <>Need urgent help after placing an order? Call Sedifex on <a href={`tel:${SEDIFEX_CALL_TO_ORDER_TEL}`}>{SEDIFEX_CALL_TO_ORDER_PHONE}</a>.</>}</p>
          </section>

          <ProductEngagementPanel publicProductId={product.id} storeId={product.storeId} sourceProductId={product.sourceProductId} isPublished={product.isPublished} />
          <RelatedMarketplaceItems currentItemId={product.id} currentStoreId={product.storeId} currentCategory={product.categoryKey} currentListingType={productListingType ?? product.itemType} currentItemType={product.itemType} currentServiceKind={productServiceKind} currentPrice={product.price} items={relatedPool} />
        </div>

        {serviceLike ? (
          <ServiceBookingPanel productId={checkoutProductId} merchantId={product.storeId ?? ''} productName={product.productName} price={product.price} currency={product.currency} whatsappPhone={storeProfile?.storeWhatsapp ?? storeProfile?.storePhone ?? product.waLink} storeName={resolvedStoreName} storeWebsiteUrl={storeProfile?.websiteUrl} listingType={productListingType} itemType={product.itemType} />
        ) : (
          <ProductPurchasePanel productId={checkoutProductId} merchantId={product.storeId ?? ''} productName={product.productName} storeName={resolvedStoreName} itemType={product.itemType} price={product.price} currency={product.currency} imageUrl={product.imageUrls[0]} deliveryOrigin={deliveryOrigin} pickupAvailable={product.pickupAvailable} deliveryAvailable={product.deliveryAvailable} sameDayDeliveryAvailable={product.sameDayDeliveryAvailable} sameDayCutoffTime={product.sameDayCutoffTime} />
        )}
      </div>
    </main>
  );
}
