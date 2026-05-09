// Integration utilities for enhanced card data

import { Card } from '../types';
import { EnhancedCard } from '../types/card-enhanced';
import { migrateCardToEnhanced, hasEnhancedFields } from './cardMigration';
import { apiService } from '../services/api';

// Convert enhanced card back to basic card for storage
export const enhancedToBasicCard = (enhancedCard: Partial<EnhancedCard>): Card => {
  // Generate enhanced notes that include special features
  const enhancedNotes = generateEnhancedNotes(enhancedCard);
  
  // Combine original notes with enhanced notes
  const combinedNotes = [enhancedCard.notes, enhancedNotes]
    .filter(note => note && note.trim().length > 0)
    .join(' | ');
  
  // Extract basic fields
  const basicCard: Card = {
    id: enhancedCard.id || `card-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    userId: enhancedCard.userId || '', // Preserve userId if it exists
    collectionId: enhancedCard.collectionId, // Preserve collectionId
    createdAt: enhancedCard.createdAt || new Date(),
    updatedAt: new Date(),
    
    // Core fields
    player: enhancedCard.player || '',
    team: enhancedCard.team || '',
    year: enhancedCard.year || new Date().getFullYear(),
    brand: enhancedCard.brand || '',
    category: enhancedCard.category || '',
    cardNumber: enhancedCard.cardNumber || '',
    parallel: enhancedCard.parallel,
    condition: enhancedCard.condition || 'RAW',
    collectionType: enhancedCard.collectionType || 'Inventory',
    gradingCompany: enhancedCard.gradingCompany,
    
    // Financial
    purchasePrice: enhancedCard.purchasePrice || 0,
    purchaseDate: enhancedCard.purchaseDate || new Date(),
    sellPrice: enhancedCard.sellPrice,
    sellDate: enhancedCard.sellDate,
    currentValue: enhancedCard.currentValue || 0,
    
    // Images & Notes - include both original notes and enhanced features
    images: enhancedCard.images || [],
    notes: combinedNotes || '',

    // Persist the EnhancedCard extension blocks to the DB so they round-trip
    // across browsers/devices. localStorage is kept as a transitional fallback.
    enhancedAttributes: extractEnhancedAttributes(enhancedCard),
  };

  return basicCard;
};

const ENHANCED_BLOCKS = [
  'identification',
  'playerMetadata',
  'authentication',
  'specialFeatures',
  'marketData',
  'physicalAttributes',
  'storage',
  'transaction',
  'digital',
  'analytics',
  'collectionMeta',
] as const;

const extractEnhancedAttributes = (
  enhancedCard: Partial<EnhancedCard>
): Record<string, unknown> | null => {
  const out: Record<string, unknown> = {};
  for (const key of ENHANCED_BLOCKS) {
    const value = (enhancedCard as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
};

// Generate comprehensive notes from enhanced fields
const generateEnhancedNotes = (card: Partial<EnhancedCard>): string => {
  const notes: string[] = [];
  
  // Don't add existing notes here - they will be combined separately
  // to avoid duplication when editing cards multiple times
  
  // Add enhanced field information
  if (card.identification) {
    const id = card.identification;
    if (id.serialNumber) notes.push(`Serial: ${id.serialNumber}`);
    if (id.printRun) notes.push(`Print Run: ${id.printRun}`);
    if (id.subset) notes.push(`Subset: ${id.subset}`);
    if (id.insert) notes.push(`Insert: ${id.insert}`);
  }
  
  if (card.playerMetadata) {
    const meta = card.playerMetadata;
    if (meta.isRookie) notes.push('ROOKIE CARD');
    if (meta.isHallOfFame) notes.push(`HOF (${meta.inductionYear})`);
    if (meta.jerseyNumber) notes.push(`Jersey #${meta.jerseyNumber}`);
    if (meta.position) notes.push(`Position: ${meta.position}`);
  }
  
  if (card.specialFeatures) {
    const features = card.specialFeatures;
    if (features.hasAutograph) {
      notes.push(`Autograph: ${features.autographType || 'Unknown type'}`);
      if (features.autographColor) notes.push(`Auto Color: ${features.autographColor}`);
    }
    if (features.hasMemorabilia) {
      notes.push('Memorabilia Card');
      if (features.isPatch) notes.push('PATCH');
      if (features.isGameUsed) notes.push('Game Used');
    }
    if (features.is1of1) notes.push('1/1 ONE OF ONE');
  }
  
  if (card.authentication) {
    const auth = card.authentication;
    if (auth.certificationNumber) notes.push(`Cert #${auth.certificationNumber}`);
    if (auth.populationHigher !== undefined) {
      notes.push(`Pop Report: ${auth.populationHigher} higher, ${auth.populationEqual} equal`);
    }
  }
  
  if (card.marketData) {
    const market = card.marketData;
    if (market.purchaseVenue) notes.push(`Purchased from: ${market.purchaseVenue}`);
    if (market.trendDirection) notes.push(`Market Trend: ${market.trendDirection}`);
  }
  
  if (card.storage) {
    const storage = card.storage;
    if (storage.storageLocation) notes.push(`Location: ${storage.storageLocation}`);
    if (storage.boxNumber) notes.push(`Box: ${storage.boxNumber}`);
  }
  
  if (card.collectionMeta) {
    const meta = card.collectionMeta;
    if (meta.personalStory) notes.push(`Story: ${meta.personalStory}`);
    if (meta.willingToTrade) notes.push('AVAILABLE FOR TRADE');
  }
  
  return notes.join(' | ');
};

