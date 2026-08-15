import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import FileService from './fileService';
import Database from '../database';
import { Card } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CenteringResult {
  measurable: boolean;
  /** Left/right split as percentages summing to 100, larger side first (eg. 62/38). */
  leftRight?: { left: number; right: number };
  topBottom?: { top: number; bottom: number };
  /** Worst-side percentage used against grading thresholds (eg. 62). */
  worstLR?: number;
  worstTB?: number;
  /** Pixel margins measured between card edge and printed frame. */
  marginsPx?: { left: number; right: number; top: number; bottom: number };
  note?: string;
}

export interface ConditionAssessment {
  corners: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  cornerNotes: string;
  edges: { top: number; bottom: number; left: number; right: number };
  edgeNotes: string;
  surface: number;
  surfaceNotes: string;
}

export interface GradePrediction {
  predictedAt: string;
  model: string;
  frontCentering: CenteringResult;
  backCentering: CenteringResult | null;
  condition: ConditionAssessment | null;
  caps: { centering: number; corners: number; edges: number; surface: number };
  /** Best grade this card could plausibly achieve (a ceiling — scans hide surface issues). */
  ceiling: number;
  /** Conservative range presented to the user, eg. "6-8". */
  estimatedRange: string;
  summary: string;
}

// PSA-style front centering thresholds: worst-side percentage → max grade.
const FRONT_CENTERING_CAPS: Array<[number, number]> = [
  [55, 10], [60, 9], [65, 8], [70, 7], [75, 6], [80, 5], [85, 4],
];

function centeringCap(worstFront: number | undefined, worstBack: number | undefined): number {
  let cap = 10;
  if (worstFront !== undefined) {
    cap = 3; // worse than every threshold
    for (const [limit, grade] of FRONT_CENTERING_CAPS) {
      if (worstFront <= limit) { cap = grade; break; }
    }
  }
  // Back centering is far more forgiving: 75/25 for a 10, ~90/10 below that.
  if (worstBack !== undefined) {
    if (worstBack > 90) cap = Math.min(cap, 7);
    else if (worstBack > 75) cap = Math.min(cap, 9);
  }
  return cap;
}

// ─── Pixel analysis ──────────────────────────────────────────────────────────

interface GrayImage { data: Buffer; width: number; height: number }

