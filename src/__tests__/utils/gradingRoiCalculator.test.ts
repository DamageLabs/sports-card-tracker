import {
  calculateGradingRoi,
  mapConditionToDistribution,
  getGradingCost,
  GRADING_COSTS,
  GRADE_PROBABILITIES,
  VALUE_MULTIPLIERS,
  DEFAULT_GRADING_SHIPPING,
  GradingRoiInput,
} from '../../utils/gradingRoiCalculator';
import { SHIPPING_COSTS } from '../../utils/breakEvenCalculator';

// purchasePrice 0 = "unknown" (the scan pipeline's default) — the calculator
// falls back to rawValue as the cost basis, which these tests assume.
const baseInput: GradingRoiInput = {
  rawValue: 100,
  purchasePrice: 0,
  condition: 'Near Mint-Mint',
  gradingCompany: 'PSA',
  gradingTier: 'Regular',
  shippingCost: SHIPPING_COSTS.SLAB,
};

describe('gradingRoiCalculator', () => {
  describe('getGradingCost', () => {
    it('returns correct cost for known company and tier', () => {
      expect(getGradingCost('PSA', 'Regular')).toBe(79.99);
      expect(getGradingCost('BGS', 'Economy')).toBe(22);
      expect(getGradingCost('SGC', 'Express')).toBe(50);
    });

    it('returns 0 for unknown company', () => {
      expect(getGradingCost('UNKNOWN', 'Regular')).toBe(0);
    });

    it('returns 0 for unknown tier', () => {
      expect(getGradingCost('PSA', 'Platinum')).toBe(0);
    });
  });

  describe('mapConditionToDistribution', () => {
    it('maps Near Mint-Mint conditions', () => {
      expect(mapConditionToDistribution('8: NEAR MINT-MINT')).toBe('Near Mint-Mint');
      expect(mapConditionToDistribution('8.5: NEAR MINT-MINT+')).toBe('Near Mint-Mint');
    });

    it('maps Near Mint conditions', () => {
      expect(mapConditionToDistribution('7: NEAR MINT')).toBe('Near Mint');
      expect(mapConditionToDistribution('7.5: NEAR MINT+')).toBe('Near Mint');
    });

    it('maps Excellent-Mint conditions', () => {
      expect(mapConditionToDistribution('6: EXCELLENT-MINT')).toBe('Excellent-Mint');
      expect(mapConditionToDistribution('6.5: EXCELLENT-MINT+')).toBe('Excellent-Mint');
    });

    it('maps Excellent conditions', () => {
      expect(mapConditionToDistribution('5: EXCELLENT')).toBe('Excellent');
    });

    it('maps Very Good conditions', () => {
      expect(mapConditionToDistribution('3: VERY GOOD')).toBe('Very Good');
    });

    it('maps RAW to Near Mint-Mint', () => {
      expect(mapConditionToDistribution('RAW')).toBe('Near Mint-Mint');
    });

    it('falls back to Near Mint for unknown conditions', () => {
      expect(mapConditionToDistribution('something unknown')).toBe('Near Mint');
    });

    it('falls back to Near Mint for empty string', () => {
      expect(mapConditionToDistribution('')).toBe('Near Mint');
    });
  });

  describe('calculateGradingRoi', () => {
    it('calculates expected value from known probabilities', () => {
      const result = calculateGradingRoi(baseInput);
      // NM-MT distribution: 10=0.20, 9.5=0.15, 9=0.40, 8.5=0.15, 8=0.07, 7=0.03
      // EV = 0.20*500 + 0.15*300 + 0.40*200 + 0.15*150 + 0.07*120 + 0.03*90
      // EV = 100 + 45 + 80 + 22.5 + 8.4 + 2.7 = 258.6
      expect(result.expectedValue).toBeCloseTo(258.6, 0);
    });

    it('calculates grading cost from company/tier', () => {
      const result = calculateGradingRoi(baseInput);
      expect(result.gradingCost).toBe(79.99); // PSA Regular (June 2026 rates)
    });

    it('calculates total investment correctly', () => {
      const result = calculateGradingRoi(baseInput);
      // rawValue(100) + gradingCost(79.99) + shipping(8)
      expect(result.totalInvestment).toBe(187.99);
    });

    it('returns positive ROI for high-value NM-MT card', () => {
      const result = calculateGradingRoi(baseInput);
      expect(result.expectedProfit).toBeGreaterThan(0);
      expect(result.expectedRoi).toBeGreaterThan(0);
    });

    it('returns negative ROI for low-value card', () => {
      const result = calculateGradingRoi({
        ...baseInput,
        rawValue: 10, // Only worth $10 raw
      });
      // totalInvestment = 10 + 79.99 + 8 = 97.99
      // Even a PSA 10 is only 10*5 = 50, which is less than 97.99
      expect(result.expectedProfit).toBeLessThan(0);
      expect(result.expectedRoi).toBeLessThan(0);
    });

    it('detects break-even grade', () => {
      const result = calculateGradingRoi(baseInput);
      // totalInvestment = 187.99
      // Grade 8.5 = 100*1.5 = 150 < 187.99, Grade 9 = 100*2.0 = 200 > 187.99
      expect(result.breakEvenGrade).toBe('9');
    });

    it('returns null break-even when no grade covers costs', () => {
      const result = calculateGradingRoi({
        ...baseInput,
        rawValue: 10,
      });
      // totalInvestment = 53, max value = 10*5 = 50
      expect(result.breakEvenGrade).toBeNull();
    });

    describe('purchase price cost basis', () => {
      it('uses purchase price as the investment when known', () => {
        const result = calculateGradingRoi({ ...baseInput, purchasePrice: 50 });
        // purchasePrice(50) + gradingCost(79.99) + shipping(8) — NOT rawValue
        expect(result.totalInvestment).toBe(137.99);
      });

      it('measures per-grade profit against the cost basis', () => {
        const result = calculateGradingRoi({ ...baseInput, purchasePrice: 50 });
        const grade10 = result.projections.find(p => p.grade === '10')!;
        // Projected value still derives from market rawValue (100 * 5),
        // but profit is measured against what was actually paid.
        expect(grade10.projectedValue).toBe(500);
        expect(grade10.netProfit).toBe(Math.round((500 - 137.99) * 100) / 100);
      });

      it('falls back to rawValue when purchase price is unknown (0)', () => {
        const result = calculateGradingRoi({ ...baseInput, purchasePrice: 0 });
        expect(result.totalInvestment).toBe(187.99);
      });

      it('a lower cost basis improves ROI for the same card', () => {
        const atMarket = calculateGradingRoi(baseInput); // basis = rawValue 100
        const boughtCheap = calculateGradingRoi({ ...baseInput, purchasePrice: 20 });
        expect(boughtCheap.expectedRoi).toBeGreaterThan(atMarket.expectedRoi);
      });
    });

    it('recommends Grade when ROI > 20% and break-even <= 9', () => {
      const result = calculateGradingRoi(baseInput);
      expect(result.expectedRoi).toBeGreaterThan(20);
      expect(result.recommendation).toBe('Grade');
    });

    it("recommends Don't Grade when ROI < 0", () => {
      const result = calculateGradingRoi({
        ...baseInput,
        rawValue: 10,
      });
      expect(result.expectedRoi).toBeLessThan(0);
      expect(result.recommendation).toBe("Don't Grade");
    });

    it('recommends Borderline when ROI is 0-20%', () => {
      // Find a rawValue that produces borderline ROI
      // totalInvestment = rawValue + 79.99 + 8 = rawValue + 87.99
      // We need EV / totalInvestment between 1.0 and 1.2
      // For NM-MT: EV multiplier ≈ 2.586x raw
      // At raw=60: EV=155.16, investment=147.99, ROI≈4.8% → Borderline
      const result = calculateGradingRoi({
        ...baseInput,
        rawValue: 60,
      });
      expect(result.expectedRoi).toBeGreaterThanOrEqual(0);
      expect(result.expectedRoi).toBeLessThanOrEqual(20);
      expect(result.recommendation).toBe('Borderline');
    });

    it('applies custom multiplier overrides', () => {
      const customMultipliers = { '10': 10.0, '9': 4.0 };
      const result = calculateGradingRoi({
        ...baseInput,
        customMultipliers,
      });

      // PSA 10 projection should use 10x instead of 5x
      const psa10 = result.projections.find(p => p.grade === '10');
      expect(psa10?.projectedValue).toBe(1000); // 100 * 10.0

      // PSA 9 should use 4x
      const psa9 = result.projections.find(p => p.grade === '9');
      expect(psa9?.projectedValue).toBe(400); // 100 * 4.0
    });

    it('uses different grading companies with correct costs', () => {
      const sgcResult = calculateGradingRoi({
        ...baseInput,
        gradingCompany: 'SGC',
        gradingTier: 'Economy',
      });
      expect(sgcResult.gradingCost).toBe(15);
      expect(sgcResult.totalInvestment).toBe(100 + 15 + 8);
    });

    it('produces projections only for grades with non-zero probability', () => {
      const result = calculateGradingRoi({
        ...baseInput,
        condition: 'Excellent',
      });
      // Excellent dist has '10': 0.00, so no 10 projection
      const psa10 = result.projections.find(p => p.grade === '10');
      expect(psa10).toBeUndefined();
      // But should have grade 6
      const grade6 = result.projections.find(p => p.grade === '6');
      expect(grade6).toBeDefined();
      expect(grade6!.probability).toBe(0.24);
    });
  });

  describe('constants', () => {
    it('exports default grading shipping from breakEvenCalculator', () => {
      expect(DEFAULT_GRADING_SHIPPING).toBe(SHIPPING_COSTS.SLAB);
    });

    it('has grading costs for major companies', () => {
      expect(Object.keys(GRADING_COSTS)).toEqual(
        expect.arrayContaining(['PSA', 'BGS', 'SGC', 'CGC', 'HGA'])
      );
    });

    it('has probability distributions summing to ~1.0', () => {
      for (const [condition, probs] of Object.entries(GRADE_PROBABILITIES)) {
        const sum = Object.values(probs).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 1);
      }
    });

    it('has value multipliers for common grades', () => {
      expect(VALUE_MULTIPLIERS['10']).toBe(5.0);
      expect(VALUE_MULTIPLIERS['9']).toBe(2.0);
      expect(VALUE_MULTIPLIERS['7']).toBe(0.9);
    });
  });
});
