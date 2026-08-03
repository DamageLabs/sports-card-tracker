import Database from '../../database';
import { CompReport, CompResult } from '../../types';

function createTestReport(overrides: Partial<CompReport> = {}): CompReport {
  return {
    cardId: 'card-1',
    player: 'Mike Trout',
    year: 2023,
    brand: 'Topps',
    cardNumber: '1',
    condition: 'RAW',
    sources: [
      {
        source: 'SportsCardsPro',
        marketValue: 50,
        sales: [
          { date: '2023-12-01', price: 48, venue: 'SportsCardsPro' },
          { date: '2023-12-02', price: 52, venue: 'SportsCardsPro', grade: 'PSA 10' },
        ],
        averagePrice: 50,
        low: 40,
        high: 60,
      },
      {
        source: 'eBay',
        marketValue: 45,
        sales: [
          { date: '2023-12-03', price: 44, venue: 'eBay' },
        ],
        averagePrice: 45,
        low: 35,
        high: 55,
      },
    ],
    aggregateAverage: 47.5,
    aggregateMedian: null,
    aggregateLow: 35,
    aggregateHigh: 60,
    psa10Median: null,
    psa9Median: null,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Comp Storage (Database CRUD)', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.waitReady();

    // Create a test card
    await db.createCard({
      player: 'Mike Trout',
      team: 'Angels',
      year: 2023,
      brand: 'Topps',
      category: 'Baseball',
      cardNumber: '1',
      condition: 'RAW',
      purchasePrice: 10,
      purchaseDate: '2023-01-01',
      currentValue: 0,
      images: [],
      notes: '',
    });

    // Get the card to use its real ID
    const cards = await db.getAllCards();
    // Update our test card ID
    (createTestReport as any).__cardId = cards[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  function getCardId(): string {
    return (createTestReport as any).__cardId;
  }

  it('saveCompReport inserts report + sources + updates currentValue', async () => {
    const cardId = getCardId();
    const report = createTestReport({ cardId });

    const stored = await db.saveCompReport(cardId, report);

    expect(stored.id).toBeDefined();
    expect(stored.cardId).toBe(cardId);
    expect(stored.sources).toHaveLength(2);
    expect(stored.aggregateAverage).toBe(47.5);
    expect(stored.aggregateLow).toBe(35);
    expect(stored.aggregateHigh).toBe(60);
    expect(stored.generatedAt).toBe(report.generatedAt);
    expect(stored.createdAt).toBeDefined();

    // Verify card's currentValue was updated
    const card = await db.getCardById(cardId);
    expect(card!.currentValue).toBe(47.5);
  });

  it('getLatestCompReport returns most recent with all sources', async () => {
    const cardId = getCardId();

    // Insert two reports with different timestamps
    const report1 = createTestReport({
      cardId,
      generatedAt: '2023-12-01T00:00:00.000Z',
      aggregateAverage: 40,
    });
    const report2 = createTestReport({
      cardId,
      generatedAt: '2023-12-15T00:00:00.000Z',
      aggregateAverage: 50,
    });

    await db.saveCompReport(cardId, report1);
    await db.saveCompReport(cardId, report2);

    const latest = await db.getLatestCompReport(cardId);
    expect(latest).toBeDefined();
    expect(latest!.generatedAt).toBe('2023-12-15T00:00:00.000Z');
    expect(latest!.aggregateAverage).toBe(50);
    expect(latest!.sources).toHaveLength(2);
    expect(latest!.sources[0].source).toBe('SportsCardsPro');
    expect(latest!.sources[1].source).toBe('eBay');
  });

  it('getLatestCompReport returns undefined when none exist', async () => {
    const cardId = getCardId();
    const latest = await db.getLatestCompReport(cardId);
    expect(latest).toBeUndefined();
  });

  it('getCompHistory returns reverse chronological, respects limit', async () => {
    const cardId = getCardId();

    for (let i = 1; i <= 5; i++) {
      const report = createTestReport({
        cardId,
        generatedAt: `2023-12-${String(i).padStart(2, '0')}T00:00:00.000Z`,
        aggregateAverage: 40 + i,
      });
      await db.saveCompReport(cardId, report);
    }

    // Full history
    const allHistory = await db.getCompHistory(cardId);
    expect(allHistory).toHaveLength(5);
    expect(allHistory[0].generatedAt).toBe('2023-12-05T00:00:00.000Z');
    expect(allHistory[4].generatedAt).toBe('2023-12-01T00:00:00.000Z');

    // Limited history
    const limited = await db.getCompHistory(cardId, 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].generatedAt).toBe('2023-12-05T00:00:00.000Z');
    expect(limited[2].generatedAt).toBe('2023-12-03T00:00:00.000Z');
  });

  it('saveCompReport does NOT update currentValue when aggregateAverage is null', async () => {
    const cardId = getCardId();

    // Set currentValue to something non-zero first
    const report1 = createTestReport({ cardId, aggregateAverage: 50 });
    await db.saveCompReport(cardId, report1);

    const cardBefore = await db.getCardById(cardId);
    expect(cardBefore!.currentValue).toBe(50);

    // Now save a report with null aggregate (all sources failed)
    const failedReport = createTestReport({
      cardId,
      sources: [
        { source: 'SportsCardsPro', marketValue: null, sales: [], averagePrice: null, low: null, high: null, error: 'Failed' },
      ],
      aggregateAverage: null,
      aggregateMedian: null,
      aggregateLow: null,
      aggregateHigh: null,
      psa10Median: null,
      psa9Median: null,
    });
    await db.saveCompReport(cardId, failedReport);

    // currentValue should remain unchanged
    const cardAfter = await db.getCardById(cardId);
    expect(cardAfter!.currentValue).toBe(50);
  });

  it('deleteCompReports cascades to sources', async () => {
    const cardId = getCardId();
    const report = createTestReport({ cardId });
    await db.saveCompReport(cardId, report);

    // Verify data exists
    const beforeDelete = await db.getLatestCompReport(cardId);
    expect(beforeDelete).toBeDefined();
    expect(beforeDelete!.sources).toHaveLength(2);

    // Delete reports
    const deleted = await db.deleteCompReports(cardId);
    expect(deleted).toBe(1);

    // Verify all cleaned up
    const afterDelete = await db.getLatestCompReport(cardId);
    expect(afterDelete).toBeUndefined();
  });

  it('sales JSON round-trips correctly', async () => {
    const cardId = getCardId();
    const report = createTestReport({ cardId });

    await db.saveCompReport(cardId, report);
    const stored = await db.getLatestCompReport(cardId);

    expect(stored).toBeDefined();
    const scpSource = stored!.sources.find(s => s.source === 'SportsCardsPro');
    expect(scpSource).toBeDefined();
    expect(scpSource!.sales).toHaveLength(2);
    expect(scpSource!.sales[0].date).toBe('2023-12-01');
    expect(scpSource!.sales[0].price).toBe(48);
    expect(scpSource!.sales[0].venue).toBe('SportsCardsPro');
    expect(scpSource!.sales[1].grade).toBe('PSA 10');
  });

  it('multiple saves create separate history entries', async () => {
    const cardId = getCardId();

    const report1 = createTestReport({
      cardId,
      generatedAt: '2023-12-01T00:00:00.000Z',
      aggregateAverage: 40,
    });
    const report2 = createTestReport({
      cardId,
      generatedAt: '2023-12-15T00:00:00.000Z',
      aggregateAverage: 55,
    });

    await db.saveCompReport(cardId, report1);
    await db.saveCompReport(cardId, report2);

    const history = await db.getCompHistory(cardId);
    expect(history).toHaveLength(2);
    expect(history[0].aggregateAverage).toBe(55);
    expect(history[1].aggregateAverage).toBe(40);
  });
});
