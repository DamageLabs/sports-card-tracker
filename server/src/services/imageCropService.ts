import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export interface CropOptions {
  padding?: number;
  minDimension?: number;
  minAreaRatio?: number;
  /** Color distance threshold for background detection (0-255 Euclidean). Default 80. */
  bgColorThreshold?: number;
  /** Fraction of row/column that must be non-background to count as "card". Default 0.7. */
  cardRowThreshold?: number;
  /** Pixels to look ahead past a card-edge candidate to verify background doesn't resume. Default 30. */
  lookahead?: number;
  /** Minimum average brightness of detected background to use smart crop (0-255). Below this, fall back to simple trim. Default 80. */
  minBgBrightness?: number;
  /** Background sample ring inset from edges, as fractions of the short side. Tightly framed scans leave only a thin border, so sampling too far in reads the subject instead. Defaults 0.01 / 0.04. */
  bgSampleInnerPct?: number;
  bgSampleOuterPct?: number;
}

export interface CropResult {
  success: boolean;
  cropped: boolean;
  originalSize?: { width: number; height: number };
  croppedSize?: { width: number; height: number };
  error?: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const DEFAULT_OPTIONS = {
  padding: 20,
  minDimension: 100,
  minAreaRatio: 0.05,
  bgColorThreshold: 80,
  cardRowThreshold: 0.7,
  lookahead: 30,
  minBgBrightness: 80,
  bgSampleInnerPct: 0.01,
  bgSampleOuterPct: 0.04,
};

type ResolvedOptions = typeof DEFAULT_OPTIONS;

class ImageCropService {
  private options: ResolvedOptions;

  constructor(options: CropOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as ResolvedOptions;
  }

  async cropAndSave(srcPath: string, destPath: string): Promise<CropResult> {
    const ext = path.extname(srcPath).toLowerCase();
    const filename = path.basename(srcPath);

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[crop] ${filename}: skipped (unsupported format ${ext})`);
      return { success: true, cropped: false, error: 'Unsupported image format for cropping' };
    }

    try {
      const metadata = await sharp(srcPath).metadata();
      const origW = metadata.width ?? 0;
      const origH = metadata.height ?? 0;

      if (origW === 0 || origH === 0) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[crop] ${filename}: skipped (could not read dimensions)`);
        return { success: true, cropped: false, error: 'Could not read image dimensions' };
      }

      const raw = await sharp(srcPath).raw().toBuffer();
      const ch = metadata.channels ?? 3;

      // Detect background color from a ring at 3-8% inset from edges
      const bg = this.detectBackground(raw, origW, origH, ch);
      const bgBrightness = (bg.r + bg.g + bg.b) / 3;

      let cropBounds: { left: number; top: number; width: number; height: number };

      if (bgBrightness >= this.options.minBgBrightness) {
        // Bright/colored background: use smart edge-scanning crop
        cropBounds = this.smartCrop(raw, origW, origH, ch, bg);
        console.log(`[crop] ${filename}: smart crop (bg rgb(${bg.r},${bg.g},${bg.b}), brightness ${bgBrightness.toFixed(0)})`);
      } else {
        // Dark background: use simple sharp.trim()
        cropBounds = await this.simpleTrim(srcPath, origW, origH);
        console.log(`[crop] ${filename}: simple trim (dark bg rgb(${bg.r},${bg.g},${bg.b}), brightness ${bgBrightness.toFixed(0)})`);
      }

      const cropW = cropBounds.width;
      const cropH = cropBounds.height;
      const cropArea = cropW * cropH;
      const origArea = origW * origH;

