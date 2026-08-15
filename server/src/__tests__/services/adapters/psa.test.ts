import PsaAdapter, { buildSearchQuery, buildSearchUrl, filterByRelevance, computeTrimmedMean, mapCategory, extractSpecId, parseSaleRows } from '../../../services/adapters/psa';
import { CompRequest, CompResult } from '../../../types';

// ─── Mock Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock browser service for PSA adapter tests.
 * Two-step navigation: search page (returns detailUrl) → detail page (returns tableRows).
 */
function createMockBrowserService(options: {
  detailUrl?: string | null;
  tableRows?: string[][];
} = {}) {
  const {
    detailUrl = 'https://www.psacard.com/auctionprices/football-cards/2000-fleer/tom-brady/358144',
    tableRows = [],
  } = options;

  const searchPage = {
    evaluate: jest.fn().mockResolvedValue(detailUrl),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const detailPage = {
    evaluate: jest.fn().mockResolvedValue(tableRows),
    close: jest.fn().mockResolvedValue(undefined),
  };

  let callCount = 0;
  const browserService = {
    isRunning: jest.fn().mockReturnValue(true),
    navigateWithThrottle: jest.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? Promise.resolve(searchPage) : Promise.resolve(detailPage);
    }),
    throttle: jest.fn().mockResolvedValue(undefined),
    newPage: jest.fn().mockResolvedValue(searchPage),
    launch: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
  };

  return { browserService, searchPage, detailPage };
}

function createMockCacheService() {
  return {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    buildCacheKey: jest.fn().mockReturnValue('test-key'),
    purgeExpired: jest.fn().mockReturnValue(0),
  };
}

/**
 * Build mock table rows (string[][]) that parseSaleRows can extract.
 * Default: 7 cells [image, date, auctionHouse, saleType, certNo, grade, price]
 * Use cellCount=6 to simulate shifted columns (no image cell).
 */
function buildTableRows(
  sales: { grade: string; venue: string; date: string; price: string }[],
  cellCount: 6 | 7 = 7
): string[][] {
  if (cellCount === 6) {
    return sales.map(s => [
      s.date,          // cell 0: date
      s.venue,         // cell 1: auction house
      'Auction',       // cell 2: sale type
      '12345678',      // cell 3: cert number
      s.grade,         // cell 4: grade
      s.price,         // cell 5: price
    ]);
  }
  return sales.map(s => [
    '<img .../>',    // cell 0: image
    s.date,          // cell 1: date
    s.venue,         // cell 2: auction house
    'Auction',       // cell 3: sale type
    '12345678',      // cell 4: cert number
    s.grade,         // cell 5: grade
    s.price,         // cell 6: price
  ]);
}

// CompService only routes PSA-graded requests to this adapter (raw and
// non-PSA graded cards skip the PSA source), so the sample request is graded.
const sampleRequest: CompRequest = {
  cardId: 'card-1',
  player: 'Mike Trout',
  year: 2023,
  brand: 'Topps',
  cardNumber: '1',
  condition: '10: GEM MINT',
  isGraded: true,
  gradingCompany: 'PSA',
  grade: '10',
};

// ─── Adapter Tests ───────────────────────────────────────────────────────────

