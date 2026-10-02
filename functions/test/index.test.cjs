const test = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../lib/index.js');
const t = mod.__testing;

test('visibility matrix: visible path', () => {
  const store = t.withStoreDefaults({ storeStatus: 'active', eligibleForBuy: true, buyOptOut: false, marketplaceApproved: true });
  assert.equal(t.computeVisibility(store, { itemType: 'product', name: 'Sample' }), true);
});

test('visibility matrix: inactive/opt-out/itemType hidden', () => {
  const inactive = t.withStoreDefaults({ storeStatus: 'inactive', eligibleForBuy: true, buyOptOut: false });
  assert.equal(t.computeVisibility(inactive, { itemType: 'product', name: 'Sample' }), false);

  const optOut = t.withStoreDefaults({ storeStatus: 'active', eligibleForBuy: true, buyOptOut: true });
  assert.equal(t.computeVisibility(optOut, { itemType: 'product', name: 'Sample' }), false);

  const active = t.withStoreDefaults({ storeStatus: 'active', eligibleForBuy: true, buyOptOut: false });
  assert.equal(t.computeVisibility(active, { itemType: 'bundle', name: 'Sample' }), false);
});

test('WhatsApp link normalization', () => {
  const link = t.buildWhatsAppLink({
    phone: ' +233 (55) 123-4567 ',
    storeName: 'Demo Store',
    productName: 'Rice',
    productId: 'prod-1',
    storeId: 'store-1',
  });

  assert.ok(link.includes('https://wa.me/233551234567'));
  assert.equal(
    t.buildWhatsAppLink({ phone: '  ', storeName: 'S', productName: 'P', productId: 'p', storeId: 's' }),
    null,
  );
});

test('upsert/delete sync behavior', async () => {
  let deleted = 0;
  let setCalls = 0;
  mod.__setDbForTests({
    collection: () => ({
      doc: () => ({
        delete: async () => { deleted += 1; },
        set: async () => { setCalls += 1; },
      }),
    }),
  });

  await t.upsertOrDeletePublicProduct({
    storeId: 's1',
    productId: 'p1',
    store: { storeStatus: 'inactive', eligibleForBuy: true, buyOptOut: false },
    product: { name: 'Rice', itemType: 'product' },
  });

  await t.upsertOrDeletePublicProduct({
    storeId: 's1',
    productId: 'p2',
    store: { storeStatus: 'active', eligibleForBuy: true, buyOptOut: false, marketplaceApproved: true, name: 'Store', phone: '+233201111111' },
    product: { name: 'Rice', itemType: 'product' },
  });

  assert.equal(deleted, 1);
  assert.equal(setCalls, 1);
});

test('rebuild uses storeId-filtered query', async () => {
  let whereCalls = 0;
  mod.__setDbForTests({
    collection: (name) => {
      if (name === 'stores') {
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ storeStatus: 'active', eligibleForBuy: true, buyOptOut: false }),
            }),
          }),
        };
      }

      if (name === 'products') {
        return {
          where: (field, op, value) => {
            if (field === 'storeId' && op === '==' && value === 'store-1') whereCalls += 1;
            return { get: async () => ({ empty: true, docs: [], size: 0 }) };
          },
        };
      }

      return {
        doc: () => ({
          set: async () => undefined,
          delete: async () => undefined,
        }),
      };
    },
    batch: () => ({
      set: () => undefined,
      delete: () => undefined,
      commit: async () => undefined,
    }),
  });

  await mod.rebuildPublicProductsForStore('store-1');
  assert.equal(whereCalls, 1);
});


test('store aliases are normalized for public product docs', () => {
  const doc = t.toPublicProductDoc({
    storeId: 'store-1',
    productId: 'prod-1',
    store: {
      storeName: 'Renamed Store',
      storePhone: '+233501234567',
      storeCity: 'Accra',
      storeCountry: 'Ghana',
      address: '123 High St',
      storeStatus: 'active',
      eligibleForBuy: true,
      buyOptOut: false,
      verified: 'true',
    },
    product: { name: 'Rice', itemType: 'product' },
  });

  assert.equal(doc.storeName, 'Renamed Store');
  assert.equal(doc.name, 'Rice');
  assert.equal(doc.itemType, 'product');
  assert.equal(doc.city, 'Accra');
  assert.equal(doc.country, 'Ghana');
  assert.equal(doc.addressLine1, '123 High St');
  assert.equal(doc.verified, true);
  assert.match(doc.waLink, /wa\.me\/233501234567/);
});

test('product names are normalized to title case', () => {
  assert.equal(t.toTitleCase('skin booster injection'), 'Skin Booster Injection');

  const normalized = t.normalizeProduct({
    productName: 'skin booster injection',
    itemType: 'product',
  });

  assert.equal(normalized.name, 'Skin Booster Injection');
});

test('ranking score favors verified, recent, featured products', () => {
  const now = Date.now();
  const newerProduct = {
    name: 'Serum',
    itemType: 'product',
    featuredRank: 4,
    price: 30,
    stockCount: 20,
    imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    updatedAt: { toMillis: () => now },
  };
  const olderProduct = {
    ...newerProduct,
    featuredRank: 0,
    updatedAt: { toMillis: () => now - 180 * 24 * 60 * 60 * 1000 },
  };

  const boosted = t.computeRankingScore({ verified: true }, newerProduct);
  const baseline = t.computeRankingScore({ verified: false }, olderProduct);
  assert.ok(boosted > baseline);
});
