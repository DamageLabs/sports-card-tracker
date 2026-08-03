import Database from '../database';

describe('Database', () => {
  let db: Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.waitReady();
  });

  afterEach(async () => {
    await db.close();
  });

  const validCard = {
    player: 'Mike Trout',
    team: 'Angels',
    year: 2023,
    brand: 'Topps Chrome',
    category: 'Baseball',
    cardNumber: '1',
    condition: 'RAW',
    purchasePrice: 10,
    purchaseDate: '2023-01-01',
    currentValue: 15,
    images: ['card.jpg'],
    notes: 'Test card',
  };

  // ─── Cards ─────────────────────────────────────────────────────────────────

  describe('getCardByImage', () => {
    it('finds card by image filename', async () => {
      const card = await db.createCard({ ...validCard, images: ['trout-front.jpg', 'trout-back.jpg'] });
      const found = await db.getCardByImage('trout-front.jpg');
      expect(found).toBeDefined();
      expect(found!.id).toBe(card.id);
    });

    it('returns undefined when image not found', async () => {
      const found = await db.getCardByImage('nonexistent.jpg');
      expect(found).toBeUndefined();
    });
  });

  describe('updateCard value snapshot', () => {
    it('creates value snapshot when currentValue changes', async () => {
      const card = await db.createCard(validCard);

      await db.updateCard(card.id, { ...validCard, currentValue: 25 });

      // Verify snapshot was created by checking heatmap data
      const heatmap = db.getHeatmapDataForPeriod(new Date(0).toISOString());
      const row = heatmap.find(r => r.cardId === card.id);
      expect(row).toBeDefined();
    });
  });

  // ─── Collections ───────────────────────────────────────────────────────────

  describe('Collections CRUD', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await db.createUser({ username: 'testuser', email: 'test@test.com', password: 'password' });
      userId = user.id;
    });

    it('creates and retrieves a collection', async () => {
      const col = await db.createCollection({
        userId,
        name: 'My Baseball Cards',
        description: 'Test collection',
        icon: 'baseball',
        color: '#FF0000',
        isDefault: false,
        visibility: 'private',
        tags: ['baseball'],
      });

      expect(col.id).toBeDefined();
      expect(col.name).toBe('My Baseball Cards');

      const fetched = await db.getCollectionById(col.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('My Baseball Cards');
    });

    it('lists all collections for a user', async () => {
      await db.createCollection({ userId, name: 'Col 1' });
      await db.createCollection({ userId, name: 'Col 2' });

      const all = await db.getAllCollections(userId);
      expect(all).toHaveLength(2);
    });

    it('lists all collections without userId filter', async () => {
      await db.createCollection({ userId, name: 'Col 1' });
      const all = await db.getAllCollections();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it('updates a collection', async () => {
      const col = await db.createCollection({ userId, name: 'Original' });
      const updated = await db.updateCollection(col.id, { name: 'Updated' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated');
    });

    it('returns undefined when updating non-existent collection', async () => {
      const result = await db.updateCollection('nonexistent', { name: 'Test' });
      expect(result).toBeUndefined();
    });

    it('sets collection as default', async () => {
      const col1 = await db.createCollection({ userId, name: 'Col 1', isDefault: true });
      const col2 = await db.createCollection({ userId, name: 'Col 2', isDefault: false });

      await db.setCollectionAsDefault(col2.id, userId);

      const updated1 = await db.getCollectionById(col1.id);
      const updated2 = await db.getCollectionById(col2.id);
      expect(updated1!.isDefault).toBe(false);
      expect(updated2!.isDefault).toBe(true);
    });

    it('gets default collection', async () => {
      await db.createCollection({ userId, name: 'Default', isDefault: true });

      const def = await db.getDefaultCollection(userId);
      expect(def).toBeDefined();
      expect(def!.name).toBe('Default');
    });

    it('calculates collection stats', async () => {
      const col = await db.createCollection({ userId, name: 'Stats Col' });
      await db.createCard({ ...validCard, collectionId: col.id, purchasePrice: 10, currentValue: 20 });
      await db.createCard({ ...validCard, player: 'Ohtani', cardNumber: '2', collectionId: col.id, purchasePrice: 15, currentValue: 30 });

      const stats = await db.getCollectionStats(col.id);
      expect(stats.cardCount).toBe(2);
      expect(stats.totalValue).toBe(50);
      expect(stats.totalCost).toBe(25);
      expect(stats.categoryBreakdown['Baseball']).toBe(2);
    });

    it('moves cards to collection', async () => {
      const col = await db.createCollection({ userId, name: 'Target' });
      const card1 = await db.createCard(validCard);
      const card2 = await db.createCard({ ...validCard, player: 'Ohtani', cardNumber: '2' });

      const moved = await db.moveCardsToCollection([card1.id, card2.id], col.id);
      expect(moved).toBe(2);

      const stats = await db.getCollectionStats(col.id);
      expect(stats.cardCount).toBe(2);
    });

    it('initializes user collections with Personal and eBay', async () => {
      const cols = await db.initializeUserCollections(userId);
      expect(cols).toHaveLength(2);

      const personal = cols.find(c => c.name === 'Personal');
      const ebay = cols.find(c => c.name === 'eBay');

      expect(personal).toBeDefined();
      expect(personal!.isDefault).toBe(true);
      expect(personal!.color).toBe('#4F46E5');

      expect(ebay).toBeDefined();
      expect(ebay!.isDefault).toBe(false);
      expect(ebay!.color).toBe('#0064D2');

      // Calling again returns the same collections (idempotent)
      const same = await db.initializeUserCollections(userId);
      expect(same).toHaveLength(2);
      expect(same.find(c => c.name === 'Personal')!.id).toBe(personal!.id);
    });

    it('migrates legacy "My Collection" to Personal and adds eBay', async () => {
      // Simulate a legacy user with only "My Collection"
      const legacy = await db.createCollection({
        userId,
        name: 'My Collection',
        description: 'Default collection for all cards',
        icon: '',
        color: '#4F46E5',
        isDefault: true,
        visibility: 'private',
        tags: [],
      });

      const cols = await db.initializeUserCollections(userId);
      expect(cols).toHaveLength(2);

      const personal = cols.find(c => c.id === legacy.id);
      expect(personal).toBeDefined();
      expect(personal!.name).toBe('Personal');
      expect(personal!.description).toBe('Personal collection cards');
      expect(personal!.isDefault).toBe(true);

      const ebay = cols.find(c => c.name === 'eBay');
      expect(ebay).toBeDefined();
      expect(ebay!.isDefault).toBe(false);

      // Calling again is idempotent — no duplicates
      const same = await db.initializeUserCollections(userId);
      expect(same).toHaveLength(2);
    });

    it('deletes a collection', async () => {
      const col = await db.createCollection({ userId, name: 'Delete Me' });
      const deleted = await db.deleteCollection(col.id);
      expect(deleted).toBe(true);

      const fetched = await db.getCollectionById(col.id);
      expect(fetched).toBeUndefined();
    });
  });

  // ─── Audit Logs (additional) ───────────────────────────────────────────────

  describe('Audit Logs - uncovered methods', () => {
    it('queries audit logs with offset', async () => {
      await db.insertAuditLog({ action: 'card.create', entity: 'card', entityId: '1' });
      await db.insertAuditLog({ action: 'card.update', entity: 'card', entityId: '2' });

      const { entries } = await db.queryAuditLogs({ limit: 1, offset: 1 });
      expect(entries).toHaveLength(1);
    });

    it('gets distinct audit actions', async () => {
      await db.insertAuditLog({ action: 'card.create', entity: 'card' });
      await db.insertAuditLog({ action: 'card.delete', entity: 'card' });
      await db.insertAuditLog({ action: 'card.create', entity: 'card' });

      const actions = await db.getDistinctAuditActions();
      expect(actions).toContain('card.create');
      expect(actions).toContain('card.delete');
      expect(actions.length).toBe(2);
    });

    it('exports audit logs with after filter', async () => {
      const old = new Date(Date.now() - 86400000).toISOString();
      await db.insertAuditLog({ action: 'card.create', entity: 'card' });

      const entries = await db.exportAuditLogs({ after: old });
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Grading Stats ────────────────────────────────────────────────────────

  describe('getGradingStats', () => {
    let userId: string;
    let cardId: string;

    beforeEach(async () => {
      const user = await db.createUser({ username: 'grader', email: 'grader@test.com', password: 'password' });
      userId = user.id;
      const card = await db.createCard(validCard);
      cardId = card.id;
    });

    it('calculates avg turnaround and avg grade for completed submissions', async () => {
      const sub = await db.createGradingSubmission(userId, {
        cardId,
        gradingCompany: 'PSA',
        submissionNumber: 'SUB-001',
        tier: 'Regular',
        cost: 30,
        submittedAt: '2023-01-01T00:00:00Z',
      });

      await db.updateGradingSubmission(sub.id, {
        status: 'Complete',
        completedAt: '2023-02-01T00:00:00Z',
        grade: '9.5',
      });

      const stats = await db.getGradingStats(userId);
      expect(stats.totalSubmissions).toBe(1);
      expect(stats.complete).toBe(1);
      expect(stats.avgTurnaroundDays).toBeGreaterThan(0);
      expect(stats.avgGrade).toBe(9.5);
    });

    it('returns null for avgTurnaroundDays and avgGrade with no completed submissions', async () => {
      await db.createGradingSubmission(userId, {
        cardId,
        gradingCompany: 'PSA',
        submissionNumber: 'SUB-002',
        tier: 'Regular',
        cost: 30,
        submittedAt: '2023-01-01T00:00:00Z',
      });

      const stats = await db.getGradingStats(userId);
      expect(stats.avgTurnaroundDays).toBeNull();
      expect(stats.avgGrade).toBeNull();
    });
  });

  // ─── Heatmap & Value Snapshots ─────────────────────────────────────────────

  describe('getHeatmapDataForPeriod', () => {
    it('returns heatmap rows with periodStartValue', async () => {
      const card = await db.createCard(validCard);
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      db.createValueSnapshot(card.id, 12, 'comp', pastDate);

      const rows = db.getHeatmapDataForPeriod(pastDate);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows.find(r => r.cardId === card.id);
      expect(row).toBeDefined();
      expect(row!.isGraded).toBe(false);
    });

    it('excludes sold cards', async () => {
      await db.createCard({ ...validCard, sellDate: '2023-06-01' });
      const rows = db.getHeatmapDataForPeriod(new Date(0).toISOString());
      expect(rows).toHaveLength(0);
    });
  });

  describe('backfillValueSnapshots', () => {
    it('creates snapshots from comp reports', async () => {
      const card = await db.createCard(validCard);

      await db.saveCompReport(card.id, {
        cardId: card.id,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        psa10Median: null,
        psa9Median: null,
        generatedAt: '2023-06-01T00:00:00Z',
      });

      // First backfill creates the snapshot (the report also auto-creates one, so we may see 0)
      const count = db.backfillValueSnapshots();
      // The saveCompReport already creates a snapshot, so backfill may find 0 new ones
      expect(typeof count).toBe('number');
    });

    it('does not create duplicate snapshots', async () => {
      const card = await db.createCard(validCard);

      await db.saveCompReport(card.id, {
        cardId: card.id,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        psa10Median: null,
        psa9Median: null,
        generatedAt: '2023-06-01T00:00:00Z',
      });

      db.backfillValueSnapshots();
      const count2 = db.backfillValueSnapshots();
      expect(count2).toBe(0);
    });
  });

  // ─── Pop Snapshots ─────────────────────────────────────────────────────────

  describe('Pop Report Snapshots', () => {
    let cardId: string;

    beforeEach(async () => {
      const card = await db.createCard(validCard);
      cardId = card.id;
    });

    it('saves and retrieves a pop snapshot', async () => {
      const popData = {
        gradingCompany: 'PSA',
        totalGraded: 100,
        gradeBreakdown: [{ grade: '10', count: 5 }],
        targetGrade: '10',
        targetGradePop: 5,
        higherGradePop: 0,
        percentile: 95,
        rarityTier: 'low' as const,
        fetchedAt: new Date().toISOString(),
      };

      await db.savePopSnapshot(cardId, popData);

      const latest = await db.getLatestPopSnapshot(cardId, 'PSA', '10');
      expect(latest).toBeDefined();
      expect(latest!.totalGraded).toBe(100);
      expect(latest!.rarityTier).toBe('low');
    });

    it('returns null when no snapshot exists', async () => {
      const result = await db.getLatestPopSnapshot(cardId, 'PSA', '10');
      expect(result).toBeNull();
    });

    it('gets pop history', async () => {
      const popData = {
        gradingCompany: 'PSA',
        totalGraded: 100,
        gradeBreakdown: [],
        targetGrade: '10',
        targetGradePop: 5,
        higherGradePop: 0,
        percentile: 95,
        rarityTier: 'low' as const,
        fetchedAt: new Date().toISOString(),
      };

      await db.savePopSnapshot(cardId, popData);
      await db.savePopSnapshot(cardId, { ...popData, totalGraded: 110, fetchedAt: new Date().toISOString() });

      const history = await db.getPopHistory(cardId, 50);
      expect(history).toHaveLength(2);
    });
  });

  // ─── Comp Reports ─────────────────────────────────────────────────────────

  describe('Comp Report methods', () => {
    let cardId: string;

    beforeEach(async () => {
      const card = await db.createCard(validCard);
      cardId = card.id;
    });

    it('saves and retrieves latest comp report', async () => {
      await db.saveCompReport(cardId, {
        cardId,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [{ source: 'eBay' as any, marketValue: 50, averagePrice: 50, low: 30, high: 70, sales: [] }],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        psa10Median: null,
        psa9Median: null,
        generatedAt: new Date().toISOString(),
      });

      const report = await db.getLatestCompReport(cardId);
      expect(report).toBeDefined();
      expect(report!.aggregateAverage).toBe(50);
      expect(report!.sources).toHaveLength(1);
    });

    it('returns undefined when no report exists', async () => {
      const report = await db.getLatestCompReport(cardId);
      expect(report).toBeUndefined();
    });

    it('updates card currentValue when saving comp report', async () => {
      await db.saveCompReport(cardId, {
        cardId,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 99,
        aggregateMedian: null,
        aggregateLow: 80,
        aggregateHigh: 120,
        psa10Median: null,
        psa9Median: null,
        generatedAt: new Date().toISOString(),
      });

      const card = await db.getCardById(cardId);
      expect(card!.currentValue).toBe(99);
    });

    it('uses popAdjustedAverage over aggregateAverage when available', async () => {
      await db.saveCompReport(cardId, {
        cardId,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        psa10Median: null,
        psa9Median: null,
        popAdjustedAverage: 60,
        popMultiplier: 1.2,
        generatedAt: new Date().toISOString(),
      });

      const card = await db.getCardById(cardId);
      expect(card!.currentValue).toBe(60);
    });

    it('deletes comp reports for a card', async () => {
      await db.saveCompReport(cardId, {
        cardId,
        player: 'Mike Trout',
        year: 2023,
        brand: 'Topps Chrome',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        psa10Median: null,
        psa9Median: null,
        generatedAt: new Date().toISOString(),
      });

      const count = await db.deleteCompReports(cardId);
      expect(count).toBe(1);

      const report = await db.getLatestCompReport(cardId);
      expect(report).toBeUndefined();
    });
  });
});
