import { CompAdapter, CompRequest, CompResult, CompSource, CompSale } from '../../types';
import CompCacheService from '../compCacheService';
import BrowserService from '../browserService';
import { MARKETMOVERS_SELECTORS } from './selectors';

// ─── Constants ──────────────────────────────────────────────────────────────

const TRPC_BASE = 'https://d1ekdvyhrdz9i5.cloudfront.net/trpc';
const WP_LOGIN_URL = 'https://www.sportscardinvestor.com/wp-login.php?redirect_to=sci_v2';
const MM_DASHBOARD_URL = 'https://marketmovers.sportscardinvestor.com/dashboard';

// ─── Token Cache ────────────────────────────────────────────────────────────

interface MMAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

let cachedTokens: MMAuthTokens | null = null;

function _resetTokenCache(): void {
  cachedTokens = null;
}

// ─── tRPC Response Types ────────────────────────────────────────────────────

interface MMCollectibleStats {
  avgPrice: number;
  maxPrice: number;
  minPrice: number;
  totalSalesCount: number;
  endAvgPrice: number;
  priceChangePercentage: number | null;
}

interface MMCollectibleItem {
  id: number;
  searchTitle: string;
  collectibleType: string;
  imageUrl: string | null;
  stats: Record<string, MMCollectibleStats>;
  player: { id: number; name: string };
  set: { id: number; name: string; year: string };
  grade: { id: number; name: string } | null;
  cardNumber: string;
  isRookie: boolean;
  setVariation?: {
    displayName: string;
    printRun: string | null;
    printRunValue: number | null;
    variation?: { name: string };
  } | null;
}

interface MMRawSaleItem {
  displayTitle: string;
  finalPrice: number;
  saleDate: string;
  seller: { name: string };
  saleUrl: string;
  imageUrls: string[];
  listingType: string;
  isBestOfferAccepted: boolean;
  offerPrice: number | null;
}

// ─── Auth Functions ─────────────────────────────────────────────────────────

function getTokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return (payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

async function authenticateViaPuppeteer(
  browserService: BrowserService
): Promise<MMAuthTokens | null> {
  const email = process.env.MARKETMOVERS_EMAIL;
  const password = process.env.MARKETMOVERS_PASSWORD;
  if (!email || !password) return null;

  const page = await browserService.navigateWithThrottle('MarketMovers', WP_LOGIN_URL);

  try {
    await page.type(MARKETMOVERS_SELECTORS.wpLoginUsername, email);
    await page.type(MARKETMOVERS_SELECTORS.wpLoginPassword, password);
    await page.click(MARKETMOVERS_SELECTORS.wpLoginSubmit);
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

    // Navigate to MM dashboard to trigger SSO exchange
    await page.goto(MM_DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for SPA to exchange SSO code for JWT
    await page.waitForFunction(
      () => localStorage.getItem('mm_token') !== null,
      { timeout: 15000 }
    );

    const accessToken = await page.evaluate(() => localStorage.getItem('mm_token'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('mm_rt'));

    await page.close();

    if (!accessToken) return null;

    const tokens: MMAuthTokens = {
      accessToken,
      refreshToken: refreshToken || '',
      expiresAt: getTokenExpiry(accessToken),
    };
    cachedTokens = tokens;
    return tokens;
  } catch {
    try { await page.close(); } catch { /* ignore */ }
    return null;
  }
}

async function refreshMMToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${TRPC_BASE}/auth.refreshToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      cachedTokens = null;
      return null;
    }

    const data = (await res.json()) as {
      result?: { data?: { accessToken?: string; refreshToken?: string } };
    };
    const newToken = data?.result?.data?.accessToken;
    if (!newToken) {
      cachedTokens = null;
      return null;
    }

    cachedTokens = {
      accessToken: newToken,
      refreshToken: data?.result?.data?.refreshToken || refreshToken,
      expiresAt: getTokenExpiry(newToken),
    };
    return newToken;
  } catch {
    cachedTokens = null;
    return null;
  }
}

async function getAccessToken(browserService: BrowserService): Promise<string | null> {
  // Return cached if still valid (5-min buffer)
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 300_000) {
    return cachedTokens.accessToken;
  }

  // Try refresh token via HTTP first
  if (cachedTokens?.refreshToken) {
    const refreshed = await refreshMMToken(cachedTokens.refreshToken);
    if (refreshed) return refreshed;
  }

  // Full re-auth via Puppeteer
  const tokens = await authenticateViaPuppeteer(browserService);
  return tokens?.accessToken || null;
}

// ─── tRPC Helper ────────────────────────────────────────────────────────────

async function trpcQuery<T>(
  endpoint: string,
  input: unknown,
  accessToken: string
): Promise<T> {
  const url = `${TRPC_BASE}/${endpoint}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`tRPC ${endpoint}: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { result?: { data?: T } };
  if (data?.result?.data === undefined || data?.result?.data === null) {
    throw new Error(`tRPC ${endpoint}: no data in response`);
  }
  return data.result.data;
}

