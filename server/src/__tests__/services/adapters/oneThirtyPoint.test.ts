import OneThirtyPointAdapter, {
  buildSearchQuery,
  parseHtmlResponse,
  filterByRelevance,
  computeTrimmedMean,
  _resetRateLimitState,
} from '../../../services/adapters/oneThirtyPoint';
import { CompRequest, CompResult } from '../../../types';

const sampleRequest: CompRequest = {
  cardId: 'card-1',
  player: 'Mike Trout',
  year: 2023,
  brand: 'Topps',
  cardNumber: '1',
  condition: 'RAW',
};

function createMockCacheService() {
  return {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    buildCacheKey: jest.fn().mockReturnValue('test-key'),
    purgeExpired: jest.fn().mockReturnValue(0),
  };
}

function buildSampleHtml(rows: Array<{ price: number; title: string; date: string; marketplace?: string }>): string {
  const tableRows = rows.map(r => {
    const mp = r.marketplace || 'eBay';
    return `<tr><td>${r.title}</td><td data-price="${r.price}">$${r.price.toFixed(2)}</td><td>${r.date}</td><td>${mp}</td></tr>`;
  }).join('\n');
  return `<table><thead><tr><th>Title</th><th>Price</th><th>Date</th><th>Source</th></tr></thead><tbody>${tableRows}</tbody></table>`;
}

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

  it('includes grading info for graded card', () => {
    const query = buildSearchQuery({
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '10',
    });
    expect(query).toBe('2023 Topps Mike Trout #1 PSA 10');
  });

  it('omits grading info when missing grade or company', () => {
    const query = buildSearchQuery({
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
    });
    expect(query).toBe('2023 Topps Mike Trout #1');
  });

  it('always produces at least 2 words', () => {
    const minRequest: CompRequest = {
      cardId: 'x',
      player: 'A',
      year: 2023,
      brand: 'B',
      cardNumber: '1',
    };
    const query = buildSearchQuery(minRequest);
    const words = query.split(' ');
    expect(words.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseHtmlResponse', () => {
  it('extracts sales from valid table rows', () => {
    const html = buildSampleHtml([
      { price: 42.50, title: '2023 Topps Mike Trout #1', date: '01/15/2026' },
      { price: 55.00, title: '2023 Topps Mike Trout #1', date: '01/10/2026' },
    ]);
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(2);
    expect(sales[0].price).toBe(42.50);
    expect(sales[0].title).toContain('Mike Trout');
    expect(sales[0].date).toBe('01/15/2026');
  });

  it('extracts price from data-price attribute', () => {
    const html = '<table><tr><td>Card Title Here</td><td data-price="99.99">Was $150</td><td>01/01/2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(99.99);
  });

  it('falls back to $XX.XX text price when no data-price attr', () => {
    const html = '<table><tr><td>Card Title Here</td><td>$42.50</td><td>01/01/2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(42.50);
  });

  it('skips header rows with <th> elements', () => {
    const html = '<table><tr><th>Title</th><th>Price</th></tr><tr><td>Card Title</td><td data-price="50">$50.00</td><td>01/01/2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
  });

  it('skips rows with zero or missing prices', () => {
    const html = '<table><tr><td>Card Title</td><td data-price="0">$0.00</td><td>01/01/2026</td></tr><tr><td>Card Title</td><td>N/A</td><td>01/01/2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(0);
  });

  it('detects marketplace from row content', () => {
    const html = [
      '<table>',
      '<tr><td>Card A</td><td data-price="50">$50</td><td>01/01/2026</td><td>Goldin Auctions</td></tr>',
      '<tr><td>Card B</td><td data-price="40">$40</td><td>01/02/2026</td><td>PWCC Marketplace</td></tr>',
      '<tr><td>Card C</td><td data-price="60">$60</td><td>01/03/2026</td><td>Heritage Auctions</td></tr>',
      '<tr><td>Card D</td><td data-price="45">$45</td><td>01/04/2026</td><td>MySlabs</td></tr>',
      '<tr><td>Card E</td><td data-price="55">$55</td><td>01/05/2026</td><td>Pristine Auction</td></tr>',
      '<tr><td>Card F</td><td data-price="35">$35</td><td>01/06/2026</td><td>eBay</td></tr>',
      '</table>',
    ].join('');
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(6);
    expect(sales[0].marketplace).toBe('Goldin');
    expect(sales[1].marketplace).toBe('PWCC');
    expect(sales[2].marketplace).toBe('Heritage');
    expect(sales[3].marketplace).toBe('MySlabs');
    expect(sales[4].marketplace).toBe('Pristine');
    expect(sales[5].marketplace).toBe('eBay');
  });

  it('returns empty array for empty HTML', () => {
    expect(parseHtmlResponse('')).toEqual([]);
  });

  it('returns empty array for malformed HTML without table rows', () => {
    expect(parseHtmlResponse('<div>No table here</div>')).toEqual([]);
  });

  it('handles comma-separated prices', () => {
    const html = '<table><tr><td>High Value Card</td><td>$1,234.56</td><td>01/01/2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(1234.56);
  });

  it('caps results at 30 sales', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      price: 10 + i,
      title: `Card Title ${i}`,
      date: '01/15/2026',
    }));
    const html = buildSampleHtml(rows);
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(30);
  });

  it('extracts date from data-date attribute', () => {
    const html = '<table><tr data-date="2026-02-15"><td>Card Title</td><td data-price="50">$50.00</td><td>some text</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].date).toBe('2026-02-15');
  });

  it('extracts ISO date format (YYYY-MM-DD) from cells', () => {
    const html = '<table><tr><td>Card Title Here</td><td data-price="75">$75.00</td><td>2026-01-20</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].date).toBe('2026-01-20');
  });

  it('extracts natural language date (Mon DD, YYYY) from cells', () => {
    const html = '<table><tr><td>Card Title Here</td><td data-price="60">$60.00</td><td>Feb 3, 2026</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].date).toBe('Feb 3, 2026');
  });

  it('prefers data-date attribute over cell text', () => {
    const html = '<table><tr data-date="2026-02-20"><td>Card Title</td><td data-price="50">$50.00</td><td>01/01/2025</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].date).toBe('2026-02-20');
  });

  it('extracts MM/DD/YY short year format', () => {
    const html = '<table><tr><td>Card Title Here</td><td data-price="40">$40.00</td><td>02/15/26</td></tr></table>';
    const sales = parseHtmlResponse(html);
    expect(sales).toHaveLength(1);
    expect(sales[0].date).toBe('02/15/26');
  });
});

