import { Router, Request, Response } from 'express';
import Database from '../database';
import EbayExportService from '../services/ebayExportService';
import AuditService from '../services/auditService';
import { AuthenticatedRequest } from '../types';
import { Config } from '../config';

export function createEbayRoutes(db: Database, ebayExportService: EbayExportService, auditService: AuditService, config: Config): Router {
  const router = Router();

  // POST /api/ebay/generate — Sync CSV generation
  router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { priceMultiplier, shippingCost, duration, location, dispatchTime, cardIds, imageBaseUrl, useCompPricing, compMaxAgeDays } = req.body;

      if (priceMultiplier == null) {
        res.status(400).json({ error: 'Missing required field: priceMultiplier' });
        return;
      }

      const result = await ebayExportService.generateCsv({
        priceMultiplier,
        shippingCost: shippingCost ?? 0,
        duration: duration || 'GTC',
        location: location || 'USA',
        dispatchTime: dispatchTime || 1,
        cardIds,
        imageBaseUrl: imageBaseUrl || config.ebayImageBaseUrl,
        useCompPricing: useCompPricing !== false,
        compMaxAgeDays: compMaxAgeDays ?? 30,
      });

      auditService.log(req, { action: 'ebay.generate', entity: 'export', details: { totalCards: result.totalCards } });
      res.json(result);
    } catch (error) {
      console.error('Error generating eBay CSV:', error);
      res.status(500).json({ error: 'Failed to generate eBay CSV' });
    }
  });

  // POST /api/ebay/generate-async — Creates ebay-csv job for async processing
  router.post('/generate-async', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { priceMultiplier, shippingCost, duration, location, dispatchTime, cardIds, imageBaseUrl, useCompPricing, compMaxAgeDays } = req.body;

      if (priceMultiplier == null) {
        res.status(400).json({ error: 'Missing required field: priceMultiplier' });
        return;
      }

      const job = await db.createJob({
        type: 'ebay-csv',
        payload: {
          priceMultiplier,
          shippingCost: shippingCost ?? 0,
          duration,
          location,
          dispatchTime,
          cardIds,
          imageBaseUrl: imageBaseUrl || config.ebayImageBaseUrl,
          useCompPricing: useCompPricing !== false,
          compMaxAgeDays: compMaxAgeDays ?? 30,
        },
      });

      auditService.log(req, { action: 'ebay.generate_async', entity: 'job', entityId: job.id });
      res.status(201).json(job);
    } catch (error) {
      console.error('Error creating eBay CSV job:', error);
      res.status(500).json({ error: 'Failed to create eBay CSV job' });
    }
  });

  // GET /api/ebay/download — Downloads generated CSV
  router.get('/download', (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!ebayExportService.outputExists()) {
        res.status(404).json({ error: 'No generated CSV file found. Run generate first.' });
        return;
      }

      const outputPath = ebayExportService.getOutputPath();
      auditService.log(req, { action: 'ebay.download', entity: 'export' });
      res.download(outputPath, 'ebay-draft-upload-batch.csv');
    } catch (error) {
      console.error('Error downloading eBay CSV:', error);
      res.status(500).json({ error: 'Failed to download eBay CSV' });
    }
  });

  // GET /api/ebay/template — Downloads template CSV
  router.get('/template', (_req: Request, res: Response) => {
    try {
      if (!ebayExportService.templateExists()) {
        res.status(404).json({ error: 'Template CSV not found' });
        return;
      }

      const templatePath = ebayExportService.getTemplatePath();
      res.download(templatePath, 'ebay-draft.csv');
    } catch (error) {
      console.error('Error downloading template:', error);
      res.status(500).json({ error: 'Failed to download template' });
    }
  });

  // GET /api/ebay/status — Returns existence flags
  router.get('/status', (_req: Request, res: Response) => {
    try {
      res.json({
        templateExists: ebayExportService.templateExists(),
        outputExists: ebayExportService.outputExists(),
      });
    } catch (error) {
      console.error('Error checking eBay status:', error);
      res.status(500).json({ error: 'Failed to check eBay export status' });
    }
  });

  // GET /api/ebay/exported-card-ids — Return a deduped list of card ids that
  // appear in any export draft. Used by the inventory UI to flag exported
  // cards with an "eBay" pill.
  router.get('/exported-card-ids', async (_req: Request, res: Response) => {
    try {
      const ids = await db.getExportedCardIds();
      res.json(ids);
    } catch (error) {
      console.error('Error getting exported card ids:', error);
      res.status(500).json({ error: 'Failed to get exported card ids' });
    }
  });

  // GET /api/ebay/drafts — List export drafts (paginated)
  router.get('/drafts', async (_req: Request, res: Response) => {
    try {
      const limit = parseInt(_req.query.limit as string) || 50;
      const offset = parseInt(_req.query.offset as string) || 0;
      const result = await db.getEbayExportDrafts(limit, offset);
      res.json(result);
    } catch (error) {
      console.error('Error listing eBay drafts:', error);
      res.status(500).json({ error: 'Failed to list eBay export drafts' });
    }
  });

  // GET /api/ebay/drafts/:id/download — Download a specific draft CSV
  router.get('/drafts/:id/download', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const draft = await db.getEbayExportDraft(req.params.id);
      if (!draft) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }

      if (!ebayExportService.draftExists(draft.filename)) {
        res.status(404).json({ error: 'Draft CSV file not found on disk' });
        return;
      }

      const filepath = ebayExportService.getDraftPath(draft.filename);
      auditService.log(req, { action: 'ebay.download', entity: 'export', entityId: draft.id });
      res.download(filepath, draft.filename);
    } catch (error) {
      console.error('Error downloading draft:', error);
      res.status(500).json({ error: 'Failed to download draft CSV' });
    }
  });

  // DELETE /api/ebay/drafts/:id — Delete a draft and its file
  router.delete('/drafts/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const draft = await db.getEbayExportDraft(req.params.id);
      if (!draft) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }

      // Delete the file from disk
      ebayExportService.deleteDraftFile(draft.filename);

      // Delete from database
      await db.deleteEbayExportDraft(draft.id);

      res.json({ message: 'Draft deleted', id: draft.id });
    } catch (error) {
      console.error('Error deleting draft:', error);
      res.status(500).json({ error: 'Failed to delete draft' });
    }
  });

  return router;
}
