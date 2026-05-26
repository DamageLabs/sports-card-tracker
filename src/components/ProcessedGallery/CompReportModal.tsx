import React, { useEffect, useCallback, useState } from 'react';
import { CompReport, CompResult, PopRarityTier } from '../../services/api';

interface CompReportModalProps {
  report: CompReport;
  onClose: () => void;
  onRefresh?: (cardId: string) => Promise<CompReport>;
}

function formatPrice(value: number | null): string {
  if (value === null) return '--';
  return '$' + value.toFixed(2);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const SourceSection: React.FC<{ result: CompResult }> = ({ result }) => {
  if (result.error) {
    return (
      <div className="comp-report-source">
        <div className="comp-report-source-header">
          <span className="comp-report-source-name">{result.source}</span>
          <span className="comp-report-source-error">Error</span>
        </div>
        <p className="comp-report-error-msg">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="comp-report-source">
      <div className="comp-report-source-header">
        <span className="comp-report-source-name">{result.source}</span>
        {result.marketValue !== null && (
          <span className="comp-report-market-value">{formatPrice(result.marketValue)}</span>
        )}
      </div>
      <div className="comp-report-source-stats">
        <span>Avg: {formatPrice(result.averagePrice)}</span>
        <span>Low: {formatPrice(result.low)}</span>
        <span>High: {formatPrice(result.high)}</span>
      </div>
      {result.sales.length > 0 && (
        <div className="comp-report-sales">
          <div className="comp-report-sales-header">Recent Sales</div>
          {result.sales.slice(0, 5).map((sale, i) => (
            <div key={i} className="comp-report-sale-row">
              <span className="comp-report-sale-date">{formatDate(sale.date)}</span>
              <span className="comp-report-sale-venue">{sale.venue}</span>
              {sale.grade && <span className="comp-report-sale-grade">{sale.grade}</span>}
              <span className="comp-report-sale-price">{formatPrice(sale.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function getRarityBadgeClass(tier: PopRarityTier): string {
  switch (tier) {
    case 'ultra-low':
    case 'low':
      return 'rarity-low';
    case 'medium':
      return 'rarity-medium';
    case 'high':
    case 'very-high':
      return 'rarity-high';
  }
}

const CompReportModal: React.FC<CompReportModalProps> = ({ report, onClose, onRefresh }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [currentReport, setCurrentReport] = useState(report);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  useEffect(() => {
    setCurrentReport(report);
  }, [report]);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      const updated = await onRefresh(currentReport.cardId);
      setCurrentReport(updated);
    } catch {
      // Error handled by parent
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="comp-report-overlay" onClick={onClose}>
      <div className="comp-report-panel" onClick={e => e.stopPropagation()}>
        <div className="comp-report-header">
          <div>
            <h3 className="comp-report-title">{currentReport.player}</h3>
            <p className="comp-report-subtitle">
              {currentReport.year} {currentReport.brand}{currentReport.cardNumber ? ` #${currentReport.cardNumber}` : ''}
              {currentReport.condition && <> &middot; {currentReport.condition}</>}
            </p>
          </div>
          <button className="comp-report-close" onClick={onClose}>&times;</button>
        </div>

        {/* Aggregate section */}
        <div className="comp-report-aggregate">
          <div className="comp-report-aggregate-item">
            <span className="comp-report-aggregate-label">Average</span>
            <span className="comp-report-aggregate-value">{formatPrice(currentReport.aggregateAverage)}</span>
          </div>
          <div className="comp-report-aggregate-item">
            <span className="comp-report-aggregate-label">Median</span>
            <span className="comp-report-aggregate-value">{formatPrice(currentReport.aggregateMedian)}</span>
          </div>
          <div className="comp-report-aggregate-item">
            <span className="comp-report-aggregate-label">Low</span>
            <span className="comp-report-aggregate-value">{formatPrice(currentReport.aggregateLow)}</span>
          </div>
          <div className="comp-report-aggregate-item">
            <span className="comp-report-aggregate-label">High</span>
            <span className="comp-report-aggregate-value">{formatPrice(currentReport.aggregateHigh)}</span>
          </div>
        </div>

        {/* Pop report section */}
        {currentReport.popData && (
          <div className="comp-report-pop-section">
            <div className="comp-report-pop-header">
              <span className="comp-report-pop-title">Population Report</span>
              <span className={`comp-report-pop-rarity-badge ${getRarityBadgeClass(currentReport.popData.rarityTier)}`}>
                {currentReport.popData.rarityTier}
              </span>
            </div>
            <div className="comp-report-pop-stats">
              <span>{currentReport.popData.gradingCompany} {currentReport.popData.targetGrade} Pop: {currentReport.popData.targetGradePop}</span>
              <span>Total Graded: {currentReport.popData.totalGraded}</span>
              <span>Top {currentReport.popData.percentile}%</span>
            </div>
            {currentReport.popAdjustedAverage !== null && currentReport.popAdjustedAverage !== undefined && currentReport.popMultiplier !== undefined && (
              <div className="comp-report-pop-adjusted-value">
                Pop-Adjusted: {formatPrice(currentReport.popAdjustedAverage)}
                <span className="comp-report-pop-multiplier">
                  ({currentReport.popMultiplier >= 1 ? '+' : ''}{Math.round((currentReport.popMultiplier - 1) * 100)}%)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Per-source sections */}
        <div className="comp-report-sources">
          {currentReport.sources.filter(s => !s.error).map(source => (
            <SourceSection key={source.source} result={source} />
          ))}
        </div>

        <div className="comp-report-footer">
          <span>Generated {formatDateTime(currentReport.generatedAt)}</span>
          {onRefresh && (
            <button
              className="comp-report-refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing...' : 'Rerun Comps'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompReportModal;