describe('filterByRelevance', () => {
  const sales = [
    { price: 42, date: '01/15/2026', title: '2023 Topps Mike Trout #1', marketplace: 'eBay' },
    { price: 49, date: '01/10/2026', title: '2023 Topps Mike Trout #1', marketplace: 'eBay' },
    { price: 45, date: '01/05/2026', title: '2023 Topps Mike Trout #1', marketplace: 'Goldin' },
    { price: 500, date: '01/03/2026', title: '2023 Topps Ohtani #17', marketplace: 'eBay' },
  ];

  it('filters out listings without player last name when 3+ match', () => {
    const result = filterByRelevance(sales, sampleRequest);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('Trout'))).toBe(true);
  });

  it('returns all when fewer than 3 match', () => {
    const fewMatches = sales.slice(0, 2).concat(sales.slice(3));
    const result = filterByRelevance(fewMatches, sampleRequest);
    expect(result).toHaveLength(3); // All kept since only 2 match "Trout"
  });

  it('is case insensitive', () => {
    const mixedCase = [
      { price: 42, date: '01/15/2026', title: '2023 topps mike TROUT #1', marketplace: 'eBay' },
      { price: 49, date: '01/10/2026', title: '2023 TOPPS MIKE trout #1', marketplace: 'eBay' },
      { price: 45, date: '01/05/2026', title: '2023 Topps mike trout #1', marketplace: 'eBay' },
    ];
    const result = filterByRelevance(mixedCase, sampleRequest);
    expect(result).toHaveLength(3);
  });

  it('filters by grade when 3+ matches exist', () => {
    const graded = [
      { price: 120, date: '01/15/2026', title: '2023 Topps Trout PSA 8', marketplace: 'eBay' },
      { price: 125, date: '01/14/2026', title: '2023 Topps Trout PSA 8 NM', marketplace: 'eBay' },
      { price: 130, date: '01/13/2026', title: '2023 Topps Trout PSA 8', marketplace: 'Goldin' },
      { price: 300, date: '01/12/2026', title: '2023 Topps Trout PSA 10', marketplace: 'eBay' },
    ];
    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '8',
    };
    const result = filterByRelevance(graded, gradedRequest);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA 8'))).toBe(true);
  });

  it('returns exact grade matches when 2+ exist (lowered threshold)', () => {
    const mixed = [
      { price: 120, date: '01/15/2026', title: '2023 Topps Trout PSA 8', marketplace: 'eBay' },
      { price: 125, date: '01/14/2026', title: '2023 Topps Trout PSA 8', marketplace: 'eBay' },
      { price: 300, date: '01/12/2026', title: '2023 Topps Trout PSA 10', marketplace: 'eBay' },
    ];
    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '8',
    };
    const result = filterByRelevance(mixed, gradedRequest);
    expect(result).toHaveLength(2); // 2 PSA 8 matches meet threshold of 2
    expect(result.every(s => s.price <= 125)).toBe(true);
  });

  it('excludes graded sales for ungraded requests', () => {
    // Graded sales price a different asset — a raw card's comps must not
    // include slabbed solds.
    const mixed = [
      { price: 120, date: '01/15/2026', title: '2023 Topps Trout PSA 8', marketplace: 'eBay' },
      { price: 300, date: '01/14/2026', title: '2023 Topps Trout PSA 10', marketplace: 'eBay' },
      { price: 50, date: '01/13/2026', title: '2023 Topps Trout raw', marketplace: 'eBay' },
    ];
    const result = filterByRelevance(mixed, sampleRequest);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(50);
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
    const prices = [1, 10, 20, 30, 40, 50, 60, 70, 80, 1000];
    // After trimming 1 from each end: [10, 20, 30, 40, 50, 60, 70, 80] => avg = 45
    expect(computeTrimmedMean(prices)).toBeCloseTo(45, 5);
  });

  it('returns single value for array of 1', () => {
    expect(computeTrimmedMean([42])).toBe(42);
  });
});

