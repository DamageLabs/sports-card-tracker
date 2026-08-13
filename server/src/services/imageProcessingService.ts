import path from 'path';
import FileService from './fileService';
import AnthropicVisionService from './anthropicVisionService';
import ImageCropService, { CropResult } from './imageCropService';
import AuditService from './auditService';
import Database from '../database';
import {
  ImageProcessingPayload,
  ImageProcessingResult,
  ImageProcessingItemResult,
  ExtractedCardData,
  CardInput,
  Card,
} from '../types';

class ImageProcessingService {
  constructor(
    private fileService: FileService,
    private db: Database,
    private visionService: AnthropicVisionService,
    private cropService?: ImageCropService,
    _auditSvc?: AuditService
  ) {}

  private logAudit(action: string, entity: string, entityId: string | null, details: Record<string, unknown>): void {
    this.db.insertAuditLog({ action, entity, entityId, details }).catch(err => {
      console.error('Audit log write failed:', err);
    });
  }

  private async copyOrCropFile(
    srcDir: string,
    srcFilename: string,
    destDir: string,
    destFilename: string
  ): Promise<CropResult> {
    if (this.cropService) {
      const srcPath = this.fileService.getFilePath(srcDir, srcFilename);
      const destPath = this.fileService.getFilePath(destDir, destFilename);
      if (!srcPath || !destPath) return { success: false, cropped: false, error: 'Invalid file path' };
      const result = await this.cropService.cropAndSave(srcPath, destPath);
      this.logAudit('image.auto_crop', 'file', srcFilename, {
        success: result.success,
        cropped: result.cropped,
        originalSize: result.originalSize,
        croppedSize: result.croppedSize,
        error: result.error,
        destination: destFilename,
      });
      return result;
    }
    const copied = this.fileService.copyFile(srcDir, srcFilename, destDir, destFilename);
    return { success: copied, cropped: false };
  }

  async processImages(
    payload: ImageProcessingPayload,
    onProgress?: (progress: number, completedItems: number) => Promise<void>
  ): Promise<ImageProcessingResult> {
    const startTime = Date.now();
    const { filenames, skipExisting = true, confidenceThreshold = 40, collectionId } = payload;
    const result: ImageProcessingResult = {
      totalFiles: filenames.length,
      processed: 0,
      skipped: 0,
      duplicates: 0,
      failed: 0,
      results: [],
    };

    // Group files into pairs and standalone
    const { pairs, standalone } = this.groupFiles(filenames);

    // Process paired files
    for (const [frontFile, backFile] of pairs) {
      try {
        const itemResult = await this.processPairedImages(
          frontFile, backFile, { skipExisting, confidenceThreshold, collectionId }
        );
        result.results.push(itemResult);
        this.updateCounts(result, itemResult);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.results.push({
          filename: frontFile,
          status: 'failed',
          error: errorMsg,
        });
        result.failed++;
        this.logError(frontFile, errorMsg);
      }

      if (onProgress) {
        const completed = result.processed + result.skipped + result.duplicates + result.failed;
        await onProgress((completed / result.totalFiles) * 100, completed);
      }
    }

    // Process standalone files
    for (const filename of standalone) {
      try {
        const itemResult = await this.processSingleImage(filename, {
          skipExisting,
          confidenceThreshold,
          collectionId,
        });
        result.results.push(itemResult);
        this.updateCounts(result, itemResult);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.results.push({
          filename,
          status: 'failed',
          error: errorMsg,
        });
        result.failed++;
        this.logError(filename, errorMsg);
      }

      if (onProgress) {
        const completed = result.processed + result.skipped + result.duplicates + result.failed;
        await onProgress((completed / result.totalFiles) * 100, completed);
      }
    }

    this.logAudit('image.batch_completed', 'job', null, {
      totalFiles: result.totalFiles,
      processed: result.processed,
      skipped: result.skipped,
      duplicates: result.duplicates,
      failed: result.failed,
      durationMs: Date.now() - startTime,
    });

    return result;
  }

  async identifyOnly(
    filename: string,
    backFile?: string
  ): Promise<ExtractedCardData> {
    const rawDir = this.fileService.getRawDir();

    if (backFile) {
      return this.visionService.identifyCardPair(
        path.join(rawDir, filename),
        path.join(rawDir, backFile)
      );
    }

    return this.visionService.identifyCard(path.join(rawDir, filename));
  }

