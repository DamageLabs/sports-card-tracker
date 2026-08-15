# Storefront Pages (Design — Not Yet Implemented)

## Status

**Proposed / designed, not built.** This document captures the full design so
implementation can be picked up later. Estimated effort: ~1.5 days.

## Motivation

A published, read-only public page for a set of inventory cards — a
"storefront" — enables pre-eBay private sales: share a tranche with a buyer
or group before it's listed ("first pick before it hits eBay, no fees"), or
show off sellable inventory with real asking prices.

Inspired by SetScribe's shared-collection pages
(https://setscribe.com/collectiondemo/), which prove the UX (search, filter
chips, contact button) but show only metadata. Our version is stronger on day
one because every card carries a **comp-backed asking price** and graded/raw
status from the existing pipeline.

## Key insight: all the hard parts already exist

- **Public hosting**: the GCP VM serves static content via Nginx
  (`GCP_SCP_*` config in `server/.env`, images at `GCP_IMAGE_BASE_URL`).
- **Image distribution**: `scpUploadService` already pushes processed card
  images to the VM for eBay CSVs, with remote URLs tracked per image in the
  `card_image_uploads` table.
- **Priced inventory**: comp reports supply asking prices; cards carry
  graded/raw status, parallels, and clean cropped images.

A storefront is one more static artifact pushed down the same pipe. No new
infrastructure, no auth system, no server-side rendering.

## Architecture: static publish (snapshot), not a live site

```
Inventory (filtered)  →  build static bundle  →  SCP to VM  →  public URL
   cards + comps          index.html + data.json     /var/www/html/store/<slug>/
                          (self-contained page)      http://<vm>/store/x7f3.../
```

Publishing is a **snapshot**, deliberately (same philosophy as the eBay CSV
exports):

- The public page cannot drift out of sync with a live DB being edited.
- Nothing to secure or keep running; Nginx serves flat files.
- "Republish" is one click when inventory changes.
- "Unpublish" deletes the remote directory.

## Components

### 1. Database — `storefronts` table

| Column | Notes |
|---|---|
| `id` | uuid |
| `slug` | unguessable random token — the only access control a share-link needs |
| `title`, `description` | shown on the page header |
| `cardIds` | JSON snapshot of the card ids included at publish time |
| `options` | JSON: `showPrices`, `showSold`, contact config (see below) |
| `contact` | mailto address or eBay store URL for the Contact button |
| `publishedAt`, `updatedAt` | timestamps |

Drizzle migration + `drizzle/meta/_journal.json` entry + `BASELINE_SQL`
update in `server/src/database.ts` (the in-memory test DB builds from
BASELINE_SQL — forgetting it breaks the whole test suite; see the
`ebayExportedAt` migration for the pattern).

### 2. Backend — `server/src/services/storefrontService.ts`

`publish(options)`:

1. Query cards — a collection id, a filter, or explicit `cardIds` (same
   pattern as `ebayExportService.generateCsv`).
2. Resolve image URLs: reuse `card_image_uploads` remote URLs where present;
   SCP any missing images via `scpUploadService`.
3. Emit `data.json`: per card — player, year/brand/set/parallel, grade or
   RAW, asking price (latest comp report: pop-adjusted → aggregate →
   `currentValue` fallback, same resolution as the eBay export), image URLs.
4. Emit `index.html` — **a single self-contained file** (vanilla JS, no
   build step) that fetches `data.json` and renders:
   - card grid with images
   - instant client-side search
   - sort (player / year / price)
   - filter chips: Graded/Raw, category, price range
   - card detail view with front/back images
   - Contact button (mailto or eBay store URL from options)
5. SCP the bundle to `/var/www/html/store/<slug>/`; store and return the URL.

Also: `republish(id)` (rebuild + re-upload) and `unpublish(id)` (delete the
remote directory over SSH, keep the DB row with `publishedAt = null`).

### 3. Routes — `server/src/routes/storefronts.ts`

| Method | Path | Action |
|---|---|---|
| POST | `/api/storefronts` | create + publish |
| GET | `/api/storefronts` | list with URLs/status |
| POST | `/api/storefronts/:id/republish` | rebuild + re-upload |
| DELETE | `/api/storefronts/:id` | unpublish + delete |

Audit actions to register in `AuditDetailsMap` (`server/src/types.ts`):
`storefront.publish`, `storefront.republish`, `storefront.unpublish`.

### 4. Frontend

- **"Publish Storefront"** action in the card list operating on the current
  filter/selection — batch collections slot in naturally (one storefront per
  selling tranche).
- Management panel (list, copy link, republish, unpublish). A modal from the
  card list is enough for the MVP; no new page needed.

## Privacy rules (hard-coded, not optional)

Never publish:

- `purchasePrice` / cost basis / P&L of any kind
- `notes`
- `storageLocation`
- anything tagged PC

Asking price only — and even that toggleable per storefront (`showPrices`).

## Open decisions (config, non-blocking)

1. **Domain**: is the VM's bare IP acceptable for shared links, or put a
   domain in front first? (Links look like `http://<ip>/store/<slug>/`.)
2. **Contact target**: email (mailto) vs eBay store URL — per-storefront
   option either way.

## Implementation checklist

- [ ] Migration `00XX_storefronts.sql` + journal entry + BASELINE_SQL
- [ ] `storefrontService` (build, publish, republish, unpublish)
- [ ] Static `index.html` template (the only genuinely new code)
- [ ] Routes + audit actions
- [ ] Card list UI: publish action + management modal
- [ ] Tests: service (mock SCP), routes, template data shape
- [ ] Verify end-to-end against the GCP VM
