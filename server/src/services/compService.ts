import FileService from './fileService';
import BrowserService from './browserService';
import CompCacheService from './compCacheService';
import SportsCardsProAdapter from './adapters/sportsCardsPro';
import EbayAdapter from './adapters/ebay';
import CardLadderAdapter from './adapters/cardLadder';
import MarketMoversAdapter from './adapters/marketMovers';
import OneThirtyPointAdapter from './adapters/oneThirtyPoint';
import PsaAdapter from './adapters/psa';
import { CompAdapter, CompRequest, CompReport, CompResult, CompSource, StoredCompReport, PopulationData } from '../types';
import Database from '../database';
import PopulationReportService, { popMultiplier } from './populationReportService';

// ─── Aggregation Constants ──────────────────────────────────────────────────

const RECENCY_HALF_LIFE_DAYS = 30;
const DEDUP_PRICE_FLOOR = 0.50;            // minimum dollar tolerance
const DEDUP_PRICE_PERCENT = 0.03;          // 3% of average price
const DEDUP_DATE_TOLERANCE_MS = 2 * 86400000; // 2 days
const TRIM_PERCENTAGE = 0.10;
const UNKNOWN_DATE_WEIGHT = 0.10;
const MIN_RECENCY_WEIGHT = 0.20;          // floor so old sales still contribute
const MIN_SALES_FOR_TRIM = 5;
const SOURCE_RELIABILITY: Record<CompSource, number> = {
  'eBay': 1.0,
  'PSA': 0.95,
  '130Point': 0.9,
  'MarketMovers': 0.85,
  'CardLadder': 0.8,
  'SportsCardsPro': 0.6,
};

// ─── Aggregation Types ──────────────────────────────────────────────────────

export interface NormalizedSale {
  price: number;
  dateMs: number | null;
  venue: string;
  sourceAdapter: CompSource;
}

// ─── Aggregation Helpers ────────────────────────────────────────────────────

/**
 * Parse various date formats into epoch ms.
 * Returns null for empty/unparseable strings.
 */
export function normalizeDate(dateStr: string): number | null {
  if (!dateStr || !dateStr.trim()) return null;
  const trimmed = dateStr.trim();

  // ISO: YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(trimmed + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Slash: MM/DD/YYYY or MM/DD/YY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Natural: "Feb 23, 2026" etc.
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Exponential decay weight based on sale age, with a floor.
 * Half-life of 30 days: today=1.0, 30d=0.5, 60d=0.25, ~70d+=0.20 (floor)
 * The floor prevents over-concentration on sparse data — even old sales
 * retain meaningful influence when only a few sales exist.
 * Unknown dates get a fixed penalty weight (below the floor).
 */
export function recencyWeight(saleDateMs: number | null, nowMs: number): number {
  if (saleDateMs === null) return UNKNOWN_DATE_WEIGHT;
  const ageDays = Math.max(0, (nowMs - saleDateMs) / 86400000);
  return Math.max(MIN_RECENCY_WEIGHT, Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS));
}

/**
 * Compute the median date (epoch ms) of all dated sales.
 * Used as a proxy for undated sales so they receive a realistic
 * recency weight instead of the harsh UNKNOWN_DATE_WEIGHT penalty.
 * Returns null when no dated sales exist (all-undated batch).
 */
export function computeMedianPrice(sales: NormalizedSale[]): number | null {
  const prices = sales.map(s => s.price).filter((p): p is number => typeof p === 'number' && !isNaN(p));
  if (prices.length === 0) return null;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
  return Math.round(median * 100) / 100;
}

export function medianDateMs(sales: NormalizedSale[]): number | null {
  const dates = sales
    .map(s => s.dateMs)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  if (dates.length === 0) return null;
  const mid = Math.floor(dates.length / 2);
  return dates.length % 2 === 0
    ? Math.round((dates[mid - 1] + dates[mid]) / 2)
    : dates[mid];
}

/**
 * Compute the price tolerance for deduplication.
 * Uses the larger of a flat floor ($0.50) or a percentage (3%) of the
 * average of the two prices being compared. This adapts to card value:
 * cheap cards use the floor, expensive cards use the percentage.
 */