async function loadGray(imagePath: string): Promise<GrayImage> {
  const { data, info } = await sharp(imagePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Mean absolute horizontal luminance gradient at column x over [y0, y1).
 * Strong vertical lines (card edge, printed frame) produce peaks.
 */
function colGradient(img: GrayImage, x: number, y0: number, y1: number): number {
  if (x < 0 || x + 1 >= img.width) return 0;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 2) {
    const i = y * img.width + x;
    sum += Math.abs(img.data[i + 1] - img.data[i]);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function rowGradient(img: GrayImage, y: number, x0: number, x1: number): number {
  if (y < 0 || y + 1 >= img.height) return 0;
  let sum = 0, n = 0;
  for (let x = x0; x < x1; x += 2) {
    sum += Math.abs(img.data[(y + 1) * img.width + x] - img.data[y * img.width + x]);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Position of the strongest gradient peak within [from, to] (inclusive, either direction). */
function strongestPeak(profile: (pos: number) => number, from: number, to: number): { pos: number; strength: number } {
  const step = from <= to ? 1 : -1;
  let best = { pos: from, strength: -1 };
  for (let p = from; step > 0 ? p <= to : p >= to; p += step) {
    const s = profile(p);
    if (s > best.strength) best = { pos: p, strength: s };
  }
  return best;
}

/**
 * The card edge is the OUTERMOST strong line near the approximate position —
 * not necessarily the strongest (a bold printed frame can out-gradient the
 * cut edge). Scan from the outside in and take the first qualifying peak:
 * a local maximum at least 40% as strong as the window's best (floor 8).
 */
function outermostEdge(
  profile: (pos: number) => number,
  outside: number,
  inside: number
): { pos: number; strength: number } {
  const step = outside <= inside ? 1 : -1;
  let windowMax = 0;
  for (let p = outside; step > 0 ? p <= inside : p >= inside; p += step) {
    windowMax = Math.max(windowMax, profile(p));
  }
  const qualify = Math.max(8, windowMax * 0.4);
  for (let p = outside; step > 0 ? p <= inside : p >= inside; p += step) {
    const s = profile(p);
    if (s >= qualify && s >= profile(p - step) && s >= profile(p + step)) {
      return { pos: p, strength: s };
    }
  }
  return strongestPeak(profile, outside, inside);
}

export interface CardBounds { left: number; top: number; right: number; bottom: number }

/**
 * Measure centering: refine the card's outer edges near the vision-supplied
 * bounds, then locate the printed frame line inward of each edge. Margins
 * (edge → frame) yield the centering ratios.
 */
export function measureCentering(img: GrayImage, approx: CardBounds): CenteringResult {
  const w = approx.right - approx.left;
  const h = approx.bottom - approx.top;
  if (w < 100 || h < 100) return { measurable: false, note: 'Card bounds too small to measure' };

  // Tight window: the vision bbox is typically within ~1.5% of the true
  // edge, and a wide window risks including the holder lip or printed frame.
  const pad = Math.round(Math.min(w, h) * 0.025);
  // Central bands avoid corners (rounded) and design intrusions.
  const bandY0 = approx.top + Math.round(h * 0.25);
  const bandY1 = approx.bottom - Math.round(h * 0.25);
  const bandX0 = approx.left + Math.round(w * 0.25);
  const bandX1 = approx.right - Math.round(w * 0.25);

  // 1. Refine card edges: outermost qualifying line near each approx edge.
  const edgeL = outermostEdge(x => colGradient(img, x, bandY0, bandY1), Math.max(0, approx.left - pad), approx.left + pad);
  const edgeR = outermostEdge(x => colGradient(img, x, bandY0, bandY1), Math.min(img.width - 2, approx.right + pad), approx.right - pad);
  const edgeT = outermostEdge(y => rowGradient(img, y, bandX0, bandX1), Math.max(0, approx.top - pad), approx.top + pad);
  const edgeB = outermostEdge(y => rowGradient(img, y, bandX0, bandX1), Math.min(img.height - 2, approx.bottom + pad), approx.bottom - pad);

  const cardW = edgeR.pos - edgeL.pos;
  const cardH = edgeB.pos - edgeT.pos;
  if (cardW < 100 || cardH < 100) return { measurable: false, note: 'Could not refine card edges' };

  // 2. Find the printed frame line inward of each edge. Search from just
  //    inside the edge (skip its own gradient) to 18% of the card span.
  const skip = Math.max(3, Math.round(Math.min(cardW, cardH) * 0.012));
  const reach = Math.round(Math.min(cardW, cardH) * 0.18);

  const frameL = strongestPeak(x => colGradient(img, x, bandY0, bandY1), edgeL.pos + skip, edgeL.pos + reach);
  const frameR = strongestPeak(x => colGradient(img, x, bandY0, bandY1), edgeR.pos - skip, edgeR.pos - reach);
  const frameT = strongestPeak(y => rowGradient(img, y, bandX0, bandX1), edgeT.pos + skip, edgeT.pos + reach);
  const frameB = strongestPeak(y => rowGradient(img, y, bandX0, bandX1), edgeB.pos - skip, edgeB.pos - reach);

  // Each axis stands on its own: a card edge lost in holder shadow on one
  // side (common for dark borders) shouldn't void the measurable axis.
  const EDGE_MIN = 6, FRAME_MIN = 8;
  const mL = frameL.pos - edgeL.pos;
  const mR = edgeR.pos - frameR.pos;
  const mT = frameT.pos - edgeT.pos;
  const mB = edgeB.pos - frameB.pos;

  const lrOk = edgeL.strength >= EDGE_MIN && edgeR.strength >= EDGE_MIN &&
    frameL.strength >= FRAME_MIN && frameR.strength >= FRAME_MIN && mL > 0 && mR > 0;
  const tbOk = edgeT.strength >= EDGE_MIN && edgeB.strength >= EDGE_MIN &&
    frameT.strength >= FRAME_MIN && frameB.strength >= FRAME_MIN && mT > 0 && mB > 0;

  if (!lrOk && !tbOk) {
    return { measurable: false, note: 'No consistent printed frame detected (borderless/full-bleed design?)' };
  }

  const result: CenteringResult = {
    measurable: true,
    marginsPx: { left: mL, right: mR, top: mT, bottom: mB },
  };
  if (lrOk) {
    const leftPct = Math.round((mL / (mL + mR)) * 1000) / 10;
    result.leftRight = { left: leftPct, right: Math.round((100 - leftPct) * 10) / 10 };
    result.worstLR = Math.max(leftPct, 100 - leftPct);
  }
  if (tbOk) {
    const topPct = Math.round((mT / (mT + mB)) * 1000) / 10;
    result.topBottom = { top: topPct, bottom: Math.round((100 - topPct) * 10) / 10 };
    result.worstTB = Math.max(topPct, 100 - topPct);
  }
  if (!lrOk) result.note = 'Left/right axis not measurable (weak edge or frame contrast)';
  if (!tbOk) result.note = 'Top/bottom axis not measurable (weak edge or frame contrast)';
  return result;
}

// ─── Service ─────────────────────────────────────────────────────────────────

const VISION_MODEL = 'claude-sonnet-5';

class GradePredictionService {
  private client: Anthropic | null = null;

  constructor(
    private db: Database,
    private fileService: FileService,
    apiKey?: string
  ) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (key) this.client = new Anthropic({ apiKey: key, maxRetries: 3 });
  }

  private getClient(): Anthropic {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY is required for grade prediction');
    return this.client;
  }

  private imagePath(filename: string): string {
    return path.join(this.fileService.getProcessedDir(), filename);
  }

  /** Ask the vision model for the pixel bbox of the physical card (excluding holder/slab). */
  private async locateCard(imgPath: string): Promise<CardBounds | null> {
    const meta = await sharp(imgPath).metadata();
    const b64 = fs.readFileSync(imgPath).toString('base64');
    const ext = path.extname(imgPath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

    const response = await this.getClient().messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          {
            type: 'text',
            text: `This ${meta.width}x${meta.height} image shows a trading card, possibly inside a clear holder or slab. Return the pixel bounding box of the physical CARD itself (the cardboard, not the holder). Respond with ONLY a JSON object: {"left": n, "top": n, "right": n, "bottom": n}`,
          },
        ],
      }],
    });

    const text = response.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    try {
      const m = text.text.match(/\{[^}]+\}/);
      if (!m) return null;
      const box = JSON.parse(m[0]);
      if ([box.left, box.top, box.right, box.bottom].some(v => typeof v !== 'number')) return null;
      return box as CardBounds;
    } catch {
      return null;
    }
  }

  /** Crop corner/edge close-ups and get a structured condition assessment. */
  private async assessCondition(imgPath: string, bounds: CardBounds): Promise<ConditionAssessment | null> {
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    const corner = Math.round(Math.min(w, h) * 0.14);
    const strip = Math.round(Math.min(w, h) * 0.07);

    const meta = await sharp(imgPath).metadata();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    const region = (left: number, top: number, width: number, height: number) => ({
      left: clamp(left, (meta.width || 1) - 2),
      top: clamp(top, (meta.height || 1) - 2),
      width: Math.min(width, (meta.width || 1) - clamp(left, (meta.width || 1) - 2)),
      height: Math.min(height, (meta.height || 1) - clamp(top, (meta.height || 1) - 2)),
    });

    const crops: Array<{ label: string; r: ReturnType<typeof region> }> = [
      { label: 'top-left corner', r: region(bounds.left, bounds.top, corner, corner) },
      { label: 'top-right corner', r: region(bounds.right - corner, bounds.top, corner, corner) },
      { label: 'bottom-left corner', r: region(bounds.left, bounds.bottom - corner, corner, corner) },
      { label: 'bottom-right corner', r: region(bounds.right - corner, bounds.bottom - corner, corner, corner) },
      { label: 'top edge', r: region(bounds.left, bounds.top, w, strip) },
      { label: 'bottom edge', r: region(bounds.left, bounds.bottom - strip, w, strip) },
      { label: 'left edge', r: region(bounds.left, bounds.top, strip, h) },
      { label: 'right edge', r: region(bounds.right - strip, bounds.top, strip, h) },
    ];

    const content: Anthropic.MessageParam['content'] = [];
    for (const c of crops) {
      const buf = await sharp(imgPath).extract(c.r).resize({ width: 400, withoutEnlargement: false }).jpeg({ quality: 90 }).toBuffer();
      content.push({ type: 'text', text: c.label + ':' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });
    }
    // Full card for surface context, downscaled
    const full = await sharp(imgPath).extract(region(bounds.left, bounds.top, w, h)).resize({ width: 700 }).jpeg({ quality: 85 }).toBuffer();
    content.push({ type: 'text', text: 'full card:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: full.toString('base64') } });
    content.push({
      type: 'text',
      text: `You are assessing trading card condition from scan close-ups. Score each area 1-10 where 10 = flawless for grading purposes (sharp corner / clean edge / clean surface) and lower = visible wear (whitening, fuzz, dings, chipping, scratches, print defects). Scans hide some surface issues, so score only what is visible.

Respond with ONLY this JSON:
{"corners":{"topLeft":n,"topRight":n,"bottomLeft":n,"bottomRight":n},"cornerNotes":"...","edges":{"top":n,"bottom":n,"left":n,"right":n},"edgeNotes":"...","surface":n,"surfaceNotes":"..."}`,
    });

    const response = await this.getClient().messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    try {
      const m = text.text.match(/\{[\s\S]+\}/);
      return m ? (JSON.parse(m[0]) as ConditionAssessment) : null;
    } catch {
      return null;
    }
  }

  async predictGrade(cardId: string): Promise<GradePrediction> {
    const card = await this.db.getCardById(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);

    const images = (card.images || []).filter(f => !f.endsWith('-comps.txt'));
    const front = images.find(f => /-front\.\w+$/.test(f)) || images[0];
    const back = images.find(f => /-back\.\w+$/.test(f));
    if (!front) throw new Error('Card has no processed images to analyze');

    const frontPath = this.imagePath(front);
    if (!fs.existsSync(frontPath)) throw new Error(`Processed image missing: ${front}`);

    // Front: locate card, measure centering, assess condition
    const frontBounds = await this.locateCard(frontPath);
    let frontCentering: CenteringResult = { measurable: false, note: 'Could not locate card in scan' };
    let condition: ConditionAssessment | null = null;
    if (frontBounds) {
      const gray = await loadGray(frontPath);
      frontCentering = measureCentering(gray, frontBounds);
      condition = await this.assessCondition(frontPath, frontBounds);
    }

    // Back centering (best-effort)
    let backCentering: CenteringResult | null = null;
    if (back) {
      const backPath = this.imagePath(back);
      if (fs.existsSync(backPath)) {
        const backBounds = await this.locateCard(backPath);
        if (backBounds) {
          backCentering = measureCentering(await loadGray(backPath), backBounds);
        }
      }
    }

    // Combine into caps — use whichever axes were measurable
    const worstOf = (c: CenteringResult | null): number | undefined => {
      if (!c || !c.measurable) return undefined;
      const vals = [c.worstLR, c.worstTB].filter((v): v is number => v !== undefined);
      return vals.length > 0 ? Math.max(...vals) : undefined;
    };
    const capCentering = centeringCap(worstOf(frontCentering), worstOf(backCentering));
    const minCorner = condition ? Math.min(...Object.values(condition.corners)) : 10;
    const minEdge = condition ? Math.min(...Object.values(condition.edges)) : 10;
    const capSurface = condition ? condition.surface : 10;

    const caps = { centering: capCentering, corners: minCorner, edges: minEdge, surface: capSurface };
    const ceiling = Math.max(1, Math.min(caps.centering, caps.corners, caps.edges, caps.surface));
    const rangeLow = Math.max(1, ceiling - 2);
    const estimatedRange = rangeLow === ceiling ? String(ceiling) : `${rangeLow}-${ceiling}`;

    const limiting = (Object.entries(caps) as Array<[string, number]>).sort((a, b) => a[1] - b[1])[0];
    const centeringParts: string[] = [];
    if (frontCentering.measurable && frontCentering.leftRight) {
      centeringParts.push(`${frontCentering.leftRight.left}/${frontCentering.leftRight.right} LR`);
    }
    if (frontCentering.measurable && frontCentering.topBottom) {
      centeringParts.push(`${frontCentering.topBottom.top}/${frontCentering.topBottom.bottom} TB`);
    }
    const centeringDesc = centeringParts.length > 0
      ? `front centering ${centeringParts.join(', ')}`
      : 'centering not measurable';
    const summary = `Ceiling ${ceiling} (limited by ${limiting[0]}); ${centeringDesc}. Scan-based estimate — surface issues may be hidden; verify before submitting.`;

    const prediction: GradePrediction = {
      predictedAt: new Date().toISOString(),
      model: VISION_MODEL,
      frontCentering,
      backCentering,
      condition,
      caps,
      ceiling,
      estimatedRange,
      summary,
    };

    await this.db.updateCardEnhancedAttribute(cardId, 'gradePrediction', prediction as unknown as Record<string, unknown>);
    return prediction;
  }
}

export default GradePredictionService;