describe('OneThirtyPointAdapter', () => {
  beforeEach(() => {
    _resetRateLimitState();
    jest.restoreAllMocks();
  });

  it('has source name 130Point', () => {
    const adapter = new OneThirtyPointAdapter();
    expect(adapter.source).toBe('130Point');
  });

  it('returns cached result when cache hit', async () => {
    const cacheService = createMockCacheService();
    const cachedResult: CompResult = {
      source: '130Point',
      marketValue: 50,
      sales: [{ date: '01/15/2026', price: 50, venue: 'eBay' }],
      averagePrice: 50,
      low: 50,
      high: 50,
    };
    cacheService.get.mockReturnValue(cachedResult);

    const adapter = new OneThirtyPointAdapter(undefined, cacheService as any, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result).toBe(cachedResult);
  });

  it('handles network errors gracefully', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network failure'));

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('130Point fetch failed');
    expect(result.error).toContain('Network failure');
    expect(result.sales).toEqual([]);
  });

  it('returns error for empty results', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<table></table>',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('No 130Point sold listings found');
    expect(result.sales).toEqual([]);
  });

  it('blocks for 1 hour on 429 response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('rate limit exceeded');
    expect(result.error).toContain('1 hour');
  });

  it('rejects subsequent requests during 429 block', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);

    // First request triggers the block
    await adapter.fetchComps(sampleRequest);

    // Second request should be blocked without hitting fetch
    const fetchSpy = jest.spyOn(global, 'fetch');
    fetchSpy.mockClear();

    const result = await adapter.fetchComps(sampleRequest);
    expect(result.error).toContain('rate limited');
    expect(result.error).toContain('blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extracts sales and caches successful result', async () => {
    const html = buildSampleHtml([
      { price: 42.50, title: '2023 Topps Mike Trout #1', date: '01/15/2026' },
      { price: 55.00, title: '2023 Topps Mike Trout #1', date: '01/10/2026' },
      { price: 48.00, title: '2023 Topps Mike Trout #1', date: '01/05/2026' },
    ]);

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as Response);

    const cacheService = createMockCacheService();
    const adapter = new OneThirtyPointAdapter(undefined, cacheService as any, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toBeUndefined();
    expect(result.sales).toHaveLength(3);
    expect(result.averagePrice).toBeCloseTo(48.5, 1);
    expect(result.low).toBe(42.50);
    expect(result.high).toBe(55.00);
    expect(result.source).toBe('130Point');
    expect(cacheService.set).toHaveBeenCalledWith('130Point', sampleRequest, result);
  });

  it('returns error for non-200 HTTP response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('130Point HTTP 500');
    expect(result.sales).toEqual([]);
  });

  it('detects error text in short HTML responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<p>Error: invalid query</p>',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(sampleRequest);

    expect(result.error).toContain('130Point returned error');
  });

  it('populates CompSale.grade from title', async () => {
    const html = buildSampleHtml([
      { price: 120, title: '2023 Topps Mike Trout #1 PSA 10', date: '01/15/2026' },
      { price: 110, title: '2023 Topps Mike Trout #1 PSA 10 GEM', date: '01/14/2026' },
      { price: 130, title: '2023 Topps Mike Trout #1 PSA 9', date: '01/13/2026' },
    ]);

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
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

  it('grade-filters at adapter level when 3+ matches', async () => {
    const html = buildSampleHtml([
      { price: 120, title: '2023 Topps Mike Trout #1 PSA 8', date: '01/15/2026' },
      { price: 125, title: '2023 Topps Mike Trout #1 PSA 8 NM', date: '01/14/2026' },
      { price: 130, title: '2023 Topps Mike Trout #1 PSA 8', date: '01/13/2026' },
      { price: 300, title: '2023 Topps Mike Trout #1 PSA 10', date: '01/12/2026' },
    ]);

    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    } as Response);

    const gradedRequest: CompRequest = {
      ...sampleRequest,
      isGraded: true,
      gradingCompany: 'PSA',
      grade: '8',
    };

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    const result = await adapter.fetchComps(gradedRequest);

    expect(result.sales).toHaveLength(3);
    expect(result.sales!.every(s => s.price <= 130)).toBe(true);
  });

  it('sends POST request with correct parameters', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<table></table>',
    } as Response);

    const adapter = new OneThirtyPointAdapter(undefined, undefined, 0);
    await adapter.fetchComps(sampleRequest);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://back.130point.com/cards/',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    );

    const body = fetchSpy.mock.calls[0][1]?.body as string;
    expect(body).toContain('query=');
    expect(body).toContain('sort=date_desc');
  });
});
