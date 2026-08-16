import { SHIPPING_COSTS } from './breakEvenCalculator';

// Grading cost per card by company and service tier.
// PSA rates as of June 2026: the Value tiers (Value/Value Plus/Value Max/
// Value Bulk) are PAUSED after the submission backlog spike — the entry
// price is Regular at $79.99, and every tier is keyed to a Max Insured
// Value that the card's declared value must not exceed.
export const GRADING_COSTS: Record<string, Record<string, number>> = {
  PSA:  {
    Regular: 79.99, Express: 149, 'Super Express': 349, 'Walk-Through': 599,
    'Premium 1': 999, 'Premium 2': 1999, 'Premium 3': 2999, 'Premium 5': 4999, 'Premium 10': 9999,
  },
  BGS:  { Economy: 22, Regular: 40, Express: 80, 'Super Express': 150, 'Walk-Through': 300 },
  SGC:  { Economy: 15, Regular: 30, Express: 50, 'Super Express': 100 },
  CGC:  { Economy: 15, Regular: 25, Express: 50 },
  HGA:  { Regular: 25, Express: 50 },
};

// PSA tiers are declared-value-gated: a card worth more than a tier's Max
// Insured Value must use a higher tier.
export const PSA_TIER_MAX_INSURED: Record<string, number> = {
  Regular: 1500,
  Express: 2500,
  'Super Express': 5000,
  'Walk-Through': 10000,
  'Premium 1': 25000,
  'Premium 2': 50000,
  'Premium 3': 100000,
  'Premium 5': 250000,
  'Premium 10': Infinity,
};

/** Lowest-cost PSA tier whose Max Insured Value covers the declared value. */
export function minEligiblePsaTier(declaredValue: number): string {
  for (const [tier, maxInsured] of Object.entries(PSA_TIER_MAX_INSURED)) {
    if (declaredValue <= maxInsured) return tier;
  }
  return 'Premium 10';
}

// Grade probability distributions by raw condition (industry averages)
export const GRADE_PROBABILITIES: Record<string, Record<string, number>> = {
  'Near Mint-Mint': { '10': 0.20, '9.5': 0.15, '9': 0.40, '8.5': 0.15, '8': 0.07, '7': 0.03 },
  'Near Mint':      { '10': 0.05, '9.5': 0.10, '9': 0.35, '8.5': 0.25, '8': 0.15, '7': 0.10 },
  'Excellent-Mint': { '10': 0.01, '9.5': 0.03, '9': 0.15, '8.5': 0.25, '8': 0.30, '7': 0.26 },
  'Excellent':      { '10': 0.00, '9.5': 0.01, '9': 0.05, '8.5': 0.10, '8': 0.25, '7': 0.35, '6': 0.24 },
  'Very Good':      { '10': 0.00, '9.5': 0.00, '9': 0.01, '8.5': 0.03, '8': 0.10, '7': 0.25, '6': 0.35, '5': 0.26 },
};

// Value multipliers relative to raw value by grade
export const VALUE_MULTIPLIERS: Record<string, number> = {
  '10':  5.0,
  '9.5': 3.0,
  '9':   2.0,
  '8.5': 1.5,
  '8':   1.2,
  '7':   0.9,
  '6':   0.7,
  '5':   0.5,
};

// Ordered grades from highest to lowest for iteration
const GRADES_DESCENDING = ['10', '9.5', '9', '8.5', '8', '7', '6', '5'];

export interface GradingRoiInput {
  rawValue: number;
  purchasePrice: number;
  condition: string;
  gradingCompany: string;
  gradingTier: string;
  shippingCost: number;
  customMultipliers?: Record<string, number>;
}

export interface GradeProjection {
  grade: string;
  probability: number;
  projectedValue: number;
  netProfit: number;
}

export interface GradingRoiResult {
  projections: GradeProjection[];
  expectedValue: number;
  gradingCost: number;
  totalInvestment: number;
  expectedProfit: number;
  expectedRoi: number;
  breakEvenGrade: string | null;
  recommendation: 'Grade' | "Don't Grade" | 'Borderline';
}

/**
 * Map a card's condition string to a grade probability distribution key.
 * Handles the ConditionGrade format (e.g. "8: NEAR MINT-MINT") and plain strings.
 */
