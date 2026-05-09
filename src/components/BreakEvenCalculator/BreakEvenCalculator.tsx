import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../../types';
import {
  calculateBreakEven,
  calculateProfit,
  EBAY_FVF_RATE,
  EBAY_PER_ORDER_FEE,
  PROMOTED_RATES,
  SHIPPING_COSTS,
  ShippingMethod,
  PromotedTier,
} from '../../utils/breakEvenCalculator';
import { apiService } from '../../services/api';
import './BreakEvenCalculator.css';

interface BreakEvenCalculatorProps {
  card: Card;
  onClose: () => void;
}

export const BreakEvenCalculator: React.FC<BreakEvenCalculatorProps> = ({ card, onClose }) => {
  const [purchasePrice, setPurchasePrice] = useState(card.purchasePrice || 0);
  const [gradingCost, setGradingCost] = useState(0);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(
    card.isGraded ? 'SLAB' : 'BMWT'
  );
  const [promotedTier, setPromotedTier] = useState<PromotedTier>('none');
  const [salePrice, setSalePrice] = useState('');
  const [gradingLoading, setGradingLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchGradingCosts = async () => {
      if (!card.id) return;
      setGradingLoading(true);
      try {
        const submissions = await apiService.getGradingSubmissions({ cardId: card.id });
        if (!cancelled && submissions.length > 0) {
          const totalCost = submissions.reduce((sum, s) => sum + (s.cost || 0), 0);
          setGradingCost(totalCost);
        }
      } catch {
        // Grading data not available — leave at 0
      } finally {
        if (!cancelled) setGradingLoading(false);
      }
    };
    fetchGradingCosts();
    return () => { cancelled = true; };
  }, [card.id]);

  const shippingCost = SHIPPING_COSTS[shippingMethod];
  const promotedRate = PROMOTED_RATES[promotedTier];

  const breakEvenInput = useMemo(() => ({
    purchasePrice,
    gradingCost,
    shippingCost,
    fvfRate: EBAY_FVF_RATE,
    promotedRate,
    perOrderFee: EBAY_PER_ORDER_FEE,
  }), [purchasePrice, gradingCost, shippingCost, promotedRate]);

  const breakEven = useMemo(() => calculateBreakEven(breakEvenInput), [breakEvenInput]);

  const salePriceNum = parseFloat(salePrice) || 0;
  const profit = useMemo(
    () => salePriceNum > 0 ? calculateProfit({ ...breakEvenInput, salePrice: salePriceNum }) : null,
    [breakEvenInput, salePriceNum]
  );

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const currentValueDiff = card.currentValue - breakEven.breakEvenPrice;

  return (
    <div className="break-even-modal" onClick={onClose}>
      <div className="break-even-container" onClick={(e) => e.stopPropagation()}>
        <div className="break-even-header">
          <div>
            <h2>Break-Even Calculator</h2>
            <p className="break-even-card-name">{card.year} {card.brand} {card.player}{card.cardNumber ? ` #${card.cardNumber}` : ''}</p>
          </div>
          <button className="break-even-close" onClick={onClose}>x</button>
        </div>

        <div className="break-even-body">
          <div className="break-even-inputs">
            <h3>Costs</h3>

            <div className="be-field">
              <label htmlFor="be-purchase">Purchase Price</label>
              <div className="be-input-wrapper">
                <span className="be-input-prefix">$</span>
                <input
                  id="be-purchase"
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="be-field">
              <label htmlFor="be-grading">
                Grading Cost
                {gradingLoading && <span className="be-loading"> (loading...)</span>}
              </label>
              <div className="be-input-wrapper">
                <span className="be-input-prefix">$</span>
                <input
                  id="be-grading"
                  type="number"
                  min="0"
                  step="0.01"
                  value={gradingCost}
                  onChange={(e) => setGradingCost(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="be-field">
              <label htmlFor="be-shipping">Shipping Method</label>
              <select
                id="be-shipping"
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value as ShippingMethod)}
              >
                <option value="PWE">PWE - Plain White Envelope ({formatCurrency(SHIPPING_COSTS.PWE)})</option>
                <option value="BMWT">BMWT - Bubble Mailer ({formatCurrency(SHIPPING_COSTS.BMWT)})</option>
                <option value="SLAB">Slab - Graded Card ({formatCurrency(SHIPPING_COSTS.SLAB)})</option>
              </select>
            </div>

            <div className="be-field">
              <label htmlFor="be-promoted">Promoted Listing</label>
              <select
                id="be-promoted"
                value={promotedTier}
                onChange={(e) => setPromotedTier(e.target.value as PromotedTier)}
              >
                <option value="none">None (0%)</option>
                <option value="standard">Standard (~2%)</option>
                <option value="advanced">Advanced (~5%)</option>
              </select>
            </div>

            <div className="be-divider" />

            <h3>What-If Sale Price</h3>
            <div className="be-field">
              <label htmlFor="be-sale-price">Enter a sale price to see profit</label>
              <div className="be-input-wrapper">
                <span className="be-input-prefix">$</span>
                <input
                  id="be-sale-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={salePrice}
                  placeholder={breakEven.breakEvenPrice.toFixed(2)}
                  onChange={(e) => setSalePrice(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="break-even-results">
            <div className="be-break-even-price">
              <span className="be-label">Break-Even Price</span>
              <span className="be-price">{formatCurrency(breakEven.breakEvenPrice)}</span>
            </div>

            {card.currentValue > 0 && (
              <div className={`be-value-comparison ${currentValueDiff >= 0 ? 'above' : 'below'}`}>
                Current value {formatCurrency(card.currentValue)} is{' '}
                <strong>{formatCurrency(Math.abs(currentValueDiff))}</strong>{' '}
                {currentValueDiff >= 0 ? 'above' : 'below'} break-even
              </div>
            )}

            <div className="be-breakdown">
              <h3>Cost Breakdown</h3>
              <table className="be-table">
                <tbody>
                  <tr>
                    <td>Purchase Price</td>
                    <td>{formatCurrency(purchasePrice)}</td>
                  </tr>
                  <tr>
                    <td>Grading Cost</td>
                    <td>{formatCurrency(gradingCost)}</td>
                  </tr>
                  <tr>
                    <td>Shipping ({shippingMethod})</td>
                    <td>{formatCurrency(shippingCost)}</td>
                  </tr>
                  <tr className="be-subtotal">
                    <td>Total Costs</td>
                    <td>{formatCurrency(breakEven.totalCosts)}</td>
                  </tr>
                  <tr>
                    <td>eBay FVF (12.9%)</td>
                    <td>{formatCurrency(breakEven.ebayFees)}</td>
                  </tr>
                  {promotedRate > 0 && (
                    <tr>
                      <td>Promoted Listing ({(promotedRate * 100).toFixed(0)}%)</td>
                      <td>{formatCurrency(breakEven.promotedFees)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Per-Order Fee</td>
                    <td>{formatCurrency(EBAY_PER_ORDER_FEE)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {profit && (
              <div className={`be-profit-result ${profit.netProfit >= 0 ? 'profit' : 'loss'}`}>
                <div className="be-profit-row">
                  <span>Sale Price</span>
                  <span>{formatCurrency(salePriceNum)}</span>
                </div>
                <div className="be-profit-row">
                  <span>Total Deductions</span>
                  <span>-{formatCurrency(profit.totalDeductions)}</span>
                </div>
                <div className="be-profit-row be-profit-net">
                  <span>Net Profit</span>
                  <span>{formatCurrency(profit.netProfit)}</span>
                </div>
                <div className="be-profit-row">
                  <span>ROI</span>
                  <span>{profit.roi > 0 ? '+' : ''}{profit.roi.toFixed(1)}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
