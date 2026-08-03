import Database from '../database';
import { CompRequest, CompResult, CompSource } from '../types';

class CompCacheService {
  private db: Database;
  private ttlMs: number;

  constructor(db: Database, ttlMs: number = 86400000) {
    this.db = db;
    this.ttlMs = ttlMs;
  }

  buildCacheKey(source: CompSource, request: CompRequest): string {
    const parts = [
      source,
      request.player.toLowerCase().trim(),
      String(request.year),
      request.brand.toLowerCase().trim(),
      request.cardNumber.trim(),
      (request.condition || '').toLowerCase().trim(),
      request.isGraded ? '1' : '0',
      (request.gradingCompany || '').toUpperCase().trim(),
      (request.grade || '').trim(),
    ];
    return parts.join('|');
  }

  get(source: CompSource, request: CompRequest): CompResult | null {
    const key = this.buildCacheKey(source, request);
    const row = this.db.getCompCache(key);

    if (!row) return null;

    const now = new Date().toISOString();
    if (row.expiresAt <= now) return null;

    return row.result as unknown as CompResult;
  }

  set(source: CompSource, request: CompRequest, result: CompResult): void {
    const key = this.buildCacheKey(source, request);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    this.db.setCompCache(key, source, result as unknown as Record<string, unknown>, now.toISOString(), expiresAt.toISOString());
  }

  purgeExpired(): number {
    const now = new Date().toISOString();
    return this.db.purgeCompCache(now);
  }
}

export default CompCacheService;
