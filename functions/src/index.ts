import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { __setDbForTests as setDbForTests } from './modules/db';
import { normalizeCategory, normalizeProduct, normalizeText, normalizeWhatsAppNumber, toTitleCase } from './modules/normalization';
import { rebuildPublicProductsForStore, syncFlatProduct, toPublicProductDoc, upsertOrDeletePublicProduct } from './modules/public-products';
import { computeRankingScore } from './modules/ranking';
import { computeVisibility, getEffectiveStoreStatus, isStoreBuyVisible, isVisibleProduct, publicProductId, withStoreDefaults, buildWhatsAppLink } from './modules/visibility';
import { type ProductDoc, type StoreDoc } from './modules/types';

admin.initializeApp();

setGlobalOptions({
  minInstances: 0,
  maxInstances: 1,
  memory: '256MiB',
  cpu: 'gcf_gen1',
});

const STORE_PATH = 'stores/{storeId}';
const FLAT_PRODUCT_PATH = 'products/{productId}';

export const __setDbForTests = setDbForTests;
export { rebuildPublicProductsForStore };

export const __testing = {
  normalizeText,
  toTitleCase,
  normalizeCategory,
  normalizeWhatsAppNumber,
  normalizeProduct,
  buildWhatsAppLink,
  withStoreDefaults,
  getEffectiveStoreStatus,
  isStoreBuyVisible,
  isVisibleProduct,
  computeVisibility,
  publicProductId,
  computeRankingScore,
  toPublicProductDoc,
  upsertOrDeletePublicProduct,
};

function storePublicInputsChanged(before: StoreDoc, after: StoreDoc): boolean {
  return (
    getEffectiveStoreStatus(before) !== getEffectiveStoreStatus(after) ||
    before.eligibleForBuy !== after.eligibleForBuy ||
    before.buyOptOut !== after.buyOptOut ||
    before.whatsappNumber !== after.whatsappNumber ||
    before.phone !== after.phone ||
    before.name !== after.name ||
    before.slug !== after.slug ||
    before.logoUrl !== after.logoUrl ||
    before.bannerUrl !== after.bannerUrl ||
    before.category !== after.category ||
    before.city !== after.city ||
    before.country !== after.country ||
    before.addressLine1 !== after.addressLine1 ||
    before.verified !== after.verified
  );
}

export const onStoreWritten = onDocumentWritten(STORE_PATH, async (event) => {
  if (!event.data || !event.data.after.exists) return;

  const storeId = event.params.storeId;
  const rawAfter = event.data.after.data() as StoreDoc;
  const after = withStoreDefaults(rawAfter);
  const before = event.data.before.exists
    ? withStoreDefaults(event.data.before.data() as StoreDoc)
    : undefined;

  if (rawAfter.eligibleForBuy === undefined || rawAfter.buyOptOut === undefined) {
    await event.data.after.ref.set(
      {
        eligibleForBuy: after.eligibleForBuy,
        buyOptOut: after.buyOptOut,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (!before || storePublicInputsChanged(before, after)) {
    await rebuildPublicProductsForStore(storeId);
  }
});

export const onFlatProductWritten = onDocumentWritten(FLAT_PRODUCT_PATH, async (event) => {
  if (!event.data) return;

  await syncFlatProduct({
    productId: event.params.productId,
    before: event.data.before.exists ? (event.data.before.data() as ProductDoc) : undefined,
    after: event.data.after.exists ? (event.data.after.data() as ProductDoc) : undefined,
  });
});
