import { extractGradeFromTitle, filterByGrade, getAdjacentGrades, GradeInfo } from '../../../services/adapters/gradeUtils';
import { CompRequest } from '../../../types';

describe('extractGradeFromTitle', () => {
  it('extracts standard PSA grade', () => {
    expect(extractGradeFromTitle('2023 Topps Mike Trout PSA 10')).toEqual({ company: 'PSA', grade: '10' });
  });

  it('extracts BGS half grade', () => {
    expect(extractGradeFromTitle('2023 Topps Mike Trout BGS 9.5')).toEqual({ company: 'BGS', grade: '9.5' });
  });

  it('extracts CGC grade', () => {
    expect(extractGradeFromTitle('2020 Panini Tom Brady CGC 8')).toEqual({ company: 'CGC', grade: '8' });
  });

  it('extracts SGC grade', () => {
    expect(extractGradeFromTitle('1986 Fleer Michael Jordan SGC 9')).toEqual({ company: 'SGC', grade: '9' });
  });

  it('is case insensitive', () => {
    expect(extractGradeFromTitle('psa 10 Mike Trout')).toEqual({ company: 'PSA', grade: '10' });
    expect(extractGradeFromTitle('Psa 10 Mike Trout')).toEqual({ company: 'PSA', grade: '10' });
  });

  it('handles no space between company and grade', () => {
    expect(extractGradeFromTitle('Mike Trout PSA10 GEM MINT')).toEqual({ company: 'PSA', grade: '10' });
  });

  it('extracts Auth grade', () => {
    expect(extractGradeFromTitle('Tom Brady PSA Auth Signed')).toEqual({ company: 'PSA', grade: 'Auth' });
  });

  it('normalizes Authentic to Auth', () => {
    expect(extractGradeFromTitle('Tom Brady PSA Authentic')).toEqual({ company: 'PSA', grade: 'Auth' });
  });

  it('returns null when no grade present', () => {
    expect(extractGradeFromTitle('2023 Topps Mike Trout #1 Base')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractGradeFromTitle('')).toBeNull();
  });

  it('does not match non-grading abbreviations', () => {
    expect(extractGradeFromTitle('USA 10 Mike Trout Team Card')).toBeNull();
  });

  it('returns first match when multiple grades present', () => {
    expect(extractGradeFromTitle('PSA 10 BGS 9.5 Crossover')).toEqual({ company: 'PSA', grade: '10' });
  });

  it('extracts grade surrounded by text', () => {
    expect(extractGradeFromTitle('RARE 2023 Topps Mike Trout PSA 10 GEM MINT')).toEqual({ company: 'PSA', grade: '10' });
  });
});

