'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FirestoreError,
  QueryConstraint,
  QueryDocumentSnapshot,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { db, firebaseConfigError } from '@/lib/firebase';
import { getProductHref } from '@/lib/product-route';
import { getStoreHref } from '@/lib/store-route';
import { resolveClosestCategoryKey } from '@/lib/category-taxonomy';
import './product-grid.css';

const PRIMARY_COLLECTION = 'publicListings';
const LEGACY_COLLECTIONS = ['publicProducts', 'publicServices'] as const;
const MARKETPLACE_COLLECTIONS = [PRIMARY_COLLECTION, ...LEGACY_COLLECTIONS] as const;
const PLACEHOLDER_IMAGE = 'https://placehold.co/640x640/172033/ffffff?text=Sedifex+Market';
const PAGE_SIZE = 24;
const FULL_PAGE_QUERY_LIMIT = 720;
const PREVIEW_QUERY_LIMIT = 48;
const SEARCH_SCAN_LIMIT = 800;
const SEARCH_HISTORY_KEY = 'sedifex-recent-searches';
const MAX_HISTORY_ITEMS = 6;
const MAX_SUGGESTIONS = 8;

type ItemTypeFilter = 'all' | 'product' | 'service' | 'course';
type SortOption = 'newest' | 'price' | 'featured';
type PaginationItem = number | 'ellipsis';

type PublicProduct = {
  id: string;
  storeId?: string;
  productName?: string;
  name?: string;
  description?: string;
  categoryKey?: string;
  category?: string;
  categoryName?: string;
  imageUrls?: string[] | string;
  imageUrl?: string;
  image?: string;
  serviceImageUrl?: string;
  serviceImage?: string;
  serviceImageUrls?: string[] | string;
  thumbnailUrl?: string;
  photoUrl?: string;
  images?: string[] | string;
  imageAlt?: string;
  price?: number;
  originalPrice?: number;
  currency?: string;
  sku?: string;
  batchNumber?: string;
  storeName?: string;
  city?: string;
  storeCity?: string;
  itemType?: string;
  listingType?: string;
  salesMode?: string;
  status?: string;
  isVisible?: boolean | string | number;
  visible?: boolean | string | number;
  isPublished?: boolean | string | number;
  isMarketplaceVisible?: boolean | string | number;
  hidden?: boolean | string | number;
  isHidden?: boolean | string | number;
  deleted?: boolean | string | number;
  isDeleted?: boolean | string | number;
  verified?: boolean | string | number;
  featuredRank?: number;
  rankingScore?: number;
  publishedAt?: { seconds?: number } | string;
  updatedAt?: { seconds?: number } | string;
};

type ProductGridProps = {
  itemTypeFilter?: ItemTypeFilter;
  previewLimit?: number;
  showToolbar?: boolean;
  showPagination?: boolean;
  moreHref?: string;
  moreLabel?: string;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'published', 'visible'].includes(normalized)) return true;
    if (['false', '0', 'no', 'draft', 'hidden'].includes(normalized)) return false;
  }
  return null;
};

const isTrue = (value: unknown) => normalizeBoolean(value) === true;
const isFalse = (value: unknown) => normalizeBoolean(value) === false;

const getTimestampScore = (value: PublicProduct['publishedAt'] | PublicProduct['updatedAt']) => {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : 0;
  }
  return typeof value.seconds === 'number' ? value.seconds : 0;
};

const buildPaginationItems = (currentPage: number, totalPages: number): PaginationItem[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  if (currentPage <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (currentPage >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page));
  const sortedPages = Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  sortedPages.forEach((page, index) => {
    const previous = sortedPages[index - 1];
    if (previous && page - previous > 1) items.push('ellipsis');
    items.push(page);
  });
  return items;
};