  async confirmCard(
    filename: string,
    cardData: ExtractedCardData,
    backFile?: string
  ): Promise<ImageProcessingItemResult> {
    const rawDir = this.fileService.getRawDir();
    const processedDir = this.fileService.getProcessedDir();

    if (backFile) {
      const frontExt = path.extname(filename);
      const backExt = path.extname(backFile);
      const baseName = this.buildProcessedFilename(cardData, '');
      const processedFront = baseName + '-front' + frontExt;
      const processedBack = baseName + '-back' + backExt;

      if (this.isAlreadyProcessed(processedFront)) {
        return { filename, status: 'skipped', processedFilename: processedFront, confidence: cardData.confidence?.score };
      }

      const duplicate = await this.checkDuplicate(cardData);
      if (duplicate) {
        this.logAudit('image.duplicate_detected', 'card', duplicate.id, {
          filename,
          duplicatePlayer: duplicate.player,
          duplicateYear: duplicate.year,
          duplicateBrand: duplicate.brand,
          duplicateCardNumber: duplicate.cardNumber,
        });
        const error = `Duplicate of card ${duplicate.id}`;
        this.logError(filename, error);
        return { filename, status: 'duplicate', confidence: cardData.confidence?.score, error };
      }

      const frontResult = await this.copyOrCropFile(rawDir, filename, processedDir, processedFront);
      if (!frontResult.success) {
        this.logAudit('image.copy_failed', 'file', filename, {
          source: filename,
          destination: processedFront,
          error: frontResult.error,
        });
      }
      const backResult = await this.copyOrCropFile(rawDir, backFile, processedDir, processedBack);
      if (!backResult.success) {
        this.logAudit('image.copy_failed', 'file', backFile, {
          source: backFile,
          destination: processedBack,
          error: backResult.error,
        });
      }

      const card = await this.db.createCard(
        this.buildCardInput(cardData, [processedFront, processedBack])
      );

      return {
        filename,
        status: 'processed',
        processedFilename: processedFront,
        cardId: card.id,
        confidence: cardData.confidence?.score,
      };
    }

    // Single image
    const ext = path.extname(filename);
    const processedFilename = this.buildProcessedFilename(cardData, ext);

    if (this.isAlreadyProcessed(processedFilename)) {
      return { filename, status: 'skipped', processedFilename, confidence: cardData.confidence?.score };
    }

    const duplicate = await this.checkDuplicate(cardData);
    if (duplicate) {
      this.logAudit('image.duplicate_detected', 'card', duplicate.id, {
        filename,
        duplicatePlayer: duplicate.player,
        duplicateYear: duplicate.year,
        duplicateBrand: duplicate.brand,
        duplicateCardNumber: duplicate.cardNumber,
      });
      const error = `Duplicate of card ${duplicate.id} (${duplicate.player} ${duplicate.year} ${duplicate.brand} #${duplicate.cardNumber})`;
      this.logError(filename, error);
      return { filename, status: 'duplicate', confidence: cardData.confidence?.score, error };
    }

    const copyResult = await this.copyOrCropFile(
      rawDir, filename,
      processedDir, processedFilename
    );
    if (!copyResult.success) {
      this.logAudit('image.copy_failed', 'file', filename, {
        source: filename,
        destination: processedFilename,
        error: copyResult.error,
      });
      const error = 'Failed to copy file to processed directory';
      this.logError(filename, error);
      return { filename, status: 'failed', error };
    }

    const card = await this.db.createCard(
      this.buildCardInput(cardData, [processedFilename])
    );

    return {
      filename,
      status: 'processed',
      processedFilename,
      cardId: card.id,
      confidence: cardData.confidence?.score,
    };
  }

