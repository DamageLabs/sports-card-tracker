import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createTestApp, cleanupTestContext, TestContext } from '../helpers/testSetup';

describe('Image Processing Routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  // Helper to create a file in the raw directory
  function createRawFile(name: string, content = 'fake image data'): void {
    fs.writeFileSync(path.join(ctx.fileService.getRawDir(), name), content);
  }

  // Helper for a standard vision result
  function visionResult(overrides: Record<string, unknown> = {}) {
    return {
      player: 'Mike Trout',
      year: '2023',
      brand: 'Topps Chrome',
      team: 'Angels',
      cardNumber: '1',
      category: 'Baseball',
      confidence: { score: 85, level: 'high', detectedFields: 6 },
      ...overrides,
    };
  }

  // ─── GET /api/image-processing/processed-raw-files ───────────────────────

  describe('GET /api/image-processing/processed-raw-files', () => {
    it('returns raw filenames whose processed destination exists', async () => {
      fs.writeFileSync(
        path.join(ctx.fileService.getProcessedDir(), '2023-Topps-Mike-Trout-1-front.jpg'), 'data'
      );
      await ctx.db.insertAuditLog({
        action: 'image.auto_crop', entity: 'file', entityId: 'scan-front.jpg',
        details: { success: true, cropped: true, destination: '2023-Topps-Mike-Trout-1-front.jpg' },
      });
      // Destination deleted from processed/ — should not be reported
      await ctx.db.insertAuditLog({
        action: 'image.auto_crop', entity: 'file', entityId: 'gone-front.jpg',
        details: { success: true, cropped: true, destination: 'deleted-card-front.jpg' },
      });

      const res = await request(ctx.app).get('/api/image-processing/processed-raw-files');
      expect(res.status).toBe(200);
      expect(res.body).toContain('scan-front.jpg');
      expect(res.body).not.toContain('gone-front.jpg');
    });

    it('returns empty list with no audit history', async () => {
      const res = await request(ctx.app).get('/api/image-processing/processed-raw-files');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ─── POST /api/image-processing/process ──────────────────────────────────

  describe('POST /api/image-processing/process', () => {
    it('creates an image-processing job', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({ filenames: ['card1.jpg', 'card2.jpg'] })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('image-processing');
      expect(res.body.status).toBe('pending');
      expect(res.body.payload.filenames).toEqual(['card1.jpg', 'card2.jpg']);
    });

    it('returns 400 when filenames missing', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('filenames');
    });

    it('returns 400 when filenames is empty array', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({ filenames: [] })
        .expect(400);

      expect(res.body.error).toContain('filenames');
    });

    it('passes optional parameters to payload', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({ filenames: ['card.jpg'], skipExisting: false, confidenceThreshold: 60 })
        .expect(201);

      expect(res.body.payload.skipExisting).toBe(false);
      expect(res.body.payload.confidenceThreshold).toBe(60);
    });

    it('includes collectionId in job payload', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({ filenames: ['card.jpg'], collectionId: 'col-abc' })
        .expect(201);

      expect(res.body.payload.collectionId).toBe('col-abc');
    });

    it('returns 500 when db.createJob throws', async () => {
      jest.spyOn(ctx.db, 'createJob').mockRejectedValueOnce(new Error('DB error'));

      const res = await request(ctx.app)
        .post('/api/image-processing/process')
        .send({ filenames: ['card.jpg'] })
        .expect(500);

      expect(res.body.error).toBe('Failed to create image processing job');
    });
  });

  // ─── POST /api/image-processing/process-sync ─────────────────────────────

  describe('POST /api/image-processing/process-sync', () => {
    it('returns result for single file', async () => {
      createRawFile('test.jpg');
      ctx.visionService.identifyCard.mockResolvedValue(visionResult());

      const res = await request(ctx.app)
        .post('/api/image-processing/process-sync')
        .send({ filename: 'test.jpg' })
        .expect(200);

      expect(res.body.filename).toBe('test.jpg');
      expect(res.body.status).toBe('processed');
      expect(res.body.cardId).toBeDefined();
    });

    it('returns 400 when filename missing', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process-sync')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('filename');
    });

    it('returns 400 when filename is not a string', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/process-sync')
        .send({ filename: 123 })
        .expect(400);

      expect(res.body.error).toContain('filename');
    });

    it('returns 500 when processing fails', async () => {
      createRawFile('fail.jpg');
      ctx.visionService.identifyCard.mockRejectedValue(new Error('Vision crashed'));

      const res = await request(ctx.app)
        .post('/api/image-processing/process-sync')
        .send({ filename: 'fail.jpg' })
        .expect(500);

      expect(res.body.error).toBe('Failed to process image');
    });
  });

  // ─── POST /api/image-processing/identify ──────────────────────────────────

  describe('POST /api/image-processing/identify', () => {
    it('returns 400 when filename missing', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('filename');
    });

    it('returns 400 when filename is not a string', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({ filename: 42 })
        .expect(400);

      expect(res.body.error).toContain('filename');
    });

    it('identifies a single card image', async () => {
      createRawFile('identify.jpg');
      ctx.visionService.identifyCard.mockResolvedValue(visionResult());

      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({ filename: 'identify.jpg' })
        .expect(200);

      expect(res.body.player).toBe('Mike Trout');
      expect(res.body.year).toBe('2023');
      expect(res.body.confidence.score).toBe(85);
    });

    it('identifies a front/back pair', async () => {
      createRawFile('card-front.jpg');
      createRawFile('card-back.jpg');
      ctx.visionService.identifyCardPair.mockResolvedValue(visionResult());

      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({ filename: 'card-front.jpg', backFile: 'card-back.jpg' })
        .expect(200);

      expect(res.body.player).toBe('Mike Trout');
      expect(ctx.visionService.identifyCardPair).toHaveBeenCalled();
    });

    it('strips _apiMeta and _parseFailed from response', async () => {
      createRawFile('meta.jpg');
      ctx.visionService.identifyCard.mockResolvedValue({
        ...visionResult(),
        _apiMeta: { inputTokens: 100, outputTokens: 200, latencyMs: 500 },
        _parseFailed: false,
      });

      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({ filename: 'meta.jpg' })
        .expect(200);

      expect(res.body._apiMeta).toBeUndefined();
      expect(res.body._parseFailed).toBeUndefined();
      expect(res.body.player).toBe('Mike Trout');
    });

    it('returns 500 when vision service throws', async () => {
      createRawFile('error.jpg');
      ctx.visionService.identifyCard.mockRejectedValue(new Error('Vision API failed'));

      const res = await request(ctx.app)
        .post('/api/image-processing/identify')
        .send({ filename: 'error.jpg' })
        .expect(500);

      expect(res.body.error).toBe('Failed to identify card');
    });
  });

  // ─── POST /api/image-processing/confirm ───────────────────────────────────

  describe('POST /api/image-processing/confirm', () => {
    it('returns 400 when filename missing', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ cardData: { player: 'Test' } })
        .expect(400);

      expect(res.body.error).toContain('filename');
    });

    it('returns 400 when cardData missing', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'card.jpg' })
        .expect(400);

      expect(res.body.error).toContain('cardData');
    });

    it('returns 400 when cardData is not an object', async () => {
      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'card.jpg', cardData: 'not-object' })
        .expect(400);

      expect(res.body.error).toContain('cardData');
    });

    it('confirms a single image and creates card', async () => {
      createRawFile('confirm.jpg');
      const cardData = visionResult();

      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'confirm.jpg', cardData })
        .expect(200);

      expect(res.body.status).toBe('processed');
      expect(res.body.cardId).toBeDefined();
      expect(res.body.processedFilename).toBeDefined();
    });

    it('confirms a front/back pair', async () => {
      createRawFile('confirm-front.jpg');
      createRawFile('confirm-back.jpg');
      const cardData = visionResult({ player: 'PairConfirm', cardNumber: '42' });

      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'confirm-front.jpg', backFile: 'confirm-back.jpg', cardData })
        .expect(200);

      expect(res.body.status).toBe('processed');
      expect(res.body.cardId).toBeDefined();
    });

    it('logs user modifications when originalData differs', async () => {
      createRawFile('modified.jpg');
      const originalData = { player: 'Mike Trut', year: '2023', brand: 'Topps Chrome', cardNumber: '1' };
      const cardData = visionResult({ player: 'Mike Trout' });

      const logSpy = jest.spyOn(ctx.db, 'insertAuditLog');

      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'modified.jpg', cardData, originalData })
        .expect(200);

      expect(res.body.status).toBe('processed');

      // Check that user_modifications audit log was written
      const modCalls = logSpy.mock.calls.filter(
        call => (call[0] as any).action === 'image.user_modifications'
      );
      expect(modCalls.length).toBe(1);
      logSpy.mockRestore();
    });

    it('does not log modifications when originalData matches', async () => {
      createRawFile('nomod.jpg');
      const cardData = visionResult({ player: 'NoMod', cardNumber: '77' });
      // Must include all fields tracked by diffCardData so nothing appears changed
      const originalData = {
        player: 'NoMod', year: '2023', brand: 'Topps Chrome', cardNumber: '77',
        team: 'Angels', category: 'Baseball',
      };

      const logSpy = jest.spyOn(ctx.db, 'insertAuditLog');

      await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'nomod.jpg', cardData, originalData })
        .expect(200);

      const modCalls = logSpy.mock.calls.filter(
        call => (call[0] as any).action === 'image.user_modifications'
      );
      expect(modCalls.length).toBe(0);
      logSpy.mockRestore();
    });

    it('passes collectionId through to the created card', async () => {
      createRawFile('coll-confirm.jpg');
      const cardData = visionResult({ player: 'CollConfirm', cardNumber: '88' });

      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'coll-confirm.jpg', cardData, collectionId: 'col-xyz' })
        .expect(200);

      expect(res.body.status).toBe('processed');
      expect(res.body.cardId).toBeDefined();

      // Verify the card was created with the correct collectionId
      const card = await ctx.db.getCardById(res.body.cardId);
      expect(card).toBeDefined();
      expect(card!.collectionId).toBe('col-xyz');
    });

    it('returns 500 when confirmCard throws', async () => {
      jest.spyOn(ctx.imageProcessingService, 'confirmCard')
        .mockRejectedValueOnce(new Error('Confirm failed'));

      const res = await request(ctx.app)
        .post('/api/image-processing/confirm')
        .send({ filename: 'card.jpg', cardData: { player: 'Test' } })
        .expect(500);

      expect(res.body.error).toBe('Failed to confirm card');
    });
  });

  // ─── GET /api/image-processing/status ─────────────────────────────────────

  describe('GET /api/image-processing/status', () => {
    it('returns file counts', async () => {
      const rawDir = ctx.fileService.getRawDir();
      const processedDir = ctx.fileService.getProcessedDir();
      fs.writeFileSync(path.join(rawDir, 'card1.jpg'), 'data');
      fs.writeFileSync(path.join(rawDir, 'card2.jpg'), 'data');
      fs.writeFileSync(path.join(processedDir, 'processed1.jpg'), 'data');

      const res = await request(ctx.app)
        .get('/api/image-processing/status')
        .expect(200);

      expect(res.body.rawCount).toBe(2);
      expect(res.body.processedCount).toBe(1);
      expect(res.body.recentErrors).toEqual([]);
    });

    it('includes recent errors', async () => {
      await ctx.db.insertAuditLog({
        action: 'image.process_failed',
        entity: 'file',
        entityId: 'bad.jpg',
        details: { reason: 'OCR failed' },
      });

      const res = await request(ctx.app)
        .get('/api/image-processing/status')
        .expect(200);

      expect(res.body.recentErrors).toHaveLength(1);
      expect(res.body.recentErrors[0].filename).toBe('bad.jpg');
      expect(res.body.recentErrors[0].reason).toBe('OCR failed');
    });

    it('returns 500 when an error occurs', async () => {
      jest.spyOn(ctx.fileService, 'listFiles').mockImplementationOnce(() => {
        throw new Error('FS error');
      });

      const res = await request(ctx.app)
        .get('/api/image-processing/status')
        .expect(500);

      expect(res.body.error).toBe('Failed to get status');
    });
  });
});