const cleanDisplayText = (value?: string) => {
  if (!value) return '';
  return value
    .replace(/\*\*/g, '')
    .replace(/^(product\s*name|service\s*name|course\s*name|item\s*name|name|title)\s*:\s*/i, '')
    .replace(/^[-–—:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const getProductName = (item: PublicProduct) => cleanDisplayText(item.productName ?? item.name) || 'Untitled item';

const resolveListingType = (item: Pick<PublicProduct, 'listingType' | 'itemType'>): Exclude<ItemTypeFilter, 'all'> => {
  const listingType = item.listingType?.trim().toLowerCase();
  if (listingType === 'course' || listingType === 'service' || listingType === 'product') return listingType;
  const fallbackType = item.itemType?.trim().toLowerCase();
  if (fallbackType === 'course') return 'course';
  if (fallbackType === 'service') return 'service';
  return 'product';
};

const matchesItemTypeFilter = (item: Pick<PublicProduct, 'listingType' | 'itemType'>, filter: ItemTypeFilter) => filter === 'all' || resolveListingType(item) === filter;

const getCategory = (item: PublicProduct) =>
  resolveClosestCategoryKey({
    category: item.categoryKey?.trim() || item.categoryName?.trim() || item.category?.trim(),
    productName: getProductName(item),
    description: item.description,
    itemType: item.itemType,
  });

const getStoreCity = (item: PublicProduct) => (item.city ?? item.storeCity)?.trim() || 'City unavailable';

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

const normalizeImageCandidate = (value: string) => {
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  if (!trimmed.toLowerCase().startsWith('gs://')) return trimmed;
  const withoutPrefix = trimmed.slice(5);
  const slashIndex = withoutPrefix.indexOf('/');
  if (slashIndex === -1) return '';
  return `https://storage.googleapis.com/${withoutPrefix.slice(0, slashIndex)}/${withoutPrefix.slice(slashIndex + 1)}`;
};

const isDisplayableImageUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const getDisplayImage = (item: PublicProduct) => {
  const candidates = [item.imageUrls, item.imageUrl, item.image, item.serviceImageUrls, item.serviceImageUrl, item.serviceImage, item.thumbnailUrl, item.photoUrl, item.images]
    .flatMap((value) => decodeImageValues(value))
    .map(normalizeImageCandidate)
    .filter(isDisplayableImageUrl);
  return Array.from(new Set(candidates))[0] ?? PLACEHOLDER_IMAGE;
};

const isPublicListing = (item: PublicProduct) => {
  if (isTrue(item.deleted) || isTrue(item.isDeleted)) return false;
  if (isTrue(item.hidden) || isTrue(item.isHidden)) return false;
  if (isFalse(item.visible) || isFalse(item.isVisible)) return false;
  if (isFalse(item.isMarketplaceVisible) || isFalse(item.isPublished)) return false;
  const status = item.status?.trim().toLowerCase();
  if (status === 'draft' && !isTrue(item.isPublished)) return false;
  return true;
};

const isVerifiedStore = (value: PublicProduct['verified']) => value == null || isTrue(value);

const formatMoneyParts = (price?: number, currency?: string) => {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const normalizedCurrency = (currency ?? 'GHS').toUpperCase();
  const symbol = normalizedCurrency === 'GHS' || normalizedCurrency === 'GHC' ? 'GH₵' : normalizedCurrency === 'USD' ? '$' : normalizedCurrency;
  const [major, decimal = '00'] = price.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).split('.');
  return { symbol, major, decimal };
};

const resolveCtaLabel = (item: Pick<PublicProduct, 'listingType' | 'itemType' | 'salesMode'>) => {
  const listingType = resolveListingType(item);
  const salesMode = item.salesMode?.trim().toLowerCase();
  if (salesMode === 'request_quote') return 'Request quote';
  if (listingType === 'service') return 'Book now';
  if (listingType === 'course') return 'Register';
  return listingType === 'product' ? 'Buy now' : 'View details';
};

const sortProducts = (items: PublicProduct[], selectedSort: SortOption) => {
  const sorted = [...items];
  sorted.sort((left, right) => {
    if (selectedSort === 'price') {
      const leftPrice = typeof left.price === 'number' ? left.price : Number.POSITIVE_INFINITY;
      const rightPrice = typeof right.price === 'number' ? right.price : Number.POSITIVE_INFINITY;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    }
    if (selectedSort === 'featured') {
      const leftScore = typeof left.rankingScore === 'number' ? left.rankingScore : Number.NEGATIVE_INFINITY;
      const rightScore = typeof right.rankingScore === 'number' ? right.rankingScore : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftRank = typeof left.featuredRank === 'number' ? left.featuredRank : Number.NEGATIVE_INFINITY;
      const rightRank = typeof right.featuredRank === 'number' ? right.featuredRank : Number.NEGATIVE_INFINITY;
      if (leftRank !== rightRank) return rightRank - leftRank;
    }
    const leftTime = getTimestampScore(left.publishedAt) || getTimestampScore(left.updatedAt);
    const rightTime = getTimestampScore(right.publishedAt) || getTimestampScore(right.updatedAt);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.id.localeCompare(right.id);
  });
  return sorted;
};

const normalizeStoreNamesByStoreId = (items: PublicProduct[]) => {
  const names = new Map<string, string>();
  items.forEach((item) => {
    const storeId = item.storeId?.trim();
    const storeName = item.storeName?.trim();
    if (storeId && storeName && !names.has(storeId)) names.set(storeId, storeName);
  });
  return items.map((item) => {
    const storeId = item.storeId?.trim();
    const canonicalName = storeId ? names.get(storeId) : null;
    return canonicalName && canonicalName !== item.storeName ? { ...item, storeName: canonicalName } : item;
  });
};

const dedupeById = (items: PublicProduct[]) => Array.from(new Map(items.map((item) => [item.id, item])).values());

const getStoreKey = (item: PublicProduct) => item.storeId?.trim() || item.storeName?.trim() || `unknown-${item.id}`;

const capProductsPerStore = (items: PublicProduct[], limitPerStore: number) => {
  const counts = new Map<string, number>();
  return items.filter((item) => {
    const key = getStoreKey(item);
    const count = counts.get(key) ?? 0;
    if (count >= limitPerStore) return false;
    counts.set(key, count + 1);
    return true;
  });
};

const balanceProductsAcrossStores = (items: PublicProduct[]) => {
  const buckets = new Map<string, PublicProduct[]>();
  const storeOrder: string[] = [];

  items.forEach((item) => {
    const key = getStoreKey(item);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      storeOrder.push(key);
    }
    buckets.get(key)?.push(item);
  });

  const balanced: PublicProduct[] = [];
  let keepGoing = true;

  while (keepGoing) {
    keepGoing = false;
    for (const key of storeOrder) {
      const bucket = buckets.get(key);
      const next = bucket?.shift();
      if (next) {
        balanced.push(next);
        keepGoing = true;
      }
    }
  }

  return balanced;
};

export function ProductGrid({
  itemTypeFilter = 'all',
  previewLimit,
  showToolbar = true,
  showPagination = true,
  moreHref,
  moreLabel,
}: ProductGridProps) {
  const isPreview = typeof previewLimit === 'number' && previewLimit > 0;
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [cities, setCities] = useState<string[]>(['all']);
  const [selectedCity, setSelectedCity] = useState('all');
  const [selectedSort, setSelectedSort] = useState<SortOption>('newest');
  const [searchText, setSearchText] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [lastCollection, setLastCollection] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const hasServerSideItemTypeFilter = itemTypeFilter !== 'all';

  const buildServerFilters = useCallback((): QueryConstraint[] => {
    const filters: QueryConstraint[] = [];
    if (hasServerSideItemTypeFilter) filters.push(where('listingType', '==', itemTypeFilter));
    return filters;
  }, [hasServerSideItemTypeFilter, itemTypeFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setRecentSearches(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_HISTORY_ITEMS));
    } catch {}
  }, []);

  const visibleProducts = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const filtered = normalizeStoreNamesByStoreId(products).filter((item) => {
      if (!matchesItemTypeFilter(item, itemTypeFilter)) return false;
      if (selectedCity !== 'all' && getStoreCity(item).toLowerCase() !== selectedCity.toLowerCase()) return false;
      if (!normalizedSearch) return true;
      const haystack = [getProductName(item), item.description, item.storeName, getCategory(item), item.sku, item.batchNumber, resolveListingType(item)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
    const sorted = sortProducts(filtered.filter(isPublicListing), selectedSort);
    return isPreview ? sorted : balanceProductsAcrossStores(sorted);
  }, [isPreview, itemTypeFilter, products, searchText, selectedCity, selectedSort]);

  const suggestions = useMemo(() => {
    const normalized = searchText.trim().toLowerCase();
    if (!normalized) return recentSearches;
    const terms = new Set<string>();
    visibleProducts.forEach((item) => [getProductName(item), item.storeName, getCategory(item), resolveListingType(item)].forEach((term) => {
      const textValue = term?.trim().toLowerCase();
      if (textValue && textValue.includes(normalized)) terms.add(textValue);
    }));
    return Array.from(terms).slice(0, MAX_SUGGESTIONS);
  }, [recentSearches, searchText, visibleProducts]);

  const commitSearch = useCallback((value: string) => {
    const normalized = value.trim();
    setSearchText(normalized);
    setCurrentPage(1);
    if (!normalized) return;
    setRecentSearches((current) => {
      const next = [normalized, ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, MAX_HISTORY_ITEMS);
      if (typeof window !== 'undefined') window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchCollectionPage = useCallback(async (collectionName: string, cursor?: QueryDocumentSnapshot) => {
    if (!db) return { items: [] as PublicProduct[], lastDoc: null as QueryDocumentSnapshot | null, isEndReached: true };
    const filters = buildServerFilters();
    const pageLimit = isPreview ? PREVIEW_QUERY_LIMIT : FULL_PAGE_QUERY_LIMIT;
    const orderOptions: QueryConstraint[][] =
      selectedSort === 'price'
        ? [[orderBy('price', 'asc'), orderBy(documentId(), 'asc')], [orderBy(documentId(), 'asc')]]
        : selectedSort === 'featured'
          ? [[orderBy('rankingScore', 'desc'), orderBy('featuredRank', 'desc'), orderBy(documentId(), 'asc')], [orderBy(documentId(), 'asc')]]
          : [[orderBy('publishedAt', 'desc')], [orderBy(documentId(), 'asc')]];

    for (const ordering of orderOptions) {
      try {
        const pageQuery = query(collection(db, collectionName), ...filters, ...ordering, limit(pageLimit), ...(cursor ? [startAfter(cursor)] : []));
        const snapshot = await getDocs(pageQuery);
        const items = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as PublicProduct)
          .filter((item) => matchesItemTypeFilter(item, itemTypeFilter) && isPublicListing(item));
        return {
          items,
          lastDoc: snapshot.docs.at(-1) ?? cursor ?? null,
          isEndReached: snapshot.docs.length < pageLimit,
        };
      } catch (error) {
        const firestoreError = error as FirestoreError;
        if (firestoreError?.code !== 'failed-precondition') throw error;
      }
    }
    throw new Error(`Unable to fetch ${collectionName} with the available indexes.`);
  }, [buildServerFilters, isPreview, itemTypeFilter, selectedSort]);

  const fetchProducts = useCallback(async (cursor?: QueryDocumentSnapshot, collectionCursor?: string | null) => {
    if (!db) {
      setError(firebaseConfigError ?? 'Firebase is not configured.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setDebugInfo(null);
    try {
      const startCollectionIndex = collectionCursor ? Math.max(0, MARKETPLACE_COLLECTIONS.indexOf(collectionCursor as typeof MARKETPLACE_COLLECTIONS[number])) : 0;
      let nextItems: PublicProduct[] = [];
      let nextLastDoc: QueryDocumentSnapshot | null = null;
      let nextCollection: string | null = null;
      let isEndReached = true;

      for (let index = startCollectionIndex; index < MARKETPLACE_COLLECTIONS.length; index += 1) {
        const collectionName = MARKETPLACE_COLLECTIONS[index];
        const page = await fetchCollectionPage(collectionName, index === startCollectionIndex ? cursor : undefined);
        nextItems = page.items;
        nextLastDoc = page.lastDoc;
        nextCollection = collectionName;
        isEndReached = page.isEndReached;
        if (nextItems.length > 0 || !isEndReached) break;
      }

      const preparedItems = isPreview ? capProductsPerStore(dedupeById(nextItems), 2) : dedupeById(nextItems);
      setProducts((current) => cursor ? normalizeStoreNamesByStoreId(dedupeById([...current, ...preparedItems])) : normalizeStoreNamesByStoreId(preparedItems));
      setCities((current) => {
        const next = new Set(current);
        preparedItems.forEach((item) => next.add(getStoreCity(item)));
        return Array.from(next).sort((a, b) => a.localeCompare(b));
      });
      setLastDoc(isEndReached ? null : nextLastDoc);
      setLastCollection(isEndReached ? null : nextCollection);
    } catch (err) {
      console.error('Failed to fetch products', err);
      const firestoreError = err as FirestoreError;
      setDebugInfo(JSON.stringify({ operation: 'fetchProducts', firestoreCode: firestoreError?.code ?? 'unknown', firestoreMessage: firestoreError?.message ?? 'No message provided' }, null, 2));
      if (firestoreError?.code === 'permission-denied') setError('Could not load listings due to Firestore rules. Allow public read access to marketplace collections.');
      else if (firestoreError?.code === 'failed-precondition') setError('Could not load listings. Deploy Firestore indexes and rules.');
      else setError('Could not load listings. Check debug details below.');
    } finally {
      setIsLoading(false);
    }
  }, [fetchCollectionPage, isPreview]);

  const fetchProductsForSearch = useCallback(async () => {
    if (!db) return;
    setIsLoading(true);
    setError(null);
    try {
      const filters = buildServerFilters();
      const allItems: PublicProduct[] = [];
      for (const collectionName of MARKETPLACE_COLLECTIONS) {
        let cursor: QueryDocumentSnapshot | undefined;
        while (allItems.length < SEARCH_SCAN_LIMIT) {
          const snapshot = await getDocs(query(collection(db, collectionName), ...filters, orderBy(documentId(), 'asc'), limit(100), ...(cursor ? [startAfter(cursor)] : [])));
          allItems.push(...snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as PublicProduct).filter((item) => matchesItemTypeFilter(item, itemTypeFilter) && isPublicListing(item)));
          if (snapshot.docs.length < 100) break;
          cursor = snapshot.docs.at(-1);
        }
      }
      const preparedItems = dedupeById(allItems).slice(0, SEARCH_SCAN_LIMIT);
      setProducts(normalizeStoreNamesByStoreId(preparedItems));
      setLastDoc(null);
      setLastCollection(null);
      setCities((current) => {
        const next = new Set(current);
        preparedItems.forEach((item) => next.add(getStoreCity(item)));
        return Array.from(next).sort((a, b) => a.localeCompare(b));
      });
    } catch (err) {
      console.error('Failed to fetch products for search', err);
      setError('Could not load all listings for search. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [buildServerFilters, itemTypeFilter]);

  const loadedPageCount = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const canFetchNextServerPage = Boolean(lastDoc && !isPreview && searchText.trim().length === 0);
  const totalPages = isPreview ? 1 : Math.max(1, loadedPageCount + (canFetchNextServerPage ? 1 : 0));
  const normalizedCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (normalizedCurrentPage - 1) * PAGE_SIZE;
  const paginatedProducts = isPreview
    ? visibleProducts.slice(0, previewLimit)
    : visibleProducts.slice(pageStartIndex, pageStartIndex + PAGE_SIZE);
  const paginationItems = buildPaginationItems(normalizedCurrentPage, totalPages);

  const goToPage = useCallback(async (page: number) => {
    if (page < 1 || page > totalPages || isLoading || isPreview) return;
    if (page > loadedPageCount && canFetchNextServerPage) await fetchProducts(lastDoc ?? undefined, lastCollection);
    setCurrentPage(page);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [canFetchNextServerPage, fetchProducts, isLoading, isPreview, lastCollection, lastDoc, loadedPageCount, totalPages]);

  useEffect(() => {
    setProducts([]);
    setLastDoc(null);
    setLastCollection(null);
    setCurrentPage(1);
    if (searchText.trim()) return;
    fetchProducts();
  }, [fetchProducts, searchText]);

  useEffect(() => {
    if (!searchText.trim()) return;
    setProducts([]);
    setLastDoc(null);
    setLastCollection(null);
    setCurrentPage(1);
    fetchProductsForSearch();
  }, [fetchProductsForSearch, searchText]);

  useEffect(() => { setCurrentPage(1); }, [itemTypeFilter, selectedCity, selectedSort]);

  return (
    <section className={isPreview ? 'marketplace marketplacePreview' : 'marketplace'}>
      <div className="marketplaceHeader">
        <h1>{itemTypeFilter === 'service' ? 'Services' : itemTypeFilter === 'course' ? 'Courses' : 'Products'}</h1>
        <p>{isPreview ? 'A quick preview of verified marketplace listings.' : 'Discover verified marketplace listings from Sedifex stores.'}</p>
      </div>

      {showToolbar && !isPreview ? (
        <>
          <div className="toolbar">
            <div className="searchWrap">
              <label htmlFor={`search-${itemTypeFilter}`}>Search</label>
              <input
                id={`search-${itemTypeFilter}`}
                type="search"
                value={searchText}
                onChange={(event) => { setSearchText(event.target.value); setIsSuggestionOpen(true); }}
                onFocus={() => setIsSuggestionOpen(true)}
                placeholder="Search by name, description, store, category, or listing type"
                onKeyDown={(event) => { if (event.key === 'Enter') { commitSearch(searchText); setIsSuggestionOpen(false); } }}
              />
              {isSuggestionOpen && suggestions.length > 0 ? (
                <ul className="searchSuggestions" role="listbox" aria-label="Search suggestions">
                  {suggestions.map((suggestion) => <li key={suggestion}><button type="button" onMouseDown={() => { commitSearch(suggestion); setIsSuggestionOpen(false); }}>{suggestion}</button></li>)}
                </ul>
              ) : null}
            </div>
            <div className="sortWrap">
              <label htmlFor={`sort-${itemTypeFilter}`}>Sort by</label>
              <select id={`sort-${itemTypeFilter}`} value={selectedSort} onChange={(event) => setSelectedSort(event.target.value as SortOption)}>
                <option value="featured">Popular</option>
                <option value="newest">Newest</option>
                <option value="price">Cheapest</option>
              </select>
            </div>
          </div>
          <div className="toolbar">
            <div className="sortWrap">
              <label htmlFor={`city-filter-${itemTypeFilter}`}>City</label>
              <select id={`city-filter-${itemTypeFilter}`} value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
                {cities.map((city) => <option key={city} value={city}>{city === 'all' ? 'All cities' : city}</option>)}
              </select>
            </div>
          </div>
        </>
      ) : null}

      {error && <p className="error">{error}</p>}
      {debugInfo && <details className="error" open><summary>Debug details</summary><pre>{debugInfo}</pre></details>}

      <div className="grid">
        {isLoading && products.length === 0
          ? Array.from({ length: isPreview ? Math.min(previewLimit ?? 8, 8) : 8 }).map((_, index) => (
              <article key={`skeleton-${index}`} className="card skeletonCard" aria-hidden="true">
                <div className="skeleton skeletonImage" /><div className="skeleton skeletonTitle" /><div className="skeleton skeletonText" /><div className="skeleton skeletonButton" />
              </article>
            ))
          : paginatedProducts.map((item) => {
              const listingType = resolveListingType(item);
              const productName = getProductName(item);
              const itemHref = getProductHref(item.id, productName, listingType);
              const storeHref = getStoreHref(item.storeId, item.storeName);
              const shortDescription = cleanDisplayText((item.description ?? '').split(/\n+/).map((line) => line.trim()).filter(Boolean)[0] ?? '');
              const priceParts = formatMoneyParts(item.price, item.currency);
              return (
                <article key={item.id} className="card">
                  <Link href={itemHref} className="imageWrap">
                    <Image src={getDisplayImage(item)} alt={item.imageAlt?.trim() || productName} loading="lazy" width={360} height={360} sizes="(max-width: 768px) 112px, (max-width: 1200px) 50vw, 25vw" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </Link>
                  <div className="cardBody">
                    <div className="badgeRow">
                      <span className="verifiedBadge">{listingType}</span>
                      {isVerifiedStore(item.verified) ? <span className="verifiedBadge verifiedStoreBadge"><span className="verifiedPulse" aria-hidden="true" />Verified</span> : null}
                    </div>
                    <h3><Link href={itemHref}>{productName}</Link></h3>
                    <p className="productShortDescription">{shortDescription || 'Details will be confirmed by the seller during checkout.'}</p>
                    <div className="meta">
                      <span className="storeIdentity">{storeHref ? <Link href={storeHref}>{item.storeName ?? 'Unknown store'}</Link> : item.storeName ?? 'Unknown store'}</span>
                      <span className="categoryLine">{getCategory(item)}</span>
                    </div>
                    {priceParts ? (
                      <div className="marketPrice" aria-label={`${priceParts.symbol} ${priceParts.major}.${priceParts.decimal}`}>
                        <span className="marketPriceCurrency">{priceParts.symbol}</span>
                        <span className="marketPriceMajor">{priceParts.major}</span>
                        <span className="marketPriceDecimal">.{priceParts.decimal}</span>
                      </div>
                    ) : (
                      <strong className="priceUnavailable">Price unavailable</strong>
                    )}
                    <p className="trustScoreCard">🛡 Receipt and payment record protected by Sedifex.</p>
                    <div className="cardActions"><Link href={itemHref} className="buyNowButton">{resolveCtaLabel(item)}</Link></div>
                  </div>
                </article>
              );
            })}
      </div>

      {!isLoading && visibleProducts.length === 0 && !error ? <div className="emptyState"><h3>No items found</h3><p>Try a different search term, category, or sort option.</p></div> : null}

      {isPreview && moreHref ? (
        <div className="previewMoreActions"><Link href={moreHref} className="btn btnPrimary">{moreLabel ?? 'Open more'}</Link></div>
      ) : null}

      {!isPreview && showPagination && visibleProducts.length > 0 ? (
        <nav className="marketPagination" aria-label="Marketplace pagination">
          <button type="button" className="marketPaginationButton" disabled={normalizedCurrentPage <= 1 || isLoading} onClick={() => void goToPage(normalizedCurrentPage - 1)}>‹ Previous</button>
          {paginationItems.map((item, index) => item === 'ellipsis'
            ? <span key={`ellipsis-${index}`} className="marketPaginationEllipsis">…</span>
            : <button key={item} type="button" className="marketPaginationButton" data-active={item === normalizedCurrentPage ? 'true' : 'false'} aria-current={item === normalizedCurrentPage ? 'page' : undefined} disabled={isLoading} onClick={() => void goToPage(item)}>{item}</button>)}
          <button type="button" className="marketPaginationButton" disabled={normalizedCurrentPage >= totalPages || isLoading} onClick={() => void goToPage(normalizedCurrentPage + 1)}>Next ›</button>
        </nav>
      ) : null}
    </section>
  );
}
