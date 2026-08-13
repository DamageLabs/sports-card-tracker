import { Card, User, StorageLocation, PriceAlert, PriceAlertHistoryEntry } from '../types';
import { logDebug, logInfo, logError } from '../utils/logger';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

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
  condition?: string;
  features?: {
    isRookie: boolean;
    isAutograph: boolean;
    isRelic: boolean;
    isNumbered: boolean;
    isGraded: boolean;
    isParallel: boolean;
  };
  confidence?: {
    score: number;
    level: 'high' | 'medium' | 'low';
    detectedFields: number;
    missingFields?: string[];
  };
}

export type AuditAction =
  | 'user.register' | 'user.login' | 'user.login_failed' | 'user.password_change' | 'user.profile_update'
  | 'file.upload' | 'file.upload_rejected' | 'file.replace' | 'file.delete_raw' | 'file.delete_processed'
  | 'log.clear'
  | 'card.create' | 'card.update' | 'card.delete'
  | 'job.create' | 'job.cancel'
  | 'collection.create' | 'collection.update' | 'collection.delete' | 'collection.set-default' | 'collection.move-cards'
  | 'ebay.generate' | 'ebay.generate_async' | 'ebay.download'
  | 'image.process_batch' | 'image.process_sync' | 'image.pair_detected' | 'image.identify' | 'image.identify_failed'
  | 'image.user_modifications' | 'image.confirm'
  | 'vision.api_call'
  | 'audit.delete' | 'audit.delete_bulk' | 'audit.purge' | 'audit.export'
  | 'admin.user_create' | 'admin.user_update' | 'admin.user_delete'
  | 'admin.user_toggle_status' | 'admin.user_change_role' | 'admin.user_reset_password'
  | 'grading.create' | 'grading.update_status' | 'grading.update' | 'grading.delete'
;

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface CardInput {
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
  images: string[];
  notes: string;
  collectionId?: string;
  collectionType?: string;
  enhancedAttributes?: Record<string, unknown> | null;
}

class ApiService {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    logDebug('ApiService', `Making request to ${url}`, { method: options.method || 'GET' });
    