describe('PsaAdapter', () => {
  it('returns stub error when no browser service', async () => {
    const adapter = new PsaAdapter();
    const result = await adapter.fetchComps(sampleRequest);
    expect(result.error).toContain('Puppeteer disabled');
    expect(result.sales).toEqual([]);
  });

  it('returns stub error when browser not running', async () => {
    const { browserService } = createMockBrowserService();
    browserService.isRunning.mockReturnValue(false);
    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);
    expect(result.error).toContain('Puppeteer disabled');
  });

  it('returns cache hit without scraping', async () => {
    const { browserService } = createMockBrowserService();
    const cacheService = createMockCacheService();
    const cachedResult: CompResult = {
      source: 'PSA',
      marketValue: 100,
      sales: [{ date: '2026-01-15', price: 100, grade: '10', venue: 'eBay' }],
      averagePrice: 100,
      low: 100,
      high: 100,
    };
    cacheService.get.mockReturnValue(cachedResult);

    const adapter = new PsaAdapter(browserService as any, cacheService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result).toBe(cachedResult);
    expect(browserService.navigateWithThrottle).not.toHaveBeenCalled();
  });

  it('extracts sales via two-step navigation', async () => {
    const tableRows = buildTableRows([
      { grade: '10', venue: 'eBay', date: 'Feb 3, 2026', price: '$150.00' },
      { grade: '10', venue: 'Goldin', date: 'Jan 10, 2026', price: '$120.00' },
      { grade: '10', venue: 'Heritage', date: 'Jan 5, 2026', price: '$135.00' },
    ]);

    const { browserService, searchPage, detailPage } = createMockBrowserService({ tableRows });
    const cacheService = createMockCacheService();
    const adapter = new PsaAdapter(browserService as any, cacheService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toBeUndefined();
    expect(result.sales).toHaveLength(3);
    expect(result.averagePrice).toBeCloseTo(135, 0);
    expect(result.low).toBe(120);
    expect(result.high).toBe(150);
    expect(cacheService.set).toHaveBeenCalled();
    expect(browserService.navigateWithThrottle).toHaveBeenCalledTimes(2);
    expect(searchPage.close).toHaveBeenCalled();
    expect(detailPage.close).toHaveBeenCalled();
  });

  it('returns error when no search results (no detail URL)', async () => {
    const { browserService } = createMockBrowserService({ detailUrl: null });

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('No PSA auction results found');
    expect(result.sales).toEqual([]);
  });

  it('returns error when detail page has no sales', async () => {
    // Empty table rows — no 7-cell rows to parse
    const { browserService } = createMockBrowserService({ tableRows: [] });

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('No PSA sales data found');
    expect(result.sales).toEqual([]);
  });

  it('returns error when detail page has only summary rows', async () => {
    // Grade summary rows have 5 cells — should be skipped
    const summaryRows: string[][] = [
      ['PSA 10', '$135.83', '$1,162.72', '1093', '0'],
      ['PSA 9', '$231.07', '$212.15', '2928', '1093'],
    ];
    const { browserService } = createMockBrowserService({ tableRows: summaryRows });

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('No PSA sales data found');
    expect(result.sales).toEqual([]);
  });

  it('handles scraping errors gracefully', async () => {
    const { browserService } = createMockBrowserService();
    browserService.navigateWithThrottle.mockRejectedValue(new Error('Page closed'));

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('PSA scraping failed');
    expect(result.error).toContain('Page closed');
  });

  it('filters to matching PSA grade only for PSA-graded cards', async () => {
    const tableRows = buildTableRows([
      { grade: '10', venue: 'eBay', date: 'Feb 3, 2026', price: '$500.00' },
      { grade: '10', venue: 'Goldin', date: 'Jan 10, 2026', price: '$480.00' },
      { grade: '8', venue: 'eBay', date: 'Jan 5, 2026', price: '$50.00' },
      { grade: '7', venue: 'Heritage', date: 'Jan 1, 2026', price: '$30.00' },
    ]);

    const { browserService } = createMockBrowserService({ tableRows });

    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '10',
    };

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(gradedRequest);

    expect(result.error).toBeUndefined();
    expect(result.sales).toHaveLength(2);
    expect(result.sales!.every(s => s.grade === '10')).toBe(true);
    expect(result.low).toBe(480);
    expect(result.high).toBe(500);
  });

  it('returns no sales for ungraded cards (PSA data is graded-only)', async () => {
    // CompService never routes raw cards here, but if called directly the
    // grade filter must still exclude every graded sale rather than let
    // graded prices stand in for a raw card's value.
    const tableRows = buildTableRows([
      { grade: '10', venue: 'eBay', date: 'Feb 3, 2026', price: '$500.00' },
      { grade: '8', venue: 'eBay', date: 'Jan 5, 2026', price: '$50.00' },
      { grade: '7', venue: 'Heritage', date: 'Jan 1, 2026', price: '$30.00' },
    ]);

    const { browserService } = createMockBrowserService({ tableRows });
    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps({
      ...sampleRequest,
      condition: 'RAW',
      isGraded: false,
      gradingCompany: undefined,
      grade: undefined,
    });

    expect(result.sales).toHaveLength(0);
  });

  it('returns all grades for non-PSA graded cards', async () => {
    const tableRows = buildTableRows([
      { grade: '10', venue: 'eBay', date: 'Feb 3, 2026', price: '$500.00' },
      { grade: '8', venue: 'eBay', date: 'Jan 5, 2026', price: '$50.00' },
    ]);

    const { browserService } = createMockBrowserService({ tableRows });

    const bgsRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'BGS',
      grade: '9.5',
    };

    const adapter = new PsaAdapter(browserService as any);
    const result = await adapter.fetchComps(bgsRequest);

    expect(result.error).toBeUndefined();
    expect(result.sales).toHaveLength(2);
  });

  it('source is PSA', () => {
    const adapter = new PsaAdapter();
    expect(adapter.source).toBe('PSA');
  });
});

// ─── parseSaleRows Tests ────────────────────────────────────────────────────

