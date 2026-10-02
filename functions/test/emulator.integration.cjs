const assert = require('node:assert/strict');
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-buy-sedifex';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();

async function waitFor(checkFn, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await checkFn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for condition');
}

(async () => {
  const storeId = `store-${Date.now()}`;
  const productId = `product-${Date.now()}`;
  const publicId = `${storeId}_${productId}`;

  await db.collection('stores').doc(storeId).set({
    name: 'Integration Store',
    storeStatus: 'active',
    eligibleForBuy: true,
    buyOptOut: false,
    marketplaceApproved: true,
    whatsappNumber: '+12025550100',
  });

  await db.collection('products').doc(productId).set({
    storeId,
    name: 'integration product',
    itemType: 'product',
    isActive: true,
    isApproved: true,
  });

  const visibleDoc = await waitFor(async () => {
    const snap = await db.collection('publicProducts').doc(publicId).get();
    return snap.exists ? snap : null;
  });

  assert.equal(visibleDoc.get('isVisible'), true);
  assert.equal(visibleDoc.get('storeId'), storeId);
  assert.equal(visibleDoc.get('productId'), productId);

  await db.collection('stores').doc(storeId).set({ buyOptOut: true }, { merge: true });

  await waitFor(async () => {
    const snap = await db.collection('publicProducts').doc(publicId).get();
    return !snap.exists;
  });

  await db.collection('stores').doc(storeId).delete();
  await db.collection('products').doc(productId).delete();

  console.log('Integration emulator test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
