import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('passwordHash').notNull(),
  role: text('role').notNull().default('user').$type<'admin' | 'user'>(),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  profilePhoto: text('profilePhoto'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

// ─── Collections ────────────────────────────────────────────────────────────

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon').default(''),
  color: text('color').default('#4F46E5'),
  isDefault: integer('isDefault', { mode: 'boolean' }).default(false),
  visibility: text('visibility').default('private').$type<'private' | 'public' | 'shared'>(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

// ─── Cards ──────────────────────────────────────────────────────────────────

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().default(''),
  collectionId: text('collectionId'),
  collectionType: text('collectionType').notNull().default('Inventory').$type<'PC' | 'Inventory' | 'Pending'>(),
  player: text('player').notNull(),
  team: text('team').notNull(),
  year: integer('year').notNull(),
  brand: text('brand').notNull(),
  category: text('category').notNull(),
  cardNumber: text('cardNumber').notNull(),
  parallel: text('parallel'),
  condition: text('condition').notNull(),
  gradingCompany: text('gradingCompany'),
  setName: text('setName'),
  serialNumber: text('serialNumber'),
  grade: text('grade'),
  isRookie: integer('isRookie', { mode: 'boolean' }).default(false),
  isAutograph: integer('isAutograph', { mode: 'boolean' }).default(false),
  isRelic: integer('isRelic', { mode: 'boolean' }).default(false),
  isNumbered: integer('isNumbered', { mode: 'boolean' }).default(false),
  isGraded: integer('isGraded', { mode: 'boolean' }).default(false),
  purchasePrice: real('purchasePrice').notNull(),
  purchaseDate: text('purchaseDate').notNull(),
  sellPrice: real('sellPrice'),
  sellDate: text('sellDate'),
  currentValue: real('currentValue').notNull(),
  images: text('images', { mode: 'json' }).$type<string[]>().notNull().default([]),
  notes: text('notes').notNull().default(''),
  storageLocation: text('storageLocation', { mode: 'json' }).$type<{
    room?: string;
    shelf?: string;
    box?: string;
    row?: string;
    slot?: string;
    method?: string;
    notes?: string;
  } | null>(),
  enhancedAttributes: text('enhancedAttributes', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

// ─── Jobs ───────────────────────────────────────────────────────────────────

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'cancelled'>(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  error: text('error'),
  progress: real('progress').notNull().default(0),
  totalItems: integer('totalItems').notNull().default(0),
  completedItems: integer('completedItems').notNull().default(0),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

// ─── Grading Submissions ────────────────────────────────────────────────────

export const gradingSubmissions = sqliteTable('grading_submissions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => users.id),
  cardId: text('cardId').notNull().references(() => cards.id),
  gradingCompany: text('gradingCompany').notNull(),
  submissionNumber: text('submissionNumber').notNull(),
  status: text('status').notNull().default('Submitted'),
  tier: text('tier').notNull().default('Regular'),
  cost: real('cost').notNull().default(0),
  declaredValue: real('declaredValue').notNull().default(0),
  submittedAt: text('submittedAt').notNull(),
  receivedAt: text('receivedAt'),
  gradingAt: text('gradingAt'),
  shippedAt: text('shippedAt'),
  completedAt: text('completedAt'),
  estimatedReturnDate: text('estimatedReturnDate'),
  grade: text('grade'),
  notes: text('notes').notNull().default(''),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  index('idx_grading_userId').on(table.userId),
  index('idx_grading_cardId').on(table.cardId),
  index('idx_grading_status').on(table.status),
]);

// ─── Comp Cache ────────────────────────────────────────────────────────────

export const compCache = sqliteTable('comp_cache', {
  key: text('key').primaryKey(),
  source: text('source').notNull(),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('createdAt').notNull(),
  expiresAt: text('expiresAt').notNull(),
}, (table) => [
  index('idx_comp_cache_expiresAt').on(table.expiresAt),
]);

// ─── Card Comp Reports ────────────────────────────────────────────────────

export const cardCompReports = sqliteTable('card_comp_reports', {
  id: text('id').primaryKey(),
  cardId: text('cardId').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  condition: text('condition'),
  aggregateAverage: real('aggregateAverage'),
  aggregateMedian: real('aggregateMedian'),
  aggregateLow: real('aggregateLow'),
  aggregateHigh: real('aggregateHigh'),
  popMultiplier: real('popMultiplier'),
  popAdjustedAverage: real('popAdjustedAverage'),
  popData: text('popData'),
  generatedAt: text('generatedAt').notNull(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_comp_reports_cardId').on(table.cardId),
  index('idx_comp_reports_generatedAt').on(table.generatedAt),
]);

// ─── Card Comp Sources ───────────────────────────────────────────────────

export const cardCompSources = sqliteTable('card_comp_sources', {
  id: text('id').primaryKey(),
  reportId: text('reportId').notNull().references(() => cardCompReports.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  marketValue: real('marketValue'),
  averagePrice: real('averagePrice'),
  low: real('low'),
  high: real('high'),
  sales: text('sales', { mode: 'json' }).$type<Record<string, unknown>[]>().notNull().default([]),
  error: text('error'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_comp_sources_reportId').on(table.reportId),
]);

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('userId'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entityId'),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  ipAddress: text('ipAddress'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_audit_logs_entity').on(table.entity, table.entityId),
  index('idx_audit_logs_userId').on(table.userId),
  index('idx_audit_logs_createdAt').on(table.createdAt),
]);

// ─── Pop Report Snapshots ────────────────────────────────────────────────

export const popReportSnapshots = sqliteTable('pop_report_snapshots', {
  id: text('id').primaryKey(),
  cardId: text('cardId').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  gradingCompany: text('gradingCompany').notNull(),
  grade: text('grade').notNull(),
  totalGraded: integer('totalGraded').notNull(),
  targetGradePop: integer('targetGradePop').notNull(),
  higherGradePop: integer('higherGradePop').notNull(),
  percentile: real('percentile').notNull(),
  rarityTier: text('rarityTier').notNull(),
  gradeBreakdown: text('gradeBreakdown', { mode: 'json' }).$type<{ grade: string; count: number }[]>().notNull().default([]),
  fetchedAt: text('fetchedAt').notNull(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_pop_snapshots_cardId').on(table.cardId),
  index('idx_pop_snapshots_fetchedAt').on(table.fetchedAt),
]);

// ─── eBay Export Drafts ────────────────────────────────────────────────

export const ebayExportDrafts = sqliteTable('ebay_export_drafts', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  totalCards: integer('totalCards').notNull(),
  skippedPcCards: integer('skippedPcCards').notNull(),
  totalListingValue: real('totalListingValue').notNull(),
  compPricedCards: integer('compPricedCards').notNull().default(0),
  options: text('options', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  cardSummary: text('cardSummary', { mode: 'json' }).$type<Record<string, unknown>[]>().notNull().default([]),
  generatedAt: text('generatedAt').notNull(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_ebay_drafts_generatedAt').on(table.generatedAt),
]);

// ─── Card Image Uploads ─────────────────────────────────────────────────

export const cardImageUploads = sqliteTable('card_image_uploads', {
  id: text('id').primaryKey(),
  cardId: text('cardId').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  remoteUrl: text('remoteUrl').notNull(),
  fileHash: text('fileHash').notNull(),
  uploadedAt: text('uploadedAt').notNull(),
}, (table) => [
  index('idx_image_uploads_cardId').on(table.cardId),
  index('idx_image_uploads_filename').on(table.filename),
]);

// ─── Card Value Snapshots ────────────────────────────────────────────────

export const cardValueSnapshots = sqliteTable('card_value_snapshots', {
  id: text('id').primaryKey(),
  cardId: text('cardId').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  value: real('value').notNull(),
  source: text('source').notNull(),
  snapshotAt: text('snapshotAt').notNull(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_value_snapshots_cardId').on(table.cardId),
  index('idx_value_snapshots_snapshotAt').on(table.snapshotAt),
  index('idx_value_snapshots_cardId_snapshotAt').on(table.cardId, table.snapshotAt),
]);

// ─── Price Alerts ─────────────────────────────────────────────────────────

export const priceAlerts = sqliteTable('price_alerts', {
  id: text('id').primaryKey(),
  cardId: text('cardId').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: text('userId').notNull().references(() => users.id),
  type: text('type').notNull().$type<'above' | 'below'>(),
  thresholdLow: real('thresholdLow'),
  thresholdHigh: real('thresholdHigh'),
  isEnabled: integer('isEnabled', { mode: 'boolean' }).default(true),
  lastCheckedAt: text('lastCheckedAt'),
  lastTriggeredAt: text('lastTriggeredAt'),
  triggerCount: integer('triggerCount').default(0),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  index('idx_price_alerts_cardId').on(table.cardId),
  index('idx_price_alerts_userId').on(table.userId),
  index('idx_price_alerts_isEnabled').on(table.isEnabled),
]);

export const priceAlertHistory = sqliteTable('price_alert_history', {
  id: text('id').primaryKey(),
  alertId: text('alertId').notNull().references(() => priceAlerts.id, { onDelete: 'cascade' }),
  cardId: text('cardId').notNull().references(() => cards.id),
  previousValue: real('previousValue').notNull(),
  currentValue: real('currentValue').notNull(),
  threshold: real('threshold').notNull(),
  type: text('type').notNull().$type<'above' | 'below'>(),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_alert_history_alertId').on(table.alertId),
  index('idx_alert_history_cardId').on(table.cardId),
  index('idx_alert_history_createdAt').on(table.createdAt),
]);
