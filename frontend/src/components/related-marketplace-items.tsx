'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { getProductHref } from '@/lib/product-route';
import { getOptimizableImageSource } from '@/lib/next-image-source';

type MarketplaceItem = {
  id: string;
  storeId?: string;
  storeName?: string;
  productName?: string;
  name?: string;
  categoryKey?: string;
  category?: string;
  marketCategory?: string;
  listingType?: string;
  itemType?: string;
  serviceKind?: string;
  salesMode?: string;
  price?: number;
  currency?: string;
  marketplaceEnabled?: boolean;
  public?: boolean;
  verified?: boolean;
  imageUrls?: string[];
  imageUrl?: string;
};

type RelatedMarketplaceItemsProps = {
  currentItemId: string;
  currentStoreId?: string;
  currentCategory?: string;
  currentListingType?: string;
  currentItemType?: string;
  currentServiceKind?: string;
  currentPrice?: number;
  items: MarketplaceItem[];
  title?: string;
  limit?: number;
};

const lower = (value?: string) => value?.trim().toLowerCase() ?? '';
const getName = (item: MarketplaceItem) => item.productName?.trim() || item.name?.trim() || 'Untitled item';
const getCategory = (item: MarketplaceItem) => item.categoryKey?.trim() || item.category?.trim() || item.marketCategory?.trim() || 'General';
const getImage = (item: MarketplaceItem) => item.imageUrls?.[0]?.trim() || item.imageUrl?.trim() || '';
const getKind = (item: MarketplaceItem) => {
  const listingType = lower(item.listingType);
  if (['product', 'service', 'course', 'event'].includes(listingType)) return listingType;
  return lower(item.itemType) === 'service' ? 'service' : 'product';
};

const getBadge = (item: MarketplaceItem) => {
  const kind = getKind(item);
  if (kind === 'course') return 'Course';
  if (kind === 'event') return 'Event';
  if (kind === 'service') return 'Service';
  return 'Product';
};

const getCta = (item: MarketplaceItem) => {
  const kind = getKind(item);
  if (kind === 'service') return 'Book service';
  if (kind === 'course' || kind === 'event') return 'Register';
  return 'Buy now';
};

const scoreItem = (item: MarketplaceItem, current: RelatedMarketplaceItemsProps) => {
  const currentKind = lower(current.currentListingType) || lower(current.currentItemType) || 'product';
  const itemKind = getKind(item);
  const sameCategory = lower(getCategory(item)) === lower(current.currentCategory);
  const sameServiceKind = lower(item.serviceKind) === lower(current.currentServiceKind);
  const hasImage = Boolean(getImage(item));
  const hasPrice = typeof item.price === 'number' && Number.isFinite(item.price);
  const sameStore = Boolean(item.storeId && item.storeId === current.currentStoreId);

  let score = 0;
  if (sameStore) score += 50;
  if (sameCategory) score += 45;
  if (itemKind === currentKind) score += 42;
  if (sameServiceKind) score += 20;
  if (hasImage) score += 16;
  if (hasPrice) score += 12;
  if (item.marketplaceEnabled !== false) score += 8;
  if (item.public !== false) score += 8;
  if (item.verified) score += 5;

  if (current.currentPrice && hasPrice) {
    const min = current.currentPrice * 0.65;
    const max = current.currentPrice * 1.35;
    if ((item.price ?? 0) >= min && (item.price ?? 0) <= max) score += 10;
  }

  if (currentKind === 'product' && itemKind !== 'product') score -= 30;
  if (currentKind !== 'product' && itemKind === 'product') score -= 10;

  return score;
};

