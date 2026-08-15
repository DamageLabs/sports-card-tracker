import { Router, Request, Response } from 'express';
import Database from '../database';
import AuditService from '../services/auditService';
import GradePredictionService from '../services/gradePredictionService';
import { AuthenticatedRequest, CardInput } from '../types';

export function createCardRoutes(
  db: Database,
  auditService: AuditService,
  gradePredictionService?: GradePredictionService
): Router {
  const router = Router();

  // POST /api/cards/:id/predict-grade — scan-based condition analysis:
  // deterministic centering measurement + vision assessment of corners,
  // edges, and surface. Stores the result on the card's enhancedAttributes.
  router.post('/:id/predict-grade', async (req: AuthenticatedRequest, res: Response) => {
    if (!gradePredictionService) {
      res.status(503).json({ error: 'Grade prediction not available (ANTHROPIC_API_KEY not configured)' });
      return;
    }
    try {
      const prediction = await gradePredictionService.predictGrade(req.params.id);
      auditService.log(req, {
        action: 'card.predict_grade',
        entity: 'card',
        entityId: req.params.id,
        details: { ceiling: prediction.ceiling, range: prediction.estimatedRange, caps: prediction.caps },
      });
      res.json(prediction);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error predicting grade:', msg);
      res.status(500).json({ error: `Failed to predict grade: ${msg}` });
    }
  });

  // Get all cards (or find by image filename)
  router.get('/', async (req: Request, res: Response) => {
    try {
      const image = req.query.image as string | undefined;
      if (image) {
        const card = await db.getCardByImage(image);
        if (card) {
          res.json(card);
        } else {
          res.status(404).json({ error: 'No card found for that image' });
        }
        return;
      }

      const userId = req.query.userId as string | undefined;
      const collectionId = req.query.collectionId as string | undefined;
      const collectionType = req.query.collectionType as string | undefined;
      const cards = await db.getAllCards({ userId, collectionId, collectionType });
      res.json(cards);
    } catch (error) {
      console.error('Error getting cards:', error);
      res.status(500).json({ error: 'Failed to fetch cards' });
    }
  });

  // Get heatmap data for a time period
  router.get('/heatmap', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || 'all';
      const validPeriods = ['1d', '7d', '30d', '90d', 'ytd', 'all'];
      if (!validPeriods.includes(period)) {
        res.status(400).json({ error: `Invalid period. Must be one of: ${validPeriods.join(', ')}` });
        return;
      }

      if (period === 'all') {
        // For "all time", use purchasePrice as the baseline — no snapshots needed
        const allCards = await db.getAllCards({});
        const heatmapCards = allCards
          .filter(c => !c.sellDate && c.currentValue > 0)
          .map(c => ({
            id: c.id,
            player: c.player,
            team: c.team,
            year: c.year,
            brand: c.brand,
            category: c.category,
            cardNumber: c.cardNumber,
            isGraded: !!c.isGraded,
            currentValue: c.currentValue,
            periodStartValue: c.purchasePrice,
            purchasePrice: c.purchasePrice,
          }));
        res.json({ period, periodStartDate: null, cards: heatmapCards });
        return;
      }

      // Compute period start date
      const now = new Date();
      let periodStartDate: Date;
      if (period === 'ytd') {
        periodStartDate = new Date(now.getFullYear(), 0, 1);
      } else {
        const days = parseInt(period);
        periodStartDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      }
      const periodStartIso = periodStartDate.toISOString();

      const rows = db.getHeatmapDataForPeriod(periodStartIso);
      const cards = rows.map(r => ({
        id: r.cardId,
        player: r.player,
        team: r.team,
        year: r.year,
        brand: r.brand,
        category: r.category,
        cardNumber: r.cardNumber,
        isGraded: r.isGraded,
        currentValue: r.currentValue,
        periodStartValue: r.periodStartValue,
        purchasePrice: r.purchasePrice,
      }));

      res.json({ period, periodStartDate: periodStartIso, cards });
    } catch (error) {
      console.error('Error getting heatmap data:', error);
      res.status(500).json({ error: 'Failed to fetch heatmap data' });
    }
  });

  // Backfill value snapshots from comp history
  router.post('/heatmap/backfill', async (_req: Request, res: Response) => {
    try {
      const count = db.backfillValueSnapshots();
      res.json({ backfilled: count });
    } catch (error) {
      console.error('Error backfilling snapshots:', error);
      res.status(500).json({ error: 'Failed to backfill value snapshots' });
    }
  });

  // Get a single card by ID
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const card = await db.getCardById(req.params.id);
      if (card) {
        res.json(card);
      } else {
        res.status(404).json({ error: 'Card not found' });
      }
    } catch (error) {
      console.error('Error getting card:', error);
      res.status(500).json({ error: 'Failed to fetch card' });
    }
  });

  // Create a new card
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cardInput: CardInput = req.body;

      const requiredFields = ['player', 'team', 'year', 'brand', 'category', 'cardNumber', 'condition', 'purchasePrice', 'purchaseDate', 'currentValue'];
      for (const field of requiredFields) {
        if (cardInput[field as keyof CardInput] === undefined || cardInput[field as keyof CardInput] === null || cardInput[field as keyof CardInput] === '') {
          res.status(400).json({ error: `Missing required field: ${field}` });
          return;
        }
      }

      if (!Array.isArray(cardInput.images)) {
        cardInput.images = [];
      }
      if (!cardInput.notes) {
        cardInput.notes = '';
      }

      const card = await db.createCard(cardInput);
      auditService.log(req, { action: 'card.create', entity: 'card', entityId: card.id, details: { player: card.player, year: card.year, brand: card.brand } });
      res.status(201).json(card);
    } catch (error) {
      console.error('Error creating card:', error);
      res.status(500).json({ error: 'Failed to create card' });
    }
  });

  // Update a card
  router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cardInput: CardInput = req.body;

      // team is optional on update — vision API may not detect it for all cards
      const requiredFields = ['player', 'year', 'brand', 'category', 'cardNumber', 'condition', 'purchasePrice', 'purchaseDate', 'currentValue'];
      for (const field of requiredFields) {
        if (cardInput[field as keyof CardInput] === undefined || cardInput[field as keyof CardInput] === null || cardInput[field as keyof CardInput] === '') {
          res.status(400).json({ error: `Missing required field: ${field}` });
          return;
        }
      }

      if (!Array.isArray(cardInput.images)) {
        cardInput.images = [];
      }
      if (!cardInput.notes) {
        cardInput.notes = '';
      }
      if (!cardInput.team) {
        cardInput.team = '';
      }

      const card = await db.updateCard(req.params.id, cardInput);
      if (card) {
        auditService.log(req, { action: 'card.update', entity: 'card', entityId: card.id, details: { player: card.player, year: card.year, brand: card.brand } });
        res.json(card);
      } else {
        res.status(404).json({ error: 'Card not found' });
      }
    } catch (error) {
      console.error('Error updating card:', error);
      res.status(500).json({ error: 'Failed to update card' });
    }
  });

  // Delete a card
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const success = await db.deleteCard(req.params.id);
      if (success) {
        auditService.log(req, { action: 'card.delete', entity: 'card', entityId: req.params.id });
        res.status(204).send();
      } else {
        res.status(404).json({ error: 'Card not found' });
      }
    } catch (error) {
      console.error('Error deleting card:', error);
      res.status(500).json({ error: 'Failed to delete card' });
    }
  });

  return router;
}