describe('parseSaleRows', () => {
  it('parses standard 7-cell sale rows', () => {
    const rows: string[][] = [
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', '10', '$135.83'],
      ['<img/>', 'Jan 10, 2026', 'Goldin', 'Auction', '12345678', '9', '$231.07'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(2);
    expect(sales[0]).toEqual({ price: 135.83, date: 'Feb 3, 2026', grade: '10', auctionHouse: 'eBay' });
    expect(sales[1]).toEqual({ price: 231.07, date: 'Jan 10, 2026', grade: '9', auctionHouse: 'Goldin' });
  });

  it('skips grade summary rows (5 cells)', () => {
    const rows: string[][] = [
      ['PSA 10', '$135.83', '$1,162.72', '1093', '0'],           // summary — skip
      ['PSA 9', '$231.07', '$212.15', '2928', '1093'],           // summary — skip
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', '10', '$135.83'],  // sale — keep
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(135.83);
  });

  it('handles prices with commas', () => {
    const rows: string[][] = [
      ['<img/>', 'Feb 1, 2026', 'eBay', 'Auction', '43036578', '10', '$1,198.00'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(1198);
  });

  it('skips $0 prices', () => {
    const rows: string[][] = [
      ['<img/>', 'Oct 3, 2025', 'eBay', 'Auction', '45326635', '8', '$0.00'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(0);
  });

  it('skips rows with non-numeric price', () => {
    const rows: string[][] = [
      ['<img/>', 'Oct 3, 2025', 'eBay', 'Auction', '45326635', '8', 'N/A'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(parseSaleRows([])).toEqual([]);
  });

  it('extracts half grades correctly', () => {
    const rows: string[][] = [
      ['<img/>', 'Dec 23, 2025', 'eBay', 'Auction', '87181981', '8.5', '$271.00'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales[0].grade).toBe('8.5');
  });

  it('defaults auctionHouse to PSA when empty', () => {
    const rows: string[][] = [
      ['<img/>', 'Feb 3, 2026', '', 'Auction', '43036578', '10', '$135.83'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales[0].auctionHouse).toBe('PSA');
  });

  it('handles mixed summary and sale rows', () => {
    const rows: string[][] = [
      ['PSA 10', '$135.83', '$1,162.72', '1093', '0'],                          // summary
      ['PSA 9', '$231.07', '$212.15', '2928', '1093'],                          // summary
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', '10', '$135.83'],  // sale
      ['<img/>', 'Feb 2, 2026', 'eBay', 'Auction', '43036578', '10', '$1,198.00'],// sale
      ['PSA 8', '$141.05', '$114.89', '3354', '4294'],                          // summary
      ['<img/>', 'Jan 31, 2026', 'eBay', 'Auction', '58074655', '8', '$141.05'],  // sale
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(3);
    expect(sales[0].price).toBe(135.83);
    expect(sales[1].price).toBe(1198);
    expect(sales[2].price).toBe(141.05);
  });

  it('extracts grade dynamically when columns shift (6 cells)', () => {
    // 6-cell row: [date, venue, saleType, certNo, grade, price]
    const rows: string[][] = [
      ['Feb 3, 2026', 'eBay', 'Auction', '43036578', '10', '$135.83'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(1);
    expect(sales[0].grade).toBe('10');
    expect(sales[0].price).toBe(135.83);
  });

  it('finds grade at different cell positions', () => {
    // Grade at cells[4] (shifted table)
    const rows6: string[][] = [
      ['Feb 3, 2026', 'eBay', 'Auction', '43036578', '9', '$231.07'],
    ];
    const sales6 = parseSaleRows(rows6);
    expect(sales6[0].grade).toBe('9');

    // Grade at cells[5] (standard table)
    const rows7: string[][] = [
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', '9', '$231.07'],
    ];
    const sales7 = parseSaleRows(rows7);
    expect(sales7[0].grade).toBe('9');
  });

  it('normalizes Auth/Authentic grade', () => {
    const rows: string[][] = [
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', 'Authentic', '$50.00'],
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', 'Auth', '$45.00'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(2);
    expect(sales[0].grade).toBe('Auth');
    expect(sales[1].grade).toBe('Auth');
  });

  it('returns empty grade when no grade-like cell found', () => {
    // Row with no grade-like value before price
    const rows: string[][] = [
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', 'some-text', 'N/A', '$100.00'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(1);
    expect(sales[0].grade).toBe('');
  });

  it('finds price as rightmost $-containing cell', () => {
    // Extra cells after standard layout — price is still the rightmost $-cell
    const rows: string[][] = [
      ['<img/>', 'Feb 3, 2026', 'eBay', 'Auction', '43036578', '10', '$135.83', 'extra'],
    ];
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(135.83);
  });

  it('works with adapter-level grade filtering on shifted rows', () => {
    // Simulate shifted table where grade is at cells[4] instead of cells[5]
    const rows = buildTableRows([
      { grade: '10', venue: 'eBay', date: 'Feb 3, 2026', price: '$500.00' },
      { grade: '9', venue: 'eBay', date: 'Jan 5, 2026', price: '$50.00' },
      { grade: '8', venue: 'Heritage', date: 'Jan 1, 2026', price: '$30.00' },
    ], 6);
    const sales = parseSaleRows(rows);
    expect(sales).toHaveLength(3);
    // Grade filter would work since grades are correctly extracted
    const grade10 = sales.filter(s => s.grade === '10');
    expect(grade10).toHaveLength(1);
    expect(grade10[0].price).toBe(500);
  });
});

// ─── Helper Tests ────────────────────────────────────────────────────────────

describe('buildSearchQuery', () => {
  it('builds basic query from required fields', () => {
    expect(buildSearchQuery(sampleRequest)).toBe('2023 Topps Mike Trout #1');
  });

  it('includes setName when provided', () => {
    expect(buildSearchQuery({ ...sampleRequest, setName: 'Chrome' })).toBe('2023 Topps Chrome Mike Trout #1');
  });

  it('includes parallel when provided', () => {
    expect(buildSearchQuery({ ...sampleRequest, parallel: 'Refractor' })).toBe('2023 Topps Mike Trout #1 Refractor');
  });

  it('does not include grading info (PSA search is card-level)', () => {
    expect(buildSearchQuery({
      ...sampleRequest,
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    })).toBe('2023 Topps Mike Trout #1');
  });
});

describe('buildSearchUrl', () => {
  it('builds correct URL with query parameter', () => {
    expect(buildSearchUrl('2023 Topps Mike Trout #1')).toBe('https://www.psacard.com/auctionprices/search?q=2023+Topps+Mike+Trout+%231');
  });

  it('encodes special characters', () => {
    const url = buildSearchUrl('2023 Topps Chrome Mike Trout #1 Refractor');
    expect(url).toContain('https://www.psacard.com/auctionprices/search?q=');
  });
});

describe('extractSpecId', () => {
  it('extracts from /values/ URL format', () => {
    expect(extractSpecId('/auctionprices/baseball-cards/2000-topps/mike-trout/values/187370')).toBe('187370');
  });

  it('extracts from trailing segment URL format', () => {
    expect(extractSpecId('https://www.psacard.com/auctionprices/football-cards/2000-fleer/tom-brady/279660')).toBe('279660');
  });

  it('returns null for URL without numeric ID', () => {
    expect(extractSpecId('https://www.psacard.com/auctionprices')).toBeNull();
  });

  it('returns null for search URL', () => {
    expect(extractSpecId('https://www.psacard.com/auctionprices/search?q=tom+brady')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractSpecId('')).toBeNull();
  });
});

describe('filterByRelevance', () => {
  const sales = [
    { price: 150, date: '01/15/2026', grade: '10', auctionHouse: 'eBay' },
    { price: 120, date: '01/10/2026', grade: '10', auctionHouse: 'Goldin' },
  ];

  it('returns all sales (PSA detail pages are card-specific)', () => {
    expect(filterByRelevance(sales, sampleRequest)).toHaveLength(2);
  });
});

describe('mapCategory', () => {
  it('maps baseball correctly', () => { expect(mapCategory('Baseball')).toBe('baseball-cards'); });
  it('maps basketball correctly', () => { expect(mapCategory('Basketball')).toBe('basketball-cards'); });
  it('maps football correctly', () => { expect(mapCategory('Football')).toBe('football-cards'); });
  it('maps hockey correctly', () => { expect(mapCategory('Hockey')).toBe('hockey-cards'); });
  it('maps soccer correctly', () => { expect(mapCategory('Soccer')).toBe('soccer-cards'); });
  it('maps pokemon correctly', () => { expect(mapCategory('Pokemon')).toBe('tcg-cards'); });
  it('maps other/unknown to non-sports-cards', () => {
    expect(mapCategory('Other')).toBe('non-sports-cards');
    expect(mapCategory('random')).toBe('non-sports-cards');
  });
  it('is case insensitive', () => {
    expect(mapCategory('BASEBALL')).toBe('baseball-cards');
    expect(mapCategory('POKEMON')).toBe('tcg-cards');
  });
});

describe('computeTrimmedMean', () => {
  it('returns 0 for empty array', () => { expect(computeTrimmedMean([])).toBe(0); });
  it('returns simple average for fewer than 5', () => { expect(computeTrimmedMean([100, 200, 300])).toBeCloseTo(200); });
  it('trims for 5+', () => {
    expect(computeTrimmedMean([1, 10, 20, 30, 40, 50, 60, 70, 80, 1000])).toBeCloseTo(45);
  });
  it('removes outliers', () => {
    const result = computeTrimmedMean([100, 110, 120, 130, 140, 5000]);
    expect(result).toBeCloseTo(125);
    expect(result).toBeLessThan(200);
  });
  it('returns single value for array of 1', () => { expect(computeTrimmedMean([42])).toBe(42); });
});
