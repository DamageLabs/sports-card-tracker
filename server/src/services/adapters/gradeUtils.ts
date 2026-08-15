import { CompRequest } from '../../types';

const GRADE_REGEX = /\b(PSA|BGS|SGC|CGC|HGA|BVG|GMA|MNT|CSG|AGS)\s*(\d+(?:\.\d+)?|Auth(?:entic)?)\b/i;

export type GradeInfo = { company: string; grade: string };

export function extractGradeFromTitle(title: string): GradeInfo | null {
  const match = title.match(GRADE_REGEX);
  if (!match) return null;
  const company = match[1].toUpperCase();
  let grade = match[2];
  if (/^auth/i.test(grade)) grade = 'Auth';
  return { company, grade };
}

// Companies that use half-point grading steps (±0.5)
const HALF_STEP_COMPANIES = new Set(['BGS', 'BVG']);

function formatGrade(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function getAdjacentGrades(company: string, grade: string): string[] {
  if (/^auth$/i.test(grade)) return [];

  const numeric = parseFloat(grade);
  if (isNaN(numeric)) return [];

  const step = HALF_STEP_COMPANIES.has(company.toUpperCase()) ? 0.5 : 1;
  const adjacent: string[] = [];

  const lower = numeric - step;
  if (lower >= 1) adjacent.push(formatGrade(lower));

  const upper = numeric + step;
  if (upper <= 10) adjacent.push(formatGrade(upper));

  return adjacent;
}

const MIN_THRESHOLD = 2;

export function filterByGrade<T>(
  sales: T[],
  request: CompRequest,
  gradeExtractor?: (sale: T) => GradeInfo | null
): T[] {
  const extract = gradeExtractor ?? ((s: T) => {
    const rec = s as Record<string, unknown>;
    if (typeof rec.title === 'string') return extractGradeFromTitle(rec.title);
    return null;
  });

  // Raw card: graded sales price a different asset (often 10-50x), so exclude
  // any sale whose title carries a grading marker. No graded fallback — zero
  // ungraded sales is an honest "no data", while graded sales would poison
  // the aggregate the way a wrong-card match does.
  if (!request.isGraded) {
    return sales.filter(s => extract(s) === null);
  }

  // Graded but company/grade unknown: can't target a grade, keep everything.
  if (!request.gradingCompany || !request.grade) return sales;

  const targetCompany = request.gradingCompany.toUpperCase();
  const targetGrade = request.grade;

  // Tier 1: exact match (same company + same grade)
  const exact = sales.filter(s => {
    const info = extract(s);
    if (!info) return false;
    return info.company === targetCompany && info.grade === targetGrade;
  });
  if (exact.length >= MIN_THRESHOLD) return exact;

  // Tier 2: adjacent grade (same company, grade ±1 step)
  const adjacentGrades = getAdjacentGrades(targetCompany, targetGrade);
  if (adjacentGrades.length > 0) {
    const adjacentSet = new Set([targetGrade, ...adjacentGrades]);
    const adjacent = sales.filter(s => {
      const info = extract(s);
      if (!info) return false;
      return info.company === targetCompany && adjacentSet.has(info.grade);
    });
    if (adjacent.length >= MIN_THRESHOLD) return adjacent;
  }

  // Tier 3: same company, any grade
  const sameCompany = sales.filter(s => {
    const info = extract(s);
    if (!info) return false;
    return info.company === targetCompany;
  });
  if (sameCompany.length >= MIN_THRESHOLD) return sameCompany;

  // Tier 4: all sales
  return sales;
}
