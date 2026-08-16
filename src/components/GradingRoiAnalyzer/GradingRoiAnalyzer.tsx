import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../../types';
import {
  calculateGradingRoi,
  getGradingCost,
  GRADING_COSTS,
  DEFAULT_GRADING_SHIPPING,
  PSA_TIER_MAX_INSURED,
  minEligiblePsaTier,
  GradingRoiInput,
} from '../../utils/gradingRoiCalculator';
import { apiService } from '../../services/api';
import './GradingRoiAnalyzer.css';

interface GradingRoiAnalyzerProps {
  card: Card;
  onClose: () => void;
}

const CONDITION_OPTIONS = [
  'Near Mint-Mint',
  'Near Mint',
  'Excellent-Mint',
  'Excellent',
  'Very Good',
];

const COMPANY_KEYS = Object.keys(GRADING_COSTS);

export const GradingRoiAnalyzer: React.FC<GradingRoiAnalyzerProps> = ({ card, onClose }) => {
  const [condition, setCondition] = useState(
    card.condition || 'Near Mint-Mint'
  );
  const [gradingCompany, setGradingCompany] = useState('PSA');
  const [gradingTier, setGradingTier] = useState(() => minEligiblePsaTier(card.currentValue || 0));
  const [rawValue, setRawValue] = useState(card.currentValue || 0);
  const [purchasePrice, setPurchasePrice] = useState(card.purchasePrice || 0);
  const [shippingCost, setShippingCost] = useState<number>(DEFAULT_GRADING_SHIPPING);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkSubmissions = async () => {
      if (!card.id) return;
      setSubmissionLoading(true);
      try {
        const submissions = await apiService.getGradingSubmissions({ cardId: card.id });
        if (!cancelled && submissions.length > 0) {
          setAlreadySubmitted(true);
        }
      } catch {
        // Not critical — ignore
      } finally {
        if (!cancelled) setSubmissionLoading(false);
      }
    };
    checkSubmissions();
    return () => { cancelled = true; };
  }, [card.id]);

  const tiers = useMemo(() => {
    return Object.keys(GRADING_COSTS[gradingCompany] || {});
  }, [gradingCompany]);

  // Reset tier when company changes
  useEffect(() => {
    if (!tiers.includes(gradingTier)) {
      setGradingTier(tiers[0] || 'Regular');
    }
  }, [tiers, gradingTier]);

  const input: GradingRoiInput = useMemo(() => ({
    rawValue,
    purchasePrice,
    condition,
    gradingCompany,
    gradingTier,
    shippingCost,
  }), [rawValue, purchasePrice, condition, gradingCompany, gradingTier, shippingCost]);

  const result = useMemo(() => calculateGradingRoi(input), [input]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatPercent = (pct: number) =>
    `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

  const recommendationClass =
    result.recommendation === 'Grade' ? 'grade' :
    result.recommendation === "Don't Grade" ? 'dont-grade' :
    'borderline';

  return (
    <div className="grading-roi-modal" onClick={onClose}>
      <div className="grading-roi-container" onClick={(e) => e.stopPropagation()}>
        <div className="grading-roi-header">
          <div>
            <h2>Grading ROI Analysis</h2>
            <p className="grading-roi-card-name">
              {card.year} {card.brand} {card.player} #{card.cardNumber}
            </p>
          </div>
          <button className="grading-roi-close" onClick={onClose}>x</button>
        </div>

        <div className="grading-roi-body">
          <div className="grading-roi-inputs">
            <h3>Card Details</h3>

            <div className="gr-field">
              <label htmlFor="gr-condition">Condition</label>
              <select
                id="gr-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                {CONDITION_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="gr-field">
              <label htmlFor="gr-company">Grading Company</label>
              <select
                id="gr-company"
                value={gradingCompany}
                onChange={(e) => setGradingCompany(e.target.value)}
              >
                {COMPANY_KEYS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="gr-field">
              <label htmlFor="gr-tier">Service Tier</label>
              <select
                id="gr-tier"
                value={gradingTier}
                onChange={(e) => setGradingTier(e.target.value)}
              >
                {tiers.map(t => {
                  const maxIns = gradingCompany === 'PSA' ? PSA_TIER_MAX_INSURED[t] : undefined;
                  const ineligible = maxIns !== undefined && isFinite(maxIns) && rawValue > maxIns;
                  return (
                    <option key={t} value={t} disabled={ineligible}>
                      {t} ({formatCurrency(getGradingCost(gradingCompany, t))})
                      {maxIns !== undefined && isFinite(maxIns) ? ` — insures to ${formatCurrency(maxIns)}` : ''}
                      {ineligible ? ' — value too high' : ''}
                    </option>
                  );
                })}
              </select>
              {gradingCompany === 'PSA' && PSA_TIER_MAX_INSURED[gradingTier] !== undefined &&
                isFinite(PSA_TIER_MAX_INSURED[gradingTier]) && rawValue > PSA_TIER_MAX_INSURED[gradingTier] && (
                <p className="gr-tier-warning">
                  This tier insures up to {formatCurrency(PSA_TIER_MAX_INSURED[gradingTier])} — a
                  card declared at {formatCurrency(rawValue)} requires {minEligiblePsaTier(rawValue)}.
                </p>
              )}
            </div>

            <div className="gr-field">
              <label htmlFor="gr-raw-value">Raw Value</label>
              <div className="gr-input-wrapper">
                <span className="gr-input-prefix">$</span>
                <input
                  id="gr-raw-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={rawValue}
                  onChange={(e) => setRawValue(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="gr-field">
              <label htmlFor="gr-purchase-price" title="What you actually paid. When set, ROI is measured against this cost basis instead of the raw market value. Leave 0 if unknown.">
                Purchase Price
              </label>
              <div className="gr-input-wrapper">
                <span className="gr-input-prefix">$</span>
                <input
                  id="gr-purchase-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="gr-field">
              <label htmlFor="gr-shipping">Shipping Cost</label>
              <div className="gr-input-wrapper">
                <span className="gr-input-prefix">$</span>
                <input
                  id="gr-shipping"
                  type="number"
                  min="0"
                  step="0.01"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            {alreadySubmitted && (
              <div className="gr-submitted-notice">
                This card has an existing grading submission.
              </div>
            )}
            {submissionLoading && (
              <div className="gr-loading">Checking grading submissions...</div>
            )}
          </div>

          <div className="grading-roi-results">
            <div className={`gr-recommendation ${recommendationClass}`}>
              <span className="gr-recommendation-label">Recommendation</span>
              <span className="gr-recommendation-value">{result.recommendation}</span>
            </div>

            <div className="gr-roi-summary">
              <div className="gr-summary-item">
                <span className="gr-summary-label">Expected ROI</span>
                <span className={`gr-summary-value ${result.expectedRoi >= 0 ? 'positive' : 'negative'}`}>
                  {formatPercent(result.expectedRoi)}
                </span>
              </div>
              <div className="gr-summary-item">
                <span className="gr-summary-label">Expected Value</span>
                <span className="gr-summary-value">{formatCurrency(result.expectedValue)}</span>
              </div>
              <div className="gr-summary-item">
                <span className="gr-summary-label">Grading Cost</span>
                <span className="gr-summary-value">{formatCurrency(result.gradingCost)}</span>
              </div>
              <div className="gr-summary-item">
                <span className="gr-summary-label">Total Investment</span>
                <span className="gr-summary-value">{formatCurrency(result.totalInvestment)}</span>
              </div>
              <div className="gr-summary-item">
                <span className="gr-summary-label">Expected Profit</span>
                <span className={`gr-summary-value ${result.expectedProfit >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(result.expectedProfit)}
                </span>
              </div>
              {result.breakEvenGrade && (
                <div className="gr-summary-item">
                  <span className="gr-summary-label">Break-Even Grade</span>
                  <span className="gr-summary-value">{result.breakEvenGrade}</span>
                </div>
              )}
            </div>

            <div className="gr-projections">
              <h3>Grade Projections</h3>
              <table className="gr-table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Probability</th>
                    <th>Projected Value</th>
                    <th>Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {result.projections.map((p) => (
                    <tr
                      key={p.grade}
                      className={`
                        ${p.grade === result.breakEvenGrade ? 'gr-break-even-row' : ''}
                        ${p.netProfit >= 0 ? 'gr-profit-row' : 'gr-loss-row'}
                      `}
                    >
                      <td className="gr-grade-cell">{p.grade}</td>
                      <td>{(p.probability * 100).toFixed(0)}%</td>
                      <td>{formatCurrency(p.projectedValue)}</td>
                      <td className={p.netProfit >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(p.netProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
