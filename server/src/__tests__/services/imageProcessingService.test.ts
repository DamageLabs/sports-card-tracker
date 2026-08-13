import fs from 'fs';
import path from 'path';
import os from 'os';
import FileService from '../../services/fileService';
import ImageProcessingService from '../../services/imageProcessingService';
import Database from '../../database';
import { ExtractedCardData } from '../../types';

// Stub vision service — tests mock identifyCard per test
const mockVisionService = {
  identifyCard: jest.fn(),
  identifyCardPair: jest.fn(),
} as any;

describe('ImageProcessingService', () => {
  let tempDir: string;
  let rawDir: string;
  let processedDir: string;
  let fileService: FileService;
  let db: Database;
  let service: ImageProcessingService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgproc-test-'));
    rawDir = path.join(tempDir, 'raw');
    processedDir = path.join(tempDir, 'processed');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });

    fileService = new FileService(rawDir, processedDir, tempDir);
    db = new Database(':memory:');
    await db.waitReady();
    service = new ImageProcessingService(fileService, db, mockVisionService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createTestFile(name: string, content: string = 'fake image data'): void {
    fs.writeFileSync(path.join(rawDir, name), content);
  }

  function mockVisionResult(overrides: Partial<ExtractedCardData> = {}): ExtractedCardData {
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

  describe('buildProcessedFilename', () => {
    it('builds filename from extracted data', () => {
      const result = service.buildProcessedFilename(
        { year: '2023', brand: 'Topps Chrome', player: 'Mike Trout', cardNumber: '1' },
        '.jpg'
      );
      expect(result).toBe('2023-Topps-Chrome-Mike-Trout-1.jpg');
    });

    it('uses Unknown for missing fields', () => {
      const result = service.buildProcessedFilename({}, '.png');
      expect(result).toBe('Unknown-Unknown-Unknown-0.png');
    });

    it('replaces spaces with hyphens', () => {
      const result = service.buildProcessedFilename(
        { year: '2023', brand: 'Upper Deck', player: 'Ken Griffey Jr.', cardNumber: '1' },
        '.jpg'
      );
      expect(result).toBe('2023-Upper-Deck-Ken-Griffey-Jr.-1.jpg');
    });

    it('includes setName when present', () => {
      const result = service.buildProcessedFilename(
        { year: '2023', brand: 'Topps', setName: 'Chrome Update', player: 'Mike Trout', cardNumber: '1' },
        '.jpg'
      );
      expect(result).toBe('2023-Topps-Chrome-Update-Mike-Trout-1.jpg');
    });

    it('appends parallel after cardNumber', () => {
      const result = service.buildProcessedFilename(
        { year: '2024', brand: 'Topps', setName: 'Cosmic Chrome Planetary Pursuit', player: 'Xavier Worthy', cardNumber: 'XW', parallel: 'Earth' },
        '.jpg'
      );
      expect(result).toBe('2024-Topps-Cosmic-Chrome-Planetary-Pursuit-Xavier-Worthy-XW-Earth.jpg');
    });

    it('includes parallel even without setName', () => {
      const result = service.buildProcessedFilename(
        { year: '2024', brand: 'Topps', player: 'Xavier Worthy', cardNumber: 'XW', parallel: 'Jupiter' },
        '.jpg'
      );
      expect(result).toBe('2024-Topps-Xavier-Worthy-XW-Jupiter.jpg');
    });

    it('omits parallel slot when absent', () => {
      const result = service.buildProcessedFilename(
        { year: '2024', brand: 'Topps', setName: 'Chrome', player: 'Mike Trout', cardNumber: '1' },
        '.jpg'
      );
      expect(result).toBe('2024-Topps-Chrome-Mike-Trout-1.jpg');
    });
  });

  describe('checkDuplicate', () => {
    it('returns null when no duplicate exists', async () => {
      const result = await service.checkDuplicate({
        player: 'Mike Trout', year: '2023', brand: 'Topps', cardNumber: '1',
      });
      expect(result).toBeNull();
    });

    it('returns existing card when duplicate found', async () => {
      // Create a processed file so the card is not treated as orphaned
      fs.writeFileSync(path.join(processedDir, 'existing.jpg'), 'data');
      await db.createCard({
        player: 'Mike Trout', team: 'Angels', year: 2023, brand: 'Topps',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Mike Trout', year: '2023', brand: 'Topps', cardNumber: '1',
      });
      expect(result).not.toBeNull();
      expect(result!.player).toBe('Mike Trout');
    });

    it('returns null when fields are missing', async () => {
      const result = await service.checkDuplicate({ player: 'Mike Trout' });
      expect(result).toBeNull();
    });

    it('is case-insensitive', async () => {
      fs.writeFileSync(path.join(processedDir, 'existing2.jpg'), 'data');
      await db.createCard({
        player: 'Mike Trout', team: 'Angels', year: 2023, brand: 'Topps',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing2.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'mike trout', year: '2023', brand: 'topps', cardNumber: '1',
      });
      expect(result).not.toBeNull();
    });

    it('cleans up orphaned records (files missing from disk)', async () => {
      // Create a card in DB whose processed file does NOT exist on disk
      const card = await db.createCard({
        player: 'Orphan Player', team: 'Team', year: 2023, brand: 'Topps',
        category: 'Baseball', cardNumber: '99', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['nonexistent.jpg'], notes: '',
      });

      // checkDuplicate should find the match but detect the orphan and delete it
      const result = await service.checkDuplicate({
        player: 'Orphan Player', year: '2023', brand: 'Topps', cardNumber: '99',
      });
      expect(result).toBeNull(); // orphan removed, not treated as duplicate

      // Verify the orphaned card was deleted
      const allCards = await db.getAllCards();
      expect(allCards.find(c => c.id === card.id)).toBeUndefined();
    });

    it('does not match when parallel differs', async () => {
      // Existing record: Earth parallel
      fs.writeFileSync(path.join(processedDir, 'worthy-earth.jpg'), 'data');
      await db.createCard({
        player: 'Xavier Worthy', team: 'Chiefs', year: 2024, brand: 'Topps',
        setName: 'Cosmic Chrome Planetary Pursuit', parallel: 'Earth',
        category: 'Football', cardNumber: 'XW', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2024-01-01', currentValue: 0,
        images: ['worthy-earth.jpg'], notes: '',
      });

      // Incoming card: same player+year+brand+#, but Jupiter parallel.
      const result = await service.checkDuplicate({
        player: 'Xavier Worthy', year: '2024', brand: 'Topps',
        setName: 'Cosmic Chrome Planetary Pursuit', parallel: 'Jupiter', cardNumber: 'XW',
      });
      expect(result).toBeNull();
    });

    it('does not match when setName differs', async () => {
      fs.writeFileSync(path.join(processedDir, 'odunze-optic.jpg'), 'data');
      await db.createCard({
        player: 'Rome Odunze', team: 'Bears', year: 2024, brand: 'Panini',
        setName: 'Donruss Optic', category: 'Football', cardNumber: '15', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2024-01-01', currentValue: 0,
        images: ['odunze-optic.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Rome Odunze', year: '2024', brand: 'Panini',
        setName: 'Absolute', cardNumber: '15',
      });
      expect(result).toBeNull();
    });

    it('matches when both records lack setName and parallel', async () => {
      fs.writeFileSync(path.join(processedDir, 'plain.jpg'), 'data');
      await db.createCard({
        player: 'Plain Card', team: 'Team', year: 2024, brand: 'Panini',
        category: 'Football', cardNumber: '50', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2024-01-01', currentValue: 0,
        images: ['plain.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Plain Card', year: '2024', brand: 'Panini', cardNumber: '50',
      });
      expect(result).not.toBeNull();
    });

    it('matches when setName + parallel both match exactly', async () => {
      fs.writeFileSync(path.join(processedDir, 'full-match.jpg'), 'data');
      await db.createCard({
        player: 'Full Match', team: 'Team', year: 2024, brand: 'Panini',
        setName: 'Donruss Optic', parallel: 'Holo',
        category: 'Football', cardNumber: '7', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2024-01-01', currentValue: 0,
        images: ['full-match.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Full Match', year: '2024', brand: 'Panini',
        setName: 'donruss optic', parallel: 'HOLO', cardNumber: '7',
      });
      expect(result).not.toBeNull();
    });

    it('matches variant player phrasing (containment)', async () => {
      fs.writeFileSync(path.join(processedDir, 'dialga.jpg'), 'data');
      await db.createCard({
        player: 'Origin Forme Dialga V', team: '', year: 2022, brand: 'Pokemon',
        setName: 'Astral Radiance', category: 'Pokemon', cardNumber: '177', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2022-01-01', currentValue: 0,
        images: ['dialga.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Dialga V', year: '2022', brand: 'Pokemon',
        setName: 'Astral Radiance', cardNumber: '177',
      });
      expect(result).not.toBeNull();
    });

    it('matches when set name was misfiled into parallel (combined signature)', async () => {
      fs.writeFileSync(path.join(processedDir, 'dialga2.jpg'), 'data');
      await db.createCard({
        player: 'Origin Forme Dialga V', team: '', year: 2022, brand: 'Pokemon',
        setName: 'Sword & Shield - Astral Radiance', category: 'Pokemon',
        cardNumber: '177', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2022-01-01', currentValue: 0,
        images: ['dialga2.jpg'], notes: '',
      });

      // Incoming scan misfiled the set: setName "SWSH", parallel "Astral Radiance"
      const result = await service.checkDuplicate({
        player: 'Dialga V', year: '2022', brand: 'Pokemon',
        setName: 'SWSH', parallel: 'Astral Radiance', cardNumber: '177',
      });
      expect(result).not.toBeNull();
    });

    it('does not merge parallels where one contains the other', async () => {
      fs.writeFileSync(path.join(processedDir, 'gold.jpg'), 'data');
      await db.createCard({
        player: 'Gold Guy', team: 'Team', year: 2024, brand: 'Topps',
        setName: 'Chrome', parallel: 'Gold', category: 'Baseball',
        cardNumber: '12', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2024-01-01', currentValue: 0,
        images: ['gold.jpg'], notes: '',
      });

      const result = await service.checkDuplicate({
        player: 'Gold Guy', year: '2024', brand: 'Topps',
        setName: 'Chrome', parallel: 'Gold Refractor', cardNumber: '12',
      });
      expect(result).toBeNull();
    });
  });

  describe('isAlreadyProcessed', () => {
    it('returns false when file does not exist', () => {
      expect(service.isAlreadyProcessed('2023-Topps-Trout-1.jpg')).toBe(false);
    });

    it('returns true when file exists in processed dir', () => {
      fs.writeFileSync(path.join(processedDir, '2023-Topps-Trout-1.jpg'), 'data');
      expect(service.isAlreadyProcessed('2023-Topps-Trout-1.jpg')).toBe(true);
    });
  });

  describe('findPairFile', () => {
    it('finds back file for front file', () => {
      const result = service.findPairFile('card1-front.jpg', ['card1-front.jpg', 'card1-back.jpg']);
      expect(result).toBe('card1-back.jpg');
    });

    it('finds front file for back file', () => {
      const result = service.findPairFile('card1-back.jpg', ['card1-front.jpg', 'card1-back.jpg']);
      expect(result).toBe('card1-front.jpg');
    });

    it('returns null for non-paired file', () => {
      const result = service.findPairFile('card1.jpg', ['card1.jpg', 'card2.jpg']);
      expect(result).toBeNull();
    });

    it('returns null when pair is missing', () => {
      const result = service.findPairFile('card1-front.jpg', ['card1-front.jpg']);
      expect(result).toBeNull();
    });
  });

  describe('identifyOnly', () => {
    it('identifies a single image via vision service', async () => {
      createTestFile('card.jpg');
      const expected = mockVisionResult();
      mockVisionService.identifyCard.mockResolvedValue(expected);

      const result = await service.identifyOnly('card.jpg');
      expect(result).toEqual(expected);
      expect(mockVisionService.identifyCard).toHaveBeenCalledWith(
        path.join(rawDir, 'card.jpg')
      );
    });

    it('identifies a front/back pair via vision service', async () => {
      createTestFile('card-front.jpg');
      createTestFile('card-back.jpg');
      const expected = mockVisionResult();
      mockVisionService.identifyCardPair.mockResolvedValue(expected);

      const result = await service.identifyOnly('card-front.jpg', 'card-back.jpg');
      expect(result).toEqual(expected);
      expect(mockVisionService.identifyCardPair).toHaveBeenCalledWith(
        path.join(rawDir, 'card-front.jpg'),
        path.join(rawDir, 'card-back.jpg')
      );
    });
  });

  describe('confirmCard', () => {
    it('confirms a single image and creates a card record', async () => {
      createTestFile('card.jpg');
      const cardData = mockVisionResult();

      const result = await service.confirmCard('card.jpg', cardData);
      expect(result.status).toBe('processed');
      expect(result.cardId).toBeDefined();
      expect(result.processedFilename).toBe('2023-Topps-Chrome-Mike-Trout-1.jpg');
      expect(result.confidence).toBe(85);

      // Verify file was copied to processed dir
      expect(fs.existsSync(path.join(processedDir, result.processedFilename!))).toBe(true);
    });

    it('confirms a front/back pair and creates card with both images', async () => {
      createTestFile('trout-front.jpg');
      createTestFile('trout-back.png');
      const cardData = mockVisionResult();

      const result = await service.confirmCard('trout-front.jpg', cardData, 'trout-back.png');
      expect(result.status).toBe('processed');
      expect(result.cardId).toBeDefined();

      // Verify both files copied with -front/-back suffixes
      const card = (await db.getAllCards()).find(c => c.id === result.cardId);
      expect(card).toBeDefined();
      expect(card!.images).toHaveLength(2);
      expect(card!.images[0]).toContain('-front.jpg');
      expect(card!.images[1]).toContain('-back.png');
    });

    it('skips if already processed (single)', async () => {
      createTestFile('card.jpg');
      const cardData = mockVisionResult();

      // Pre-create the processed file
      const processedFilename = service.buildProcessedFilename(cardData, '.jpg');
      fs.writeFileSync(path.join(processedDir, processedFilename), 'existing');

      const result = await service.confirmCard('card.jpg', cardData);
      expect(result.status).toBe('skipped');
    });

    it('skips if already processed (pair)', async () => {
      createTestFile('card-front.jpg');
      createTestFile('card-back.jpg');
      const cardData = mockVisionResult();

      // Pre-create the processed front file
      const baseName = service.buildProcessedFilename(cardData, '');
      fs.writeFileSync(path.join(processedDir, baseName + '-front.jpg'), 'existing');

      const result = await service.confirmCard('card-front.jpg', cardData, 'card-back.jpg');
      expect(result.status).toBe('skipped');
    });

    it('detects duplicate on confirm (single)', async () => {
      createTestFile('card.jpg');
      fs.writeFileSync(path.join(processedDir, 'existing.jpg'), 'data');
      await db.createCard({
        player: 'Mike Trout', team: 'Angels', year: 2023, brand: 'Topps Chrome',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing.jpg'], notes: '',
      });

      const result = await service.confirmCard('card.jpg', mockVisionResult());
      expect(result.status).toBe('duplicate');
      expect(result.error).toContain('Duplicate');
    });

    it('detects duplicate on confirm (pair)', async () => {
      createTestFile('card-front.jpg');
      createTestFile('card-back.jpg');
      fs.writeFileSync(path.join(processedDir, 'existing.jpg'), 'data');
      await db.createCard({
        player: 'Mike Trout', team: 'Angels', year: 2023, brand: 'Topps Chrome',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing.jpg'], notes: '',
      });

      const result = await service.confirmCard('card-front.jpg', mockVisionResult(), 'card-back.jpg');
      expect(result.status).toBe('duplicate');
    });

    it('returns failed when copy fails (single)', async () => {
      // Don't create the file so copy will fail
      const cardData = mockVisionResult({ player: 'NoFile', cardNumber: '999' });

      const result = await service.confirmCard('missing.jpg', cardData);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Failed to copy');
    });

    it('sets collectionId on the created card when provided', async () => {
      createTestFile('card-coll.jpg');
      const cardData = mockVisionResult({ player: 'CollTest', cardNumber: '50', collectionId: 'col-123' });

      const result = await service.confirmCard('card-coll.jpg', cardData);
      expect(result.status).toBe('processed');

      const card = (await db.getAllCards()).find(c => c.id === result.cardId);
      expect(card).toBeDefined();
      expect(card!.collectionId).toBe('col-123');
    });
  });

  describe('processSingleImage', () => {
    it('processes a card image successfully', async () => {
      createTestFile('card.jpg');
      mockVisionService.identifyCard.mockResolvedValue(mockVisionResult());

      const result = await service.processSingleImage('card.jpg');
      expect(result.status).toBe('processed');
      expect(result.processedFilename).toBeDefined();
      expect(result.cardId).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('fails when confidence is below threshold', async () => {
      createTestFile('blurry.jpg');
      mockVisionService.identifyCard.mockResolvedValue(
        mockVisionResult({ confidence: { score: 20, level: 'low', detectedFields: 1 } })
      );

      const result = await service.processSingleImage('blurry.jpg', { confidenceThreshold: 50 });
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Low confidence');
    });

    it('skips already processed files', async () => {
      createTestFile('card.jpg');
      mockVisionService.identifyCard.mockResolvedValue(mockVisionResult());

      // Process once
      const first = await service.processSingleImage('card.jpg');
      expect(first.status).toBe('processed');

      // Process again -- should skip
      const second = await service.processSingleImage('card.jpg');
      expect(second.status).toBe('skipped');
    });

    it('detects duplicates', async () => {
      // Create existing card in DB with a real processed file
      fs.writeFileSync(path.join(processedDir, 'existing.jpg'), 'data');
      await db.createCard({
        player: 'Mike Trout', team: 'Angels', year: 2023, brand: 'Topps Chrome',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing.jpg'], notes: '',
      });

      createTestFile('card2.jpg');
      mockVisionService.identifyCard.mockResolvedValue(
        mockVisionResult({ brand: 'Topps Chrome' })
      );

      const result = await service.processSingleImage('card2.jpg', { skipExisting: false });
      expect(result.status).toBe('duplicate');
    });

    it('handles vision API error gracefully', async () => {
      createTestFile('corrupt.jpg');
      mockVisionService.identifyCard.mockRejectedValue(new Error('Vision API failure'));

      await expect(service.processSingleImage('corrupt.jpg')).rejects.toThrow('Vision API failure');
    });

    it('returns failed when file copy fails', async () => {
      // Create the file but mock copyFile to fail
      createTestFile('card.jpg');
      mockVisionService.identifyCard.mockResolvedValue(
        mockVisionResult({ player: 'CopyFail', cardNumber: '777' })
      );

      jest.spyOn(fileService, 'copyFile').mockReturnValueOnce(false);

      const result = await service.processSingleImage('card.jpg');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Failed to copy');
    });

    it('threads collectionId option to the created card', async () => {
      createTestFile('coll-single.jpg');
      mockVisionService.identifyCard.mockResolvedValue(
        mockVisionResult({ player: 'CollSingle', cardNumber: '60' })
      );

      const result = await service.processSingleImage('coll-single.jpg', { collectionId: 'col-456' });
      expect(result.status).toBe('processed');

      const card = (await db.getAllCards()).find(c => c.id === result.cardId);
      expect(card).toBeDefined();
      expect(card!.collectionId).toBe('col-456');
    });
  });

  describe('processImages', () => {
    it('processes a batch of images', async () => {
      createTestFile('card1.jpg');
      createTestFile('card2.jpg');
      mockVisionService.identifyCard
        .mockResolvedValueOnce(mockVisionResult())
        .mockResolvedValueOnce(mockVisionResult({ player: 'Aaron Judge', cardNumber: '99', team: 'Yankees' }));

      const result = await service.processImages({
        filenames: ['card1.jpg', 'card2.jpg'],
      });

      expect(result.totalFiles).toBe(2);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it('reports progress via callback', async () => {
      createTestFile('card1.jpg');
      mockVisionService.identifyCard.mockResolvedValue(mockVisionResult());

      const progressCalls: number[] = [];
      await service.processImages(
        { filenames: ['card1.jpg'] },
        async (progress) => { progressCalls.push(progress); }
      );

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]).toBe(100);
    });

    it('handles mixed results (success and failure)', async () => {
      createTestFile('good.jpg');
      createTestFile('bad.jpg');
      mockVisionService.identifyCard
        .mockResolvedValueOnce(mockVisionResult())
        .mockResolvedValueOnce(mockVisionResult({ confidence: { score: 10, level: 'low', detectedFields: 0 } }));

      const result = await service.processImages({
        filenames: ['good.jpg', 'bad.jpg'],
      });

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('handles front/back pairs', async () => {
      createTestFile('trout-front.jpg');
      createTestFile('trout-back.jpg');
      mockVisionService.identifyCardPair.mockResolvedValue(mockVisionResult());

      const result = await service.processImages({
        filenames: ['trout-front.jpg', 'trout-back.jpg'],
      });

      expect(result.processed).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('processed');
    });

    it('ensures idempotency on re-run', async () => {
      createTestFile('card1.jpg');
      mockVisionService.identifyCard.mockResolvedValue(mockVisionResult());

      const first = await service.processImages({ filenames: ['card1.jpg'] });
      expect(first.processed).toBe(1);

      const second = await service.processImages({ filenames: ['card1.jpg'] });
      expect(second.skipped).toBe(1);
      expect(second.processed).toBe(0);
    });

    it('catches errors from paired image processing', async () => {
      createTestFile('err-front.jpg');
      createTestFile('err-back.jpg');
      mockVisionService.identifyCardPair.mockRejectedValue(new Error('Pair vision failed'));

      const result = await service.processImages({
        filenames: ['err-front.jpg', 'err-back.jpg'],
      });

      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('Pair vision failed');
    });

    it('catches errors from standalone image processing', async () => {
      createTestFile('standalone.jpg');
      mockVisionService.identifyCard.mockRejectedValue(new Error('Standalone vision failed'));

      const result = await service.processImages({
        filenames: ['standalone.jpg'],
      });

      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('Standalone vision failed');
    });

    it('reports progress for paired images', async () => {
      createTestFile('pair-front.jpg');
      createTestFile('pair-back.jpg');
      mockVisionService.identifyCardPair.mockResolvedValue(
        mockVisionResult({ player: 'PairProgress', cardNumber: '88' })
      );

      const progressCalls: { progress: number; completed: number }[] = [];
      await service.processImages(
        { filenames: ['pair-front.jpg', 'pair-back.jpg'] },
        async (progress, completed) => { progressCalls.push({ progress, completed }); }
      );

      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it('handles paired low confidence as failure', async () => {
      createTestFile('lowconf-front.jpg');
      createTestFile('lowconf-back.jpg');
      mockVisionService.identifyCardPair.mockResolvedValue(
        mockVisionResult({ confidence: { score: 15, level: 'low', detectedFields: 1 } })
      );

      const result = await service.processImages({
        filenames: ['lowconf-front.jpg', 'lowconf-back.jpg'],
        confidenceThreshold: 50,
      });

      expect(result.failed).toBe(1);
      expect(result.results[0].error).toContain('Low confidence');
    });

    it('detects duplicate in paired images', async () => {
      createTestFile('dup-front.jpg');
      createTestFile('dup-back.jpg');
      fs.writeFileSync(path.join(processedDir, 'existing-dup.jpg'), 'data');
      await db.createCard({
        player: 'DupPair', team: 'Team', year: 2023, brand: 'Topps Chrome',
        category: 'Baseball', cardNumber: '1', condition: 'Raw',
        purchasePrice: 0, purchaseDate: '2023-01-01', currentValue: 0,
        images: ['existing-dup.jpg'], notes: '',
      });

      mockVisionService.identifyCardPair.mockResolvedValue(
        mockVisionResult({ player: 'DupPair' })
      );

      const result = await service.processImages({
        filenames: ['dup-front.jpg', 'dup-back.jpg'],
        skipExisting: false,
      });

      expect(result.duplicates).toBe(1);
    });

    it('applies collectionId from payload to all created cards', async () => {
      createTestFile('batch-coll1.jpg');
      createTestFile('batch-coll2.jpg');
      mockVisionService.identifyCard
        .mockResolvedValueOnce(mockVisionResult({ player: 'BatchColl1', cardNumber: '70' }))
        .mockResolvedValueOnce(mockVisionResult({ player: 'BatchColl2', cardNumber: '71' }));

      const result = await service.processImages({
        filenames: ['batch-coll1.jpg', 'batch-coll2.jpg'],
        collectionId: 'col-789',
      });

      expect(result.processed).toBe(2);
      const cards = await db.getAllCards();
      expect(cards).toHaveLength(2);
      expect(cards.every(c => c.collectionId === 'col-789')).toBe(true);
    });

    it('skips already processed paired files', async () => {
      createTestFile('skip-front.jpg');
      createTestFile('skip-back.jpg');

      const cardData = mockVisionResult({ player: 'SkipPair', cardNumber: '42' });
      mockVisionService.identifyCardPair.mockResolvedValue(cardData);

      // Pre-create the processed front file
      const baseName = service.buildProcessedFilename(cardData, '');
      fs.writeFileSync(path.join(processedDir, baseName + '-front.jpg'), 'existing');

      const result = await service.processImages({
        filenames: ['skip-front.jpg', 'skip-back.jpg'],
      });

      expect(result.skipped).toBe(1);
    });
  });

  describe('copyOrCropFile', () => {
    it('uses cropService when available', async () => {
      const mockCropService = {
        cropAndSave: jest.fn().mockResolvedValue({
          success: true,
          cropped: true,
          originalSize: { width: 1000, height: 1500 },
          croppedSize: { width: 800, height: 1200 },
        }),
      } as any;

      const serviceWithCrop = new ImageProcessingService(
        fileService, db, mockVisionService, mockCropService
      );

      createTestFile('crop-card.jpg');
      mockVisionService.identifyCard.mockResolvedValue(
        mockVisionResult({ player: 'CropTest', cardNumber: '55' })
      );

      const result = await serviceWithCrop.processSingleImage('crop-card.jpg');
      expect(result.status).toBe('processed');
      expect(mockCropService.cropAndSave).toHaveBeenCalled();
    });
  });
});