export function RelatedMarketplaceItems(props: RelatedMarketplaceItemsProps) {
  const currentKind = lower(props.currentListingType) || lower(props.currentItemType) || 'product';

  const rankedItems = useMemo(
    () => props.items
      .filter((item) => item.id !== props.currentItemId)
      .map((item) => ({ item, score: scoreItem(item, props) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item),
    [props],
  );

  const sections = useMemo(() => {
    const sectionConfig = currentKind === 'product'
      ? ['Similar products', 'More from this store', 'Customers also viewed']
      : ['Similar services', 'More from this provider', 'Other bookable services'];
    const used = new Set<string>();
    const pick = (predicate: (item: MarketplaceItem) => boolean, limit: number) => {
      const chosen: MarketplaceItem[] = [];
      for (const item of rankedItems) {
        if (used.has(item.id) || !predicate(item)) continue;
        chosen.push(item);
        used.add(item.id);
        if (chosen.length >= limit) break;
      }
      return chosen;
    };

    const sameKind = (item: MarketplaceItem) => getKind(item) === currentKind;
    const sameStore = (item: MarketplaceItem) => Boolean(item.storeId && item.storeId === props.currentStoreId);
    const sameCategory = (item: MarketplaceItem) => lower(getCategory(item)) === lower(props.currentCategory);

    const primary = pick((item) => sameKind(item) && sameCategory(item), 4);
    const secondary = pick((item) => sameStore(item), 4);
    const tertiary = pick((item) => sameKind(item), 4);
    const fallback = pick(() => true, props.limit ?? 8);

    return [
      { name: sectionConfig[0], items: primary },
      { name: sectionConfig[1], items: secondary },
      { name: sectionConfig[2], items: tertiary.length > 0 ? tertiary : fallback },
    ].filter((section) => section.items.length > 0);
  }, [currentKind, props.currentCategory, props.currentStoreId, props.limit, rankedItems]);

  useEffect(() => {
    if (sections.length === 0) return;
    const total = sections.reduce((sum, section) => sum + section.items.length, 0);
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'related_items_impression', payload: { currentItemId: props.currentItemId, currentStoreId: props.currentStoreId, count: total, sections: sections.map((section) => section.name) } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [props.currentItemId, props.currentStoreId, sections]);

  const trackClick = (clicked: MarketplaceItem, section: string, position: number) => {
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: 'related_item_click', payload: { currentItemId: props.currentItemId, clickedItemId: clicked.id, currentStoreId: props.currentStoreId, clickedStoreId: clicked.storeId, section, position } }),
      keepalive: true,
    }).catch(() => undefined);
  };

  if (sections.length === 0) {
    return (
      <section className="storeInfoCard relatedFallbackCard">
        <h2>Explore more products and services</h2>
        <p>We could not find close matches right now. Browse the marketplace to discover verified sellers.</p>
        <div className="cardActions"><Link className="requestButton" href="/search">Browse Sedifex Market</Link></div>
      </section>
    );
  }

  return (
    <div className="relatedMarketplaceRoot">
      {props.title ? <h2>{props.title}</h2> : null}
      {sections.map((section) => (
        <section key={section.name} className="storeInfoCard" aria-label={section.name}>
          <h2>{section.name}</h2>
          <div className="relatedMarketplaceGrid">
            {section.items.map((item, index) => {
              const imageUrl = getOptimizableImageSource(getImage(item));
              return (
                <article key={`${section.name}-${item.id}`} className="relatedMarketplaceCard">
                  <div className="relatedMarketplaceImageWrap"><Image src={imageUrl} alt={getName(item)} width={360} height={360} className="relatedMarketplaceImage" /></div>
                  <p className="eyebrow">{getBadge(item)}</p>
                  <h3>{getName(item)}</h3>
                  <p>{item.storeName || 'Unknown store'} · {getCategory(item)}</p>
                  <p>{typeof item.price === 'number' ? `${(item.currency || 'GHS').toUpperCase()} ${item.price.toFixed(2)}` : 'Price unavailable'}</p>
                  <div className="cardActions">
                    <Link className="requestButton" href={getProductHref(item.id, getName(item))} onClick={() => trackClick(item, section.name, index + 1)}>{getCta(item)}</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
