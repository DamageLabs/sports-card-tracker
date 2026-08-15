import { measureCentering, CardBounds } from '../../services/gradePredictionService';

/**
 * Build a synthetic grayscale "scan": light background, dark card with a
 * lighter inner design area, so both the card edge and the printed frame
 * produce strong gradient lines at known positions.
 */
function syntheticCard(opts: {
  width: number; height: number;
  card: CardBounds;
  margins: { left: number; right: number; top: number; bottom: number };
}): { data: Buffer; width: number; height: number } {
  const { width, height, card, margins } = opts;
  const data = Buffer.alloc(width * height, 230); // light background
  for (let y = card.top; y < card.bottom; y++) {
    for (let x = card.left; x < card.right; x++) {
      const inFrame =
        x >= card.left + margins.left && x < card.right - margins.right &&
        y >= card.top + margins.top && y < card.bottom - margins.bottom;
      data[y * width + x] = inFrame ? 160 : 30; // dark border, mid design
    }
  }
  return { data, width, height };
}

describe('measureCentering', () => {
  const bounds: CardBounds = { left: 100, top: 120, right: 600, bottom: 820 };

  it('measures a perfectly centered card as 50/50', () => {
    const img = syntheticCard({
      width: 700, height: 940, card: bounds,
      margins: { left: 40, right: 40, top: 50, bottom: 50 },
    });
    const r = measureCentering(img, bounds);
    expect(r.measurable).toBe(true);
    expect(r.leftRight!.left).toBeCloseTo(50, 0);
    expect(r.topBottom!.top).toBeCloseTo(50, 0);
    expect(r.worstLR).toBeLessThanOrEqual(52);
    expect(r.worstTB).toBeLessThanOrEqual(52);
  });

  it('measures an off-center card with correct ratios', () => {
    // 60/30 left/right → 66.7/33.3; 40/80 top/bottom → 33.3/66.7
    const img = syntheticCard({
      width: 700, height: 940, card: bounds,
      margins: { left: 60, right: 30, top: 40, bottom: 80 },
    });
    const r = measureCentering(img, bounds);
    expect(r.measurable).toBe(true);
    expect(r.leftRight!.left).toBeGreaterThan(63);
    expect(r.leftRight!.left).toBeLessThan(70);
    expect(r.topBottom!.top).toBeGreaterThan(30);
    expect(r.topBottom!.top).toBeLessThan(37);
    expect(r.worstLR).toBeGreaterThan(63);
    expect(r.worstTB).toBeGreaterThan(63);
  });

  it('tolerates an imprecise approximate bounding box', () => {
    const img = syntheticCard({
      width: 700, height: 940, card: bounds,
      margins: { left: 40, right: 40, top: 50, bottom: 50 },
    });
    // Vision bbox off by ~8px on every side
    const sloppy: CardBounds = { left: 108, top: 112, right: 592, bottom: 828 };
    const r = measureCentering(img, sloppy);
    expect(r.measurable).toBe(true);
    expect(r.leftRight!.left).toBeCloseTo(50, 0);
  });

  it('reports unmeasurable for a borderless (full-bleed) design', () => {
    // Uniform card interior — no frame line anywhere
    const { data, width, height } = (() => {
      const w = 700, h = 940;
      const d = Buffer.alloc(w * h, 230);
      for (let y = bounds.top; y < bounds.bottom; y++) {
        for (let x = bounds.left; x < bounds.right; x++) d[y * w + x] = 100;
      }
      return { data: d, width: w, height: h };
    })();
    const r = measureCentering({ data, width, height }, bounds);
    expect(r.measurable).toBe(false);
  });

  it('rejects bounds that are too small', () => {
    const img = syntheticCard({
      width: 700, height: 940, card: bounds,
      margins: { left: 40, right: 40, top: 50, bottom: 50 },
    });
    const r = measureCentering(img, { left: 10, top: 10, right: 60, bottom: 60 });
    expect(r.measurable).toBe(false);
  });
});
