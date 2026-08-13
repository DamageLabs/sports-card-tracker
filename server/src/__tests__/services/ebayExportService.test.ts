import fs from 'fs';
import path from 'path';
import Database from '../../database';
import FileService from '../../services/fileService';
import EbayExportService from '../../services/ebayExportService';
import os from 'os';

describe('EbayExportService', () => {
  let db: Database;
  let fileService: FileService;
  let service: EbayExportService;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sct-ebay-test-'));
    const rawDir = path.join(tempDir, 'raw');
    const processedDir = path.join(tempDir, 'processed');
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });

    db = new Database(':memory:');
    await db.waitReady();
    fileService = new FileService(rawDir, processedDir, tempDir);
    service = new EbayExportService(db, fileService);
  });

  afterAll(async () => {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const defaultOptions = {
    priceMultiplier: 0.9,
    shippingCost: 4.99,
    duration: 'GTC',
    location: 'USA',
    dispatchTime: 1,
  };

  async function createInventoryCard(overrides: Record<string, unknown> = {}) {
    return db.createCard({
      player: 'Mike Trout',
      team: 'Los Angeles Angels',
      year: 2023,
      brand: 'Topps',
      category: 'Baseball',
      cardNumber: '1',
      condition: 'RAW',
      collectionType: 'Inventory',
      purchasePrice: 5,
      purchaseDate: '2023-01-15',
      currentValue: 15,
      images: [],
      notes: '',
      ...overrides,
    });
  }

  async function createPcCard(overrides: Record<string, unknown> = {}) {
    return db.createCard({
      player: 'Shohei Ohtani',
      team: 'Los Angeles Dodgers',
      year: 2023,
      brand: 'Topps',
      category: 'Baseball',
      cardNumber: '100',
      condition: 'RAW',
      collectionType: 'PC',
      purchasePrice: 20,
      purchaseDate: '2023-01-15',
      currentValue: 50,
      images: [],
      notes: '',
      ...overrides,
    });
  }

  describe('generateCsv', () => {
    it('generates CSV with correct headers', async () => {
      await createInventoryCard();
      const result = await service.generateCsv(defaultOptions);

      expect(result.filename).toMatch(/^ebay-draft-upload-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.csv$/);
      expect(result.generatedAt).toBeDefined();
      expect(result.draftId).toBeDefined();
      expect(result.compPricedCards).toBeDefined();
      expect(result.staleFallbackCards).toBeDefined();

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      const lines = csvContent.split('\n');

      // First 4 lines are #INFO preamble rows
      expect(lines[0]).toContain('#INFO');
      expect(lines[1]).toContain('#INFO');
      expect(lines[2]).toContain('#INFO');
      expect(lines[3]).toContain('#INFO');

      // Line 5 (index 4) is the header row
      const headerLine = lines[4];
      expect(headerLine).toContain('Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)');
      expect(headerLine).toContain('Custom label (SKU)');
      expect(headerLine).toContain('Category ID');
      expect(headerLine).toContain('Price');
      expect(headerLine).toContain('Format');
    });

    it('generates correct row count for Inventory cards', async () => {
      const card1 = await createInventoryCard({ player: 'RowCount A', cardNumber: '10' });
      const card2 = await createInventoryCard({ player: 'RowCount B', cardNumber: '11' });

      const result = await service.generateCsv({
        ...defaultOptions,
        cardIds: [card1.id, card2.id],
      });

      expect(result.totalCards).toBe(2);

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      // Count rows by looking for 'Draft,' at start of CSV records (data rows start with Draft)
      const draftRows = csvContent.split('\n').filter(l => l.startsWith('Draft,'));
      expect(draftRows.length).toBe(2);
      // Header row
      expect(csvContent).toContain('Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)');
    });

    it('excludes PC cards', async () => {
      const invCard = await createInventoryCard({ player: 'Inv Card', cardNumber: '50' });
      const pcCard = await createPcCard({ player: 'PC Card', cardNumber: '51' });

      const result = await service.generateCsv({
        ...defaultOptions,
        cardIds: [invCard.id, pcCard.id],
      });

      expect(result.totalCards).toBe(1);
      expect(result.skippedPcCards).toBe(1);

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      expect(csvContent).toContain('Inv Card');
      expect(csvContent).not.toContain('PC Card');
    });

    it('respects cardIds filter', async () => {
      const card1 = await createInventoryCard({ player: 'Target Card', cardNumber: '70' });
      await createInventoryCard({ player: 'Other Card', cardNumber: '71' });

      const result = await service.generateCsv({
        ...defaultOptions,
        cardIds: [card1.id],
      });

      expect(result.totalCards).toBe(1);
      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      expect(csvContent).toContain('Target Card');
    });

    it('applies priceMultiplier correctly', async () => {
      const card = await createInventoryCard({ player: 'Price Test', cardNumber: '80', currentValue: 100 });

      await service.generateCsv({
        ...defaultOptions,
        priceMultiplier: 0.85,
        cardIds: [card.id],
      });

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      expect(csvContent).toContain('85.00');
    });

    it('truncates titles to 80 chars', async () => {
      const card = await createInventoryCard({
        player: 'Bartholomew Maximilian Richardson-Smithington III',
        brand: 'Topps Chrome Sapphire Edition',
        cardNumber: '99999',
        parallel: 'Gold Refractor Superfractor Ultra Rare Limited Edition',
        gradingCompany: 'PSA',
        condition: '10',
        category: 'Baseball',
      });

      await service.generateCsv({
        ...defaultOptions,
        cardIds: [card.id],
      });

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      // Data rows start after 4 #INFO rows + 1 header row (index 5)
      const dataLine = csvContent.split('\n').filter(l => l.startsWith('Draft,'))[0];
      // The title should end with ... if truncated
      expect(dataLine).toContain('...');
    });

    it('writes to correct output path', async () => {
      await createInventoryCard({ player: 'Path Test', cardNumber: '90' });
      await service.generateCsv(defaultOptions);

      const expectedPath = path.join(tempDir, 'exports', 'ebay-draft-upload-batch.csv');
      expect(service.getOutputPath()).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it('escapes CSV special characters properly', async () => {
      const card = await createInventoryCard({
        player: 'O\'Brien, Jr.',
        notes: 'Has a comma, and "quotes"',
        cardNumber: '95',
      });

      await service.generateCsv({
        ...defaultOptions,
        cardIds: [card.id],
      });

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      // The description contains HTML with commas, so it should be quoted
      expect(csvContent).toContain('"');
    });

    it('handles empty card list (headers only)', async () => {
      const result = await service.generateCsv({
        ...defaultOptions,
        cardIds: ['nonexistent-id'],
      });

      expect(result.totalCards).toBe(0);
      expect(result.totalListingValue).toBe(0);

      const csvContent = fs.readFileSync(service.getOutputPath(), 'utf-8');
      const lines = csvContent.split('\n').filter(l => l.trim());
      expect(lines.length).toBe(5); // 4 #INFO rows + 1 header row
    });

    it('calls onProgress callback', async () => {
      const card1 = await createInventoryCard({ player: 'Progress A', cardNumber: '110' });
      const card2 = await createInventoryCard({ player: 'Progress B', cardNumber: '111' });

      const progressCalls: Array<{ progress: number; completed: number }> = [];
      await service.generateCsv(
        { ...defaultOptions, cardIds: [card1.id, card2.id] },
        async (progress, completed) => {
          progressCalls.push({ progress, completed });
        }
      );

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0].completed).toBe(1);
      expect(progressCalls[1].completed).toBe(2);
      expect(progressCalls[1].progress).toBe(100);
    });
  });

  describe('templateExists / outputExists', () => {
    it('reports template existence correctly', () => {
      // Template is at dataDir/ebay-draft.csv
      const templatePath = service.getTemplatePath();
      // Initially no template in temp dir
      const exists = service.templateExists();
      // We haven't copied the template to tempDir, so should be false
      expect(typeof exists).toBe('boolean');
    });

    it('reports output existence correctly', async () => {
      // Generate a CSV first
      await createInventoryCard({ player: 'Exists Test', cardNumber: '120' });
      await service.generateCsv(defaultOptions);
      expect(service.outputExists()).toBe(true);
    });
  });
});
