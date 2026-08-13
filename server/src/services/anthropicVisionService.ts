import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { ExtractedCardData, CardFeatures, DetectionConfidence } from '../types';

const SUPPORTED_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

class AnthropicVisionService {
  private client: Anthropic | null = null;
  private apiKey: string | undefined;
  private model = 'claude-sonnet-5';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (this.apiKey) {
      this.client = new Anthropic({ apiKey: this.apiKey, maxRetries: 4 });
    }
  }

  private getClient(): Anthropic {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is required. Set it in server/.env');
    }
    return this.client;
  }

  async identifyCard(filePath: string): Promise<ExtractedCardData> {
    const ext = path.extname(filePath).toLowerCase();
    const mediaType = SUPPORTED_TYPES[ext];

    if (!mediaType) {
      throw new Error(`Unsupported image type: ${ext}. Supported: ${Object.keys(SUPPORTED_TYPES).join(', ')}`);
    }

    const imageData = fs.readFileSync(filePath);
    const base64 = imageData.toString('base64');

    const startMs = Date.now();
    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Identify this sports card. Return a JSON object with these fields (use null for any field you cannot determine):

{
  "player": "Full player name",
  "year": "Year as string (e.g. '2023')",
  "brand": "Manufacturer (e.g. 'Topps', 'Panini')",
  "set": "Set name (e.g. 'Chrome', 'Prizm', 'Series 1')",
  "cardNumber": "Card number as string",
  "team": "Team name",
  "category": "One of: Baseball, Basketball, Football, Hockey, Soccer, Pokemon, Other",
  "parallel": "Parallel/variant name if any (e.g. 'Refractor', 'Gold')",
  "serialNumber": "Serial number if visible (e.g. '25/50')",
  "isRookie": true/false,
  "isAutograph": true/false,
  "isRelic": true/false,
  "isNumbered": true/false,
  "isGraded": true/false,
  "gradingCompany": "PSA/BGS/SGC/CGC if graded",
  "grade": "Numeric grade if graded"
}

Naming conventions (critical for duplicate detection - follow exactly):
- "player": the exact full name as printed on the card, including forms/variants/suffixes (e.g. "Origin Forme Dialga V" not "Dialga V"; "Ken Griffey Jr." not "Ken Griffey")
- "brand": the manufacturer only (e.g. "Topps", "Panini", "Upper Deck"; for Pokemon TCG cards always use "Pokemon")
- "set": the official set name only - no brand, series/era prefixes, or abbreviations (e.g. "Astral Radiance" not "SWSH Astral Radiance" or "Sword & Shield Astral Radiance"; "Chrome" not "Topps Chrome"; "Hoops" not "NBA Hoops")
- "cardNumber": the number as printed, without the set-size denominator (e.g. "177" for "177/189")

Return ONLY the JSON object, no other text.`,
            },
          ],
        },
      ],
    });
    const durationMs = Date.now() - startMs;

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const data = this.parseResponse(text);
    data._apiMeta = {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs,
      imageCount: 1,
    };
    return data;
  }

  async identifyCardPair(frontPath: string, backPath: string): Promise<ExtractedCardData> {
    const frontExt = path.extname(frontPath).toLowerCase();
    const backExt = path.extname(backPath).toLowerCase();
    const frontType = SUPPORTED_TYPES[frontExt];
    const backType = SUPPORTED_TYPES[backExt];

    if (!frontType || !backType) {
      throw new Error('Unsupported image type');
    }

    const frontData = fs.readFileSync(frontPath).toString('base64');
    const backData = fs.readFileSync(backPath).toString('base64');

    const startMs = Date.now();
    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Here are the front and back of a sports card. Identify it using both images.',
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: frontType,
                data: frontData,
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: backType,
                data: backData,
              },
            },
            {
              type: 'text',
              text: `Return a JSON object with these fields (use null for any field you cannot determine):

{
  "player": "Full player name",
  "year": "Year as string (e.g. '2023')",
  "brand": "Manufacturer (e.g. 'Topps', 'Panini')",
  "set": "Set name (e.g. 'Chrome', 'Prizm', 'Series 1')",
  "cardNumber": "Card number as string",
  "team": "Team name",
  "category": "One of: Baseball, Basketball, Football, Hockey, Soccer, Pokemon, Other",
  "parallel": "Parallel/variant name if any (e.g. 'Refractor', 'Gold')",
  "serialNumber": "Serial number if visible (e.g. '25/50')",
  "isRookie": true/false,
  "isAutograph": true/false,
  "isRelic": true/false,
  "isNumbered": true/false,
  "isGraded": true/false,
  "gradingCompany": "PSA/BGS/SGC/CGC if graded",
  "grade": "Numeric grade if graded"
}

Naming conventions (critical for duplicate detection - follow exactly):
- "player": the exact full name as printed on the card, including forms/variants/suffixes (e.g. "Origin Forme Dialga V" not "Dialga V"; "Ken Griffey Jr." not "Ken Griffey")
- "brand": the manufacturer only (e.g. "Topps", "Panini", "Upper Deck"; for Pokemon TCG cards always use "Pokemon")
- "set": the official set name only - no brand, series/era prefixes, or abbreviations (e.g. "Astral Radiance" not "SWSH Astral Radiance" or "Sword & Shield Astral Radiance"; "Chrome" not "Topps Chrome"; "Hoops" not "NBA Hoops")
- "cardNumber": the number as printed, without the set-size denominator (e.g. "177" for "177/189")

Return ONLY the JSON object, no other text.`,
            },
          ],
        },
      ],
    });
    const durationMs = Date.now() - startMs;

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const data = this.parseResponse(text);
    data._apiMeta = {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs,
      imageCount: 2,
    };
    return data;
  }

  private parseResponse(text: string): ExtractedCardData {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse Anthropic response:', text);
      return { confidence: { score: 0, level: 'low', detectedFields: 0, missingFields: ['player', 'year', 'brand', 'cardNumber'] }, _parseFailed: true };
    }

    const features: CardFeatures = {
      isRookie: !!parsed.isRookie,
      isAutograph: !!parsed.isAutograph,
      isRelic: !!parsed.isRelic,
      isNumbered: !!parsed.isNumbered,
      isGraded: !!parsed.isGraded,
      isParallel: !!parsed.parallel,
    };

    const data: ExtractedCardData = {
      player: parsed.player as string || undefined,
      year: parsed.year as string || undefined,
      brand: parsed.brand as string || undefined,
      setName: parsed.set as string || undefined,
      cardNumber: parsed.cardNumber as string || undefined,
      team: parsed.team as string || undefined,
      category: parsed.category as string || undefined,
      parallel: parsed.parallel as string || undefined,
      serialNumber: parsed.serialNumber as string || undefined,
      gradingCompany: parsed.gradingCompany as string || undefined,
      grade: parsed.grade != null ? String(parsed.grade) : undefined,
      features,
    };

    // Calculate confidence based on how many fields we got
    data.confidence = this.calculateConfidence(data, features);
    data.rawText = JSON.stringify(parsed, null, 2);

    return data;
  }

  private calculateConfidence(data: ExtractedCardData, features: CardFeatures): DetectionConfidence {
    let score = 0;
    let detectedFields = 0;
    const missingFields: string[] = [];

    const fieldScores: Record<string, number> = {
      player: 25,
      year: 20,
      brand: 15,
      cardNumber: 10,
      team: 8,
      category: 5,
      parallel: 3,
      serialNumber: 4,
    };

    for (const [field, points] of Object.entries(fieldScores)) {
      if (data[field as keyof ExtractedCardData]) {
        score += points;
        detectedFields++;
      } else if (points >= 10) {
        missingFields.push(field);
      }
    }

    if (features.isRookie) score += 2;
    if (features.isAutograph) score += 2;
    if (features.isRelic) score += 2;
    if (features.isNumbered) score += 2;
    if (features.isGraded) score += 2;

    const percentage = Math.min(score, 100);

    let level: 'high' | 'medium' | 'low';
    if (percentage >= 80) level = 'high';
    else if (percentage >= 60) level = 'medium';
    else level = 'low';

    return {
      score: percentage,
      level,
      detectedFields,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    };
  }
}

export default AnthropicVisionService;
