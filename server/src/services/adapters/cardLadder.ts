import { CompAdapter, CompRequest, CompResult, CompSource, CompSale } from '../../types';
import CompCacheService from '../compCacheService';

const FIREBASE_API_KEY = 'AIzaSyBqbxgaaGlpeb1F6HRvEW319OcuCsbkAHM';
const FIRESTORE_PROJECT = 'cardladder-71d53';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;

// ─── Firebase Auth ─────────────────────────────────────────────────────────

interface FirebaseAuthTokens {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedTokens: FirebaseAuthTokens | null = null;

async function getFirebaseToken(email: string, password: string): Promise<string | null> {
  // Return cached token if still valid (with 5-min buffer)
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 300_000) {
    return cachedTokens.idToken;
  }

  // Try refresh first if we have a refresh token
  if (cachedTokens?.refreshToken) {
    const refreshed = await refreshFirebaseToken(cachedTokens.refreshToken);
    if (refreshed) return refreshed;
  }

  // Full sign-in
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
  };

  cachedTokens = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + parseInt(data.expiresIn) * 1000,
  };

  return data.idToken;
}

async function refreshFirebaseToken(refreshToken: string): Promise<string | null> {
  const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
  });

  if (!res.ok) {
    cachedTokens = null;
    return null;
  }

  const data = await res.json() as {
    id_token: string;
    refresh_token: string;
    expires_in: string;
  };

  cachedTokens = {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + parseInt(data.expires_in) * 1000,
  };

  return data.id_token;
}

// ─── Firestore helpers ─────────────────────────────────────────────────────

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { nullValue: null };

function extractValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      result[k] = extractValue(v);
    }
    return result;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(extractValue);
  }
  return null;
}

interface CardLadderCard {
  player: string;
  year: number;
  set: string;
  number: string;
  condition: string;
  variation: string;
  gradingCompany: string | null;
  currentValue: number;
  numSales: number;
  dailySales: Record<string, { p: number; n: number }>;
  category: string;
  label: string;
}

function docToCard(fields: Record<string, FirestoreValue>): CardLadderCard {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    raw[k] = extractValue(v);
  }
  return {
    player: (raw.player as string) || '',
    year: Number(raw.year) || 0,
    set: (raw.set as string) || '',
    number: (raw.number as string) || '',
    condition: (raw.condition as string) || '',
    variation: (raw.variation as string) || '',
    gradingCompany: (raw.gradingCompany as string) || null,
    currentValue: Number(raw.currentValue) || 0,
    numSales: Number(raw.numSales) || 0,
    dailySales: (raw.dailySales as Record<string, { p: number; n: number }>) || {},
    category: (raw.category as string) || '',
    label: (raw.label as string) || '',
  };
}

// ─── Card matching ─────────────────────────────────────────────────────────

function scoreMatch(card: CardLadderCard, request: CompRequest): number {
  let score = 0;

  // Year must match
  if (card.year !== request.year) return -1;

  // Player already matched by Firestore query
  score += 10;

  // Card number match
  if (card.number.toLowerCase() === request.cardNumber.toLowerCase()) {
    score += 20;
  }

  // Set/brand match
  const cardSet = card.set.toLowerCase();
  const brand = request.brand.toLowerCase();
  const setName = (request.setName || '').toLowerCase();
  if (cardSet.includes(brand)) score += 5;
  if (setName && cardSet.includes(setName)) score += 10;

  // Parallel/variation match
  if (request.parallel) {
    const variation = card.variation.toLowerCase();
    if (variation.includes(request.parallel.toLowerCase())) score += 10;
  } else if (card.variation.toLowerCase() === 'base' || card.variation === '') {
    score += 5;
  }

  // Condition match — prefer matching condition
  if (request.isGraded && request.gradingCompany && request.grade) {
    const wantCondition = `${request.gradingCompany} ${request.grade}`.toLowerCase();
    if (card.condition.toLowerCase() === wantCondition) score += 15;
    else if (card.condition.toLowerCase().includes(request.gradingCompany.toLowerCase())) score += 5;
  } else {
    // Raw card — graded index entries price a different asset; make them
    // ineligible rather than merely less-preferred, so a graded entry can
    // never win when no raw entry exists.
    if (card.condition.toLowerCase() === 'raw') {
      score += 15;
    } else {
      return -1;
    }
  }

  return score;
}

// ─── Extract recent sales from dailySales map ──────────────────────────────

