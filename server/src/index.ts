import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { loadConfig } from './config';
import Database from './database';
import FileService from './services/fileService';
import EventService from './services/eventService';
import JobService from './services/jobService';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { optionalAuth } from './middleware/auth';
import { createHealthRoutes } from './routes/health';
import { createCardRoutes } from './routes/cards';
import { createFileRoutes } from './routes/files';
import { createJobRoutes } from './routes/jobs';
import { createEventRoutes } from './routes/events';
import { createAuthRoutes } from './routes/auth';
import { createCompRoutes } from './routes/comps';
import { createImageProcessingRoutes } from './routes/imageProcessing';
import CompService from './services/compService';
import BrowserService from './services/browserService';
import CompCacheService from './services/compCacheService';
import PopulationReportService from './services/populationReportService';
import PsaPopScraper from './services/adapters/psaPopScraper';
import CgcPopScraper from './services/adapters/cgcPopScraper';
import BgsPopScraper from './services/adapters/bgsPopScraper';
import SgcPopScraper from './services/adapters/sgcPopScraper';
import GemRatePopScraper from './services/adapters/gemratePopScraper';
import AnthropicVisionService from './services/anthropicVisionService';
import ImageProcessingService from './services/imageProcessingService';
import ImageCropService from './services/imageCropService';
import EbayExportService from './services/ebayExportService';
import ScpUploadService from './services/scpUploadService';
import AuditService from './services/auditService';
import { createEbayRoutes } from './routes/ebay';
import { createAuditLogRoutes } from './routes/auditLogs';
import { createCollectionRoutes } from './routes/collections';
import { createAdminUserRoutes } from './routes/adminUsers';
import { createGradingSubmissionRoutes } from './routes/gradingSubmissions';
import { createStorageRoutes } from './routes/storage';
import { createPriceAlertRoutes } from './routes/priceAlerts';
import PriceAlertService from './services/priceAlertService';
import { EbayExportOptions, ScpUploadPayload } from './types';

dotenv.config();

const config = loadConfig();

// Initialize services
const db = new Database(config.dbPath);
const fileService = new FileService(config.rawDir, config.processedDir, config.dataDir);
const eventService = new EventService();
const jobService = new JobService(db, eventService);

// Puppeteer-based comp scraping (optional)
const browserService = config.puppeteerEnabled ? new BrowserService({
  headless: config.puppeteerHeadless,
  rateLimits: config.rateLimits,
}) : undefined;
const compCacheService = config.puppeteerEnabled ? new CompCacheService(db, config.compCacheTtlMs) : undefined;
const gemrateScraper = config.puppeteerEnabled ? new GemRatePopScraper(browserService) : undefined;
const popService = config.puppeteerEnabled
  ? new PopulationReportService(
      [new PsaPopScraper(browserService), new CgcPopScraper(browserService), new BgsPopScraper(), new SgcPopScraper()],
      db,
      gemrateScraper
    )
  : undefined;
const compService = new CompService(fileService, undefined, browserService, compCacheService, db, popService);

const visionService = new AnthropicVisionService();
const imageCropService = new ImageCropService();
const auditService = new AuditService(db);
const imageProcessingService = new ImageProcessingService(fileService, db, visionService, imageCropService, auditService);
const ebayExportService = new EbayExportService(db, fileService);
const scpUploadService = new ScpUploadService(db, fileService, config);
const priceAlertService = new PriceAlertService(db, eventService);

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(requestLogger);
app.use(optionalAuth);

