import { Request } from 'express';

// ─── Storage Location ────────────────────────────────────────────────────────

export interface StorageLocation {
  room?: string;
  shelf?: string;
  box?: string;
  row?: string;
  slot?: string;
  method?: string;
  notes?: string;
}

// ─── Card ────────────────────────────────────────────────────────────────────

export interface Card {
  id: string;
  userId: string;
  collectionId?: string;
  collectionType: 'PC' | 'Inventory' | 'Pending';
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  parallel?: string;
  condition: string;
  gradingCompany?: string;
  setName?: string;
  serialNumber?: string;
  grade?: string;
  isRookie?: boolean;
  isAutograph?: boolean;
  isRelic?: boolean;
  isNumbered?: boolean;
  isGraded?: boolean;
  purchasePrice: number;
  purchaseDate: string;
  sellPrice?: number;
  sellDate?: string;
  ebayExportedAt?: string;
  currentValue: number;
  storageLocation?: StorageLocation | null;
  enhancedAttributes?: Record<string, unknown> | null;
  images: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardInput {
  userId?: string;
  collectionId?: string;
  collectionType?: 'PC' | 'Inventory' | 'Pending';
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  parallel?: string;
  condition: string;
  gradingCompany?: string;
  setName?: string;
  serialNumber?: string;
  grade?: string;
  isRookie?: boolean;
  isAutograph?: boolean;
  isRelic?: boolean;
  isNumbered?: boolean;
  isGraded?: boolean;
  purchasePrice: number;
  purchaseDate: string;
  sellPrice?: number;
  sellDate?: string;
  currentValue: number;
  storageLocation?: StorageLocation | null;
  enhancedAttributes?: Record<string, unknown> | null;
  images: string[];
  notes: string;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  isActive: boolean;
  profilePhoto: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserInput {
  username: string;
  email: string;
  password: string;
  role?: 'admin' | 'user';
}

// ─── Collection ──────────────────────────────────────────────────────────────

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  isDefault: boolean;
  visibility: 'private' | 'public' | 'shared';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionInput {
  userId: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  visibility?: 'private' | 'public' | 'shared';
  tags?: string[];
}

export interface CollectionStats {
  cardCount: number;
  totalValue: number;
  totalCost: number;
  categoryBreakdown: { [category: string]: number };
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'image-processing' | 'comp-generation' | 'ebay-csv' | string;

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  totalItems: number;
  completedItems: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobInput {
  type: JobType;
  payload?: Record<string, unknown>;
}

// ─── File ────────────────────────────────────────────────────────────────────

export interface FileInfo {
  name: string;
  size: number;
  modified: string;
  type: string;
}

// ─── Log ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  timestamp: string;
  filename: string;
  reason: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  role: 'admin' | 'user';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

// ─── Comps ───────────────────────────────────────────────────────────────────

export type CompSource = 'SportsCardsPro' | 'eBay' | 'CardLadder' | 'MarketMovers' | '130Point' | 'PSA';

export interface CompSale {
  date: string;
  price: number;
  grade?: string;
  venue: string;
}

export interface CompResult {
  source: CompSource;
  marketValue: number | null;
  sales: CompSale[];
  averagePrice: number | null;
  low: number | null;
  high: number | null;
  error?: string;
}

export interface CompReport {
  cardId: string;
  player: string;
  year: number;
  brand: string;
  cardNumber: string;
  condition?: string;
  sources: CompResult[];
  aggregateAverage: number | null;
  aggregateMedian: number | null;
  aggregateLow: number | null;
  aggregateHigh: number | null;
  psa10Median: number | null;
  psa9Median: number | null;
  popData?: PopulationData | null;
  popMultiplier?: number;
  popAdjustedAverage?: number | null;
  generatedAt: string;
}

export interface CompRequest {
  cardId: string;
  player: string;
  year: number;
  brand: string;
  cardNumber: string;
  condition?: string;
  category?: string;
  setName?: string;
  parallel?: string;
  isGraded?: boolean;
  gradingCompany?: string;
  grade?: string;
  isRookie?: boolean;
  isAutograph?: boolean;
  isRelic?: boolean;
  isNumbered?: boolean;
}

export interface CompAdapter {
  source: CompSource;
  fetchComps(request: CompRequest): Promise<CompResult>;
}

export interface StoredCompReport {
  id: string;
  cardId: string;
  condition?: string;
  sources: CompResult[];
  aggregateAverage: number | null;
  aggregateMedian: number | null;
  aggregateLow: number | null;
  aggregateHigh: number | null;
  psa10Median: number | null;
  psa9Median: number | null;
  popData?: PopulationData | null;
  popMultiplier?: number;
  popAdjustedAverage?: number | null;
  generatedAt: string;
  createdAt: string;
}

// ─── Population Report ─────────────────────────────────────────────────────

export interface PopulationData {
  gradingCompany: string;
  totalGraded: number;
  gradeBreakdown: PopGradeEntry[];
  targetGrade: string;
  targetGradePop: number;
  higherGradePop: number;
  percentile: number;
  rarityTier: PopRarityTier;
  fetchedAt: string;
}

export interface PopGradeEntry { grade: string; count: number; }
export type PopRarityTier = 'ultra-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface PopScraper {
  company: string;
  fetchPopulation(request: PopRequest): Promise<PopulationData | null>;
}

export interface PopRequest {
  player: string;
  year: number;
  brand: string;
  cardNumber: string;
  setName?: string;
  parallel?: string;
  grade: string;
  category?: string;
  gradingCompany?: string;
}

// ─── eBay Export ────────────────────────────────────────────────────────────

export interface EbayExportOptions {
  priceMultiplier: number;
  shippingCost?: number;
  duration: string;
  location: string;
  dispatchTime: number;
  cardIds?: string[];
  imageBaseUrl?: string;
  useCompPricing?: boolean;
  compMaxAgeDays?: number;
}

export interface EbayExportResult {
  filename: string;
  totalCards: number;
  skippedPcCards: number;
  totalListingValue: number;
  compPricedCards: number;
  staleFallbackCards: number;
  draftId: string;
  generatedAt: string;
}

export interface EbayExportDraft {
  id: string;
  filename: string;
  totalCards: number;
  skippedPcCards: number;
  totalListingValue: number;
  compPricedCards: number;
  options: EbayExportOptions;
  cardSummary: EbayExportCardSummary[];
  generatedAt: string;
  createdAt: string;
}

export interface EbayExportCardSummary {
  cardId: string;
  player: string;
  price: number;
  priceSource: string;
}

// ─── Image Upload (SCP) ─────────────────────────────────────────────────────

export interface ImageUpload {
  id: string;
  cardId: string;
  filename: string;
  remoteUrl: string;
  fileHash: string;
  uploadedAt: string;
}

export interface ScpUploadPayload {
  cardIds?: string[];
}

export interface ScpUploadResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ─── Image Processing ───────────────────────────────────────────────────────

export interface ImageProcessingPayload {
  filenames: string[];
  skipExisting?: boolean;
  confidenceThreshold?: number;
  collectionId?: string;
}

export interface ImageProcessingResult {
  totalFiles: number;
  processed: number;
  skipped: number;
  duplicates: number;
  failed: number;
  results: ImageProcessingItemResult[];
}

export interface ImageProcessingItemResult {
  filename: string;
  status: 'processed' | 'skipped' | 'duplicate' | 'failed';
  processedFilename?: string;
  cardId?: string;
  confidence?: number;
  error?: string;
}

export interface ExtractedCardData {
  player?: string;
  year?: string;
  brand?: string;
  setName?: string;
  cardNumber?: string;
  team?: string;
  category?: string;
  parallel?: string;
  serialNumber?: string;
  gradingCompany?: string;
  grade?: string;
  collectionId?: string;
  features?: CardFeatures;
  confidence?: DetectionConfidence;
  rawText?: string;
  _apiMeta?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    imageCount: number;
  };
  _parseFailed?: boolean;
}

export interface CardFeatures {
  isRookie: boolean;
  isAutograph: boolean;
  isRelic: boolean;
  isNumbered: boolean;
  isGraded: boolean;
  isParallel: boolean;
}

export interface DetectionConfidence {
  score: number;
  level: 'high' | 'medium' | 'low';
  detectedFields: number;
  missingFields?: string[];
}

// ─── Grading Submissions ────────────────────────────────────────────────────

export type GradingStatus = 'Submitted' | 'Received' | 'Grading' | 'Shipped' | 'Complete';
export type GradingCompany = 'PSA' | 'BGS' | 'SGC' | 'CGC' | 'HGA' | 'Other';
export type GradingTier = 'Economy' | 'Regular' | 'Express' | 'Super Express' | 'Walk-Through';

export interface GradingSubmission {
  id: string;
  userId: string;
  cardId: string;
  gradingCompany: GradingCompany;
  submissionNumber: string;
  status: GradingStatus;
  tier: GradingTier;
  cost: number;
  declaredValue: number;
  submittedAt: string;
  receivedAt: string | null;
  gradingAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  estimatedReturnDate: string | null;
  grade: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradingSubmissionInput {
  cardId: string;
  gradingCompany: GradingCompany;
  submissionNumber: string;
  tier: GradingTier;
  cost: number;
  declaredValue?: number;
  submittedAt: string;
  estimatedReturnDate?: string;
  notes?: string;
}

export interface GradingStats {
  totalSubmissions: number;
  pending: number;
  complete: number;
  totalCost: number;
  avgTurnaroundDays: number | null;
  avgGrade: number | null;
}

// ─── Price Alerts ────────────────────────────────────────────────────────────

export type PriceAlertType = 'above' | 'below';

export interface PriceAlert {
  id: string;
  cardId: string;
  userId: string;
  type: PriceAlertType;
  thresholdLow: number | null;
  thresholdHigh: number | null;
  isEnabled: boolean;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertInput {
  cardId: string;
  type: PriceAlertType;
  thresholdLow?: number;
  thresholdHigh?: number;
}

export interface PriceAlertHistoryEntry {
  id: string;
  alertId: string;
  cardId: string;
  previousValue: number;
  currentValue: number;
  threshold: number;
  type: PriceAlertType;
  createdAt: string;
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'action' | 'entity' | 'entityId';
  sortDirection?: 'asc' | 'desc';
}

// ─── Typed Audit Details ────────────────────────────────────────────────────

export interface AuditDetailsMap {
  'user.register': undefined;
  'user.login': undefined;
  'user.login_failed': { email: string };
  'user.password_change': undefined;
  'user.profile_update': { fields: string[] };
  'file.upload': { count: number; files: { name: string; originalName: string; size: number }[] };
  'file.upload_rejected': { error: string; code?: string };
  'file.replace': undefined;
  'file.delete_raw': undefined;
  'file.delete_processed': undefined;
  'log.clear': undefined;
  'card.create': { player: string; year: number; brand: string };
  'card.update': { player: string; year: number; brand: string };
  'card.delete': undefined;
  'job.create': { type: string };
  'job.cancel': { type: string };
  'collection.create': { name: string };
  'collection.update': { name: string };
  'collection.delete': undefined;
  'collection.set-default': undefined;
  'collection.move-cards': { cardCount: number };
  'ebay.generate': { totalCards: number };
  'ebay.generate_async': undefined;
  'ebay.download': undefined;
  'image.process_batch': { fileCount: number };
  'image.process_sync': { status: string; cardId?: string };
  'image.pair_detected': { backFile: string };
  'image.identify': { backFile: string | null; confidenceScore?: number; confidenceLevel?: string; detectedFields?: number; missingFields?: string[] };
  'image.identify_failed': { error: string; backFile: string | null };
  'image.user_modifications': { modifications: { field: string; from: unknown; to: unknown }[] };
  'image.confirm': { filename: string; backFile: string | null; processedFilename?: string; confidence?: number; status: string };
  'vision.api_call': { model?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; imageCount?: number; confidenceScore?: number; parseFailed: boolean };
  'audit.delete': { deletedId: string };
  'audit.delete_bulk': { deletedCount: number; requestedIds: string[] };
  'audit.purge': { deletedCount: number; before: string; filters?: Record<string, string> };
  'audit.export': { format: 'csv' | 'json'; entryCount: number; filters?: Record<string, string> };
  'admin.user_create': { username: string; email: string; role: 'admin' | 'user' };
  'admin.user_update': { userId: string; fields: string[] };
  'admin.user_delete': { userId: string; username: string };
  'admin.user_toggle_status': { userId: string; newStatus: boolean };
  'admin.user_change_role': { userId: string; oldRole: string; newRole: string };
  'admin.user_reset_password': { userId: string };
  'grading.create': { cardId: string; gradingCompany: string; submissionNumber: string };
  'grading.update_status': { submissionId: string; oldStatus: string; newStatus: string; grade?: string };
  'grading.update': { submissionId: string; fields: string[] };
  'grading.delete': { submissionId: string; cardId: string };
  'storage.update': { cardId: string; location: StorageLocation };
  'storage.bulk_assign': { cardIds: string[]; location: StorageLocation };
  'price_alert.create': { cardId: string; type: string };
  'price_alert.update': Record<string, unknown>;
  'price_alert.delete': { cardId: string };
}

export type AuditAction = keyof AuditDetailsMap;