export function dedupPriceTolerance(priceA: number, priceB: number): number {
  const avgPrice = (priceA + priceB) / 2;
  return Math.max(DEDUP_PRICE_FLOOR, avgPrice * DEDUP_PRICE_PERCENT);
}

/**
 * Check whether two sale venues overlap for dedup purposes.
 * "130Point" as a venue means unknown marketplace (130Point is a
 * meta-aggregator), so it's treated as a potential match with any venue.
 */
export function venuesOverlap(venueA: string, venueB: string): boolean {
  const a = venueA.toLowerCase();
  const b = venueB.toLowerCase();
  if (a === b) return true;
  if (a.includes('ebay') && b.includes('ebay')) return true;
  // 130Point as a venue means unknown marketplace — could be from anywhere
  if (a === '130point' || b === '130point') return true;
  return false;
}

/**
 * Remove duplicate sales that appear across multiple sources.
 * Two sales are duplicates if: price within tolerance (3% of avg price,
 * min $0.50), dates within 2 days, and venues overlap (case-insensitive,
 * both contain "ebay", or either is "130Point" which is an unknown-
 * marketplace default from the 130Point meta-aggregator).
 * Input should be pre-sorted by source priority. First-seen wins.
 * Null-date sales are never deduped.
 */
export function deduplicateSales(sales: NormalizedSale[]): NormalizedSale[] {
  const kept: NormalizedSale[] = [];

  for (const sale of sales) {
    if (sale.dateMs === null) {
      kept.push(sale);
      continue;
    }

    const isDup = kept.some(existing => {
      if (existing.dateMs === null) return false;
      const tolerance = dedupPriceTolerance(existing.price, sale.price);
      if (Math.abs(existing.price - sale.price) > tolerance) return false;
      if (Math.abs(existing.dateMs - sale.dateMs!) > DEDUP_DATE_TOLERANCE_MS) return false;
      return venuesOverlap(existing.venue, sale.venue);
    });

    if (!isDup) {
      kept.push(sale);
    }
  }

  return kept;
}

/**
 * Compute a recency-weighted, trimmed mean from pooled sales.
 * Trims 10% of total weight from each tail when 5+ sales.
 * Returns null if no sales provided.
 */
export function computeWeightedTrimmedMean(
  sales: NormalizedSale[],
  nowMs: number,
  sourceReliability?: Record<string, number>
): { average: number; low: number; high: number } | null {
  if (sales.length === 0) return null;

  // Assign weights (use median date as proxy for undated sales)
  const proxyDateMs = medianDateMs(sales);

  const weighted = sales.map(s => ({
    price: s.price,
    weight: recencyWeight(s.dateMs ?? proxyDateMs, nowMs) * (sourceReliability?.[s.sourceAdapter] ?? 1),
  }));

  // Sort by price ascending
  weighted.sort((a, b) => a.price - b.price);

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) return null;

  let trimmedItems = weighted;

  // Trim tails if enough sales
  if (sales.length >= MIN_SALES_FOR_TRIM) {
    const trimWeight = totalWeight * TRIM_PERCENTAGE;

    // Trim low tail
    let lowTrimRemaining = trimWeight;
    let lowIdx = 0;
    while (lowIdx < weighted.length && lowTrimRemaining > 0) {
      if (weighted[lowIdx].weight <= lowTrimRemaining) {
        lowTrimRemaining -= weighted[lowIdx].weight;
        lowIdx++;
      } else {
        // Partial trim: reduce weight of this item
        weighted[lowIdx] = {
          ...weighted[lowIdx],
          weight: weighted[lowIdx].weight - lowTrimRemaining,
        };
        lowTrimRemaining = 0;
      }
    }

    // Trim high tail
    let highTrimRemaining = trimWeight;
    let highIdx = weighted.length - 1;
    while (highIdx >= lowIdx && highTrimRemaining > 0) {
      if (weighted[highIdx].weight <= highTrimRemaining) {
        highTrimRemaining -= weighted[highIdx].weight;
        highIdx--;
      } else {
        weighted[highIdx] = {
          ...weighted[highIdx],
          weight: weighted[highIdx].weight - highTrimRemaining,
        };
        highTrimRemaining = 0;
      }
    }

    trimmedItems = weighted.slice(lowIdx, highIdx + 1);
  }

  if (trimmedItems.length === 0) return null;

  const trimmedTotal = trimmedItems.reduce((sum, w) => sum + w.weight, 0);
  if (trimmedTotal === 0) return null;

  const average = trimmedItems.reduce((sum, w) => sum + w.price * w.weight, 0) / trimmedTotal;
  const low = trimmedItems[0].price;
  const high = trimmedItems[trimmedItems.length - 1].price;

  return { average, low, high };
}

