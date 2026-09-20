'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { useCart } from '@/components/cart-provider';
import { db, firebaseConfigError } from '@/lib/firebase';
import { getProductHref } from '@/lib/product-route';
import { resolveClosestCategoryKey } from '@/lib/category-taxonomy';

type StoreProduct = {
  id: string;
  storeId?: string;
  productName?: string;
  name?: string;
  description?: string;
  imageUrls?: string[] | string;
  imageUrl?: string;
  image?: string;
  serviceImageUrls?: string[] | string;
  serviceImageUrl?: string;
  serviceImage?: string;
  imageAlt?: string;
  price?: number;
  currency?: string;
  categoryKey?: string;
  category?: string;
  itemType?: string;
  isVisible?: boolean | string | number;
  visible?: boolean | string | number;
  isPublished?: boolean | string | number;
  hidden?: boolean | string | number;
  isHidden?: boolean | string | number;
  deleted?: boolean | string | number;
  isDeleted?: boolean | string | number;
  listingType?: string;
  salesMode?: string;
  serviceKind?: string;
  enrollmentMode?: string;
  eventKind?: string;
  registrationMode?: string;
  linkedCourseId?: string;
  startAt?: string;
  endAt?: string;
  duration?: string;
  courseLevel?: string;
  mode?: string;
  classTimes?: string;
  registrationFee?: number;
  allowDepositPayment?: boolean;
  marketplaceEnabled?: boolean;
  capacity?: number;
  seatsRemaining?: number;
  location?: string;
};

type StoreProductsSectionProps = {
  storeId: string;
  storeName: string;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
};

const isExplicitlyTrue = (value: unknown) => normalizeBoolean(value) === true;
const isExplicitlyFalse = (value: unknown) => normalizeBoolean(value) === false;

const isPublicListing = (item: StoreProduct) => {
  if (isExplicitlyTrue(item.deleted) || isExplicitlyTrue(item.isDeleted)) return false;
  if (isExplicitlyTrue(item.hidden) || isExplicitlyTrue(item.isHidden)) return false;
  if (isExplicitlyFalse(item.visible) || isExplicitlyFalse(item.isVisible)) return false;
  return true;
};

const getProductName = (item: StoreProduct) => (item.productName ?? item.name)?.trim() || 'Untitled item';

const normalizeDisplayCurrency = (currency?: string) => {
  const normalizedCurrency = (currency ?? 'GHS').toUpperCase();
  return normalizedCurrency === 'USD' ? 'GHS' : normalizedCurrency;
};

const formatPrice = (price?: number, currency?: string) => {
  if (price == null) return 'Price unavailable';
  const displayCurrency = normalizeDisplayCurrency(currency);
  const currencyLabel = displayCurrency === 'GHS' ? 'Cedis (GH₵)' : displayCurrency;
  return `${currencyLabel} ${price.toFixed(2)}`;
};

const decodeImageValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => decodeImageValues(entry));
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.flatMap((entry) => decodeImageValues(entry));
    } catch {
      return [trimmed];
    }
  }
  return [trimmed];
};

