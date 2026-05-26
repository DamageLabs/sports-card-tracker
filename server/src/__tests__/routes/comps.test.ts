import request from 'supertest';
import { createTestApp, cleanupTestContext, TestContext } from '../helpers/testSetup';
import { createCardData } from '../helpers/factories';
import { _resetRateLimitState as resetOneThirtyPointRateLimit } from '../../services/adapters/oneThirtyPoint';

describe('Comp Routes', () => {
  let ctx: TestContext;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Mock fetch so 130Point adapter doesn't make real HTTP calls
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network disabled in test'));
    ctx = await createTestApp();
  });

  beforeEach(() => {
    resetOneThirtyPointRateLimit();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    fetchSpy.mockRestore();
  });

  // Helper: create a card in the DB and return its ID
  async function createTestCard(overrides: Record<string, unknown> = {}): Promise<string> {
    const cardData = createCardData(overrides as any);
    const res = await request(ctx.app).post('/api/cards').send(cardData);
    return res.body.id;
  }

  // Helper: save a comp report for a card
  async function saveCompReport(cardId: string, overrides: Record<string, unknown> = {}) {
    return ctx.db.saveCompReport(cardId, {
      cardId,
      player: 'Mike Trout',
      year: 2023,
      brand: 'Topps',
      cardNumber: '1',
      sources: [{ source: 'eBay' as any, marketValue: 50, averagePrice: 50, low: 30, high: 70, sales: [] }],
      aggregateAverage: 50,
      aggregateMedian: null,
      aggregateLow: 30,
      aggregateHigh: 70,
      generatedAt: new Date().toISOString(),
      ...overrides,
    });
  }

  // ─── GET /api/comps/pop-summary ──────────────────────────────────────────

  describe('GET /api/comps/pop-summary', () => {
    it('returns empty array when no pop data exists', async () => {
      const res = await request(ctx.app).get('/api/comps/pop-summary');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns pop summary with rarity tiers', async () => {
      const cardId = await createTestCard();
      await saveCompReport(cardId, {
        popData: {
          gradingCompany: 'PSA',
          totalGraded: 100,
          gradeBreakdown: [{ grade: '10', count: 5 }],
          targetGrade: '10',
          targetGradePop: 5,
          higherGradePop: 0,
          percentile: 95,
          rarityTier: 'low',
          fetchedAt: new Date().toISOString(),
        },
        popMultiplier: 1.2,
        popAdjustedAverage: 60,
      });

      const res = await request(ctx.app).get('/api/comps/pop-summary');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const entry = res.body.find((e: any) => e.cardId === cardId);
      expect(entry).toBeDefined();
      expect(entry.rarityTier).toBe('low');
    });

    it('returns 500 when db throws', async () => {
      jest.spyOn(ctx.db, 'getPopSummary').mockRejectedValueOnce(new Error('DB error'));
      const res = await request(ctx.app).get('/api/comps/pop-summary');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get pop summary');
    });
  });

  // ─── POST /api/comps/generate ────────────────────────────────────────────

  describe('POST /api/comps/generate', () => {
    it('returns a comp report', async () => {
      const res = await request(ctx.app)
        .post('/api/comps/generate')
        .send({
          cardId: 'test-1',
          player: 'Mike Trout',
          year: 2023,
          brand: 'Topps',
          cardNumber: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body.cardId).toBe('test-1');
      expect(res.body.player).toBe('Mike Trout');
      expect(res.body.sources).toBeDefined();
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.generatedAt).toBeDefined();
    });

    it('returns 400 for missing fields', async () => {
      const res = await request(ctx.app)
        .post('/api/comps/generate')
        .send({ cardId: 'test-1', player: 'Mike Trout' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required fields/);
    });

    it('returns 500 when generateComps throws', async () => {
      jest.spyOn(ctx.compService, 'generateComps').mockRejectedValueOnce(new Error('fail'));
      const res = await request(ctx.app)
        .post('/api/comps/generate')
        .send({ cardId: 'x', player: 'P', year: 2023, brand: 'B', cardNumber: '1' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to generate comps');
    });
  });

  // ─── POST /api/comps/generate-and-save ───────────────────────────────────

  describe('POST /api/comps/generate-and-save', () => {
    it('generates and saves comp file', async () => {
      const res = await request(ctx.app)
        .post('/api/comps/generate-and-save')
        .send({
          cardId: 'save-1',
          player: 'Shohei Ohtani',
          year: 2023,
          brand: 'Topps',
          cardNumber: '100',
        });

      expect(res.status).toBe(200);
      expect(res.body.cardId).toBe('save-1');
      expect(res.body.sources).toBeDefined();
    });

    it('returns 400 for missing fields', async () => {
      const res = await request(ctx.app)
        .post('/api/comps/generate-and-save')
        .send({ player: 'Test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required fields/);
    });

    it('returns 500 when service throws', async () => {
      jest.spyOn(ctx.compService, 'generateAndWriteComps').mockRejectedValueOnce(new Error('fail'));
      const res = await request(ctx.app)
        .post('/api/comps/generate-and-save')
        .send({ cardId: 'x', player: 'P', year: 2023, brand: 'B', cardNumber: '1' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to generate and save comps');
    });
  });

  // ─── GET /api/comps/:cardId/stored ───────────────────────────────────────

  describe('GET /api/comps/:cardId/stored', () => {
    it('returns 404 when card not found', async () => {
      const res = await request(ctx.app).get('/api/comps/nonexistent/stored');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Card not found');
    });

    it('returns 404 when no stored comps exist', async () => {
      const cardId = await createTestCard();
      const res = await request(ctx.app).get(`/api/comps/${cardId}/stored`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No stored comps found for this card');
    });

    it('returns stored comps as a CompReport', async () => {
      const cardId = await createTestCard();
      const spy = jest.spyOn(ctx.compService, 'getStoredComps').mockResolvedValueOnce({
        id: 'report-1',
        cardId,
        condition: undefined,
        sources: [{ source: 'eBay' as any, marketValue: 50, averagePrice: 50, low: 30, high: 70, sales: [] }],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        generatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as any);

      const res = await request(ctx.app).get(`/api/comps/${cardId}/stored`);
      expect(res.status).toBe(200);
      expect(res.body.cardId).toBe(cardId);
      expect(res.body.aggregateAverage).toBe(50);
      expect(res.body.sources).toHaveLength(1);
      spy.mockRestore();
    });

    it('returns 500 when db throws', async () => {
      jest.spyOn(ctx.db, 'getCardById').mockRejectedValueOnce(new Error('DB error'));
      const res = await request(ctx.app).get('/api/comps/some-id/stored');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get stored comps');
    });
  });

  // ─── GET /api/comps/:cardId/history ──────────────────────────────────────

  describe('GET /api/comps/:cardId/history', () => {
    it('returns 404 when card not found', async () => {
      const res = await request(ctx.app).get('/api/comps/nonexistent/history');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Card not found');
    });

    it('returns comp history array', async () => {
      const cardId = await createTestCard();
      const spy = jest.spyOn(ctx.compService, 'getCompHistory').mockResolvedValueOnce([{
        id: 'report-1',
        cardId,
        condition: undefined,
        sources: [{ source: 'eBay' as any, marketValue: 50, averagePrice: 50, low: 30, high: 70, sales: [] }],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        generatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as any]);

      const res = await request(ctx.app).get(`/api/comps/${cardId}/history`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].cardId).toBe(cardId);
      spy.mockRestore();
    });

    it('respects limit query parameter', async () => {
      const cardId = await createTestCard();
      const spy = jest.spyOn(ctx.compService, 'getCompHistory').mockResolvedValueOnce([]);
      await request(ctx.app).get(`/api/comps/${cardId}/history?limit=5`).expect(200);
      expect(spy).toHaveBeenCalledWith(cardId, 5);
      spy.mockRestore();
    });

    it('returns 500 when service throws', async () => {
      jest.spyOn(ctx.db, 'getCardById').mockRejectedValueOnce(new Error('DB error'));
      const res = await request(ctx.app).get('/api/comps/some-id/history');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get comp history');
    });
  });

  // ─── GET /api/comps/:cardId/pop-history ──────────────────────────────────

  describe('GET /api/comps/:cardId/pop-history', () => {
    it('returns 404 when card not found', async () => {
      const res = await request(ctx.app).get('/api/comps/nonexistent/pop-history');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Card not found');
    });

    it('returns empty array when no pop history', async () => {
      const cardId = await createTestCard();
      const res = await request(ctx.app).get(`/api/comps/${cardId}/pop-history`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('respects limit query parameter', async () => {
      const cardId = await createTestCard();
      const spy = jest.spyOn(ctx.db, 'getPopHistory').mockResolvedValueOnce([]);
      await request(ctx.app).get(`/api/comps/${cardId}/pop-history?limit=10`).expect(200);
      expect(spy).toHaveBeenCalledWith(cardId, 10);
      spy.mockRestore();
    });

    it('returns 500 when service throws', async () => {
      jest.spyOn(ctx.db, 'getCardById').mockRejectedValueOnce(new Error('DB error'));
      const res = await request(ctx.app).get('/api/comps/some-id/pop-history');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get pop history');
    });
  });

  // ─── GET /api/comps/:cardId ──────────────────────────────────────────────

  describe('GET /api/comps/:cardId', () => {
    it('generates comps from card data', async () => {
      const cardData = createCardData({ player: 'Aaron Judge', year: 2023, brand: 'Topps', cardNumber: '99' });
      const created = await request(ctx.app).post('/api/cards').send(cardData);
      const cardId = created.body.id;

      const res = await request(ctx.app).get(`/api/comps/${cardId}`);

      expect(res.status).toBe(200);
      expect(res.body.cardId).toBe(cardId);
      expect(res.body.player).toBe('Aaron Judge');
      expect(res.body.sources).toBeDefined();
    });

    it('returns 404 for non-existent card', async () => {
      const res = await request(ctx.app).get('/api/comps/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns stored comps when available (no refresh)', async () => {
      const cardId = await createTestCard();
      const spy = jest.spyOn(ctx.compService, 'getStoredComps').mockResolvedValueOnce({
        id: 'report-1',
        cardId,
        condition: undefined,
        sources: [{ source: 'eBay' as any, marketValue: 50, averagePrice: 50, low: 30, high: 70, sales: [] }],
        aggregateAverage: 50,
        aggregateMedian: null,
        aggregateLow: 30,
        aggregateHigh: 70,
        generatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      } as any);

      const res = await request(ctx.app).get(`/api/comps/${cardId}`);
      expect(res.status).toBe(200);
      expect(res.body.cardId).toBe(cardId);
      expect(res.body.aggregateAverage).toBe(50);
      spy.mockRestore();
    });

    it('generates fresh comps when refresh=true', async () => {
      const cardId = await createTestCard();
      await saveCompReport(cardId);

      const spy = jest.spyOn(ctx.compService, 'generateAndWriteComps').mockResolvedValueOnce({
        cardId,
        player: 'Test',
        year: 2023,
        brand: 'Topps',
        cardNumber: '1',
        sources: [],
        aggregateAverage: 99,
        aggregateMedian: null,
        aggregateLow: 80,
        aggregateHigh: 120,
        generatedAt: new Date().toISOString(),
      });

      const res = await request(ctx.app).get(`/api/comps/${cardId}?refresh=true`);
      expect(res.status).toBe(200);
      expect(res.body.aggregateAverage).toBe(99);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('returns 500 when service throws', async () => {
      jest.spyOn(ctx.db, 'getCardById').mockRejectedValueOnce(new Error('DB error'));
      const res = await request(ctx.app).get('/api/comps/some-id');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get comps');
    });
  });
});
