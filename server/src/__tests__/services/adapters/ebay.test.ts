import EbayAdapter, { buildSearchQuery, filterByRelevance, computeTrimmedMean } from '../../../services/adapters/ebay';
import { CompRequest, CompResult } from '../../../types';

function createMockBrowserService(pageReturnValue: unknown = []) {
  const mockPage = {
    $$eval: jest.fn().mockResolvedValue(pageReturnValue),
    $eval: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const browserService = {
    isRunning: jest.fn().mockReturnValue(true),
    navigateWithThrottle: jest.fn().mockResolvedValue(mockPage),
    throttle: jest.fn().mockResolvedValue(undefined),
    newPage: jest.fn().mockResolvedValue(mockPage),
    launch: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
  };

  return { browserService, mockPage };
}

function createMockCacheService() {
  return {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    buildCacheKey: jest.fn().mockReturnValue('test-key'),
    purgeExpired: jest.fn().mockReturnValue(0),
  };
}

const sampleRequest: CompRequest = {
  cardId: 'card-1',
  player: 'Mike Trout',
  year: 2023,
  brand: 'Topps',
  cardNumber: '1',
  condition: 'RAW',
};

describe('EbayAdapter', () => {
  it('returns stub error when no browser service', async () => {
    const adapter = new EbayAdapter();
    const result = await adapter.fetchComps(sampleRequest);
    expect(result.error).toContain('Puppeteer disabled');
    expect(result.sales).toEqual([]);
  });

  it('returns stub error when browser not running', async () => {
    const { browserService } = createMockBrowserService();
    browserService.isRunning.mockReturnValue(false);
    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);
    expect(result.error).toContain('Puppeteer disabled');
  });

  it('returns cache hit without scraping', async () => {
    const { browserService } = createMockBrowserService();
    const cacheService = createMockCacheService();
    const cachedResult: CompResult = {
      source: 'eBay',
      marketValue: 50,
      sales: [{ date: '2026-01-15', price: 50, venue: 'eBay' }],
      averagePrice: 50,
      low: 50,
      high: 50,
    };
    cacheService.get.mockReturnValue(cachedResult);

    const adapter = new EbayAdapter(browserService as any, cacheService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result).toBe(cachedResult);
    expect(browserService.navigateWithThrottle).not.toHaveBeenCalled();
  });

  it('extracts sold listings successfully', async () => {
    const soldListings = [
      { price: 42, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 49, date: 'Jan 10, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 45, date: 'Jan 5, 2026', title: '2023 Topps Mike Trout #1' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const cacheService = createMockCacheService();
    const adapter = new EbayAdapter(browserService as any, cacheService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toBeUndefined();
    expect(result.sales).toHaveLength(3);
    expect(result.averagePrice).toBeCloseTo(45.33, 1);
    expect(result.low).toBe(42);
    expect(result.high).toBe(49);
    expect(cacheService.set).toHaveBeenCalled();
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('returns error when no listings found', async () => {
    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue([]);

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('No eBay sold listings found');
    expect(result.sales).toEqual([]);
  });

  it('handles scraping errors gracefully', async () => {
    const { browserService, mockPage } = createMockBrowserService();
    browserService.navigateWithThrottle.mockRejectedValue(new Error('Timeout'));

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('eBay scraping failed');
    expect(result.error).toContain('Timeout');
  });

  it('source is eBay', () => {
    const adapter = new EbayAdapter();
    expect(adapter.source).toBe('eBay');
  });

  it('filters out irrelevant listings by player last name', async () => {
    const soldListings = [
      { price: 42, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 49, date: 'Jan 10, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 45, date: 'Jan 5, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 500, date: 'Jan 3, 2026', title: '2023 Topps Shohei Ohtani #17' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    // Ohtani listing should be filtered out (3 Trout listings >= 3 threshold)
    expect(result.sales).toHaveLength(3);
    expect(result.sales!.every(s => s.price < 100)).toBe(true);
  });

  it('keeps all listings when fewer than 3 match player name', async () => {
    const soldListings = [
      { price: 42, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 49, date: 'Jan 10, 2026', title: '2023 Topps Mike Trout #1' },
      { price: 500, date: 'Jan 3, 2026', title: '2023 Topps Shohei Ohtani #17' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    // Only 2 Trout listings < 3, so all are kept
    expect(result.sales).toHaveLength(3);
  });

  it('filters by grade when 3+ matches exist', async () => {
    const soldListings = [
      { price: 120, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 125, date: 'Jan 14, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 130, date: 'Jan 13, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 300, date: 'Jan 12, 2026', title: '2023 Topps Mike Trout #1 PSA 10' },
      { price: 280, date: 'Jan 11, 2026', title: '2023 Topps Mike Trout #1 PSA 9' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '8',
    };

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(gradedRequest);

    expect(result.sales).toHaveLength(3);
    expect(result.sales!.every(s => s.price <= 130)).toBe(true);
  });

  it('returns exact grade matches when 2+ exist (lowered threshold)', async () => {
    const soldListings = [
      { price: 120, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 125, date: 'Jan 14, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 300, date: 'Jan 12, 2026', title: '2023 Topps Mike Trout #1 PSA 10' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '8',
    };

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(gradedRequest);

    // 2 PSA 8 matches meet threshold of 2
    expect(result.sales).toHaveLength(2);
    expect(result.sales!.every(s => s.price <= 125)).toBe(true);
  });

  it('excludes graded sales for ungraded card requests', async () => {
    // Graded sales price a different asset — a raw card's comps must not
    // include slabbed solds.
    const soldListings = [
      { price: 120, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1 PSA 8' },
      { price: 300, date: 'Jan 14, 2026', title: '2023 Topps Mike Trout #1 PSA 10' },
      { price: 50, date: 'Jan 13, 2026', title: '2023 Topps Mike Trout #1' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest); // ungraded

    expect(result.sales).toHaveLength(1);
    expect(result.sales![0].price).toBe(50);
  });

  it('populates CompSale.grade from title', async () => {
    const soldListings = [
      { price: 120, date: 'Jan 15, 2026', title: '2023 Topps Mike Trout #1 PSA 10' },
      { price: 110, date: 'Jan 14, 2026', title: '2023 Topps Mike Trout #1 PSA 9' },
      { price: 130, date: 'Jan 13, 2026', title: '2023 Topps Mike Trout #1 PSA 10 GEM' },
    ];

    const { browserService, mockPage } = createMockBrowserService();
    mockPage.$$eval.mockResolvedValue(soldListings);

    const adapter = new EbayAdapter(browserService as any);
    const result = await adapter.fetchComps({
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '10',
      condition: '10: GEM MINT',
    });

    expect(result.sales![0].grade).toBe('PSA 10');
    expect(result.sales![1].grade).toBe('PSA 10');
  });
});

describe('buildSearchQuery', () => {
  it('builds basic query from required fields', () => {
    const query = buildSearchQuery(sampleRequest);
    expect(query).toBe('2023 Topps Mike Trout #1');
  });

  it('includes setName when provided', () => {
    const query = buildSearchQuery({ ...sampleRequest, setName: 'Chrome' });
    expect(query).toBe('2023 Topps Chrome Mike Trout #1');
  });

  it('includes parallel when provided', () => {
    const query = buildSearchQuery({ ...sampleRequest, parallel: 'Refractor' });
    expect(query).toBe('2023 Topps Mike Trout #1 Refractor');
  });

  it('includes grading info when graded', () => {
    const query = buildSearchQuery({
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '10',
    });
    expect(query).toBe('2023 Topps Mike Trout #1 PSA 10');
  });

  it('does not include grading info when missing grade or company', () => {
    const query = buildSearchQuery({
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      // no grade
    });
    expect(query).toBe('2023 Topps Mike Trout #1');
  });

  it('includes auto for autograph cards', () => {
    const query = buildSearchQuery({ ...sampleRequest, isAutograph: true });
    expect(query).toBe('2023 Topps Mike Trout #1 auto');
  });

  it('includes relic for relic cards', () => {
    const query = buildSearchQuery({ ...sampleRequest, isRelic: true });
    expect(query).toBe('2023 Topps Mike Trout #1 relic');
  });

  it('builds fully enriched query with all fields', () => {
    const query = buildSearchQuery({
      ...sampleRequest,
      setName: 'Chrome',
      parallel: 'Gold Refractor',
      isGraded: true,
      gradingCompany: 'BGS',
      grade: '9.5',
      isAutograph: true,
      isRelic: true,
    });
    expect(query).toBe('2023 Topps Chrome Mike Trout #1 Gold Refractor BGS 9.5 auto relic');
  });
});

describe('filterByRelevance', () => {
  const sales = [
    { price: 42, date: 'Jan 15', title: '2023 Topps Mike Trout #1' },
    { price: 49, date: 'Jan 10', title: '2023 Topps Mike Trout #1' },
    { price: 45, date: 'Jan 5', title: '2023 Topps Mike Trout #1' },
    { price: 500, date: 'Jan 3', title: '2023 Topps Ohtani #17' },
  ];

  it('filters out listings without player last name when 3+ match', () => {
    const result = filterByRelevance(sales, sampleRequest);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('Trout'))).toBe(true);
  });

  it('returns all when fewer than 3 match', () => {
    const fewMatches = [
      { price: 42, date: 'Jan 15', title: '2023 Topps Mike Trout #1' },
      { price: 49, date: 'Jan 10', title: '2023 Topps Mike Trout #1' },
      { price: 500, date: 'Jan 3', title: '2023 Topps Ohtani #17' },
    ];
    const result = filterByRelevance(fewMatches, sampleRequest);
    expect(result).toHaveLength(3);
  });

  it('is case insensitive', () => {
    const mixedCase = [
      { price: 42, date: 'Jan 15', title: '2023 topps mike TROUT #1' },
      { price: 49, date: 'Jan 10', title: '2023 TOPPS MIKE trout #1' },
      { price: 45, date: 'Jan 5', title: '2023 Topps mike trout #1' },
    ];
    const result = filterByRelevance(mixedCase, sampleRequest);
    expect(result).toHaveLength(3);
  });
});

describe('computeTrimmedMean', () => {
  it('returns 0 for empty array', () => {
    expect(computeTrimmedMean([])).toBe(0);
  });

  it('returns simple average for fewer than 5 prices', () => {
    expect(computeTrimmedMean([10, 20, 30])).toBeCloseTo(20, 5);
  });

  it('returns simple average for exactly 4 prices', () => {
    expect(computeTrimmedMean([10, 20, 30, 40])).toBeCloseTo(25, 5);
  });

  it('trims top and bottom 15% for 5+ prices', () => {
    // 10 prices: trim 1 from each end (floor(10 * 0.15) = 1)
    const prices = [1, 10, 20, 30, 40, 50, 60, 70, 80, 1000];
    // After trimming: [10, 20, 30, 40, 50, 60, 70, 80] => avg = 45
    expect(computeTrimmedMean(prices)).toBeCloseTo(45, 5);
  });

  it('removes outliers effectively', () => {
    // Normal prices with one extreme outlier
    const prices = [45, 48, 50, 52, 55, 500];
    // Sorted: [45, 48, 50, 52, 55, 500], trim 1 from each end
    // Trimmed: [48, 50, 52, 55] => avg = 51.25
    const result = computeTrimmedMean(prices);
    expect(result).toBeCloseTo(51.25, 5);
    // Much lower than simple average which would be ~125
    expect(result).toBeLessThan(60);
  });

  it('returns single value for array of 1', () => {
    expect(computeTrimmedMean([42])).toBe(42);
  });
});
