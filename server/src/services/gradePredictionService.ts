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

/** A single identified defect — TAG DIG-report style inventory entry. */
export interface CardDefect {
  side: 'front' | 'back';
  area: 'corner' | 'edge' | 'surface';
  /** eg. "top-left corner", "bottom edge", "center" */
  location: string;
  /** eg. whitening | fray | ding | pit | scratch | print-line | crease | stain */
  type: string;
  severity: 'minor' | 'moderate' | 'severe';
  description: string;
  /** Evidence crop saved to the analysis dir, served via /api/files/analysis/. */
  cropFile?: string;
}

export interface ConditionAssessment {
  corners: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  cornerNotes: string;
  edges: { top: number; bottom: number; left: number; right: number };
  edgeNotes: string;
  surface: number;
  surfaceNotes: string;
  defects: CardDefect[];
}

export interface GradePrediction {
  predictedAt: string;
  model: string;
  frontCentering: CenteringResult;
  backCentering: CenteringResult | null;
  condition: ConditionAssessment | null;
  backCondition: ConditionAssessment | null;
  defects: CardDefect[];
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

  // A real printed frame is a continuous line across the card; strong
  // gradients from artwork (full-art/borderless designs) are patchy. Require
  // the detected frame line to be strong in most segments of the band, so a
  // design element can't masquerade as a border and produce fake centering.
  const LINE_SEGMENTS = 6;
  const rowLineConsistent = (y: number, x0: number, x1: number): boolean => {
    const step = Math.floor((x1 - x0) / LINE_SEGMENTS);
    if (step < 6) return true;
    let ok = 0;
    for (let s = 0; s < LINE_SEGMENTS; s++) {
      const sx = x0 + s * step;
      if (rowGradient(img, y, sx, sx + step) >= 6) ok++;
    }
    return ok >= LINE_SEGMENTS - 1;
  };
  const colLineConsistent = (x: number, y0: number, y1: number): boolean => {
    const step = Math.floor((y1 - y0) / LINE_SEGMENTS);
    if (step < 6) return true;
    let ok = 0;
    for (let s = 0; s < LINE_SEGMENTS; s++) {
      const sy = y0 + s * step;
      if (colGradient(img, x, sy, sy + step) >= 6) ok++;
    }
    return ok >= LINE_SEGMENTS - 1;
  };

  // Each axis stands on its own: a card edge lost in holder shadow on one
  // side (common for dark borders) shouldn't void the measurable axis.
  const EDGE_MIN = 6, FRAME_MIN = 8;
  const mL = frameL.pos - edgeL.pos;
  const mR = edgeR.pos - frameR.pos;
  const mT = frameT.pos - edgeT.pos;
  const mB = edgeB.pos - frameB.pos;

  const lrOk = edgeL.strength >= EDGE_MIN && edgeR.strength >= EDGE_MIN &&
    frameL.strength >= FRAME_MIN && frameR.strength >= FRAME_MIN && mL > 0 && mR > 0 &&
    colLineConsistent(frameL.pos, bandY0, bandY1) && colLineConsistent(frameR.pos, bandY0, bandY1);
  const tbOk = edgeT.strength >= EDGE_MIN && edgeB.strength >= EDGE_MIN &&
    frameT.strength >= FRAME_MIN && frameB.strength >= FRAME_MIN && mT > 0 && mB > 0 &&
    rowLineConsistent(frameT.pos, bandX0, bandX1) && rowLineConsistent(frameB.pos, bandX0, bandX1);

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

