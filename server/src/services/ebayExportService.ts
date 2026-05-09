import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Database from '../database';
import FileService from './fileService';
import { Card, EbayExportOptions, EbayExportResult, EbayExportCardSummary, StoredCompReport } from '../types';

const TEMPLATE_HEADERS = [
  'Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)',
  'Custom label (SKU)',
  'Category ID',
  'Title',
  'UPC',
  'Price',
  'Quantity',
  'Item photo URL',
  'Condition ID',
  'Description',
  'Format',
];

const DEFAULT_INFO_ROWS = [
  '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,',
  '#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,',
  '"#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,',
  '#INFO,,,,,,,,,,',
];

const OUTPUT_FILENAME = 'ebay-draft-upload-batch.csv';
const TEMPLATE_FILENAME = 'ebay-draft.csv';

interface ResolvedPrice {
  price: number;
  source: string;
}

class EbayExportService {
  private db: Database;
  private fileService: FileService;

  constructor(db: Database, fileService: FileService) {
    this.db = db;
    this.fileService = fileService;
  }

  async generateCsv(
    options: EbayExportOptions,
    onProgress?: (progress: number, completedItems: number) => Promise<void>
  ): Promise<EbayExportResult> {
    // Fetch cards, always filtering out PC
    const allCards = await this.fetchCards(options.cardIds);
    const inventoryCards = allCards.filter(c => c.collectionType === 'Inventory');
    const skippedPcCards = allCards.length - inventoryCards.length;

    // Batch-fetch comp reports if comp pricing is enabled
    const useCompPricing = options.useCompPricing !== false;
    const compMaxAgeDays = options.compMaxAgeDays ?? 30;
    let compReports = new Map<string, StoredCompReport>();
    if (useCompPricing && inventoryCards.length > 0) {
      compReports = await this.db.getLatestCompReportsForCards(
        inventoryCards.map(c => c.id)
      );
    }

    // Batch-fetch remote URLs for image uploads
    const allImageFilenames: string[] = [];
    for (const card of inventoryCards) {
      if (card.images) {
        for (const img of card.images) {
          if (!img.endsWith('-comps.txt')) {
            allImageFilenames.push(img);
          }
        }
      }
    }
    const remoteUrlMap = await this.db.getRemoteUrlMap(allImageFilenames);

    const infoRows = this.readInfoRows();
    const rows: string[] = [...infoRows];
    rows.push(this.rowToCsvLine(TEMPLATE_HEADERS));

    let totalListingValue = 0;
    let compPricedCards = 0;
    let staleFallbackCards = 0;
    const cardSummary: EbayExportCardSummary[] = [];

    for (let i = 0; i < inventoryCards.length; i++) {
      const card = inventoryCards[i];
      const compReport = compReports.get(card.id);
      const resolved = this.resolvePrice(card, compReport, compMaxAgeDays);

      if (resolved.source.startsWith('comp-')) {
        compPricedCards++;
      } else if (resolved.source === 'stale-fallback') {
        staleFallbackCards++;
      }

      const startPrice = resolved.price * options.priceMultiplier;
      const row = this.cardToRow(card, options, startPrice, remoteUrlMap, compReport);
      rows.push(this.rowToCsvLine(row));

      totalListingValue += startPrice;

      cardSummary.push({
        cardId: card.id,
        player: card.player,
        price: Math.round(startPrice * 100) / 100,
        priceSource: resolved.source,
      });

      if (onProgress) {
        await onProgress(
          ((i + 1) / inventoryCards.length) * 100,
          i + 1
        );
      }
    }

    const csvContent = rows.join('\n');
    const generatedAt = new Date().toISOString();

    // Write timestamped draft file
    const timestamp = generatedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
    const draftFilename = `ebay-draft-upload-${timestamp}.csv`;
    const draftPath = path.join(this.fileService.getDataDir(), draftFilename);
    fs.writeFileSync(draftPath, csvContent, 'utf-8');

    // Also write to the standard output path for backward compatibility
    const outputPath = this.getOutputPath();
    fs.writeFileSync(outputPath, csvContent, 'utf-8');

    // Save draft record to database
    const draftId = uuidv4();
    const now = new Date().toISOString();
    await this.db.saveEbayExportDraft({
      id: draftId,
      filename: draftFilename,
      totalCards: inventoryCards.length,
      skippedPcCards,
      totalListingValue: Math.round(totalListingValue * 100) / 100,
      compPricedCards,
      options,
      cardSummary,
      generatedAt,
      createdAt: now,
    });

    return {
      filename: draftFilename,
      totalCards: inventoryCards.length,
      skippedPcCards,
      totalListingValue: Math.round(totalListingValue * 100) / 100,
      compPricedCards,
      staleFallbackCards,
      draftId,
      generatedAt,
    };
  }