  async processSingleImage(
    filename: string,
    options: { skipExisting?: boolean; confidenceThreshold?: number; collectionId?: string } = {}
  ): Promise<ImageProcessingItemResult> {
    const { skipExisting = true, confidenceThreshold = 40, collectionId } = options;
    const rawDir = this.fileService.getRawDir();
    const filePath = path.join(rawDir, filename);

    // Use Anthropic Vision to identify the card
    const data = await this.visionService.identifyCard(filePath);
    if (collectionId) data.collectionId = collectionId;

    // Check confidence
    const confidence = data.confidence?.score ?? 0;
    if (confidence < confidenceThreshold) {
      const error = `Low confidence: ${confidence}% (threshold: ${confidenceThreshold}%)`;
      this.logError(filename, error);
      return { filename, status: 'failed', confidence, error };
    }

    // Build processed filename
    const ext = path.extname(filename);
    const processedFilename = this.buildProcessedFilename(data, ext);

    // Idempotency: skip if already processed
    if (skipExisting && this.isAlreadyProcessed(processedFilename)) {
      return { filename, status: 'skipped', processedFilename, confidence };
    }

    // Duplicate detection
    const duplicate = await this.checkDuplicate(data);
    if (duplicate) {
      this.logAudit('image.duplicate_detected', 'card', duplicate.id, {
        filename,
        duplicatePlayer: duplicate.player,
        duplicateYear: duplicate.year,
        duplicateBrand: duplicate.brand,
        duplicateCardNumber: duplicate.cardNumber,
      });
      const error = `Duplicate of card ${duplicate.id} (${duplicate.player} ${duplicate.year} ${duplicate.brand} #${duplicate.cardNumber})`;
      this.logError(filename, error);
      return { filename, status: 'duplicate', confidence, error };
    }

    // Copy (with auto-crop) to processed directory
    const singleCopyResult = await this.copyOrCropFile(
      rawDir, filename,
      this.fileService.getProcessedDir(), processedFilename
    );
    if (!singleCopyResult.success) {
      this.logAudit('image.copy_failed', 'file', filename, {
        source: filename,
        destination: processedFilename,
        error: singleCopyResult.error,
      });
      const error = 'Failed to copy file to processed directory';
      this.logError(filename, error);
      return { filename, status: 'failed', error };
    }

    // Create card record
    const card = await this.db.createCard(
      this.buildCardInput(data, [processedFilename])
    );

    return {
      filename,
      status: 'processed',
      processedFilename,
      cardId: card.id,
      confidence,
    };
  }

  private async processPairedImages(
    frontFile: string,
    backFile: string,
    options: { skipExisting?: boolean; confidenceThreshold?: number; collectionId?: string }
  ): Promise<ImageProcessingItemResult> {
    const { skipExisting = true, confidenceThreshold = 40, collectionId } = options;
    const rawDir = this.fileService.getRawDir();

    // Use Anthropic Vision to identify the card from both images
    const data = await this.visionService.identifyCardPair(
      path.join(rawDir, frontFile),
      path.join(rawDir, backFile)
    );
    if (collectionId) data.collectionId = collectionId;

    const confidence = data.confidence?.score ?? 0;

    if (confidence < confidenceThreshold) {
      const error = `Low confidence: ${confidence}% (threshold: ${confidenceThreshold}%)`;
      this.logError(frontFile, error);
      return { filename: frontFile, status: 'failed', confidence, error };
    }

    const frontExt = path.extname(frontFile);
    const backExt = path.extname(backFile);
    const baseName = this.buildProcessedFilename(data, '');
    const processedFront = baseName + '-front' + frontExt;
    const processedBack = baseName + '-back' + backExt;

    if (skipExisting && this.isAlreadyProcessed(processedFront)) {
      return { filename: frontFile, status: 'skipped', processedFilename: processedFront, confidence };
    }

    const duplicate = await this.checkDuplicate(data);
    if (duplicate) {
      this.logAudit('image.duplicate_detected', 'card', duplicate.id, {
        filename: frontFile,
        duplicatePlayer: duplicate.player,
        duplicateYear: duplicate.year,
        duplicateBrand: duplicate.brand,
        duplicateCardNumber: duplicate.cardNumber,
      });
      const error = `Duplicate of card ${duplicate.id}`;
      this.logError(frontFile, error);
      return { filename: frontFile, status: 'duplicate', confidence, error };
    }

    const processedDir = this.fileService.getProcessedDir();
    const pairFrontResult = await this.copyOrCropFile(rawDir, frontFile, processedDir, processedFront);
    if (!pairFrontResult.success) {
      this.logAudit('image.copy_failed', 'file', frontFile, {
        source: frontFile,
        destination: processedFront,
        error: pairFrontResult.error,
      });
    }
    const pairBackResult = await this.copyOrCropFile(rawDir, backFile, processedDir, processedBack);
    if (!pairBackResult.success) {
      this.logAudit('image.copy_failed', 'file', backFile, {
        source: backFile,
        destination: processedBack,
        error: pairBackResult.error,
      });
    }

    const card = await this.db.createCard(
      this.buildCardInput(data, [processedFront, processedBack])
    );

    return {
      filename: frontFile,
      status: 'processed',
      processedFilename: processedFront,
      cardId: card.id,
      confidence,
    };
  }