const normalizeImageUrl = (value: string) => {
  const trimmed = value.trim().replace(/^['\"]+|['\"]+$/g, '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  if (!trimmed.toLowerCase().startsWith('gs://')) return trimmed;
  const withoutPrefix = trimmed.slice(5);
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex === -1) return '';
  const bucket = withoutPrefix.slice(0, slashIndex);
  const objectPath = withoutPrefix.slice(slashIndex + 1);
  return bucket && objectPath ? `https://storage.googleapis.com/${bucket}/${objectPath}` : '';
};

const isValidImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const getDisplayImages = (item: StoreProduct) => {
  const candidates = [item.imageUrls, item.imageUrl, item.image, item.serviceImageUrls, item.serviceImageUrl, item.serviceImage].flatMap((value) => decodeImageValues(value));
  return Array.from(new Set(candidates.map(normalizeImageUrl).filter(isValidImageUrl)));
};

const getCategory = (item: StoreProduct) =>
  resolveClosestCategoryKey({
    category: item.categoryKey?.trim() || item.category?.trim(),
    productName: getProductName(item),
    description: item.description,
    itemType: item.itemType,
  });

const lower = (value?: string) => value?.trim().toLowerCase();

const getListingType = (item: StoreProduct): 'product' | 'service' | 'course' | 'event' => {
  const listingType = lower(item.listingType);
  if (listingType === 'course') return 'course';
  if (listingType === 'event') return 'event';
  if (listingType === 'service') return 'service';
  if (listingType === 'product') return 'product';
  return lower(item.itemType) === 'service' ? 'service' : 'product';
};

const formatDateTime = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

function StoreProductAction({ product, imageUrl, storeId, storeName }: { product: StoreProduct; imageUrl: string; storeId: string; storeName: string }) {
  const cart = useCart();
  const isService = product.itemType?.trim().toLowerCase() === 'service';
  return (
    <button
      type="button"
      className="buyNowButton"
      onClick={() => cart.addItem({
        productId: product.id,
        merchantId: product.storeId || storeId,
        productName: getProductName(product),
        quantity: 1,
        type: isService ? 'SERVICE' : 'PRODUCT',
        price: product.price ?? null,
        currency: product.currency || 'GHS',
        imageUrl,
        storeName,
      })}
    >
      {isService ? 'Add service' : 'Add to cart'}
    </button>
  );
}

export function StoreProductsSection({ storeId, storeName }: StoreProductsSectionProps) {
  const [items, setItems] = useState<StoreProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadStoreProducts = async () => {
      if (!db) {
        setError(firebaseConfigError ?? 'Firebase is not configured.');
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const snapshot = await getDocs(query(collection(db, 'publicProducts'), where('storeId', '==', storeId), limit(120)));
        if (!active) return;
        const loaded = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as StoreProduct).filter((item) => isPublicListing(item) && getDisplayImages(item).length > 0);
        setItems(loaded);
      } catch (loadError) {
        console.error('Failed to load store products', loadError);
        if (!active) return;
        setError('Could not load this store’s products. Please try again.');
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadStoreProducts();
    return () => {
      active = false;
    };
  }, [storeId]);

  const productListings = useMemo(() => items.filter((item) => getListingType(item) === 'product'), [items]);
  const serviceListings = useMemo(() => items.filter((item) => getListingType(item) === 'service'), [items]);
  const courseListings = useMemo(
    () => items.filter((item) => getListingType(item) === 'course' || lower(item.enrollmentMode) === 'always_open'),
    [items],
  );
  const upcomingEvents = useMemo(
    () => items.filter((item) => getListingType(item) === 'event' || lower(item.enrollmentMode) === 'scheduled'),
    [items],
  );

  return (
    <section className="storeInfoCard" aria-label="Store products and services">
      <h2>Products &amp; Services from {storeName}</h2>
      <p>🚚 Delivery: Discuss with seller · 💳 Add items to cart and pay securely with Paystack checkout.</p>
      {isLoading ? <p>Loading store products…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!isLoading && !error && items.length === 0 ? <p>No products listed yet.</p> : null}
      {productListings.length > 0 ? <h3>Products ({productListings.length})</h3> : null}
      <div className="grid">
        {productListings.map((product) => {
          const imageUrl = getDisplayImages(product)[0] ?? 'https://placehold.co/640x640';
          const category = getCategory(product);
          return (
            <article key={product.id} className="card">
              <div className="imageWrap"><Image src={imageUrl} alt={product.imageAlt?.trim() || getProductName(product)} width={360} height={360} style={{ width: '100%', height: 'auto' }} /></div>
              <h3>{getProductName(product)}</h3>
              <p>{formatPrice(product.price, product.currency)}</p>
              {category ? <p className="trustScoreCard">{category}</p> : null}
              <div className="cardActions">
                <StoreProductAction product={product} imageUrl={imageUrl} storeId={storeId} storeName={storeName} />
                <Link href={getProductHref(product.id, product.productName ?? product.name)} className="contactStoreButton">View details</Link>
              </div>
            </article>
          );
        })}
      </div>
      {serviceListings.length > 0 ? <h3>Services ({serviceListings.length})</h3> : null}
      {serviceListings.length > 0 ? (
        <div className="grid">
          {serviceListings.map((service) => {
            const imageUrl = getDisplayImages(service)[0] ?? 'https://placehold.co/640x640';
            return (
              <article key={service.id} className="card">
                <div className="imageWrap"><Image src={imageUrl} alt={service.imageAlt?.trim() || getProductName(service)} width={360} height={360} style={{ width: '100%', height: 'auto' }} /></div>
                <h3>{getProductName(service)}</h3>
                <p>{formatPrice(service.price, service.currency)}</p>
                <div className="cardActions"><StoreProductAction product={service} imageUrl={imageUrl} storeId={storeId} storeName={storeName} /><Link href={getProductHref(service.id, service.productName ?? service.name)} className="contactStoreButton">View details</Link></div>
              </article>
            );
          })}
        </div>
      ) : null}
      {courseListings.length > 0 ? <h3>Courses / Programmes ({courseListings.length})</h3> : null}
      {courseListings.length > 0 ? (
        <div className="grid">
          {courseListings.map((course) => {
            const imageUrl = getDisplayImages(course)[0] ?? 'https://placehold.co/640x640';
            return (
              <article key={course.id} className="card">
                <div className="imageWrap"><Image src={imageUrl} alt={course.imageAlt?.trim() || getProductName(course)} width={360} height={360} style={{ width: '100%', height: 'auto' }} /></div>
                <h3>{getProductName(course)}</h3>
                <p>{formatPrice(course.price, course.currency)}</p>
                {course.duration ? <p><strong>Duration:</strong> {course.duration}</p> : null}
                {course.courseLevel ? <p><strong>Level:</strong> {course.courseLevel}</p> : null}
                {course.mode ? <p><strong>Mode:</strong> {course.mode}</p> : null}
                {course.classTimes ? <p><strong>Class times:</strong> {course.classTimes}</p> : null}
                <div className="cardActions"><Link href={getProductHref(course.id, course.productName ?? course.name)} className="buyNowButton">Register</Link></div>
              </article>
            );
          })}
        </div>
      ) : null}
      {upcomingEvents.length > 0 ? <h3>Upcoming ({upcomingEvents.length})</h3> : null}
      {upcomingEvents.length > 0 ? (
        <div className="grid">
          {upcomingEvents.map((event) => {
            const imageUrl = getDisplayImages(event)[0] ?? 'https://placehold.co/640x640';
            const startLabel = formatDateTime(event.startAt);
            return (
              <article key={event.id} className="card">
                <div className="imageWrap"><Image src={imageUrl} alt={event.imageAlt?.trim() || getProductName(event)} width={360} height={360} style={{ width: '100%', height: 'auto' }} /></div>
                <h3>{getProductName(event)}</h3>
                {startLabel ? <p><strong>Starts:</strong> {startLabel}</p> : null}
                {event.capacity != null ? <p><strong>Capacity:</strong> {event.capacity}</p> : null}
                {event.seatsRemaining != null ? <p><strong>Seats remaining:</strong> {event.seatsRemaining}</p> : null}
                <div className="cardActions"><Link href={getProductHref(event.id, event.productName ?? event.name)} className="buyNowButton">{event.linkedCourseId ? 'Register for this batch' : 'Reserve seat'}</Link></div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