// ─── Search Query Builders ──────────────────────────────────────────────────

function buildSearchQuery(request: CompRequest): string {
  const parts: string[] = [String(request.year), request.brand];
  if (request.setName) parts.push(request.setName);
  parts.push(request.player);
  if (request.cardNumber) parts.push(`#${request.cardNumber}`);
  if (request.parallel) parts.push(request.parallel);
  if (request.isGraded && request.gradingCompany && request.grade) {
    parts.push(request.gradingCompany, request.grade);
  }
  return parts.join(' ');
}

function buildCollectiblesSearchInput(request: CompRequest): unknown {
  const searchText = [
    String(request.year),
    request.brand,
    request.setName || '',
    request.player,
    request.cardNumber,
  ].filter(Boolean).join(' ').trim();

  return {
    sort: [
      { sortBy: 'stats.last30.totalSalesCount', sortDirection: 'desc' },
      { sortBy: 'stats.all.endAvgPrice', sortDirection: 'desc' },
    ],
    filters: {},
    collectibleType: 'sports-card',
    limit: 20,
    offset: 0,
    titleSearchQueryText: searchText,
  };
}

function buildRawSalesSearchInput(request: CompRequest): unknown {
  const searchText = buildSearchQuery(request);
  return {
    titleSearchQueryText: searchText,
    filters: {},
    titleSearchQuery: {
      includeTerms: [],
      includeOrTermGroups: [],
      excludeTerms: ['lot', 'reprint', 'digital', 'custom'],
    },
    sort: [
      { sortBy: 'saleDate', sortDirection: 'desc' },
      { sortBy: 'score', sortDirection: 'desc' },
    ],
    offset: 0,
    limit: 20,
  };
}

// ─── Result Scoring ─────────────────────────────────────────────────────────

function scoreCollectibleMatch(
  item: MMCollectibleItem,
  request: CompRequest
): number {
  let score = 0;

  // Year must match
  if (String(item.set.year) !== String(request.year)) return -1;

  // Player last name must appear
  const lastName = request.player.split(' ').pop()?.toLowerCase() || '';
  if (lastName && !item.player.name.toLowerCase().includes(lastName)) return -1;
  score += 10;

  // Card number match
  if (
    item.cardNumber &&
    item.cardNumber.toLowerCase() === request.cardNumber.toLowerCase()
  ) {
    score += 20;
  }

  // Set/brand match
  const setName = item.set.name.toLowerCase();
  if (setName.includes(request.brand.toLowerCase())) score += 5;
  if (request.setName && setName.includes(request.setName.toLowerCase())) {
    score += 10;
  }

  // Parallel/variation match
  if (request.parallel) {
    const variation = item.setVariation?.variation?.name?.toLowerCase() || '';
    const displayName = item.setVariation?.displayName?.toLowerCase() || '';
    if (
      variation.includes(request.parallel.toLowerCase()) ||
      displayName.includes(request.parallel.toLowerCase())
    ) {
      score += 10;
    }
  } else {
    // Prefer base cards when no parallel requested
    const variation = item.setVariation?.variation?.name?.toLowerCase() || '';
    if (variation === 'base' || variation === '' || !item.setVariation) {
      score += 5;
    }
  }

  // Grade match
  if (request.isGraded && request.gradingCompany && request.grade) {
    const itemGrade = item.grade?.name?.toLowerCase() || '';
    const wantGrade = `${request.gradingCompany} ${request.grade}`.toLowerCase();
    if (itemGrade === wantGrade) score += 15;
    else if (itemGrade.includes(request.gradingCompany.toLowerCase())) score += 5;
  } else {
    // Raw card — graded entries price a different asset; make them ineligible
    // rather than merely less-preferred, so a graded item can never win when
    // no ungraded entry exists.
    const gradeName = item.grade?.name?.toLowerCase() || '';
    if (!item.grade || gradeName === 'raw' || gradeName === '') {
      score += 15;
    } else {
      return -1;
    }
  }

  // Rookie bonus
  if (request.isRookie && item.isRookie) score += 3;

  return score;
}

// ─── Adapter ────────────────────────────────────────────────────────────────

class MarketMoversAdapter implements CompAdapter {
  public readonly source: CompSource = 'MarketMovers';
  private browserService?: BrowserService;
  private cacheService?: CompCacheService;

  constructor(browserService?: BrowserService, cacheService?: CompCacheService) {
    this.browserService = browserService;
    this.cacheService = cacheService;
  }