/**
 * Fallback when no individual sales exist: weight market values by source reliability.
 */
export function computeFallbackFromMarketValues(
  results: CompResult[]
): { average: number; low: number; high: number } | null {
  const entries: { value: number; weight: number }[] = [];

  for (const r of results) {
    if (r.error) continue;
    const value = r.marketValue ?? r.averagePrice;
    if (value === null || value === undefined) continue;
    const weight = SOURCE_RELIABILITY[r.source] ?? 0.5;
    entries.push({ value, weight });
  }

  if (entries.length === 0) return null;

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const average = entries.reduce((sum, e) => sum + e.value * e.weight, 0) / totalWeight;
  const low = Math.min(...entries.map(e => e.value));
  const high = Math.max(...entries.map(e => e.value));

  return { average, low, high };
}

class CompService {
  private fileService: FileService;
  private adapters: CompAdapter[];
  private db?: Database;
  private popService?: PopulationReportService;

  constructor(
    fileService: FileService,
    adapters?: CompAdapter[],
    browserService?: BrowserService,
    cacheService?: CompCacheService,
    db?: Database,
    popService?: PopulationReportService
  ) {
    this.fileService = fileService;
    this.db = db;
    this.popService = popService;
    this.adapters = adapters || [
      new SportsCardsProAdapter(browserService, cacheService),
      new EbayAdapter(browserService, cacheService),
      new MarketMoversAdapter(browserService, cacheService),
      new OneThirtyPointAdapter(browserService, cacheService),
      new PsaAdapter(browserService, cacheService),
      new CardLadderAdapter(browserService, cacheService),
    ];
  }