export function mapConditionToDistribution(condition: string): string {
  if (!condition) return 'Near Mint';

  const upper = condition.toUpperCase().trim();

  // Direct match on the descriptive portion after the grade number
  if (upper.includes('NEAR MINT-MINT') || upper.includes('NM-MT') || upper === 'NM-MINT') {
    return 'Near Mint-Mint';
  }
  if (upper.includes('NEAR MINT') || upper.includes('NM') || upper === 'NEAR MINT+') {
    return 'Near Mint';
  }
  if (upper.includes('EXCELLENT-MINT') || upper.includes('EX-MT')) {
    return 'Excellent-Mint';
  }
  if (upper.includes('EXCELLENT') || upper.includes('EX')) {
    return 'Excellent';
  }
  if (upper.includes('VERY GOOD') || upper.includes('VG')) {
    return 'Very Good';
  }
  if (upper === 'RAW' || upper === 'MINT' || upper === 'GEM MINT') {
    return 'Near Mint-Mint';
  }

  // Fallback: conservative distribution
  return 'Near Mint';
}

/**
 * Get the grading cost for a given company and tier. Returns 0 for unknown combinations.
 */
export function getGradingCost(company: string, tier: string): number {
  return GRADING_COSTS[company]?.[tier] ?? 0;
}

/**
 * Calculate grading ROI analysis for a card.
 */
export function calculateGradingRoi(input: GradingRoiInput): GradingRoiResult {
  const { rawValue, purchasePrice, condition, gradingCompany, gradingTier, shippingCost, customMultipliers } = input;

  const gradingCost = getGradingCost(gradingCompany, gradingTier);
  // Cost basis: when the card has a real purchase price, that is the money
  // actually invested — projected profits are measured against it. Cards
  // created by the scan pipeline default purchasePrice to 0 ("unknown"), so
  // fall back to the current raw value as an opportunity-cost stand-in.
  const costBasis = purchasePrice > 0 ? purchasePrice : rawValue;
  const totalInvestment = costBasis + gradingCost + shippingCost;

  const distributionKey = mapConditionToDistribution(condition);
  const probabilities = GRADE_PROBABILITIES[distributionKey] || GRADE_PROBABILITIES['Near Mint'];
  const multipliers = { ...VALUE_MULTIPLIERS, ...customMultipliers };

  // Build projections for each grade with a non-zero probability
  const projections: GradeProjection[] = GRADES_DESCENDING
    .filter(grade => (probabilities[grade] ?? 0) > 0)
    .map(grade => {
      const probability = probabilities[grade] ?? 0;
      const multiplier = multipliers[grade] ?? 1;
      const projectedValue = Math.round(rawValue * multiplier * 100) / 100;
      const netProfit = Math.round((projectedValue - totalInvestment) * 100) / 100;
      return { grade, probability, projectedValue, netProfit };
    });

  // Expected value = sum of (probability * projected value)
  const expectedValue = Math.round(
    projections.reduce((sum, p) => sum + p.probability * p.projectedValue, 0) * 100
  ) / 100;

  const expectedProfit = Math.round((expectedValue - totalInvestment) * 100) / 100;
  const expectedRoi = totalInvestment > 0
    ? Math.round((expectedProfit / totalInvestment) * 10000) / 100
    : 0;

  // Break-even grade: lowest grade where projectedValue > totalInvestment
  // Scan from lowest grade upward
  let breakEvenGrade: string | null = null;
  for (let i = GRADES_DESCENDING.length - 1; i >= 0; i--) {
    const grade = GRADES_DESCENDING[i];
    const multiplier = multipliers[grade] ?? 1;
    const gradeValue = rawValue * multiplier;
    if (gradeValue > totalInvestment) {
      breakEvenGrade = grade;
      break;
    }
  }

  // Recommendation logic
  let recommendation: GradingRoiResult['recommendation'];
  const breakEvenNum = breakEvenGrade ? parseFloat(breakEvenGrade) : Infinity;

  if (expectedRoi < 0 || breakEvenNum >= 10) {
    recommendation = "Don't Grade";
  } else if (expectedRoi > 20 && breakEvenNum <= 9) {
    recommendation = 'Grade';
  } else {
    recommendation = 'Borderline';
  }

  return {
    projections,
    expectedValue,
    gradingCost,
    totalInvestment,
    expectedProfit,
    expectedRoi,
    breakEvenGrade,
    recommendation,
  };
}

/**
 * Default shipping cost for sending to a grading company (slab return shipping).
 */
export const DEFAULT_GRADING_SHIPPING = SHIPPING_COSTS.SLAB;
