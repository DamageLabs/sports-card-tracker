import path from 'path';
import Database from 'better-sqlite3';
import {
  NormalizedSale,
  computeMedianPrice,
  deduplicateSales,
  normalizeDate,
} from '../services/compService';
import { CompSource } from '../types';

interface ReportRow {
  id: string;
  cardId: string;
  aggregateMedian: number | null;
}

interface SourceRow {
  reportId: string;
  source: string;
  sales: string;
  error: string | null;
}

interface SaleJson {
  price: number;
  date: string;
  venue: string;
}

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'database.sqlite');
const db = new Database(dbPath);

const reports = db
  .prepare<[], ReportRow>('SELECT id, cardId, aggregateMedian FROM card_comp_reports WHERE aggregateMedian IS NULL')
  .all();

console.log(`Found ${reports.length} report(s) needing median backfill`);

const sourcesByReport = new Map<string, SourceRow[]>();
const allSources = db
  .prepare<[], SourceRow>('SELECT reportId, source, sales, error FROM card_comp_sources')
  .all();
for (const s of allSources) {
  const arr = sourcesByReport.get(s.reportId) ?? [];
  arr.push(s);
  sourcesByReport.set(s.reportId, arr);
}

const updateStmt = db.prepare('UPDATE card_comp_reports SET aggregateMedian = ? WHERE id = ?');

let updated = 0;
let skipped = 0;
for (const report of reports) {
  const sources = sourcesByReport.get(report.id) ?? [];
  const successful = sources.filter(s => !s.error);

  const allSales: NormalizedSale[] = [];
  for (const src of successful) {
    let sales: SaleJson[] = [];
    try {
      sales = JSON.parse(src.sales) as SaleJson[];
    } catch {
      continue;
    }
    if (!Array.isArray(sales)) continue;
    for (const sale of sales) {
      if (typeof sale?.price !== 'number') continue;
      allSales.push({
        price: sale.price,
        dateMs: normalizeDate(sale.date),
        venue: sale.venue || '',
        sourceAdapter: src.source as CompSource,
      });
    }
  }

  if (allSales.length === 0) {
    skipped++;
    continue;
  }

  // Mirror the live aggregator: sort by source sales count descending for dedup priority
  const salesCountBySource = new Map<CompSource, number>();
  for (const sale of allSales) {
    salesCountBySource.set(sale.sourceAdapter, (salesCountBySource.get(sale.sourceAdapter) ?? 0) + 1);
  }
  allSales.sort((a, b) => {
    const countA = salesCountBySource.get(a.sourceAdapter) ?? 0;
    const countB = salesCountBySource.get(b.sourceAdapter) ?? 0;
    return countB - countA;
  });

  const deduped = deduplicateSales(allSales);
  const median = computeMedianPrice(deduped);

  if (median === null) {
    skipped++;
    continue;
  }

  updateStmt.run(median, report.id);
  updated++;
}

console.log(`Backfill complete: updated=${updated}, skipped=${skipped} (no usable sales)`);
db.close();