      // Safety: over-trimmed
      if (cropW < this.options.minDimension || cropH < this.options.minDimension) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[crop] ${filename}: fallback (over-trimmed to ${cropW}x${cropH})`);
        return { success: true, cropped: false, originalSize: { width: origW, height: origH },
          error: `Trimmed dimensions too small: ${cropW}x${cropH}` };
      }

      // Safety: ate too much
      if (cropArea / origArea < this.options.minAreaRatio) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[crop] ${filename}: fallback (area ratio ${(cropArea / origArea * 100).toFixed(1)}%)`);
        return { success: true, cropped: false, originalSize: { width: origW, height: origH },
          error: `Trimmed area too small` };
      }

      // No meaningful crop detected
      if (cropW === origW && cropH === origH) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[crop] ${filename}: no background detected (${origW}x${origH})`);
        return { success: true, cropped: false, originalSize: { width: origW, height: origH } };
      }

      const pad = this.options.padding;
      await sharp(srcPath)
        .extract(cropBounds)
        .extend({ top: pad, bottom: pad, left: pad, right: pad,
          background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toFile(destPath);

      const removedL = cropBounds.left;
      const removedT = cropBounds.top;
      const removedR = origW - cropBounds.left - cropW;
      const removedB = origH - cropBounds.top - cropH;
      console.log(`[crop] ${filename}: ${origW}x${origH} -> ${cropW}x${cropH} (L=${removedL} T=${removedT} R=${removedR} B=${removedB})`);

      return { success: true, cropped: true,
        originalSize: { width: origW, height: origH },
        croppedSize: { width: cropW, height: cropH } };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[crop] ${filename}: error: ${msg}`);
      try { fs.copyFileSync(srcPath, destPath); } catch {
        return { success: false, cropped: false, error: `Crop and copy both failed: ${msg}` };
      }
      return { success: true, cropped: false, error: `Crop failed, fell back to copy: ${msg}` };
    }
  }

  /** Detect background color by sampling a ring inset from image edges. */
  private detectBackground(raw: Buffer, w: number, h: number, ch: number): { r: number; g: number; b: number } {
    const inner = Math.floor(Math.min(w, h) * this.options.bgSampleInnerPct);
    const outer = Math.max(inner + 1, Math.floor(Math.min(w, h) * this.options.bgSampleOuterPct));
    let rS = 0, gS = 0, bS = 0, cnt = 0;

    // Top strip
    for (let y = inner; y < outer && y < h; y++) {
      for (let x = outer; x < w - outer; x += 10) {
        const i = (y * w + x) * ch;
        rS += raw[i]; gS += raw[i + 1]; bS += raw[i + 2]; cnt++;
      }
    }
    // Bottom strip
    for (let y = h - outer; y < h - inner; y++) {
      for (let x = outer; x < w - outer; x += 10) {
        const i = (y * w + x) * ch;
        rS += raw[i]; gS += raw[i + 1]; bS += raw[i + 2]; cnt++;
      }
    }
    // Left strip
    for (let x = inner; x < outer; x++) {
      for (let y = outer; y < h - outer; y += 10) {
        const i = (y * w + x) * ch;
        rS += raw[i]; gS += raw[i + 1]; bS += raw[i + 2]; cnt++;
      }
    }
    // Right strip
    for (let x = w - outer; x < w - inner; x++) {
      for (let y = outer; y < h - outer; y += 10) {
        const i = (y * w + x) * ch;
        rS += raw[i]; gS += raw[i + 1]; bS += raw[i + 2]; cnt++;
      }
    }

    if (cnt === 0) return { r: 0, g: 0, b: 0 };
    return { r: Math.round(rS / cnt), g: Math.round(gS / cnt), b: Math.round(bS / cnt) };
  }

  /** Smart crop: scan edges to find where card content starts, with lookahead to skip artifacts. */
  private smartCrop(
    raw: Buffer, w: number, h: number, ch: number,
    bg: { r: number; g: number; b: number }
  ): { left: number; top: number; width: number; height: number } {
    const bgT = this.options.bgColorThreshold;
    const cardT = this.options.cardRowThreshold;
    const look = this.options.lookahead;

    // Saturated backgrounds (colored scanner mats) vary in brightness across
    // the scan, so absolute RGB distance either misses the gradient or
    // swallows the subject. Chromaticity (color ratios) is lighting-invariant:
    // dim and bright yellow match each other but not the grey slab or the
    // background tinting seen through translucent slab edges. Neutral
    // grey/white backgrounds carry no usable chroma signal, so they keep the
    // RGB distance check.
    const bgSum = bg.r + bg.g + bg.b || 1;
    const bgMax = Math.max(bg.r, bg.g, bg.b);
    const bgMin = Math.min(bg.r, bg.g, bg.b);
    const chromaticBg = bgMax > 0 && (bgMax - bgMin) / bgMax > 0.35;
    const bgCr = bg.r / bgSum, bgCg = bg.g / bgSum, bgCb = bg.b / bgSum;
    const chromaT = 0.10;

    const isBg = (idx: number): boolean => {
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
      if (r < 30 && g < 30 && b < 30) return true;
      if (chromaticBg) {
        const sum = r + g + b || 1;
        const dr = r / sum - bgCr, dg = g / sum - bgCg, db = b / sum - bgCb;
        return Math.sqrt(dr * dr + dg * dg + db * db) < chromaT;
      }
      const dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < bgT;
    };

    // Background ratio for a column (sampled every 3 pixels for speed)
    const colBgRatio = (x: number, yStart: number, yEnd: number): number => {
      let bgCnt = 0, tot = 0;
      for (let y = yStart; y < yEnd; y += 3) {
        tot++;
        if (isBg((y * w + x) * ch)) bgCnt++;
      }
      return tot > 0 ? bgCnt / tot : 1;
    };

    // Background ratio for a row
    const rowBgRatio = (y: number, xStart: number, xEnd: number): number => {
      let bgCnt = 0, tot = 0;
      for (let x = xStart; x < xEnd; x += 3) {
        tot++;
        if (isBg((y * w + x) * ch)) bgCnt++;
      }
      return tot > 0 ? bgCnt / tot : 1;
    };

    // Is this a real card edge? Look ahead to check if background doesn't resume.
    const isRealEdgeCol = (x: number, dir: number, yS: number, yE: number): boolean => {
      let bgCols = 0;
      for (let i = 1; i <= look && x + i * dir >= 0 && x + i * dir < w; i++) {
        if (colBgRatio(x + i * dir, yS, yE) >= (1 - cardT)) bgCols++;
      }
      return bgCols <= look * 0.3;
    };

    const isRealEdgeRow = (y: number, dir: number, xS: number, xE: number): boolean => {
      let bgRows = 0;
      for (let i = 1; i <= look && y + i * dir >= 0 && y + i * dir < h; i++) {
        if (rowBgRatio(y + i * dir, xS, xE) >= (1 - cardT)) bgRows++;
      }
      return bgRows <= look * 0.3;
    };

    // Scan left
    let left = 0;
    for (let x = 0; x < w / 2; x++) {
      if (colBgRatio(x, 0, h) < (1 - cardT) && isRealEdgeCol(x, 1, 0, h)) { left = x; break; }
    }

    // Scan right
    let right = w;
    for (let x = w - 1; x > w / 2; x--) {
      if (colBgRatio(x, 0, h) < (1 - cardT) && isRealEdgeCol(x, -1, 0, h)) { right = x + 1; break; }
    }

    // Scan top (constrained to left/right bounds)
    let top = 0;
    for (let y = 0; y < h / 2; y++) {
      if (rowBgRatio(y, left, right) < (1 - cardT) && isRealEdgeRow(y, 1, left, right)) { top = y; break; }
    }

    // Scan bottom (constrained to left/right bounds)
    let bottom = h;
    for (let y = h - 1; y > h / 2; y--) {
      if (rowBgRatio(y, left, right) < (1 - cardT) && isRealEdgeRow(y, -1, left, right)) { bottom = y + 1; break; }
    }

    return { left, top, width: right - left, height: bottom - top };
  }

  /** Simple trim using sharp's built-in trim for dark/low-contrast backgrounds. */
  private async simpleTrim(
    srcPath: string, origW: number, origH: number
  ): Promise<{ left: number; top: number; width: number; height: number }> {
    try {
      const trimmed = await sharp(srcPath)
        .trim({ threshold: 50 })
        .toBuffer({ resolveWithObject: true });

      const tW = trimmed.info.width;
      const tH = trimmed.info.height;
      const tLeft = trimmed.info.trimOffsetLeft ?? 0;
      const tTop = trimmed.info.trimOffsetTop ?? 0;

      // trimOffsetLeft/Top are negative offsets from original
      const left = Math.abs(tLeft);
      const top = Math.abs(tTop);

      return { left, top, width: tW, height: tH };
    } catch {
      return { left: 0, top: 0, width: origW, height: origH };
    }
  }
}

export default ImageCropService;