// Routes
app.use('/api/health', createHealthRoutes(db, fileService));
app.use('/api/cards', createCardRoutes(db, auditService));
app.use('/api/files', createFileRoutes(fileService, auditService, db, scpUploadService));
app.use('/api/jobs', createJobRoutes(db, auditService));
app.use('/api/events', createEventRoutes(eventService));
app.use('/api/auth', createAuthRoutes(db, auditService));
app.use('/api/comps', createCompRoutes(db, compService));
app.use('/api/image-processing', createImageProcessingRoutes(db, imageProcessingService, fileService, auditService));
app.use('/api/ebay', createEbayRoutes(db, ebayExportService, auditService, config));
app.use('/api/audit-logs', createAuditLogRoutes(auditService));
app.use('/api/collections', createCollectionRoutes(db, auditService));
app.use('/api/admin/users', createAdminUserRoutes(db, auditService));
app.use('/api/grading-submissions', createGradingSubmissionRoutes(db, auditService));
app.use('/api/storage', createStorageRoutes(db, auditService));
app.use('/api/price-alerts', createPriceAlertRoutes(db, auditService, priceAlertService));

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Register job handlers
jobService.registerHandler('comp-generation', async (job, updateProgress) => {
  const cardIds = (job.payload.cardIds as string[]) || [];
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < cardIds.length; i++) {
    const card = await db.getCardById(cardIds[i]);
    if (card) {
      const report = await compService.generateAndWriteComps({
        cardId: card.id,
        player: card.player,
        year: card.year,
        brand: card.brand,
        cardNumber: card.cardNumber,
        condition: card.condition,
        setName: card.setName,
        parallel: card.parallel,
        isGraded: card.isGraded,
        gradingCompany: card.gradingCompany,
        grade: card.grade,
        isRookie: card.isRookie,
        isAutograph: card.isAutograph,
        isRelic: card.isRelic,
        isNumbered: card.isNumbered,
      });
      results.push({ cardId: card.id, generatedAt: report.generatedAt });
    }
    await updateProgress(((i + 1) / cardIds.length) * 100, i + 1);
  }

  return { processed: results.length, results };
});

// Register ebay-csv job handler
jobService.registerHandler('ebay-csv', async (job, updateProgress) => {
  const payload = job.payload as unknown as EbayExportOptions;
  // Ensure imageBaseUrl falls back to config
  if (!payload.imageBaseUrl) {
    payload.imageBaseUrl = config.ebayImageBaseUrl;
  }
  const result = await ebayExportService.generateCsv(payload, updateProgress);
  return result as unknown as Record<string, unknown>;
});

// Register image-processing job handler
jobService.registerHandler('image-processing', async (job, updateProgress) => {
  const payload = job.payload as unknown as { filenames: string[]; skipExisting?: boolean; confidenceThreshold?: number; collectionId?: string };
  const result = await imageProcessingService.processImages(
    {
      filenames: payload.filenames || [],
      skipExisting: payload.skipExisting,
      confidenceThreshold: payload.confidenceThreshold,
      collectionId: payload.collectionId,
    },
    updateProgress
  );

  // Auto-queue comp generation for all cards created by this batch
  const createdCardIds = result.results
    .filter((r) => r.status === 'processed' && r.cardId)
    .map((r) => r.cardId as string);
  if (createdCardIds.length > 0) {
    try {
      await db.createJob({ type: 'comp-generation', payload: { cardIds: createdCardIds } });
    } catch (jobError) {
      console.error('Failed to enqueue comp generation for batch', jobError);
    }
  }

  return result as unknown as Record<string, unknown>;
});

// Register scp-upload job handler
jobService.registerHandler('scp-upload', async (job, updateProgress) => {
  const payload = job.payload as unknown as ScpUploadPayload;
  const result = await scpUploadService.uploadCardImages(payload.cardIds, updateProgress);
  return result as unknown as Record<string, unknown>;
});

// Start server (only when run directly, not when imported for testing)
if (require.main === module) {
  (async () => {
    try {
      await db.waitReady();
      console.log('Database ready');

      fileService.ensureDirectories();
      console.log('Directories ready');

      if (browserService) {
        await browserService.launch();
        console.log('Browser service started');
      }

      jobService.start(config.jobPollInterval);
      console.log('Job service started');

      priceAlertService.start();
      console.log('Price alert service started (hourly checks)');

      eventService.startHeartbeat();

      const server = app.listen(config.port, '0.0.0.0', () => {
        console.log(`Server running on port ${config.port}`);
        console.log(`Frontend URL: ${config.frontendUrl}`);
      });

      const shutdown = () => {
        console.log('Shutting down...');
        jobService.stop();
        priceAlertService.stop();
        eventService.stopHeartbeat();
        server.close(async () => {
          if (browserService) {
            await browserService.shutdown();
            console.log('Browser service stopped');
          }
          await db.close();
          console.log('Server stopped');
          process.exit(0);
        });
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();
}

export { app, db, fileService, eventService, jobService, compService, browserService, compCacheService, visionService, imageCropService, imageProcessingService, ebayExportService, scpUploadService, auditService };