function extractRecentSales(dailySales: Record<string, { p: number; n: number }>, limit: number = 15): CompSale[] {
  const entries = Object.entries(dailySales)
    .map(([dateStr, data]) => ({
      date: dateStr,
      price: data.p,
      sortKey: new Date(dateStr).getTime(),
    }))
    .filter(e => !isNaN(e.sortKey) && e.price > 0)
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit);

  return entries.map(e => ({
    date: e.date,
    price: Math.round(e.price * 100) / 100,
    venue: 'Card Ladder',
  }));
}

// ─── Adapter ───────────────────────────────────────────────────────────────

function buildSearchQuery(request: CompRequest): string {
  const parts: string[] = [String(request.year), request.brand];
  if (request.setName) parts.push(request.setName);
  parts.push(request.player, request.cardNumber);
  return parts.join(' ');
}

class CardLadderAdapter implements CompAdapter {
  public readonly source: CompSource = 'CardLadder';
  private cacheService?: CompCacheService;

  constructor(_browserService?: unknown, cacheService?: CompCacheService) {
    this.cacheService = cacheService;
  }

  async fetchComps(request: CompRequest): Promise<CompResult> {
    // Check cache first
    if (this.cacheService) {
      const cached = this.cacheService.get(this.source, request);
      if (cached) return cached;
    }

    const email = process.env.CARDLADDER_EMAIL;
    const password = process.env.CARDLADDER_PASSWORD;
    if (!email || !password) {
      return {
        source: this.source,
        marketValue: null,
        sales: [],
        averagePrice: null,
        low: null,
        high: null,
        error: 'Card Ladder credentials not configured (set CARDLADDER_EMAIL and CARDLADDER_PASSWORD)',
      };
    }

    try {
      // Authenticate
      const idToken = await getFirebaseToken(email, password);
      if (!idToken) {
        return {
          source: this.source,
          marketValue: null,
          sales: [],
          averagePrice: null,
          low: null,
          high: null,
          error: 'Card Ladder authentication failed',
        };
      }

      // Query Firestore for cards by player
      const queryUrl = `${FIRESTORE_BASE}:runQuery`;
      const res = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'cards' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'player' },
                op: 'EQUAL',
                value: { stringValue: request.player },
              },
            },
            limit: 500,
          },
        }),
      });

      if (!res.ok) {
        return {
          source: this.source,
          marketValue: null,
          sales: [],
          averagePrice: null,
          low: null,
          high: null,
          error: `Card Ladder query failed: HTTP ${res.status}`,
        };
      }

      const results = await res.json() as Array<{ document?: { fields: Record<string, FirestoreValue> } }>;

      // Filter for documents and convert
      const cards = results
        .filter(r => r.document?.fields)
        .map(r => docToCard(r.document!.fields));

      if (cards.length === 0) {
        const query = buildSearchQuery(request);
        return {
          source: this.source,
          marketValue: null,
          sales: [],
          averagePrice: null,
          low: null,
          high: null,
          error: `No Card Ladder results found for: ${query}`,
        };
      }

      // Score and pick best match
      const scored = cards
        .map(card => ({ card, score: scoreMatch(card, request) }))
        .filter(s => s.score >= 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        const query = buildSearchQuery(request);
        return {
          source: this.source,
          marketValue: null,
          sales: [],
          averagePrice: null,
          low: null,
          high: null,
          error: `No matching Card Ladder card found for: ${query}`,
        };
      }

      const bestCard = scored[0].card;
      const marketValue = Math.round(bestCard.currentValue * 100) / 100;
      const sales = extractRecentSales(bestCard.dailySales);
      const prices = sales.map(s => s.price);

      let averagePrice: number | null = null;
      let low: number | null = null;
      let high: number | null = null;

      if (prices.length > 0) {
        averagePrice = Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100;
        low = Math.round(Math.min(...prices) * 100) / 100;
        high = Math.round(Math.max(...prices) * 100) / 100;
      } else {
        averagePrice = marketValue;
      }

      const result: CompResult = {
        source: this.source,
        marketValue,
        sales,
        averagePrice,
        low,
        high,
      };

      // Cache successful result
      if (this.cacheService) {
        this.cacheService.set(this.source, request, result);
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        source: this.source,
        marketValue: null,
        sales: [],
        averagePrice: null,
        low: null,
        high: null,
        error: `Card Ladder error: ${message}`,
      };
    }
  }
}

export default CardLadderAdapter;
export { buildSearchQuery, scoreMatch, extractRecentSales, getFirebaseToken, docToCard };

// Allow tests to reset cached tokens
export function _resetTokenCache(): void {
  cachedTokens = null;
}