describe('filterByGrade', () => {
  const mkSale = (title: string) => ({ title, price: 100, date: '2026-01-15' });

  it('excludes graded sales for ungraded request', () => {
    const sales = [mkSale('PSA 10 Trout'), mkSale('BGS 9.5 Trout'), mkSale('Raw Trout')];
    const request: CompRequest = { cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1' };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(1);
    expect((result[0] as { title: string }).title).toBe('Raw Trout');
  });

  it('returns empty for ungraded request when only graded sales exist', () => {
    // No graded fallback: an empty result is honest "no data", while graded
    // sales would poison a raw card's aggregate.
    const sales = [mkSale('PSA 10 Trout'), mkSale('SGC 9 Trout')];
    const request: CompRequest = { cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1' };
    expect(filterByGrade(sales, request)).toHaveLength(0);
  });

  it('returns all sales when gradingCompany is missing', () => {
    const sales = [mkSale('PSA 10 Trout'), mkSale('BGS 9.5 Trout')];
    const request: CompRequest = { cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1', isGraded: true, grade: '10' };
    expect(filterByGrade(sales, request)).toHaveLength(2);
  });

  it('returns all sales when grade is missing', () => {
    const sales = [mkSale('PSA 10 Trout'), mkSale('BGS 9.5 Trout')];
    const request: CompRequest = { cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1', isGraded: true, gradingCompany: 'PSA' };
    expect(filterByGrade(sales, request)).toHaveLength(2);
  });

  it('filters to matching grade when 3+ matches exist', () => {
    const sales = [
      mkSale('2023 Topps Trout PSA 10'),
      mkSale('2023 Topps Trout PSA 10 GEM'),
      mkSale('2023 Topps Trout PSA 10 Mint'),
      mkSale('2023 Topps Trout PSA 9'),
      mkSale('2023 Topps Trout BGS 10'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA 10'))).toBe(true);
  });

  it('returns exact matches when 2+ exist (lowered threshold)', () => {
    const sales = [
      mkSale('2023 Topps Trout PSA 10'),
      mkSale('2023 Topps Trout PSA 10 GEM'),
      mkSale('2023 Topps Trout PSA 9'),
      mkSale('2023 Topps Trout BGS 10'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(2); // 2 PSA 10 matches meet threshold
    expect(result.every(s => s.title.includes('PSA 10'))).toBe(true);
  });

  it('distinguishes company correctly (PSA 10 != BGS 10)', () => {
    const sales = [
      mkSale('Trout BGS 10'),
      mkSale('Trout BGS 10 Pristine'),
      mkSale('Trout BGS 10 Black Label'),
      mkSale('Trout PSA 10'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'BGS', grade: '10',
    };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('BGS 10'))).toBe(true);
  });

  it('matches case insensitively in titles', () => {
    const sales = [
      mkSale('Trout psa 10 gem'),
      mkSale('Trout PSA 10 mint'),
      mkSale('Trout Psa 10 nice'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(3);
  });

  it('handles mixed graded and ungraded listings', () => {
    const sales = [
      mkSale('Trout PSA 10'),
      mkSale('Trout PSA 10 GEM'),
      mkSale('Trout PSA 10 MINT'),
      mkSale('Trout raw card no grade'),
      mkSale('Trout base card'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA 10'))).toBe(true);
  });

  it('falls back to adjacent grades (tier 2) when < 2 exact', () => {
    const sales = [
      mkSale('Trout PSA 10'),
      mkSale('Trout PSA 9'),
      mkSale('Trout PSA 9 MINT'),
      mkSale('Trout BGS 10'),
      mkSale('Trout raw card'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    // 1 exact PSA 10, falls to tier 2: PSA 9 + PSA 10 = 3 adjacent matches
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA'))).toBe(true);
  });

  it('falls back to same company (tier 3) when < 2 adjacent', () => {
    const sales = [
      mkSale('Trout PSA 10'),
      mkSale('Trout PSA 7'),
      mkSale('Trout PSA 7 GEM'),
      mkSale('Trout BGS 10'),
      mkSale('Trout raw card'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    // 1 exact, adjacent (9,10) = 1 only PSA 10, falls to tier 3: all PSA = 3
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA'))).toBe(true);
  });

  it('falls back to all sales (tier 4) when < 2 same company', () => {
    const sales = [
      mkSale('Trout PSA 10'),
      mkSale('Trout BGS 9.5'),
      mkSale('Trout raw card'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request);
    // 1 exact, 1 adjacent, 1 same company — all < 2, return all
    expect(result).toHaveLength(3);
  });

  it('uses BGS half-point adjacent grades', () => {
    const sales = [
      mkSale('Trout BGS 9.5'),
      mkSale('Trout BGS 9'),
      mkSale('Trout BGS 9 GEM'),
      mkSale('Trout PSA 10'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'BGS', grade: '9.5',
    };
    const result = filterByGrade(sales, request);
    // 1 exact BGS 9.5, falls to tier 2: adjacent = 9.0 and 10.0, so BGS 9.5 + BGS 9 + BGS 9 = 3
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('BGS'))).toBe(true);
  });

  it('Auth grade has no adjacency — falls through tiers', () => {
    const sales = [
      mkSale('Trout PSA Auth'),
      mkSale('Trout PSA 10'),
      mkSale('Trout PSA 9'),
      mkSale('Trout raw card'),
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: 'Auth',
    };
    const result = filterByGrade(sales, request);
    // 1 exact Auth, no adjacent grades for Auth, tier 3: all PSA = 3
    expect(result).toHaveLength(3);
    expect(result.every(s => s.title.includes('PSA'))).toBe(true);
  });

  it('accepts a custom gradeExtractor', () => {
    const sales = [
      { id: 1, grade: '10' },
      { id: 2, grade: '10' },
      { id: 3, grade: '9' },
    ];
    const request: CompRequest = {
      cardId: '1', player: 'Mike Trout', year: 2023, brand: 'Topps', cardNumber: '1',
      isGraded: true, gradingCompany: 'PSA', grade: '10',
    };
    const result = filterByGrade(sales, request, (s) => {
      if (!s.grade) return null;
      return { company: 'PSA', grade: s.grade };
    });
    expect(result).toHaveLength(2);
    expect(result.every(s => s.grade === '10')).toBe(true);
  });
});

describe('getAdjacentGrades', () => {
  it('returns ±1 for PSA integer grade', () => {
    expect(getAdjacentGrades('PSA', '9')).toEqual(['8', '10']);
  });

  it('returns ±0.5 for BGS half-point scale', () => {
    expect(getAdjacentGrades('BGS', '9.5')).toEqual(['9', '10']);
  });

  it('returns ±0.5 for BVG half-point scale', () => {
    expect(getAdjacentGrades('BVG', '8')).toEqual(['7.5', '8.5']);
  });

  it('returns empty for Auth grade', () => {
    expect(getAdjacentGrades('PSA', 'Auth')).toEqual([]);
  });

  it('does not go below 1', () => {
    expect(getAdjacentGrades('PSA', '1')).toEqual(['2']);
  });

  it('does not go above 10', () => {
    expect(getAdjacentGrades('PSA', '10')).toEqual(['9']);
  });

  it('handles SGC integer grade', () => {
    expect(getAdjacentGrades('SGC', '8')).toEqual(['7', '9']);
  });

  it('is case insensitive for company', () => {
    expect(getAdjacentGrades('bgs', '9')).toEqual(['8.5', '9.5']);
  });
});