  async generateComps(request: CompRequest, options?: { skipGradeProjection?: boolean }): Promise<CompReport> {
    // Filter adapters (skip PSA for non-PSA graded cards)
    const activeAdapters = this.adapters.filter(adapter => {
      if (adapter.source === 'PSA' && request.isGraded && request.gradingCompany && request.gradingCompany !== 'PSA') {
        return false;
      }
      return true;
    });

    // Run all adapters in parallel
    const settled = await Promise.allSettled(
      activeAdapters.map(adapter => adapter.fetchComps(request))
    );

    const results: CompResult[] = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      const errorMessage = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      return {
        source: activeAdapters[i].source,
        marketValue: null,
        sales: [],
        averagePrice: null,
        low: null,
        high: null,
        error: errorMessage,
      };
    });

    // Compute weighted aggregate from pooled sales (or fallback to market values)
    const { aggregateAverage, aggregateMedian, aggregateLow, aggregateHigh } = this.computeWeightedAggregate(results);

    // Fetch pop data for graded cards (failures don't break comps)
    let popData: PopulationData | null = null;
    let popMult: number | undefined;
    let popAdjustedAverage: number | null | undefined;

    if (this.popService) {
      try {
        popData = await this.popService.getPopulationData(request);
        if (popData && aggregateAverage !== null) {
          popMult = popMultiplier(popData.targetGradePop);
          popAdjustedAverage = Math.round(aggregateAverage * popMult * 100) / 100;
        }
      } catch (err) {
        console.error('[Pop] Error fetching pop data:', err);
      }
    }

    // Project PSA 10 / PSA 9 medians for ungraded cards by running the full
    // pipeline twice more with grade-qualified requests. Cached after first
    // call; only fires for raw cards on the top-level invocation.
    let psa10Median: number | null = null;
    let psa9Median: number | null = null;
    if (!options?.skipGradeProjection && !request.isGraded) {
      const projectionRequest = (grade: '10' | '9'): CompRequest => ({
        ...request,
        isGraded: true,
        gradingCompany: 'PSA',
        grade,
      });
      const [psa10Result, psa9Result] = await Promise.allSettled([
        this.generateComps(projectionRequest('10'), { skipGradeProjection: true }),
        this.generateComps(projectionRequest('9'), { skipGradeProjection: true }),
      ]);
      if (psa10Result.status === 'fulfilled') psa10Median = psa10Result.value.aggregateMedian;
      if (psa9Result.status === 'fulfilled') psa9Median = psa9Result.value.aggregateMedian;
    }

    return {
      cardId: request.cardId,
      player: request.player,
      year: request.year,
      brand: request.brand,
      cardNumber: request.cardNumber,
      condition: request.condition,
      sources: results,
      aggregateAverage,
      aggregateMedian,
      aggregateLow,
      aggregateHigh,
      psa10Median,
      psa9Median,
      popData,
      popMultiplier: popMult,
      popAdjustedAverage,
      generatedAt: new Date().toISOString(),
    };
  }

  async generateAndWriteComps(request: CompRequest): Promise<CompReport> {
    const report = await this.generateComps(request);

    // Log errors to comp-error.log
    const failedSources = report.sources.filter(s => s.error);
    for (const source of failedSources) {
      const filename = `${request.year}-${request.brand}-${request.player}-${request.cardNumber}`;
      this.fileService.appendLog('comp-error.log', {
        timestamp: new Date().toISOString(),
        filename,
        reason: `${source.source} - ${source.error}`,
      });
    }

    // Persist to DB (primary storage)
    if (this.db) {
      await this.db.saveCompReport(request.cardId, report);
    }

    return report;
  }

  async getStoredComps(cardId: string): Promise<StoredCompReport | undefined> {
    if (!this.db) return undefined;
    return this.db.getLatestCompReport(cardId);
  }

  async getCompHistory(cardId: string, limit?: number): Promise<StoredCompReport[]> {
    if (!this.db) return [];
    return this.db.getCompHistory(cardId, limit);
  }

  private computeWeightedAggregate(results: CompResult[]): {
    aggregateAverage: number | null;
    aggregateMedian: number | null;
    aggregateLow: number | null;
    aggregateHigh: number | null;
  } {
    const successfulResults = results.filter(r => !r.error);

    // Pool all individual sales from all sources and normalize dates
    const allSales: NormalizedSale[] = [];
    for (const r of successfulResults) {
      for (const sale of r.sales) {
        allSales.push({
          price: sale.price,
          dateMs: normalizeDate(sale.date),
          venue: sale.venue,
          sourceAdapter: r.source,
        });
      }
    }

    if (allSales.length > 0) {
      // Sort by source sales count descending for dedup priority
      const salesCountBySource = new Map<CompSource, number>();
      for (const r of successfulResults) {
        salesCountBySource.set(r.source, r.sales.length);
      }
      allSales.sort((a, b) => {
        const countA = salesCountBySource.get(a.sourceAdapter) || 0;
        const countB = salesCountBySource.get(b.sourceAdapter) || 0;
        return countB - countA;
      });

      // Deduplicate cross-source
      const deduped = deduplicateSales(allSales);

      // Compute weighted trimmed mean
      const nowMs = Date.now();
      const result = computeWeightedTrimmedMean(deduped, nowMs, SOURCE_RELIABILITY);
      if (result) {
        return {
          aggregateAverage: result.average,
          aggregateMedian: computeMedianPrice(deduped),
          aggregateLow: result.low,
          aggregateHigh: result.high,
        };
      }
    }

    // Fallback: use market values weighted by source reliability
    const fallback = computeFallbackFromMarketValues(results);
    if (fallback) {
      return {
        aggregateAverage: fallback.average,
        aggregateMedian: null,
        aggregateLow: fallback.low,
        aggregateHigh: fallback.high,
      };
    }

    return {
      aggregateAverage: null,
      aggregateMedian: null,
      aggregateLow: null,
      aggregateHigh: null,
    };
  }

}

export default CompService;
