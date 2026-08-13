import { Router, Request, Response } from 'express';
import Database from '../database';
import ImageProcessingService from '../services/imageProcessingService';
import FileService from '../services/fileService';
import AuditService from '../services/auditService';
import { AuthenticatedRequest } from '../types';

function diffCardData(
  original: Record<string, unknown>,
  edited: Record<string, unknown>
): { field: string; from: unknown; to: unknown }[] {
  const trackFields = ['player', 'year', 'brand', 'setName', 'cardNumber', 'team', 'category', 'parallel', 'serialNumber', 'gradingCompany', 'grade'];
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of trackFields) {
    const orig = original[field] ?? null;
    const edit = edited[field] ?? null;
    if (String(orig) !== String(edit)) {
      changes.push({ field, from: orig, to: edit });
    }
  }
  return changes;
}

export function createImageProcessingRoutes(
  db: Database,
  imageProcessingService: ImageProcessingService,
  fileService: FileService,
  auditService: AuditService
): Router {
  const router = Router();

  // POST /api/image-processing/process -- async via job queue
  router.post('/process', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filenames, skipExisting, confidenceThreshold, collectionId } = req.body;

      if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        res.status(400).json({ error: 'filenames must be a non-empty array' });
        return;
      }

      const job = await db.createJob({
        type: 'image-processing',
        payload: { filenames, skipExisting, confidenceThreshold, collectionId },
      });

      auditService.log(req, { action: 'image.process_batch', entity: 'job', entityId: job.id, details: { fileCount: filenames.length } });
      res.status(201).json(job);
    } catch (error) {
      console.error('Error creating image-processing job:', error);
      res.status(500).json({ error: 'Failed to create image processing job' });
    }
  });

  // POST /api/image-processing/process-sync -- process single file synchronously
  router.post('/process-sync', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filename, confidenceThreshold, collectionId } = req.body;

      if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'filename is required' });
        return;
      }

      const result = await imageProcessingService.processSingleImage(filename, {
        confidenceThreshold,
        collectionId,
      });

      auditService.log(req, { action: 'image.process_sync', entity: 'file', entityId: filename, details: { status: result.status, cardId: result.cardId } });
      res.json(result);
    } catch (error) {
      console.error('Error processing image:', error);
      res.status(500).json({ error: 'Failed to process image' });
    }
  });

  // POST /api/image-processing/identify -- vision only, no commit
  router.post('/identify', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filename, backFile } = req.body;

      if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'filename is required' });
        return;
      }

      // Event #6 — pair detected
      if (backFile) {
        auditService.log(req, {
          action: 'image.pair_detected',
          entity: 'file',
          entityId: filename,
          details: { backFile },
        });
      }

      const data = await imageProcessingService.identifyOnly(filename, backFile);

      // Event #10 — vision API call telemetry
      if (data._apiMeta) {
        auditService.log(req, {
          action: 'vision.api_call',
          entity: 'file',
          entityId: filename,
          details: {
            ...data._apiMeta,
            confidenceScore: data.confidence?.score,
            parseFailed: data._parseFailed || false,
          },
        });
      }

      // Event #11 — enriched image.identify
      auditService.log(req, {
        action: 'image.identify',
        entity: 'file',
        entityId: filename,
        details: {
          backFile: backFile || null,
          confidenceScore: data.confidence?.score,
          confidenceLevel: data.confidence?.level,
          detectedFields: data.confidence?.detectedFields,
          missingFields: data.confidence?.missingFields,
        },
      });

      // Strip internal fields before sending response
      delete data._apiMeta;
      delete data._parseFailed;

      res.json(data);
    } catch (error) {
      const { filename, backFile } = req.body;
      // Event #3 — identify failed
      auditService.log(req, {
        action: 'image.identify_failed',
        entity: 'file',
        entityId: filename || null,
        details: { error: error instanceof Error ? error.message : String(error), backFile: backFile || null },
      });
      console.error('Error identifying card:', error);
      res.status(500).json({ error: 'Failed to identify card' });
    }
  });

  // POST /api/image-processing/confirm -- commit user-reviewed card data
  router.post('/confirm', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filename, backFile, cardData, originalData, collectionId } = req.body;

      if (!filename || typeof filename !== 'string') {
        res.status(400).json({ error: 'filename is required' });
        return;
      }
      if (!cardData || typeof cardData !== 'object') {
        res.status(400).json({ error: 'cardData is required' });
        return;
      }

      // Merge collectionId into cardData if provided at the top level
      if (collectionId && !cardData.collectionId) {
        cardData.collectionId = collectionId;
      }

      // Event #5 — user modifications diff
      if (originalData) {
        const changedFields = diffCardData(originalData, cardData);
        if (changedFields.length > 0) {
          auditService.log(req, {
            action: 'image.user_modifications',
            entity: 'file',
            entityId: filename,
            details: { modifications: changedFields },
          });
        }
      }

      const result = await imageProcessingService.confirmCard(filename, cardData, backFile);

      // Auto-queue comp generation so confirmed cards get priced without a manual step
      if (result.status === 'processed' && result.cardId) {
        try {
          await db.createJob({ type: 'comp-generation', payload: { cardIds: [result.cardId] } });
        } catch (jobError) {
          console.error('Failed to enqueue comp generation for card', result.cardId, jobError);
        }
      }

      // Event #11 — enriched image.confirm
      auditService.log(req, {
        action: 'image.confirm',
        entity: 'card',
        entityId: result.cardId || null,
        details: {
          filename,
          backFile: backFile || null,
          processedFilename: result.processedFilename,
          confidence: result.confidence,
          status: result.status,
        },
      });

      res.json(result);
    } catch (error) {
      console.error('Error confirming card:', error);
      res.status(500).json({ error: 'Failed to confirm card' });
    }
  });

  // GET /api/image-processing/status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const rawFiles = fileService.listFiles(fileService.getRawDir());
      const processedFiles = fileService.listFiles(fileService.getProcessedDir());
      const { entries: recentLogs } = await db.queryAuditLogs({ action: 'image.process_failed', limit: 10 });
      const recentErrors = recentLogs.map(log => ({
        timestamp: log.createdAt,
        filename: log.entityId ?? '',
        reason: (log.details as Record<string, unknown>)?.reason ?? '',
      }));

      res.json({
        rawCount: rawFiles.length,
        processedCount: processedFiles.length,
        recentErrors,
      });
    } catch (error) {
      console.error('Error getting image processing status:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  return router;
}
