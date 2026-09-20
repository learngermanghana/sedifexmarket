'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type AnalyticsEventName =
  | 'page_view'
  | 'store_view'
  | 'product_view'
  | 'search'
  | 'add_to_cart'
  | 'checkout_started'
  | 'payment_initialized'
  | 'order_paid'
  | 'whatsapp_click'
  | 'phone_click'
  | 'seller_profile_click'
  | 'support_click';

type AnalyticsPayload = {
  eventName: AnalyticsEventName;
  pageUrl?: string;
  pagePath?: string;
  pageTitle?: string;
  referrer?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  productId?: string | null;
  productName?: string | null;
  searchTerm?: string | null;
  actionTarget?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

const VISITOR_KEY = 'sedifex_market_visitor_id';
const SESSION_KEY = 'sedifex_market_session_id';
const SESSION_STARTED_KEY = 'sedifex_market_session_started_at';
const SESSION_TTL_MS = 30 * 60 * 1000;
// Browsing events are useful for directional analytics, but every event also
// invokes a Vercel Function. Keep conversion events lossless and use a stable
// per-session 1% sample for high-volume browsing events.
const BROWSING_SAMPLE_PERCENT = 1;
const DUPLICATE_EVENT_WINDOW_MS = 2500;
const BROWSING_EVENTS = new Set<AnalyticsEventName>([
  'page_view',
  'store_view',
  'product_view',
  'search',
  'seller_profile_click',
]);

let lastEventKey = '';
let lastEventAt = 0;

function id(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function storageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function getVisitorId() {
  const existing = storageGet(VISITOR_KEY);
  if (existing) return existing;
  const next = id('visitor');
  storageSet(VISITOR_KEY, next);
  return next;
}

function getSessionId() {
  const now = Date.now();
  const startedAt = Number(storageGet(SESSION_STARTED_KEY) || 0);
  const existing = storageGet(SESSION_KEY);
  if (existing && startedAt && now - startedAt < SESSION_TTL_MS) {
    storageSet(SESSION_STARTED_KEY, String(now));
    return existing;
  }
  const next = id('session');
  storageSet(SESSION_KEY, next);
  storageSet(SESSION_STARTED_KEY, String(now));
  return next;
}

function isSampledBrowsingSession(sessionId: string) {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(index)) >>> 0;
  }
  return hash % 100 < BROWSING_SAMPLE_PERCENT;
}

function paramsToUtm(searchParams: URLSearchParams) {
  return {
    utmSource: searchParams.get('utm_source'),
    utmMedium: searchParams.get('utm_medium'),
    utmCampaign: searchParams.get('utm_campaign'),
    utmTerm: searchParams.get('utm_term'),
    utmContent: searchParams.get('utm_content'),
  };
}

function extractContextFromElement(element: Element | null) {
  let current: Element | null = element;
  while (current) {
    const html = current as HTMLElement;
    const storeId = html.dataset?.storeId || html.getAttribute('data-store-id');
    const productId = html.dataset?.productId || html.getAttribute('data-product-id');
    const storeName = html.dataset?.storeName || html.getAttribute('data-store-name');
    const productName = html.dataset?.productName || html.getAttribute('data-product-name');
    if (storeId || productId || storeName || productName) return { storeId, productId, storeName, productName };
    current = current.parentElement;
  }
  return {};
}