    // Get auth token from localStorage
    const token = localStorage.getItem('token');
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        logError('ApiService', `HTTP Error for ${url}`, new Error(errorMessage));
        throw new Error(errorMessage);
      }

      if (response.status === 204) {
        return {} as T; // No content response
      }

      const data = await response.json();
      logDebug('ApiService', `Response received from ${url}`, data);
      return data;
    } catch (error) {
      // Enhanced error logging
      if (error instanceof TypeError && error.message.includes('fetch')) {
        const networkError = new Error(`Network error: Unable to connect to ${url}. Make sure the server is running.`);
        logError('ApiService', `Network error for ${url}`, networkError);
        throw networkError;
      }
      
      logError('ApiService', `Request failed for ${url}`, error as Error);
      throw error;
    }
  }

  public async getAllCards(): Promise<Card[]> {
    try {
      logInfo('ApiService', 'Fetching all cards');
      const cards = await this.request<Card[]>('/cards');
      
      // Convert date strings back to Date objects
      const processedCards = cards.map(card => ({
        ...card,
        purchaseDate: new Date(card.purchaseDate),
        sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
        createdAt: new Date(card.createdAt),
        updatedAt: new Date(card.updatedAt)
      }));
      
      logInfo('ApiService', `Fetched ${processedCards.length} cards`);
      return processedCards;
    } catch (error) {
      logError('ApiService', 'Failed to fetch cards', error as Error);
      throw error;
    }
  }

  public async getCard(id: string): Promise<Card> {
    try {
      logInfo('ApiService', `Fetching card ${id}`);
      const card = await this.request<Card>(`/cards/${id}`);
      
      // Convert date strings back to Date objects
      return {
        ...card,
        purchaseDate: new Date(card.purchaseDate),
        sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
        createdAt: new Date(card.createdAt),
        updatedAt: new Date(card.updatedAt)
      };
    } catch (error) {
      logError('ApiService', `Failed to fetch card ${id}`, error as Error);
      throw error;
    }
  }

  public async createCard(cardData: Card): Promise<Card> {
    try {
      logInfo('ApiService', 'Creating new card', { player: cardData.player });

      const cardInput: CardInput = {
        player: cardData.player,
        team: cardData.team,
        year: cardData.year,
        brand: cardData.brand,
        category: cardData.category,
        cardNumber: cardData.cardNumber,
        parallel: cardData.parallel,
        condition: cardData.condition,
        gradingCompany: cardData.gradingCompany,
        setName: cardData.setName,
        serialNumber: cardData.serialNumber,
        grade: cardData.grade,
        isRookie: cardData.isRookie,
        isAutograph: cardData.isAutograph,
        isRelic: cardData.isRelic,
        isNumbered: cardData.isNumbered,
        isGraded: cardData.isGraded,
        purchasePrice: cardData.purchasePrice,
        purchaseDate: cardData.purchaseDate.toISOString(),
        sellPrice: cardData.sellPrice,
        sellDate: cardData.sellDate?.toISOString(),
        currentValue: cardData.currentValue,
        images: cardData.images,
        notes: cardData.notes,
        collectionId: cardData.collectionId,
        collectionType: cardData.collectionType,
        enhancedAttributes: cardData.enhancedAttributes ?? null,
      };

      const card = await this.request<Card>('/cards', {
        method: 'POST',
        body: JSON.stringify(cardInput),
      });

      // Convert date strings back to Date objects
      return {
        ...card,
        purchaseDate: new Date(card.purchaseDate),
        sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
        createdAt: new Date(card.createdAt),
        updatedAt: new Date(card.updatedAt)
      };
    } catch (error) {
      logError('ApiService', 'Failed to create card', error as Error, cardData);
      throw error;
    }
  }

  public async updateCard(cardData: Card): Promise<Card> {
    try {
      logInfo('ApiService', `Updating card ${cardData.id}`, { player: cardData.player });

      const cardInput: CardInput = {
        player: cardData.player,
        team: cardData.team,
        year: cardData.year,
        brand: cardData.brand,
        category: cardData.category,
        cardNumber: cardData.cardNumber,
        parallel: cardData.parallel,
        condition: cardData.condition,
        gradingCompany: cardData.gradingCompany,
        setName: cardData.setName,
        serialNumber: cardData.serialNumber,
        grade: cardData.grade,
        isRookie: cardData.isRookie,
        isAutograph: cardData.isAutograph,
        isRelic: cardData.isRelic,
        isNumbered: cardData.isNumbered,
        isGraded: cardData.isGraded,
        purchasePrice: cardData.purchasePrice,
        purchaseDate: cardData.purchaseDate.toISOString(),
        sellPrice: cardData.sellPrice,
        sellDate: cardData.sellDate?.toISOString(),
        currentValue: cardData.currentValue,
        images: cardData.images,
        notes: cardData.notes,
        collectionId: cardData.collectionId,
        collectionType: cardData.collectionType,
        enhancedAttributes: cardData.enhancedAttributes ?? null,
      };

      const card = await this.request<Card>(`/cards/${cardData.id}`, {
        method: 'PUT',
        body: JSON.stringify(cardInput),
      });

      // Convert date strings back to Date objects
      return {
        ...card,
        purchaseDate: new Date(card.purchaseDate),
        sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
        createdAt: new Date(card.createdAt),
        updatedAt: new Date(card.updatedAt)
      };
    } catch (error) {
      logError('ApiService', `Failed to update card ${cardData.id}`, error as Error, cardData);
      throw error;
    }
  }

  public async deleteCard(id: string): Promise<void> {
    try {
      logInfo('ApiService', `Deleting card ${id}`);
      await this.request<void>(`/cards/${id}`, {
        method: 'DELETE',
      });
      logInfo('ApiService', `Card ${id} deleted successfully`);
    } catch (error) {
      logError('ApiService', `Failed to delete card ${id}`, error as Error);
      throw error;
    }
  }

  public async login(email: string, password: string): Promise<{ user: User; token: string }> {
    return this.request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  public async register(username: string, email: string, password: string): Promise<{ user: User; token: string }> {
    return this.request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  public async getMe(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  public async updateProfile(data: {
    email?: string;
    currentPassword?: string;
    newPassword?: string;
    profilePhoto?: string | null;
  }): Promise<User> {
    return this.request<User>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // ─── eBay Export ──────────────────────────────────────────────────────────

  public async generateEbayCsv(options: {
    priceMultiplier: number;
    shippingCost?: number;
    duration?: string;
    location?: string;
    dispatchTime?: number;
    cardIds?: string[];
  }): Promise<{
    filename: string;
    totalCards: number;
    skippedPcCards: number;
    totalListingValue: number;
    generatedAt: string;
  }> {
    return this.request('/ebay/generate', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  public async generateEbayCsvAsync(options: {
    priceMultiplier: number;
    shippingCost?: number;
    duration?: string;
    location?: string;
    dispatchTime?: number;
    cardIds?: string[];
  }): Promise<{ id: string; type: string; status: string }> {
    return this.request('/ebay/generate-async', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  public async downloadEbayCsv(): Promise<Blob> {
    const url = `${API_BASE_URL}/ebay/download`;
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to download CSV: ${response.statusText}`);
    }
    return response.blob();
  }

  public async getEbayExportStatus(): Promise<{
    templateExists: boolean;
    outputExists: boolean;
  }> {
    return this.request('/ebay/status');
  }

  public async getExportedCardIds(): Promise<string[]> {
    return this.request<string[]>('/ebay/exported-card-ids');
  }

  public async getProcessedRawFiles(): Promise<string[]> {
    return this.request<string[]>('/image-processing/processed-raw-files');
  }

  public async getEbayExportDrafts(limit?: number, offset?: number): Promise<{
    drafts: EbayExportDraftSummary[];
    total: number;
  }> {
    const params = new URLSearchParams();
    if (limit != null) params.append('limit', String(limit));
    if (offset != null) params.append('offset', String(offset));
    const qs = params.toString();
    return this.request(`/ebay/drafts${qs ? `?${qs}` : ''}`);
  }

  public async downloadEbayDraft(draftId: string, filename: string): Promise<void> {
    const url = `${API_BASE_URL}/ebay/drafts/${draftId}/download`;
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  public async deleteEbayDraft(draftId: string): Promise<void> {
    await this.request<void>(`/ebay/drafts/${draftId}`, { method: 'DELETE' });
  }

  // ─── SCP Image Upload ───────────────────────────────────────────────────

  public async getScpStatus(): Promise<{ total: number; synced: number; unsynced: number; configured: boolean }> {
    return this.request('/files/scp-status');
  }

  public async triggerScpUpload(cardIds?: string[]): Promise<{ uploaded?: number; skipped?: number; failed?: number; errors?: string[]; jobId?: string; message?: string }> {
    return this.request('/files/scp-upload', {
      method: 'POST',
      body: JSON.stringify(cardIds ? { cardIds } : {}),
    });
  }

  // ─── Processed Files ────────────────────────────────────────────────────

  public async getProcessedFiles(): Promise<{ name: string; size: number; modified: string; type: string }[]> {
    return this.request('/files/processed');
  }

  public async deleteProcessedFile(filename: string): Promise<void> {
    await this.request<void>(`/files/processed/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  // ─── Raw Files (Holding Pen) ────────────────────────────────────────────

  public async getRawFiles(): Promise<{ name: string; size: number; modified: string; type: string }[]> {
    return this.request('/files/raw');
  }

  public async deleteRawFile(filename: string): Promise<void> {
    await this.request<void>(`/files/raw/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  public async uploadRawFiles(files: File[]): Promise<{ uploaded: { name: string; size: number; originalName: string }[]; count: number }> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const url = `${API_BASE_URL}/files/raw/upload`;
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  public async replaceRawFile(filename: string, blob: Blob): Promise<void> {
    const formData = new FormData();
    formData.append('file', blob, filename);

    const url = `${API_BASE_URL}/files/raw/${encodeURIComponent(filename)}`;
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Replace failed' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
  }

  public async processRawImages(filenames: string[], collectionId?: string): Promise<{ id: string; type: string; status: string }> {
    return this.request('/image-processing/process', {
      method: 'POST',
      body: JSON.stringify({ filenames, collectionId }),
    });
  }

  public async getJob(id: string): Promise<{ id: string; type: string; status: string; result?: Record<string, unknown>; error?: string; progress?: number }> {
    return this.request(`/jobs/${id}`);
  }

  public async identifyCard(filename: string, backFile?: string): Promise<ExtractedCardData> {
    return this.request('/image-processing/identify', {
      method: 'POST',
      body: JSON.stringify({ filename, backFile }),
    });
  }

  public async confirmCard(
    filename: string,
    cardData: ExtractedCardData,
    backFile?: string,
    originalData?: ExtractedCardData
  ): Promise<{ filename: string; status: string; processedFilename?: string; cardId?: string; confidence?: number; error?: string }> {
    return this.request('/image-processing/confirm', {
      method: 'POST',
      body: JSON.stringify({ filename, backFile, cardData, originalData }),
    });
  }

  public async getCardByImage(imageFilename: string): Promise<Card> {
    const card = await this.request<Card>(`/cards?image=${encodeURIComponent(imageFilename)}`);
    return {
      ...card,
      purchaseDate: new Date(card.purchaseDate),
      sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
      createdAt: new Date(card.createdAt),
      updatedAt: new Date(card.updatedAt),
    };
  }

  // ─── Heatmap ─────────────────────────────────────────────────────────────

  public async getHeatmapData(period: string = 'all'): Promise<HeatmapResponse> {
    return this.request<HeatmapResponse>(`/cards/heatmap?period=${encodeURIComponent(period)}`);
  }

  public async backfillValueSnapshots(): Promise<{ backfilled: number }> {
    return this.request('/cards/heatmap/backfill', { method: 'POST' });
  }

  // ─── Comps ──────────────────────────────────────────────────────────────

  public async generateComps(cardId: string): Promise<CompReport> {
    return this.request<CompReport>(`/comps/${cardId}`);
  }

  public async getStoredComps(cardId: string): Promise<CompReport | null> {
    try {
      return await this.request<CompReport>(`/comps/${cardId}/stored`);
    } catch {
      return null;
    }
  }

  public async getCompHistory(cardId: string, limit?: number): Promise<CompReport[]> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<CompReport[]>(`/comps/${cardId}/history${query}`);
  }

  public async refreshComps(cardId: string): Promise<CompReport> {
    return this.request<CompReport>(`/comps/${cardId}?refresh=true`);
  }

  public async getPopSummary(): Promise<{ cardId: string; rarityTier: PopRarityTier; popAdjustedAverage: number | null; images: string[] }[]> {
    return this.request<{ cardId: string; rarityTier: PopRarityTier; popAdjustedAverage: number | null; images: string[] }[]>('/comps/pop-summary');
  }

  public async getPriceSummary(): Promise<{ cardId: string; aggregateAverage: number | null; aggregateMedian: number | null; psa10Median: number | null; psa9Median: number | null; popAdjustedAverage: number | null; images: string[] }[]> {
    return this.request<{ cardId: string; aggregateAverage: number | null; aggregateMedian: number | null; psa10Median: number | null; psa9Median: number | null; popAdjustedAverage: number | null; images: string[] }[]>('/comps/price-summary');
  }

  public async getPopHistory(cardId: string, limit?: number): Promise<PopulationData[]> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request<PopulationData[]>(`/comps/${cardId}/pop-history${query}`);
  }

  public async generateBulkComps(cardIds: string[]): Promise<{ id: string; type: string; status: string }> {
    return this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify({ type: 'comp-generation', payload: { cardIds } }),
    });
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  public async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      logDebug('ApiService', 'Performing health check');
      return await this.request<{ status: string; message: string }>('/health');
    } catch (error) {
      logError('ApiService', 'Health check failed', error as Error);
      throw error;
    }
  }

  // ─── Audit Logs (Admin) ──────────────────────────────────────────────────

  public async getAuditLogs(params: {
    userId?: string;
    action?: string;
    entity?: string;
    entityId?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortDirection?: string;
  }): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.append(key, String(value));
    });
    return this.request(`/audit-logs?${query.toString()}`);
  }

  public async getAuditLogActions(): Promise<string[]> {
    return this.request('/audit-logs/actions');
  }

  public async deleteAuditLog(id: string): Promise<void> {
    await this.request<void>(`/audit-logs/${id}`, { method: 'DELETE' });
  }

  public async deleteAuditLogsBulk(ids: string[]): Promise<{ deletedCount: number }> {
    return this.request('/audit-logs/delete-bulk', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  public async purgeAuditLogs(before: string, filters?: { action?: string; entity?: string; userId?: string }): Promise<{ deletedCount: number }> {
    return this.request('/audit-logs/purge', {
      method: 'POST',
      body: JSON.stringify({ before, ...filters }),
    });
  }

  public async exportAuditLogs(format: 'csv' | 'json', filters?: Record<string, string>): Promise<void> {
    const query = new URLSearchParams({ format });
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) query.append(key, value);
      });
    }
    const url = `${API_BASE_URL}/audit-logs/export?${query.toString()}`;
    const token = localStorage.getItem('token');
    const response = await fetch(url, {
      headers: {
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename="?(.+?)"?$/);
    const filename = filenameMatch ? filenameMatch[1] : `audit-logs.${format}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // ─── Collections ──────────────────────────────────────────────────────────

  public async getCollections(): Promise<any[]> {
    return this.request('/collections');
  }

  public async getDefaultCollection(): Promise<any> {
    return this.request('/collections/default');
  }

  public async getCollection(id: string): Promise<any> {
    return this.request(`/collections/${id}`);
  }

  public async getCollectionStats(id: string): Promise<{
    cardCount: number;
    totalValue: number;
    totalCost: number;
    categoryBreakdown: { [category: string]: number };
  }> {
    return this.request(`/collections/${id}/stats`);
  }

  public async createCollection(data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    visibility?: string;
    tags?: string[];
  }): Promise<any> {
    return this.request('/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateCollection(id: string, data: {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    visibility?: string;
    tags?: string[];
  }): Promise<any> {
    return this.request(`/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async deleteCollection(id: string): Promise<void> {
    await this.request<void>(`/collections/${id}`, {
      method: 'DELETE',
    });
  }

  public async setCollectionAsDefault(id: string): Promise<any> {
    return this.request(`/collections/${id}/set-default`, {
      method: 'POST',
    });
  }

  public async moveCardsToCollection(cardIds: string[], targetCollectionId: string): Promise<{ moved: number }> {
    return this.request('/collections/move-cards', {
      method: 'POST',
      body: JSON.stringify({ cardIds, targetCollectionId }),
    });
  }

  public async initializeCollections(): Promise<any> {
    return this.request('/collections/initialize', {
      method: 'POST',
    });
  }

  // ─── Admin User Management ─────────────────────────────────────────────

  public async getAdminUsers(): Promise<AdminUser[]> {
    return this.request('/admin/users');
  }

  public async getAdminUser(id: string): Promise<AdminUser> {
    return this.request(`/admin/users/${id}`);
  }

  public async createAdminUser(data: {
    username: string;
    email: string;
    password: string;
    role?: 'admin' | 'user';
  }): Promise<AdminUser> {
    return this.request('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateAdminUser(id: string, data: {
    username?: string;
    email?: string;
  }): Promise<AdminUser> {
    return this.request(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async resetAdminUserPassword(id: string, password: string): Promise<{ message: string }> {
    return this.request(`/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  public async toggleAdminUserStatus(id: string): Promise<AdminUser> {
    return this.request(`/admin/users/${id}/toggle-status`, {
      method: 'POST',
    });
  }

  public async changeAdminUserRole(id: string, role: 'admin' | 'user'): Promise<AdminUser> {
    return this.request(`/admin/users/${id}/change-role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  public async deleteAdminUser(id: string): Promise<void> {
    await this.request<void>(`/admin/users/${id}`, {
      method: 'DELETE',
    });
  }

  // ─── Grading Submissions ──────────────────────────────────────────────────

  public async getGradingSubmissions(filters?: { status?: string; cardId?: string }): Promise<GradingSubmission[]> {
    const query = new URLSearchParams();
    if (filters?.status) query.append('status', filters.status);
    if (filters?.cardId) query.append('cardId', filters.cardId);
    const qs = query.toString();
    return this.request(`/grading-submissions${qs ? `?${qs}` : ''}`);
  }

  public async getGradingSubmission(id: string): Promise<GradingSubmission> {
    return this.request(`/grading-submissions/${id}`);
  }

  public async getGradingStats(): Promise<GradingStats> {
    return this.request('/grading-submissions/stats');
  }

  public async createGradingSubmission(data: GradingSubmissionInput): Promise<GradingSubmission> {
    return this.request('/grading-submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateGradingSubmission(id: string, data: Partial<GradingSubmissionInput>): Promise<GradingSubmission> {
    return this.request(`/grading-submissions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async updateGradingSubmissionStatus(id: string, status: string, grade?: string): Promise<GradingSubmission> {
    return this.request(`/grading-submissions/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, ...(grade ? { grade } : {}) }),
    });
  }

  public async deleteGradingSubmission(id: string): Promise<void> {
    await this.request<void>(`/grading-submissions/${id}`, {
      method: 'DELETE',
    });
  }

  // ─── Storage ───────────────────────────────────────────────────────────────

  public async getStorageLocations(): Promise<{ room: string; shelf: string; box: string; cardCount: number }[]> {
    return this.request('/storage/locations');
  }

  public async getCardsByStorage(filters: { room?: string; shelf?: string; box?: string }): Promise<Card[]> {
    const query = new URLSearchParams();
    if (filters.room) query.append('room', filters.room);
    if (filters.shelf) query.append('shelf', filters.shelf);
    if (filters.box) query.append('box', filters.box);
    const qs = query.toString();
    const cards = await this.request<Card[]>(`/storage/cards${qs ? `?${qs}` : ''}`);
    return cards.map(card => ({
      ...card,
      purchaseDate: new Date(card.purchaseDate),
      sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
      createdAt: new Date(card.createdAt),
      updatedAt: new Date(card.updatedAt),
    }));
  }

  public async updateCardStorage(cardId: string, location: StorageLocation | null): Promise<Card> {
    const card = await this.request<Card>(`/storage/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify({ location }),
    });
    return {
      ...card,
      purchaseDate: new Date(card.purchaseDate),
      sellDate: card.sellDate ? new Date(card.sellDate) : undefined,
      createdAt: new Date(card.createdAt),
      updatedAt: new Date(card.updatedAt),
    };
  }

  public async bulkAssignStorage(cardIds: string[], location: StorageLocation): Promise<{ updated: number }> {
    return this.request('/storage/bulk-assign', {
      method: 'POST',
      body: JSON.stringify({ cardIds, location }),
    });
  }

  // ─── Price Alerts ─────────────────────────────────────────────────────

  public async getPriceAlerts(): Promise<PriceAlert[]> {
    return this.request('/price-alerts');
  }

  public async getPriceAlertsByCard(cardId: string): Promise<PriceAlert[]> {
    return this.request(`/price-alerts/card/${cardId}`);
  }

  public async createPriceAlert(data: { cardId: string; type: 'above' | 'below'; thresholdLow?: number; thresholdHigh?: number }): Promise<PriceAlert> {
    return this.request('/price-alerts', { method: 'POST', body: JSON.stringify(data) });
  }

  public async updatePriceAlert(id: string, data: Partial<Pick<PriceAlert, 'type' | 'thresholdLow' | 'thresholdHigh' | 'isEnabled'>>): Promise<PriceAlert> {
    return this.request(`/price-alerts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  public async deletePriceAlert(id: string): Promise<void> {
    return this.request(`/price-alerts/${id}`, { method: 'DELETE' });
  }

  public async checkPriceAlerts(): Promise<{ triggered: number; checked: number }> {
    return this.request('/price-alerts/check', { method: 'POST' });
  }

  public async getPriceAlertHistory(): Promise<(PriceAlertHistoryEntry & { player: string })[]> {
    return this.request('/price-alerts/history');
  }
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  isActive: boolean;
  profilePhoto: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GradingSubmission {
  id: string;
  userId: string;
  cardId: string;
  gradingCompany: string;
  submissionNumber: string;
  status: string;
  tier: string;
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
  gradingCompany: string;
  submissionNumber: string;
  tier: string;
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

// ─── Heatmap Types ───────────────────────────────────────────────────────

export interface HeatmapApiCard {
  id: string;
  player: string;
  team: string;
  year: number;
  brand: string;
  category: string;
  cardNumber: string;
  isGraded: boolean;
  currentValue: number;
  periodStartValue: number | null;
  purchasePrice: number;
}

export interface HeatmapResponse {
  period: string;
  periodStartDate: string | null;
  cards: HeatmapApiCard[];
}

// ─── Comp Types ───────────────────────────────────────────────────────────

export type CompSource = 'SportsCardsPro' | 'eBay' | 'CardLadder' | 'MarketMovers';

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

export type PopRarityTier = 'ultra-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface PopulationData {
  gradingCompany: string;
  totalGraded: number;
  gradeBreakdown: { grade: string; count: number }[];
  targetGrade: string;
  targetGradePop: number;
  higherGradePop: number;
  percentile: number;
  rarityTier: PopRarityTier;
  fetchedAt: string;
}

export interface EbayExportDraftSummary {
  id: string;
  filename: string;
  totalCards: number;
  skippedPcCards: number;
  totalListingValue: number;
  compPricedCards: number;
  options: Record<string, unknown>;
  cardSummary: { cardId: string; player: string; price: number; priceSource: string }[];
  generatedAt: string;
  createdAt: string;
}

export const apiService = new ApiService();
export default apiService;