// One-shot boot migration: drain any pre-existing `enhanced_card_*`
// localStorage entries into the server-side `enhancedAttributes` column,
// then remove them. Safe to run on every boot — it skips cards whose DB
// record already has enhancedAttributes (DB is canonical).
export const migrateLocalStorageEnhancedAttributes = async (): Promise<void> => {
  const PREFIX = 'enhanced_card_';
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  if (keys.length === 0) return;

  console.log(`[migrateLocalStorageEnhancedAttributes] Found ${keys.length} legacy localStorage entries`);

  for (const key of keys) {
    const cardId = key.slice(PREFIX.length);
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch { continue; }
    if (!raw) { localStorage.removeItem(key); continue; }

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw); }
    catch { localStorage.removeItem(key); continue; }

    try {
      const card = await apiService.getCard(cardId);
      if (card.enhancedAttributes) {
        // DB already has data — DB wins, drop the stale localStorage copy.
        localStorage.removeItem(key);
        continue;
      }
      await apiService.updateCard({ ...card, enhancedAttributes: parsed });
      localStorage.removeItem(key);
    } catch (err) {
      // Card no longer exists or API down — leave the entry for a retry.
      console.warn(`[migrateLocalStorageEnhancedAttributes] Skipped ${cardId}:`, err);
    }
  }
};

// Merge basic card with enhanced data (server-side `enhancedAttributes` only).
// localStorage is no longer consulted; any pre-existing localStorage payload
// is migrated to the DB on app boot via `migrateLocalStorageEnhancedAttributes`.
export const mergeCardWithEnhanced = (card: Card): EnhancedCard => {
  const dbAttributes = (card.enhancedAttributes ?? null) as Record<string, unknown> | null;
  if (dbAttributes) {
    return { ...card, ...dbAttributes } as EnhancedCard;
  }
  return migrateCardToEnhanced(card);
};

// Save complete enhanced card
export const saveEnhancedCard = async (
  enhancedCard: Partial<EnhancedCard>,
  addCard: (card: Card) => Promise<void>,
  updateCard: (card: Card) => Promise<void>
): Promise<void> => {
  console.log('[saveEnhancedCard] Starting save process for enhanced card:', enhancedCard);

  // Convert to basic card for database. enhancedAttributes is packed in by
  // enhancedToBasicCard so the full enhanced payload round-trips via the API.
  const basicCard = enhancedToBasicCard(enhancedCard);
  console.log('[saveEnhancedCard] Converted to basic card:', basicCard);

  // Save to database
  // Check if this is an update (card has an ID and was created before)
  const isUpdate = enhancedCard.id && enhancedCard.createdAt;
  
  console.log('[saveEnhancedCard] Save details:', {
    id: enhancedCard.id,
    createdAt: enhancedCard.createdAt,
    isUpdate,
    player: enhancedCard.player,
    basicCardId: basicCard.id,
    userId: basicCard.userId,
    collectionId: basicCard.collectionId
  });
  
  try {
    if (isUpdate) {
      console.log('[saveEnhancedCard] Updating existing card');
      await updateCard(basicCard);
      console.log('[saveEnhancedCard] Card updated successfully');
    } else {
      console.log('[saveEnhancedCard] Adding new card');
      await addCard(basicCard);
      console.log('[saveEnhancedCard] Card added successfully');
    }
  } catch (error) {
    console.error('[saveEnhancedCard] Error saving card:', error);
    throw error;
  }
};