import React, { memo, useMemo, useState } from 'react';
import { useCards } from '../../context/ApiCardContext';
import { CollectionType } from '../../types';
import './Dashboard.css';

type DashboardView = 'all' | 'Inventory' | 'PC' | 'Pending';

const Dashboard: React.FC = () => {
  const { state, getPortfolioStats } = useCards();
  const [activeView, setActiveView] = useState<DashboardView>('all');
  const stats = getPortfolioStats(activeView === 'all' ? undefined : activeView as CollectionType);

  const formatCurrency = (amount: number) => {
    // For very large numbers, use compact notation
    if (Math.abs(amount) >= 1000000) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1
      }).format(amount);
    }
    
    // For medium numbers, show thousands with K
    if (Math.abs(amount) >= 10000) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 0
      }).format(amount);
    }
    
    // For smaller numbers, use standard notation
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const viewCards = useMemo(() => {
    if (activeView === 'all') return state.cards;
    return state.cards.filter(card => card.collectionType === activeView);
  }, [state.cards, activeView]);

  const recentCards = useMemo(() => {
    return [...viewCards]
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [viewCards]);

  const topPerformers = useMemo(() => {
    return [...viewCards]
      .map(card => ({
        ...card,
        profit: card.currentValue - card.purchasePrice,
        profitPercent: ((card.currentValue - card.purchasePrice) / card.purchasePrice) * 100
      }))
      .sort((a, b) => b.profitPercent - a.profitPercent)
      .slice(0, 5);
  }, [viewCards]);

  return (
    <div className="dashboard">
      <h1>Portfolio Dashboard</h1>

      <div className="dashboard-view-tabs">
        <button
          className={`view-tab ${activeView === 'all' ? 'active' : ''}`}
          onClick={() => setActiveView('all')}
        >
          All
        </button>
        <button
          className={`view-tab ${activeView === 'Inventory' ? 'active' : ''}`}
          onClick={() => setActiveView('Inventory')}
        >
          Inventory
        </button>
        <button
          className={`view-tab ${activeView === 'PC' ? 'active' : ''}`}
          onClick={() => setActiveView('PC')}
        >
          Personal Collection
        </button>
        <button
          className={`view-tab ${activeView === 'Pending' ? 'active' : ''}`}
          onClick={() => setActiveView('Pending')}
        >
          Pending
          {state.cards.filter(c => c.collectionType === 'Pending').length > 0 && (
            <span className="pending-badge">
              {state.cards.filter(c => c.collectionType === 'Pending').length}
            </span>
          )}
        </button>
      </div>

      <div className="stats-section">
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Cards</h3>
            <p className="stat-value">{stats.totalCards}</p>
          </div>
          
          <div className="stat-card">
            <h3>Total Investment</h3>
            <p className="stat-value">{formatCurrency(stats.totalCostBasis)}</p>
          </div>
          
          <div className="stat-card">
            <h3>Current Value</h3>
            <p className="stat-value">{formatCurrency(stats.totalCurrentValue)}</p>
          </div>
          
          <div className="stat-card">
            <h3>Total P&L</h3>
            <p className={`stat-value ${stats.totalProfit >= 0 ? 'profit' : 'loss'}`}>
              {formatCurrency(stats.totalProfit)}
            </p>
          </div>
          
          <div className="stat-card">
            <h3>Cards Sold</h3>
            <p className="stat-value">{stats.totalSold}</p>
          </div>
          
          <div className="stat-card">
            <h3>Sales Revenue</h3>
            <p className="stat-value">{formatCurrency(stats.totalSoldValue)}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-sections">
        <div className="recent-cards">
          <h2>Recent Additions</h2>
          {recentCards.length > 0 ? (
            <div className="card-list">
              {recentCards.map(card => (
                <div key={card.id} className="card-item">
                  <div className="card-info">
                    <strong>{card.year} {card.brand} {card.player}</strong>
                    <span>{card.team}{card.cardNumber ? ` - #${card.cardNumber}` : ''}</span>
                  </div>
                  <div className="card-value">
                    {formatCurrency(card.currentValue)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No cards added yet.</p>
          )}
        </div>

        <div className="top-performers">
          <h2>Top Performers</h2>
          {topPerformers.length > 0 ? (
            <div className="card-list">
              {topPerformers.map(card => (
                <div key={card.id} className="card-item">
                  <div className="card-info">
                    <strong>{card.year} {card.brand} {card.player}</strong>
                    <span>{card.team}{card.cardNumber ? ` - #${card.cardNumber}` : ''}</span>
                  </div>
                  <div className="card-performance">
                    <span className={`profit ${card.profit >= 0 ? 'positive' : 'negative'}`}>
                      {formatCurrency(card.profit)}
                    </span>
                    <span className={`percent ${card.profitPercent >= 0 ? 'positive' : 'negative'}`}>
                      ({card.profitPercent > 0 ? '+' : ''}{card.profitPercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No performance data available yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(Dashboard);