  buildProcessedFilename(data: ExtractedCardData, ext: string): string {
    const sanitize = (s: string) => s.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').replace(/-{2,}/g, '-');
    const year = data.year || 'Unknown';
    const brand = sanitize(data.brand || 'Unknown');
    const setName = data.setName ? sanitize(data.setName) : '';
    const player = sanitize(data.player || 'Unknown');
    const cardNumber = data.cardNumber || '0';
    const parallel = data.parallel ? sanitize(data.parallel) : '';

    const parts = [year, brand];
    if (setName) parts.push(setName);
    parts.push(player, cardNumber);
    if (parallel) parts.push(parallel);
    return parts.join('-') + ext;
  }

  private static readonly GRADE_CONDITIONS: Record<string, string> = {
    '10': '10: GEM MINT',
    '9.5': '9.5: MINT+',
    '9': '9: MINT',
    '8.5': '8.5: NEAR MINT-MINT+',
    '8': '8: NEAR MINT-MINT',
    '7.5': '7.5: NEAR MINT+',
    '7': '7: NEAR MINT',
    '6.5': '6.5: EXCELLENT-MINT+',
    '6': '6: EXCELLENT-MINT',
    '5.5': '5.5: EXCELLENT+',
    '5': '5: EXCELLENT',
    '4.5': '4.5: VERY GOOD-EXCELLENT+',
    '4': '4: VERY GOOD-EXCELLENT',
    '3.5': '3.5: VERY GOOD+',
    '3': '3: VERY GOOD',
    '2.5': '2.5: GOOD+',
    '2': '2: GOOD',
    '1.5': '1.5: POOR+',
    '1': '1: POOR',
  };

  private gradeToCondition(grade?: string): string {
    if (!grade) return 'Graded';
    const normalized = grade.trim();
    return ImageProcessingService.GRADE_CONDITIONS[normalized] || 'Graded';
  }

  private buildCardInput(data: ExtractedCardData, images: string[]): CardInput {
    return {
      player: data.player || 'Unknown',
      team: data.team || '',
      year: data.year ? parseInt(data.year) : 0,
      brand: data.brand || 'Unknown',
      category: data.category || 'Other',
      cardNumber: data.cardNumber || '',
      parallel: data.parallel,
      condition: data.features?.isGraded ? this.gradeToCondition(data.grade) : 'RAW',
      gradingCompany: data.gradingCompany,
      setName: data.setName,
      serialNumber: data.serialNumber,
      grade: data.grade,
      isRookie: data.features?.isRookie ?? false,
      isAutograph: data.features?.isAutograph ?? false,
      isRelic: data.features?.isRelic ?? false,
      isNumbered: data.features?.isNumbered ?? false,
      isGraded: data.features?.isGraded ?? false,
      purchasePrice: 0,
      purchaseDate: new Date().toISOString().split('T')[0],
      currentValue: 0,
      images,
      notes: '',
      collectionType: 'Pending',
      collectionId: data.collectionId,
    };
  }

