# Sports Card Tracker — Workflow

The app takes you from raw card photos to priced, export-ready eBay listings. The short version:

**raw photo → identify/confirm → comps run automatically → card promoted to Inventory with a price → eBay CSV**

---

## 1. Ingest Photos → Holding Pen

- Drop raw card photos into the `raw/` folder, or drag-and-drop / click-to-upload in the UI.
- The **Holding Pen** shows everything in `raw/`.
- Front/back shots are auto-paired via `-front` / `-back` filename suffixes (e.g. `trout-front.jpg` / `trout-back.jpg`). Pairs are sent to the vision API together for better accuracy.

## 2. Identify → Review → Confirm

1. **Identify**: Claude Vision analyzes the image (or pair) and extracts card data — player, year, brand, set, card number, team, category, parallel, serial number, grading info, and feature flags (rookie, auto, relic, numbered, graded) — with a confidence score (high 80%+, medium 60–80%, low <60%). Nothing is saved or copied at this step.
2. **Review & Confirm**: You review and correct the extracted data in the **Card Review Form**, then confirm. On confirm:
   - The image is copied to `processed/` and renamed as `{Year}-{Brand}-{SetName}-{PlayerName}-{CardNumber}.{ext}` (set name omitted if not detected).
   - A card record is created with `collectionType: 'Pending'`.
   - **A comp-generation job is queued automatically** — no manual step needed.

**Batch mode**: An async job queue can process many images at once, skipping manual review and using a confidence threshold instead. Progress streams to the frontend via SSE. Failures on individual cards do not halt the batch; they are logged to database audit logs. A single comp job is queued automatically for all cards the batch creates.

**Duplicate detection**: Cards are matched on player + year + brand + card number. Re-running the pipeline on the same raw images will not create duplicates; orphaned DB records (no matching files on disk) are auto-cleaned.

## 3. Comps → Auto-Priced, Auto-Promoted

Comps run automatically after confirm (single card) or after a batch completes. You can also re-run them anytime from the **Processed Gallery** — per card, or in bulk via an async job.

Six sources run in parallel, ordered by reliability weight:

| Source | Weight | Notes |
|---|---|---|
| eBay Sold Listings | 1.0 | Recent completed sales |
| PSA | 0.95 | Cert verification and sales data (skipped for non-PSA graded cards) |
| 130Point | 0.9 | eBay sold data aggregator |
| Market Movers | 0.85 | Multi-marketplace sales records (Sports Card Investor) |
| Card Ladder | 0.8 | 100M+ historical sales (eBay, Goldin, Heritage, Fanatics, etc.) |
| SportsCardsPro | 0.6 | Market values and price data |

When a comp report produces a price:

- The card's `currentValue` is set (pop-adjusted average preferred, raw aggregate otherwise) and a value snapshot is recorded.
- A `Pending` card is **automatically promoted to `Inventory`** — it's now priced and export-eligible. Cards you've already tagged PC or Inventory are left untouched.
- A card stuck in `Pending` means comps haven't produced a price yet (sources failed or no sales found) — re-run from the Processed Gallery.

Comp reports live in the database only (view them in the Comp Report modal from the Processed Gallery). Adapters need a running browser service and, for Market Movers / Card Ladder, credentials in `server/.env` (`MARKETMOVERS_EMAIL/PASSWORD`, `CARDLADDER_EMAIL/PASSWORD`).

## 4. Tag and Organize

- Cards default to **Inventory** (for sale) once priced. Tag anything you're keeping as **Personal Collection** — PC cards are excluded from eBay exports and recommendations.
- Record physical storage location: Room → Shelf → Box → Row → Slot (Storage screen). Searchable by card.
- Track grading submissions to PSA/BGS/SGC: submission #, status (Submitted → Received → Grading → Shipped Back → Complete), turnaround, cost.

## 5. List on eBay

- From **eBay Listings**, export the eBay bulk-upload CSV. Files are written to `exports/` (gitignored), e.g. `exports/ebay-draft-upload-<timestamp>.csv`, and a draft record is saved in the database.
- Pricing comes from the latest comp report (pop-adjusted average → aggregate average), falling back to `currentValue` when the report is older than 30 days.
- Each row includes title (max 80 chars), description, category, price, condition, photos, shipping, return policy, and item specifics, using `eBay-draft-listing-template.csv` as the column/format reference.
- Only unsold Inventory cards are exported; PC and Pending cards are skipped.

## 6. Track Performance

- **Sales**: Record `sellPrice`/`sellDate` on a card when it sells; profit and portfolio stats update from there.
- **Price alerts**: Per-card thresholds, checked hourly against `currentValue` (which comps keep fresh), delivered via SSE notifications.
- **Reporting**: Portfolio heatmap (7d/30d/90d/YTD/all-time), tax reports (short- vs. long-term gains), grading ROI analysis, and the 11-tab Reports section.

### Planned (not yet implemented)

eBay API integration (sold-item reconciliation, relist automation, listing views/watchers), cross-platform exports (COMC, MySlabs, Fanatics), consignment tracking, QR label printing, and automated grade-posted alerts. Until then, sales are reconciled manually.

---

## Running the App

```bash
npm run dev   # starts backend (Express, port 8000) and frontend (React, port 3000)
```

Then open http://localhost:3000 and start by putting photos in `raw/` — confirmed cards come out the other end priced and ready to export.
