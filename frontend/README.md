# buy-sedifex frontend

Next.js storefront for `publicProducts` in Firestore with manual store approval from `approvedStores`.

## Run locally

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set Firebase web SDK values.

## Deploy to Vercel

1. Import this repository in Vercel.
2. If you deploy from the repository root, keep **Root Directory** at `/` (the root `vercel.json` runs the frontend build automatically).
3. If you prefer deploying only `frontend`, set **Root Directory** to `frontend` and use the local `frontend/vercel.json`.
4. Add all `NEXT_PUBLIC_FIREBASE_*` variables.
5. Deploy.

## Deploy Firestore indexes and rules (required for product queries)

The product grid uses Firestore queries that require composite indexes from `firestore.indexes.json`.
If these indexes are not deployed, Firestore returns `failed-precondition` / `missing index` and products will not load.

From the repository root, run:

```bash
firebase deploy --only firestore:indexes,firestore:rules
```

This deploys both:
- `firestore.indexes.json` (composite indexes)
- `firestore.rules` (public read access for `publicProducts` and `approvedStores`)

## Firebase env values (important)

Use the **Firebase Web app config** values (Firebase Console → Project settings → General → Your apps → Web app config).

- `NEXT_PUBLIC_FIREBASE_API_KEY` → `apiKey`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` → `authDomain`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` → `projectId`
- `NEXT_PUBLIC_FIREBASE_APP_ID` → `appId`

`NEXT_PUBLIC_*` variables are inlined at build time by Next.js. If you add or change them in Vercel, trigger a **new deployment** so the storefront gets updated values.

## Approving stores for the storefront

The storefront now only shows products for stores that are listed in Firestore collection `approvedStores`.

- Collection: `approvedStores`
- Document ID: `{storeId}` (must match the store ID from `stores/{storeId}`)
- Suggested fields:
  - `storeName` (string, used for the store filter label)

Example document:

```json
{
  "storeName": "Aster Pharmacy"
}
```

## Performance and Core Web Vitals

Core Web Vitals should be monitored with Vercel's platform tooling or local Lighthouse runs. The former per-visit `/api/web-vitals` reporter was removed to avoid a serverless invocation for every browser metric.

Remote marketplace images are intentionally served from their source CDN instead of Vercel Image Optimization. This avoids transformation usage for the marketplace's unbounded merchant image catalog. High-volume browsing analytics use a stable 1% session sample, while conversion events continue to be recorded without sampling.

To generate a local Core Web Vitals report with Lighthouse:

```bash
npm run dev
npm run cwv
```

This outputs `.lighthouse/core-web-vitals.report.html` and `.lighthouse/core-web-vitals.report.json`.