  async checkDuplicate(data: ExtractedCardData): Promise<Card | null> {
    if (!data.player || !data.year || !data.brand || !data.cardNumber) {
      return null;
    }

    // Treat null/undefined/'' as equivalent so two cards both lacking the
    // field still compare as equal. setName + parallel are part of the
    // identity key because real-world products reuse player/year/brand/#
    // across distinct parallels (eg. Topps Cosmic Chrome Planetary Pursuit
    // Earth vs Jupiter, both #XW).
    //
    // The vision model phrases names inconsistently between scans (eg.
    // "Dialga V" vs "Origin Forme Dialga V", "SWSH Astral Radiance" vs
    // "Astral Radiance"), so player and setName use punctuation-stripped
    // containment matching rather than exact equality. Parallel stays
    // exact because containment there would merge genuinely distinct
    // cards (eg. "Gold" vs "Gold Refractor").
    const norm = (s: string | null | undefined): string =>
      (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fuzzyEq = (a: string, b: string): boolean => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.includes(b) || b.includes(a);
    };
    // The model also sometimes misfiles the set name into `parallel`
    // ("SWSH" + parallel "Astral Radiance" vs set "Sword & Shield - Astral
    // Radiance" + no parallel). A combined set+parallel signature, compared
    // for exact equality after expanding common abbreviations, catches that
    // without merging real parallels.
    const alias = (s: string): string => s.replace(/swsh/g, 'swordshield');
    const combinedSig = (setN: string, par: string): string => alias(setN + par);
    const targetPlayer = norm(data.player);
    const targetSet = norm(data.setName);
    const targetParallel = norm(data.parallel);
    const targetCombined = combinedSig(targetSet, targetParallel);

    const allCards = await this.db.getAllCards();
    const match = allCards.find(card => {
      if (
        !fuzzyEq(norm(card.player), targetPlayer) ||
        card.year !== parseInt(data.year!) ||
        norm(card.brand) !== norm(data.brand) ||
        card.cardNumber !== data.cardNumber
      ) {
        return false;
      }
      const cardSet = norm(card.setName);
      const cardParallel = norm(card.parallel);
      if (fuzzyEq(cardSet, targetSet) && cardParallel === targetParallel) return true;
      return combinedSig(cardSet, cardParallel) === targetCombined && targetCombined !== '';
    });

    if (!match) return null;

    // Verify the duplicate's processed files actually exist.
    // If none of its images are on disk, the record is orphaned — remove it.
    const hasFiles = match.images.some(img =>
      this.fileService.fileExists(this.fileService.getProcessedDir(), img)
    );
    if (!hasFiles) {
      this.logAudit('image.orphan_cleanup', 'card', match.id, {
        player: match.player,
        year: match.year,
        brand: match.brand,
        cardNumber: match.cardNumber,
        orphanedImages: match.images,
      });
      await this.db.deleteCard(match.id);
      return null;
    }

    return match;
  }

  isAlreadyProcessed(filename: string): boolean {
    return this.fileService.fileExists(this.fileService.getProcessedDir(), filename);
  }

  findPairFile(filename: string, rawFiles: string[]): string | null {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);

    let pairSuffix: string | null = null;
    let baseName: string;

    if (base.endsWith('-front')) {
      baseName = base.slice(0, -6);
      pairSuffix = '-back';
    } else if (base.endsWith('-back')) {
      baseName = base.slice(0, -5);
      pairSuffix = '-front';
    } else {
      return null;
    }

    const pairName = baseName + pairSuffix + ext;
    return rawFiles.includes(pairName) ? pairName : null;
  }

  private groupFiles(filenames: string[]): { pairs: [string, string][]; standalone: string[] } {
    const pairs: [string, string][] = [];
    const standalone: string[] = [];
    const paired = new Set<string>();

    for (const filename of filenames) {
      if (paired.has(filename)) continue;

      const pairFile = this.findPairFile(filename, filenames);
      if (pairFile && !paired.has(pairFile)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        if (base.endsWith('-front')) {
          pairs.push([filename, pairFile]);
        } else {
          pairs.push([pairFile, filename]);
        }
        paired.add(filename);
        paired.add(pairFile);
      } else if (!pairFile) {
        standalone.push(filename);
      }
    }

    return { pairs, standalone };
  }

  private updateCounts(result: ImageProcessingResult, item: ImageProcessingItemResult): void {
    switch (item.status) {
      case 'processed': result.processed++; break;
      case 'skipped': result.skipped++; break;
      case 'duplicate': result.duplicates++; break;
      case 'failed': result.failed++; break;
    }
  }

  private logError(filename: string, reason: string): void {
    this.db.insertAuditLog({
      action: 'image.process_failed',
      entity: 'file',
      entityId: filename,
      details: { reason },
    }).catch(err => {
      console.error('Audit log write failed:', err);
    });
  }
}

export default ImageProcessingService;