  async fetchComps(request: CompRequest): Promise<CompResult> {
    // Check cache first
    if (this.cacheService) {
      const cached = this.cacheService.get(this.source, request);
      if (cached) return cached;
    }

    // Require credentials
    if (!process.env.MARKETMOVERS_EMAIL || !process.env.MARKETMOVERS_PASSWORD) {
      return this.errorResult(
        'Market Movers credentials not configured (set MARKETMOVERS_EMAIL and MARKETMOVERS_PASSWORD)'
      );
    }

    // Require Puppeteer for auth
    if (!this.browserService || !this.browserService.isRunning()) {
      return this.errorResult(
        'Market Movers requires Puppeteer for authentication (Puppeteer disabled)'
      );
    }

    try {
      const accessToken = await getAccessToken(this.browserService);
      if (!accessToken) {
        return this.errorResult('Market Movers authentication failed');
      }

      // Fetch from both endpoints in parallel
      const [collectibleResult, rawSalesResult] = await Promise.allSettled([
        this.fetchCollectibleData(accessToken, request),
        this.fetchRawSalesData(accessToken, request),
      ]);

      let marketValue: number | null = null;
      if (collectibleResult.status === 'fulfilled' && collectibleResult.value !== null) {
        marketValue = collectibleResult.value;
      }

      let sales: CompSale[] = [];
      if (rawSalesResult.status === 'fulfilled') {
        sales = rawSalesResult.value;
      }

      if (marketValue === null && sales.length === 0) {
        return this.errorResult(
          `No Market Movers data found for: ${buildSearchQuery(request)}`
        );
      }

      // Calculate aggregates from sales
      const prices = sales.map(s => s.price);
      let averagePrice: number | null = null;
      let low: number | null = null;
      let high: number | null = null;

      if (prices.length > 0) {
        averagePrice = Math.round(
          (prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100
        ) / 100;
        low = Math.round(Math.min(...prices) * 100) / 100;
        high = Math.round(Math.max(...prices) * 100) / 100;
      } else if (marketValue !== null) {
        averagePrice = marketValue;
      }

      const result: CompResult = {
        source: this.source,
        marketValue: marketValue !== null ? Math.round(marketValue * 100) / 100 : null,
        sales,
        averagePrice,
        low,
        high,
      };

      if (this.cacheService) {
        this.cacheService.set(this.source, request, result);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResult(`Market Movers error: ${message}`);
    }
  }

  private async fetchCollectibleData(
    accessToken: string,
    request: CompRequest
  ): Promise<number | null> {
    const input = buildCollectiblesSearchInput(request);

    interface CollectiblesResponse {
      items: Array<{ item: MMCollectibleItem; score: number }>;
    }

    const data = await trpcQuery<CollectiblesResponse>(
      'private.collectibles.search',
      input,
      accessToken
    );

    if (!data.items || data.items.length === 0) return null;

    // Score and pick best match
    const scored = data.items
      .map(entry => ({
        item: entry.item,
        score: scoreCollectibleMatch(entry.item, request),
      }))
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;

    const best = scored[0].item;
    // Use last30 endAvgPrice as market value, fall back to avgPrice
    const stats = best.stats?.last30;
    if (stats) {
      if (stats.endAvgPrice > 0) return Math.round(stats.endAvgPrice * 100) / 100;
      if (stats.avgPrice > 0) return Math.round(stats.avgPrice * 100) / 100;
    }

    // Fall back to last90
    const stats90 = best.stats?.last90;
    if (stats90) {
      if (stats90.endAvgPrice > 0) return Math.round(stats90.endAvgPrice * 100) / 100;
      if (stats90.avgPrice > 0) return Math.round(stats90.avgPrice * 100) / 100;
    }

    return null;
  }

  private async fetchRawSalesData(
    accessToken: string,
    request: CompRequest
  ): Promise<CompSale[]> {
    const input = buildRawSalesSearchInput(request);

    interface RawSalesResponse {
      totalCount: number;
      items: MMRawSaleItem[];
    }

    const data = await trpcQuery<RawSalesResponse>(
      'private.rawSales.completed.search',
      input,
      accessToken
    );

    if (!data.items || data.items.length === 0) return [];

    // Filter by relevance (must contain player's last name)
    const lastName = request.player.split(' ').pop()?.toLowerCase() || '';
    const relevant = lastName
      ? data.items.filter(item =>
          item.displayTitle.toLowerCase().includes(lastName)
        )
      : data.items;

    const items = relevant.length >= 3 ? relevant : data.items;

    return items.slice(0, 15).map(item => ({
      date: item.saleDate.split('T')[0],
      price: Math.round(
        (item.isBestOfferAccepted && item.offerPrice
          ? item.offerPrice
          : item.finalPrice) * 100
      ) / 100,
      venue: item.seller?.name || 'Market Movers',
    }));
  }

  private errorResult(error: string): CompResult {
    return {
      source: this.source,
      marketValue: null,
      sales: [],
      averagePrice: null,
      low: null,
      high: null,
      error,
    };
  }
}

export default MarketMoversAdapter;
export {
  buildSearchQuery,
  buildCollectiblesSearchInput,
  buildRawSalesSearchInput,
  scoreCollectibleMatch,
  getTokenExpiry,
  getAccessToken,
  trpcQuery,
  _resetTokenCache,
};