  getTemplatePath(): string {
    return path.join(this.fileService.getDataDir(), TEMPLATE_FILENAME);
  }

  getOutputPath(): string {
    return path.join(this.fileService.getDataDir(), OUTPUT_FILENAME);
  }

  getDraftPath(filename: string): string {
    return path.join(this.fileService.getDataDir(), filename);
  }

  templateExists(): boolean {
    return fs.existsSync(this.getTemplatePath());
  }

  outputExists(): boolean {
    return fs.existsSync(this.getOutputPath());
  }

  draftExists(filename: string): boolean {
    return fs.existsSync(this.getDraftPath(filename));
  }

  deleteDraftFile(filename: string): void {
    const filepath = this.getDraftPath(filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }

  private resolvePrice(
    card: Card,
    compReport: StoredCompReport | undefined,
    maxAgeDays: number
  ): ResolvedPrice {
    if (!compReport) {
      return { price: card.currentValue, source: 'card-value' };
    }

    // Check freshness
    const ageMs = Date.now() - new Date(compReport.generatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      return { price: card.currentValue, source: 'stale-fallback' };
    }

    if (compReport.popAdjustedAverage != null && compReport.popAdjustedAverage > 0) {
      return { price: compReport.popAdjustedAverage, source: 'comp-pop' };
    }

    if (compReport.aggregateAverage != null && compReport.aggregateAverage > 0) {
      return { price: compReport.aggregateAverage, source: 'comp-avg' };
    }

    return { price: card.currentValue, source: 'card-value' };
  }

  private readInfoRows(): string[] {
    try {
      const templatePath = this.getTemplatePath();
      if (!fs.existsSync(templatePath)) {
        return [...DEFAULT_INFO_ROWS];
      }
      const content = fs.readFileSync(templatePath, 'utf-8');
      const lines = content.split('\n');
      const infoLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('#INFO') || line.startsWith('"#INFO')) {
          infoLines.push(line);
        } else {
          break;
        }
      }
      return infoLines.length > 0 ? infoLines : [...DEFAULT_INFO_ROWS];
    } catch {
      return [...DEFAULT_INFO_ROWS];
    }
  }

  private async fetchCards(cardIds?: string[]): Promise<Card[]> {
    if (cardIds && cardIds.length > 0) {
      const cards: Card[] = [];
      for (const id of cardIds) {
        const card = await this.db.getCardById(id);
        if (card) cards.push(card);
      }
      return cards;
    }
    return this.db.getAllCards({ collectionType: 'Inventory' });
  }

  private cardToRow(card: Card, options: EbayExportOptions, startPrice: number, _remoteUrlMap?: Map<string, string>, compReport?: StoredCompReport): string[] {
    return [
      'Draft',
      this.generateSku(card),
      this.getCategoryId(card.category),
      this.generateTitle(card),
      '',
      startPrice.toFixed(2),
      '1',
      '',
      this.getConditionId(card),
      this.generateDescription(card, compReport),
      'FixedPrice',
    ];
  }

  private buildPicUrl(card: Card, imageBaseUrl?: string, remoteUrlMap?: Map<string, string>): string {
    if (!card.images || card.images.length === 0) return '';
    const base = imageBaseUrl || '';

    return card.images
      .filter(img => !img.endsWith('-comps.txt'))
      .map(img => {
        // Prefer remote URL if available
        const remoteUrl = remoteUrlMap?.get(img);
        if (remoteUrl) return remoteUrl;
        // Fall back to local API path
        if (!base) return '';
        return `${base}/api/files/processed/${encodeURIComponent(img)}`;
      })
      .filter(url => url !== '')
      .join('|');
  }

  private generateSku(card: Card): string {
    const sanitize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const lastName = sanitize(card.player.split(' ').pop() || 'UNKNOWN');
    const year = card.year > 0 ? card.year.toString() : 'YR';

    // Product slot: prefer the set name, fall back to the brand.
    const product = sanitize(card.setName || card.brand || '');

    // Parallel slot: optional, only when set.
    const parallel = card.parallel ? sanitize(card.parallel) : '';

    // Copy slot: prefer the unique serial number (e.g. "76" from "76/99"),
    // fall back to the printed card number, then to the last 7 of the UUID
    // so unnumbered base cards still get a unique SKU.
    let copy = '';
    if (card.serialNumber && card.serialNumber.includes('/')) {
      copy = sanitize(card.serialNumber.split('/')[0]);
    } else if (card.cardNumber) {
      copy = sanitize(card.cardNumber);
    } else {
      copy = card.id.replace(/-/g, '').slice(-7).toLowerCase();
    }

    // Grade slot: PSA10 / RAW.
    const gradeSlot = card.isGraded && card.gradingCompany && card.grade
      ? `${sanitize(card.gradingCompany)}${card.grade.replace('.', '')}`
      : 'RAW';

    return [lastName, year, product, parallel, copy, gradeSlot]
      .filter(s => s && s.length > 0)
      .join('-');
  }

  private generateTitle(card: Card): string {
    const parts: string[] = [];

    parts.push(`${card.year} ${card.brand}`);

    if (card.setName) {
      parts.push(card.setName);
    }

    parts.push(card.player);

    if (card.parallel) {
      parts.push(card.parallel);
    }

    if (card.cardNumber) {
      parts.push(`#${card.cardNumber}`);
    }

    if (card.gradingCompany && card.grade) {
      parts.push(`${card.gradingCompany} ${card.grade}`);
    }

    if (card.isRookie) {
      parts.push('RC');
    }

    if (card.team) {
      parts.push(card.team);
    }

    // Append print-run suffix (e.g. "/99") when serialNumber is "<n>/<printRun>".
    const printRun = card.serialNumber && card.serialNumber.includes('/')
      ? card.serialNumber.split('/')[1].trim()
      : null;
    if (printRun) {
      parts.push(`/${printRun}`);
    }

    let title = parts.join(' ');
    if (title.length > 80) {
      title = title.substring(0, 77) + '...';
    }

    return title;
  }

  private generateDescription(card: Card, compReport?: StoredCompReport): string {
    const sections: string[] = [];

    // Header line
    const setDisplay = card.setName ? ` ${card.setName}` : '';
    sections.push(`<p><b>${card.year} ${card.brand}${setDisplay} ${card.player} #${card.cardNumber}</b></p>`);

    // Grade line with condition label
    if (card.isGraded && card.gradingCompany && card.grade) {
      const condLabel = this.getConditionLabel(card.gradingCompany, card.grade);
      const gradeDisplay = condLabel
        ? `${card.gradingCompany} ${card.grade} ${condLabel}`
        : `${card.gradingCompany} ${card.grade}`;
      let gradeLine = `<p><b>Grade:</b> ${gradeDisplay}`;
      if (card.serialNumber) {
        gradeLine += `<br><b>Serial Numbered:</b> ${card.serialNumber}`;
      }
      gradeLine += '</p>';
      sections.push(gradeLine);
    } else if (card.serialNumber) {
      sections.push(`<p><b>Serial Numbered:</b> ${card.serialNumber}</p>`);
    }

    // Features line (pipe-separated)
    const features: string[] = [];
    if (card.parallel) {
      features.push(card.parallel);
    }
    if (card.isRookie) {
      features.push('Rookie Card');
    }
    if (card.isAutograph) {
      features.push('Autograph');
    }
    if (card.isRelic) {
      features.push('Game-Used Relic');
    }
    if (card.isNumbered && !card.serialNumber) {
      features.push('Numbered');
    }
    if (features.length > 0) {
      sections.push(`<p>${features.join(' | ')}</p>`);
    }

    // Team + sport context
    const teamParts: string[] = [];
    if (card.team) {
      teamParts.push(card.team);
    }
    if (card.category && card.category !== 'Other') {
      teamParts.push(card.category);
    }
    if (teamParts.length > 0) {
      sections.push(`<p>${teamParts.join(' | ')}</p>`);
    }

    // Vintage tag
    if (card.year < 1990) {
      sections.push('<p><b>VINTAGE</b></p>');
    }

    // Comp pricing context
    if (compReport) {
      const priceParts: string[] = [];
      if (compReport.aggregateAverage != null && compReport.aggregateAverage > 0) {
        priceParts.push(`Avg Market Value: $${compReport.aggregateAverage.toFixed(2)}`);
      }
      if (compReport.aggregateLow != null && compReport.aggregateHigh != null
          && compReport.aggregateLow > 0 && compReport.aggregateHigh > 0) {
        priceParts.push(`Recent Sales Range: $${compReport.aggregateLow.toFixed(2)} - $${compReport.aggregateHigh.toFixed(2)}`);
      }
      const sourceCount = compReport.sources?.filter(s => !s.error && s.sales.length > 0).length;
      if (sourceCount && sourceCount > 0) {
        priceParts.push(`Based on ${sourceCount} market source${sourceCount > 1 ? 's' : ''}`);
      }
      if (priceParts.length > 0) {
        sections.push(`<p><b>Market Data:</b> ${priceParts.join(' | ')}</p>`);
      }
    }

    // Notes
    if (card.notes) {
      sections.push(`<p>${card.notes}</p>`);
    }

    // Shipping
    if (card.isGraded && card.gradingCompany) {
      sections.push(`<p>Card ships in ${card.gradingCompany} protective case with tracking.</p>`);
    } else {
      sections.push('<p>Card shipped in protective sleeve and toploader with tracking.</p>');
    }

    return sections.join('');
  }

  private getConditionLabel(company: string, grade: string): string {
    const num = parseFloat(grade);
    if (isNaN(num)) return '';

    if (company === 'PSA') {
      if (num === 10) return 'GEM MINT';
      if (num === 9) return 'MINT';
      if (num === 8) return 'NM-MT';
      if (num === 7) return 'NM';
      if (num === 6) return 'EX-MT';
      if (num === 5) return 'EX';
      if (num === 4) return 'VG-EX';
      if (num === 3) return 'VG';
      if (num === 2) return 'GOOD';
      if (num === 1) return 'PR';
    } else if (company === 'BGS' || company === 'SGC') {
      if (num >= 10) return 'PRISTINE';
      if (num >= 9.5) return 'GEM MINT';
      if (num >= 9) return 'MINT';
      if (num >= 8.5) return 'NM-MT+';
      if (num >= 8) return 'NM-MT';
      if (num >= 7.5) return 'NM+';
      if (num >= 7) return 'NM';
    } else if (company === 'CGC') {
      if (num >= 10) return 'PRISTINE';
      if (num >= 9.5) return 'MINT+';
      if (num >= 9) return 'MINT';
      if (num >= 8.5) return 'NM-MT+';
      if (num >= 8) return 'NM-MT';
      if (num >= 7.5) return 'NM+';
      if (num >= 7) return 'NM';
    }

    return '';
  }

  private getCategoryId(category: string): string {
    if (category === 'Pokemon') {
      return '183454';
    }
    return '215';
  }

  private getConditionId(card: Card): string {
    if (card.isGraded && card.grade) {
      const grade = card.grade;
      if (grade.includes('10') || grade.includes('GEM')) {
        return '2750';
      } else if (grade.includes('9.5')) {
        return '2750';
      } else if (grade.includes('9')) {
        return '2750';
      } else if (grade.includes('8')) {
        return '2750';
      } else if (grade.includes('7')) {
        return '2750';
      }
      return '2750';
    }
    return '3000';
  }

  private escapeCell(cell: string): string {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }

  private rowToCsvLine(row: string[]): string {
    return row.map(cell => this.escapeCell(cell)).join(',');
  }
}

export default EbayExportService;
