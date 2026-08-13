import React, { useState, useMemo, useEffect } from 'react';
import { useCards } from '../../context/ApiCardContext';
import { Card } from '../../types';
import EbayExportHistory from './EbayExportHistory';
import apiService from '../../services/api';
import './EbayListings.css';

interface ListingRecommendation {
  card: Card;
  score: number;
  reasons: string[];
  suggestedPrice: number;
  profitMargin: number;
  profitPercent: number;
  holdingDays: number;
  priceRange: { min: number; max: number };
  listingTitle: string;
  category: string;
}

const EbayListings: React.FC = () => {
  const { state } = useCards();
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'profit' | 'percent' | 'holding'>('score');
  const [minProfit, setMinProfit] = useState<number>(0);
  const [showOnlyUnsold, setShowOnlyUnsold] = useState<boolean>(true);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [ebayExporting, setEbayExporting] = useState<boolean>(false);
  // Removed automatic export functionality

  const evaluateCard = (card: Card): ListingRecommendation | null => {
    // Only recommend Inventory cards for eBay listing
    if (card.collectionType !== 'Inventory') return null;

    // Skip already sold cards if filter is on
    if (showOnlyUnsold && card.sellDate) return null;

    const reasons: string[] = [];
    let score = 0;

    // Calculate basic metrics
    const profit = card.currentValue - card.purchasePrice;
    const profitPercent = (profit / card.purchasePrice) * 100;
    const holdingDays = Math.floor((new Date().getTime() - new Date(card.purchaseDate).getTime()) / (1000 * 60 * 60 * 24));

    // Skip if below minimum profit threshold
    if (profit < minProfit) return null;

    // Scoring criteria
    
    // 1. Profit margin (up to 30 points)
    if (profitPercent >= 100) {
      score += 30;
      reasons.push('💰 Excellent ROI (100%+)');
    } else if (profitPercent >= 50) {
      score += 25;
      reasons.push('📈 Strong ROI (50%+)');
    } else if (profitPercent >= 25) {
      score += 20;
      reasons.push('✅ Good ROI (25%+)');
    } else if (profitPercent >= 10) {
      score += 10;
      reasons.push('📊 Positive ROI');
    }

    // 2. Holding period (up to 20 points)
    if (holdingDays > 365) {
      score += 20;
      reasons.push('📅 Long hold (1+ year)');
    } else if (holdingDays > 180) {
      score += 15;
      reasons.push('📅 Medium hold (6+ months)');
    } else if (holdingDays > 90) {
      score += 10;
      reasons.push('📅 Quarterly hold');
    }

    // 3. Graded cards bonus (up to 20 points)
    if (card.gradingCompany) {
      score += 15;
      reasons.push('🏆 Professionally graded');
      
      // High grade bonus
      if (card.condition.includes('10') || card.condition.includes('9.5')) {
        score += 5;
        reasons.push('⭐ High grade');
      }
    }

    // 4. Popular categories (up to 15 points)
    if (['Basketball', 'Football', 'Baseball'].includes(card.category)) {
      score += 10;
      reasons.push('🔥 Popular sport');
    }

    // 5. Rookie card bonus (up to 15 points)
    if (card.notes?.toLowerCase().includes('rookie') || card.notes?.toLowerCase().includes('rc')) {
      score += 15;
      reasons.push('🌟 Rookie card');
    }

    // 6. Special cards (parallels, numbered, etc.)
    if (card.parallel) {
      score += 10;
      reasons.push('✨ Special parallel');
    }

    // 7. Market timing
    const currentMonth = new Date().getMonth();
    if (currentMonth >= 10 || currentMonth <= 1) { // Nov-Jan is peak season
      score += 5;
      reasons.push('🎄 Peak selling season');
    }

    // Skip if score is too low
    if (score < 20) return null;

    // Calculate price range (eBay typically sells 85-95% of current value)
    const priceRange = {
      min: Math.round(card.currentValue * 0.85),
      max: Math.round(card.currentValue * 0.95)
    };

    // Suggested starting price (start at 90% of current value)
    const suggestedPrice = Math.round(card.currentValue * 0.90);

    // Generate eBay listing title
    const listingTitle = generateListingTitle(card);

    // Determine eBay category
    const category = determineEbayCategory(card);

    return {
      card,
      score,
      reasons,
      suggestedPrice,
      profitMargin: profit,
      profitPercent,
      holdingDays,
      priceRange,
      listingTitle,
      category
    };
  };

  const generateListingTitle = (card: Card): string => {
    const parts = [];
    
    // Year and brand
    parts.push(`${card.year} ${card.brand}`);
    
    // Player name
    parts.push(card.player);
    
    // Card number
    parts.push(`#${card.cardNumber}`);
    
    // Parallel/variation
    if (card.parallel) {
      parts.push(card.parallel);
    }
    
    // Rookie indicator
    if (card.notes?.toLowerCase().includes('rookie')) {
      parts.push('RC ROOKIE');
    }
    
    // Grading info
    if (card.gradingCompany) {
      parts.push(`${card.gradingCompany} ${card.condition}`);
    }
    
    // Category
    parts.push(card.category);
    
    return parts.join(' ');
  };

  const determineEbayCategory = (card: Card): string => {
    const sportMap: Record<string, string> = {
      'Baseball': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Baseball',
      'Basketball': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Basketball',
      'Football': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Football',
      'Hockey': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Ice Hockey',
      'Soccer': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Soccer',
      'Pokemon': 'Toys & Hobbies > Collectible Card Games > Pokémon TCG',
      'Other': 'Sports Mem, Cards & Fan Shop > Sports Trading Cards > Other Sports'
    };
    
    return sportMap[card.category] || sportMap['Other'];
  };

  const handleBulkEbayExport = async () => {
    setEbayExporting(true);
    try {
      const result = await apiService.generateEbayCsv({
        priceMultiplier: 0.9,
      });

      const blob = await apiService.downloadEbayCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEbayExporting(false);
    }
  };

  const recommendations = useMemo(() => {
    const unsoldCards = showOnlyUnsold 
      ? state.cards.filter(card => !card.sellDate)
      : state.cards;

    const filtered = filterCategory === 'all'
      ? unsoldCards
      : unsoldCards.filter(card => card.category === filterCategory);

    const evaluated = filtered
      .map(card => evaluateCard(card))
      .filter((rec): rec is ListingRecommendation => rec !== null);

    // Sort based on selected criteria
    return evaluated.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.score - a.score;
        case 'profit':
          return b.profitMargin - a.profitMargin;
        case 'percent':
          return b.profitPercent - a.profitPercent;
        case 'holding':
          return b.holdingDays - a.holdingDays;
        default:
          return b.score - a.score;
      }
    });
  }, [state.cards, filterCategory, sortBy, minProfit, showOnlyUnsold]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const categories = Array.from(new Set(state.cards.map(card => card.category))).sort();

  const handleCreateDraft = (recommendation: ListingRecommendation) => {
    // Create a draft with the listing details
    const draft = {
      title: recommendation.listingTitle,
      startingPrice: recommendation.suggestedPrice,
      buyItNowPrice: recommendation.priceRange.max,
      category: recommendation.category,
      description: generateListingDescription(recommendation),
      condition: recommendation.card.condition,
      card: recommendation.card
    };

    // In a real app, this would save to a drafts collection or open eBay's listing tool
    console.log('Creating eBay draft:', draft);
    
    // Copy listing title to clipboard
    navigator.clipboard.writeText(recommendation.listingTitle).then(() => {
      alert('Listing title copied to clipboard! You can paste it into eBay.');
    });
  };

  const handleViewDetails = (card: Card) => {
    setSelectedCard(card);
    // In a real app, this would open the card detail modal
    console.log('Viewing card details:', card);
  };

  const generateListingDescription = (rec: ListingRecommendation): string => {
    const lines = [];
    
    lines.push(`${rec.card.year} ${rec.card.brand} ${rec.card.player} #${rec.card.cardNumber}`);
    
    if (rec.card.parallel) {
      lines.push(`Parallel: ${rec.card.parallel}`);
    }
    
    lines.push(`\nCondition: ${rec.card.condition}`);
    
    if (rec.card.gradingCompany) {
      lines.push(`Professionally graded by ${rec.card.gradingCompany}`);
    }
    
    lines.push(`\nCategory: ${rec.card.category}`);
    lines.push(`Team: ${rec.card.team}`);
    
    if (rec.card.notes) {
      lines.push(`\nAdditional Notes: ${rec.card.notes}`);
    }
    
    lines.push(`\n\nShipped with care in protective packaging.`);
    lines.push(`Please see photos for exact condition.`);
    
    return lines.join('\n');
  };

  return (
    <div className="ebay-listings">
      
      <div className="listings-header">
        <h1>eBay Listing Recommendations</h1>
        <p>AI-powered suggestions for your most profitable eBay listings</p>
        <div className="export-buttons">
          <button
            className="btn-bulk-export"
            onClick={handleBulkEbayExport}
            disabled={ebayExporting}
          >
            {ebayExporting
              ? 'Exporting...'
              : `Export eBay CSV (${state.cards.filter(c => !c.sellDate && c.collectionType === 'Inventory').length} unsold)`}
          </button>
        </div>
      </div>

      <div className="listings-controls">
        <div className="control-group">
          <label>Category</label>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Sort By</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="score">Recommendation Score</option>
            <option value="profit">Profit Amount</option>
            <option value="percent">Profit Percentage</option>
            <option value="holding">Holding Period</option>
          </select>
        </div>

        <div className="control-group">
          <label>Min Profit</label>
          <input
            type="number"
            value={minProfit}
            onChange={(e) => setMinProfit(Number(e.target.value))}
            min="0"
            step="10"
          />
        </div>

        <div className="control-group checkbox">
          <label>
            <input
              type="checkbox"
              checked={showOnlyUnsold}
              onChange={(e) => setShowOnlyUnsold(e.target.checked)}
            />
            Show only unsold cards
          </label>
        </div>
      </div>

      <div className="listings-summary">
        <div className="summary-stat">
          <span className="stat-label">Total Recommendations</span>
          <span className="stat-value">{recommendations.length}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total Potential Profit</span>
          <span className="stat-value">
            {formatCurrency(recommendations.reduce((sum, rec) => sum + rec.profitMargin, 0))}
          </span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Average ROI</span>
          <span className="stat-value">
            {recommendations.length > 0 
              ? `${(recommendations.reduce((sum, rec) => sum + rec.profitPercent, 0) / recommendations.length).toFixed(1)}%`
              : '0%'
            }
          </span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Est. Listing Value</span>
          <span className="stat-value">
            {formatCurrency(recommendations.reduce((sum, rec) => sum + rec.suggestedPrice, 0))}
          </span>
        </div>
      </div>

      <div className="listings-grid">
        {recommendations.map((rec) => (
          <div 
            key={rec.card.id} 
            className="listing-card"
            data-high-score={rec.score >= 60 ? "true" : "false"}
          >
            <div className="listing-score">
              <div className="score-circle">
                <span className="score-value">{rec.score}</span>
                <span className="score-label">Score</span>
              </div>
            </div>

            <div className="listing-content">
              <h3>{rec.card.player}</h3>
              <p className="card-details">
                {rec.card.year} {rec.card.brand}{rec.card.cardNumber ? ` #${rec.card.cardNumber}` : ''}
                {rec.card.parallel && ` - ${rec.card.parallel}`}
              </p>

              <div className="listing-metrics">
                <div className="metric">
                  <span className="metric-label">Current Value</span>
                  <span className="metric-value">{formatCurrency(rec.card.currentValue)}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Suggested Price</span>
                  <span className="metric-value suggested">{formatCurrency(rec.suggestedPrice)}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Profit</span>
                  <span className="metric-value profit">
                    {formatCurrency(rec.profitMargin)} ({rec.profitPercent.toFixed(1)}%)
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-label">Held for</span>
                  <span className="metric-value">{rec.holdingDays} days</span>
                </div>
              </div>

              <div className="listing-reasons">
                <h4>Why sell now?</h4>
                <ul>
                  {rec.reasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>

              <div className="listing-details">
                <div className="detail-section">
                  <h4>Suggested Listing Title</h4>
                  <p className="listing-title">{rec.listingTitle}</p>
                </div>

                <div className="detail-section">
                  <h4>Price Range</h4>
                  <p className="price-range">
                    {formatCurrency(rec.priceRange.min)} - {formatCurrency(rec.priceRange.max)}
                  </p>
                </div>

                <div className="detail-section">
                  <h4>eBay Category</h4>
                  <p className="category-path">{rec.category}</p>
                </div>
              </div>

              <div className="listing-actions">
                <button 
                  className="btn-create-listing"
                  onClick={() => handleCreateDraft(rec)}
                >
                  Create eBay Draft
                </button>
                <button 
                  className="btn-view-details"
                  onClick={() => handleViewDetails(rec.card)}
                >
                  View Card Details
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {state.cards.some(c => c.collectionType === 'PC') && (
        <div className="pc-exclusion-note" style={{ padding: '8px 16px', margin: '0 0 16px', background: '#f0f4ff', borderRadius: '6px', fontSize: '0.85rem', color: '#555' }}>
          Personal Collection cards are excluded from all eBay exports and recommendations.
        </div>
      )}

      {recommendations.length === 0 && (
        <div className="no-recommendations">
          <p>No cards meet the current criteria for eBay listing.</p>
          <p>Try adjusting your filters or wait for better market conditions.</p>
        </div>
      )}
      
      <EbayExportHistory />

    </div>
  );
};

export default EbayListings;