function classifyClick(target: Element | null): { eventName: AnalyticsEventName; actionTarget?: string; metadata?: Record<string, string> } | null {
  const clickable = target?.closest('a,button,[role="button"]') as HTMLElement | null;
  if (!clickable) return null;

  const href = clickable instanceof HTMLAnchorElement ? clickable.href : clickable.getAttribute('href') || '';
  const text = (clickable.textContent || '').trim().slice(0, 160);
  const hrefLower = href.toLowerCase();
  const textLower = text.toLowerCase();
  const explicitEvent = clickable.dataset?.analyticsEvent as AnalyticsEventName | undefined;

  if (explicitEvent) return { eventName: explicitEvent, actionTarget: href || text, metadata: { text } };
  if (hrefLower.startsWith('https://wa.me') || hrefLower.includes('whatsapp') || hrefLower.startsWith('whatsapp:')) return { eventName: 'whatsapp_click', actionTarget: href, metadata: { text } };
  if (hrefLower.startsWith('tel:')) return { eventName: 'phone_click', actionTarget: href, metadata: { text } };
  if (/add\s*to\s*cart|add cart|cart/.test(textLower)) return { eventName: 'add_to_cart', actionTarget: href || text, metadata: { text } };
  if (/checkout|pay now|place order|buy now/.test(textLower)) return { eventName: 'checkout_started', actionTarget: href || text, metadata: { text } };
  if (/store|seller|vendor|merchant/.test(textLower) && hrefLower) return { eventName: 'seller_profile_click', actionTarget: href, metadata: { text } };
  if (/support|help|chat/.test(textLower) || hrefLower.includes('support')) return { eventName: 'support_click', actionTarget: href || text, metadata: { text } };
  return null;
}

export function trackSedifexMarketEvent(payload: AnalyticsPayload) {
  if (typeof window === 'undefined') return;

  const sessionId = getSessionId();
  if (BROWSING_EVENTS.has(payload.eventName) && !isSampledBrowsingSession(sessionId)) return;

  const eventKey = [
    sessionId,
    payload.eventName,
    payload.pagePath || window.location.pathname,
    payload.productId || '',
    payload.storeId || '',
    payload.actionTarget || '',
  ].join(':');
  const now = Date.now();
  if (eventKey === lastEventKey && now - lastEventAt < DUPLICATE_EVENT_WINDOW_MS) return;
  lastEventKey = eventKey;
  lastEventAt = now;

  const url = new URL(window.location.href);
  const body = {
    site: 'sedifexmarket',
    sessionId,
    visitorId: getVisitorId(),
    pageUrl: payload.pageUrl || window.location.href,
    pagePath: payload.pagePath || window.location.pathname,
    pageTitle: payload.pageTitle || document.title,
    referrer: payload.referrer ?? document.referrer,
    ...paramsToUtm(url.searchParams),
    ...payload,
  };

  const json = JSON.stringify(body);
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon('/api/analytics/track', new Blob([json], { type: 'application/json' }));
    if (sent) return;
  }

  fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json,
    keepalive: true,
  }).catch(() => undefined);
}

function inferPageEvent(pathname: string): AnalyticsEventName {
  const path = pathname.toLowerCase();
  if (/product|item|listing/.test(path)) return 'product_view';
  if (/store|seller|merchant/.test(path)) return 'store_view';
  return 'page_view';
}

function AnalyticsTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPageKey = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `${pathname}?${searchParams.toString()}`;
    if (lastPageKey.current === key) return;
    lastPageKey.current = key;

    const url = new URL(window.location.href);
    const searchTerm = searchParams.get('q') || searchParams.get('query') || searchParams.get('search') || null;
    const eventName = searchTerm ? 'search' : inferPageEvent(pathname || '/');

    trackSedifexMarketEvent({
      eventName,
      pageUrl: url.toString(),
      pagePath: pathname || '/',
      pageTitle: document.title,
      searchTerm,
    });
  }, [pathname, searchParams]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const classified = classifyClick(target);
      if (!classified) return;
      const context = extractContextFromElement(target);
      trackSedifexMarketEvent({
        eventName: classified.eventName,
        actionTarget: classified.actionTarget,
        storeId: context.storeId || null,
        storeName: context.storeName || null,
        productId: context.productId || null,
        productName: context.productName || null,
        metadata: classified.metadata,
      });
    };

    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  return null;
}

export function AnalyticsTracker() {
  return (
    <Suspense fallback={null}>
      <AnalyticsTrackerInner />
    </Suspense>
  );
}
