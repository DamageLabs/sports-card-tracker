import { Router, Request, Response } from 'express';
import Database from '../database';
import CompService from '../services/compService';
import { CompRequest, CompReport } from '../types';

export function createCompRoutes(db: Database, compService: CompService): Router {
  const router = Router();

  // GET /api/comps/pop-summary — returns pop rarity tiers for all cards with pop data
  router.get('/pop-summary', async (_req: Request, res: Response) => {
    try {
      const summary = await db.getPopSummary();
      res.json(summary);
    } catch (error) {
      console.error('Error getting pop summary:', error);
      res.status(500).json({ error: 'Failed to get pop summary' });
    }
  });

  // GET /api/comps/price-summary — returns aggregate comp prices for all cards with stored comp reports
  router.get('/price-summary', async (_req: Request, res: Response) => {
    try {
      const summary = await db.getPriceSummary();
      res.json(summary);
    } catch (error) {
      console.error('Error getting price summary:', error);
      res.status(500).json({ error: 'Failed to get price summary' });
    }
  });

  // POST /api/comps/generate
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const {
        cardId, player, year, brand, cardNumber, condition, category,
        setName, parallel, isGraded, gradingCompany, grade,
        isRookie, isAutograph, isRelic, isNumbered,
      } = req.body;

      if (!cardId || !player || !year || !brand || !cardNumber) {
        res.status(400).json({ error: 'Missing required fields: cardId, player, year, brand, cardNumber' });
        return;
      }

      const request: CompRequest = {
        cardId, player, year, brand, cardNumber, condition, category,
        setName, parallel, isGraded, gradingCompany, grade,
        isRookie, isAutograph, isRelic, isNumbered,
      };
      const report = await compService.generateComps(request);
      res.json(report);
    } catch (error) {
      console.error('Error generating comps:', error);
      res.status(500).json({ error: 'Failed to generate comps' });
    }
  });

  // POST /api/comps/generate-and-save
  router.post('/generate-and-save', async (req: Request, res: Response) => {
    try {
      const {
        cardId, player, year, brand, cardNumber, condition, category,
        setName, parallel, isGraded, gradingCompany, grade,
        isRookie, isAutograph, isRelic, isNumbered,
      } = req.body;

      if (!cardId || !player || !year || !brand || !cardNumber) {
        res.status(400).json({ error: 'Missing required fields: cardId, player, year, brand, cardNumber' });
        return;
      }

      const request: CompRequest = {
        cardId, player, year, brand, cardNumber, condition, category,
        setName, parallel, isGraded, gradingCompany, grade,
        isRookie, isAutograph, isRelic, isNumbered,
      };
      const report = await compService.generateAndWriteComps(request);
      res.json(report);
    } catch (error) {
      console.error('Error generating and saving comps:', error);
      res.status(500).json({ error: 'Failed to generate and save comps' });
    }
  });

  // GET /api/comps/:cardId/stored — returns only DB-stored comps
  router.get('/:cardId/stored', async (req: Request, res: Response) => {
    try {
      const card = await db.getCardById(req.params.cardId);
      if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      const stored = await compService.getStoredComps(card.id);
      if (!stored) {
        res.status(404).json({ error: 'No stored comps found for this card' });
        return;
      }

      // Reconstitute full CompReport from card + stored data
      const report: CompReport = {
        cardId: card.id,
        player: card.player,
        year: card.year,
        brand: card.brand,
        cardNumber: card.cardNumber,
        condition: stored.condition,
        sources: stored.sources,
        aggregateAverage: stored.aggregateAverage,
        aggregateMedian: stored.aggregateMedian,
        aggregateLow: stored.aggregateLow,
        aggregateHigh: stored.aggregateHigh,
        psa10Median: stored.psa10Median,
        psa9Median: stored.psa9Median,
        popData: stored.popData,
        popMultiplier: stored.popMultiplier,
        popAdjustedAverage: stored.popAdjustedAverage,
        generatedAt: stored.generatedAt,
      };

      res.json(report);
    } catch (error) {
      console.error('Error getting stored comps:', error);
      res.status(500).json({ error: 'Failed to get stored comps' });
    }
  });

  // GET /api/comps/:cardId/history — returns historical comp reports
  router.get('/:cardId/history', async (req: Request, res: Response) => {
    try {
      const card = await db.getCardById(req.params.cardId);
      if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const history = await compService.getCompHistory(card.id, limit);

      // Reconstitute full CompReport shape for each entry
      const reports: CompReport[] = history.map(stored => ({
        cardId: card.id,
        player: card.player,
        year: card.year,
        brand: card.brand,
        cardNumber: card.cardNumber,
        condition: stored.condition,
        sources: stored.sources,
        aggregateAverage: stored.aggregateAverage,
        aggregateMedian: stored.aggregateMedian,
        aggregateLow: stored.aggregateLow,
        aggregateHigh: stored.aggregateHigh,
        psa10Median: stored.psa10Median,
        psa9Median: stored.psa9Median,
        popData: stored.popData,
        popMultiplier: stored.popMultiplier,
        popAdjustedAverage: stored.popAdjustedAverage,
        generatedAt: stored.generatedAt,
      }));

      res.json(reports);
    } catch (error) {
      console.error('Error getting comp history:', error);
      res.status(500).json({ error: 'Failed to get comp history' });
    }
  });

  // GET /api/comps/:cardId/pop-history — returns historical pop report snapshots
  router.get('/:cardId/pop-history', async (req: Request, res: Response) => {
    try {
      const card = await db.getCardById(req.params.cardId);
      if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const history = await db.getPopHistory(card.id, limit);
      res.json(history);
    } catch (error) {
      console.error('Error getting pop history:', error);
      res.status(500).json({ error: 'Failed to get pop history' });
    }
  });

  // GET /api/comps/:cardId — check stored comps first, re-generate with ?refresh=true
  router.get('/:cardId', async (req: Request, res: Response) => {
    try {
      const card = await db.getCardById(req.params.cardId);
      if (!card) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }

      const refresh = req.query.refresh === 'true';

      // If not forcing refresh, check for stored comps first
      if (!refresh) {
        const stored = await compService.getStoredComps(card.id);
        if (stored) {
          const report: CompReport = {
            cardId: card.id,
            player: card.player,
            year: card.year,
            brand: card.brand,
            cardNumber: card.cardNumber,
            condition: stored.condition,
            sources: stored.sources,
            aggregateAverage: stored.aggregateAverage,
            aggregateMedian: stored.aggregateMedian,
            aggregateLow: stored.aggregateLow,
            aggregateHigh: stored.aggregateHigh,
            psa10Median: stored.psa10Median,
            psa9Median: stored.psa9Median,
            popData: stored.popData,
            popMultiplier: stored.popMultiplier,
            popAdjustedAverage: stored.popAdjustedAverage,
            generatedAt: stored.generatedAt,
          };
          res.json(report);
          return;
        }
      }

      // Generate fresh comps (and persist via generateAndWriteComps)
      const request: CompRequest = {
        cardId: card.id,
        player: card.player,
        year: card.year,
        brand: card.brand,
        cardNumber: card.cardNumber,
        condition: card.condition,
        category: card.category,
        setName: card.setName,
        parallel: card.parallel,
        isGraded: card.isGraded,
        gradingCompany: card.gradingCompany,
        grade: card.grade,
        isRookie: card.isRookie,
        isAutograph: card.isAutograph,
        isRelic: card.isRelic,
        isNumbered: card.isNumbered,
      };

      const report = await compService.generateAndWriteComps(request);
      res.json(report);
    } catch (error) {
      console.error('Error getting comps for card:', error);
      res.status(500).json({ error: 'Failed to get comps' });
    }
  });

  return router;
}