  // Readings worse than 80/20 are rare on factory-cut cards; more often the
  // scan captured a card shifted inside its holder, or the frame search
  // locked onto a design element. Keep the numbers but flag them.
  const extreme = Math.max(result.worstLR ?? 0, result.worstTB ?? 0) > 80;
  if (extreme) {
    result.note = [result.note, 'Extreme ratio — verify manually (possible holder offset or frame misdetection)']
      .filter(Boolean).join('; ');
  }
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
  private async assessCondition(
    imgPath: string,
    bounds: CardBounds,
    side: 'front' | 'back',
    cardId: string
  ): Promise<ConditionAssessment | null> {
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
    const cropBuffers = new Map<string, Buffer>();
    for (const c of crops) {
      // fit: 'inside' bounds BOTH dimensions — a tall narrow edge strip
      // resized by width alone can exceed the API's 8000px image limit.
      const buf = await sharp(imgPath).extract(c.r)
        .resize({ width: 400, height: 1000, fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 90 }).toBuffer();
      cropBuffers.set(c.label, buf);
      content.push({ type: 'text', text: c.label + ':' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });
    }
    // Full card for surface context, downscaled
    const full = await sharp(imgPath).extract(region(bounds.left, bounds.top, w, h)).resize({ width: 700 }).jpeg({ quality: 85 }).toBuffer();
    cropBuffers.set('full card', full);
    content.push({ type: 'text', text: 'full card:' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: full.toString('base64') } });
    content.push({
      type: 'text',
      text: `You are assessing the ${side.toUpperCase()} of a trading card from scan close-ups. Score each area 1-10 where 10 = flawless for grading purposes (sharp corner / clean edge / clean surface) and lower = visible wear. Scans hide some surface issues, so score only what is visible.

IMPORTANT — the card may be inside a clear protective holder (top-loader, one-touch, screw-down case). Score the CARD only. Do NOT count against the card: scratches, scuffs, dust, haze, glare, or reflections on the holder plastic; the holder's own edges, corners, or screw posts; shadows cast by the holder. Holder plastic often sits 1-3mm outside the card edge — wear visible on that outer boundary belongs to the holder, not the card. If you cannot tell whether a flaw is on the holder or the card, do not count it and do not list it as a defect; mention the uncertainty in the notes instead.

Also list each individual visible defect. Allowed values: area = corner | edge | surface; location = one of "top-left corner", "top-right corner", "bottom-left corner", "bottom-right corner", "top edge", "bottom edge", "left edge", "right edge", or a brief surface position like "center" / "upper right area"; type = whitening | fray | ding | pit | scratch | print-line | crease | stain | chip | other; severity = minor | moderate | severe. Only include defects you can actually see — an empty list is a valid answer.

Respond with ONLY this JSON:
{"corners":{"topLeft":n,"topRight":n,"bottomLeft":n,"bottomRight":n},"cornerNotes":"...","edges":{"top":n,"bottom":n,"left":n,"right":n},"edgeNotes":"...","surface":n,"surfaceNotes":"...","defects":[{"area":"corner","location":"top-left corner","type":"whitening","severity":"minor","description":"..."}]}`,
    });

    const response = await this.getClient().messages.create({
      model: VISION_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });
    const text = response.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    try {
      const m = text.text.match(/\{[\s\S]+\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]) as ConditionAssessment;
      parsed.defects = Array.isArray(parsed.defects) ? parsed.defects : [];

      // Save an evidence crop per defect: the matching close-up when the
      // location names a corner/edge, else the full-card context image.
      const analysisDir = this.fileService.getAnalysisDir();
      const idShort = cardId.slice(0, 8);
      parsed.defects = parsed.defects.map((d, i) => {
        const buf = cropBuffers.get(d.location) || cropBuffers.get('full card');
        const defect: CardDefect = { ...d, side };
        if (buf) {
          const cropFile = `defect-${idShort}-${side}-${i + 1}.jpg`;
          try {
            fs.writeFileSync(path.join(analysisDir, cropFile), buf);
            defect.cropFile = cropFile;
          } catch {
            // evidence crop is best-effort
          }
        }
        return defect;
      });
      return parsed;
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
      condition = await this.assessCondition(frontPath, frontBounds, 'front', cardId);
    }

    // Back: centering + condition (best-effort)
    let backCentering: CenteringResult | null = null;
    let backCondition: ConditionAssessment | null = null;
    if (back) {
      const backPath = this.imagePath(back);
      if (fs.existsSync(backPath)) {
        const backBounds = await this.locateCard(backPath);
        if (backBounds) {
          backCentering = measureCentering(await loadGray(backPath), backBounds);
          backCondition = await this.assessCondition(backPath, backBounds, 'back', cardId);
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

    // Back wear caps the grade one step more leniently than front wear —
    // graders weight the front, but a chewed back corner still kills a gem.
    const factorCap = (front: number | undefined, backScore: number | undefined): number => {
      const f = front ?? 10;
      const b = backScore !== undefined ? Math.min(10, backScore + 1) : 10;
      return Math.min(f, b);
    };
    const minOf = (obj: Record<string, number> | undefined): number | undefined =>
      obj ? Math.min(...Object.values(obj)) : undefined;

    const caps = {
      centering: capCentering,
      corners: factorCap(minOf(condition?.corners), minOf(backCondition?.corners)),
      edges: factorCap(minOf(condition?.edges), minOf(backCondition?.edges)),
      surface: factorCap(condition?.surface, backCondition?.surface),
    };
    const defects: CardDefect[] = [
      ...(condition?.defects || []),
      ...(backCondition?.defects || []),
    ];
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
    const defectDesc = defects.length > 0
      ? `${defects.length} defect${defects.length === 1 ? '' : 's'} identified`
      : 'no notable defects visible';
    const summary = `Ceiling ${ceiling} (limited by ${limiting[0]}); ${centeringDesc}; ${defectDesc}. Scan-based estimate — surface issues may be hidden; verify before submitting.`;

    const prediction: GradePrediction = {
      predictedAt: new Date().toISOString(),
      model: VISION_MODEL,
      frontCentering,
      backCentering,
      condition,
      backCondition,
      defects,
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
