const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const loadHelper = () => import(pathToFileURL(`${process.cwd()}/src/lib/next-image-source.ts`).href);

test('next/image sources retain configured remote and local URLs', async () => {
  const { getOptimizableImageSource } = await loadHelper();

  assert.equal(getOptimizableImageSource('https://storage.googleapis.com/bucket/item.jpg'), 'https://storage.googleapis.com/bucket/item.jpg');
  assert.equal(getOptimizableImageSource('http://firebasestorage.googleapis.com/item.jpg'), 'http://firebasestorage.googleapis.com/item.jpg');
  assert.equal(getOptimizableImageSource('/sedifex-logo.svg'), '/sedifex-logo.svg');
});

test('next/image sources fall back for merchant hosts outside remotePatterns', async () => {
  const { getOptimizableImageSource, NEXT_IMAGE_PLACEHOLDER } = await loadHelper();

  assert.equal(getOptimizableImageSource('https://cdn.example.com/product.jpg'), NEXT_IMAGE_PLACEHOLDER);
  assert.equal(getOptimizableImageSource('https://storage.googleapis.com.evil.example/product.jpg'), NEXT_IMAGE_PLACEHOLDER);
  assert.equal(getOptimizableImageSource('not a URL'), NEXT_IMAGE_PLACEHOLDER);
});
