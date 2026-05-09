import React, { useState, useMemo, useEffect, memo, useCallback } from 'react';
import { useCards } from '../../context/ApiCardContext';
import { Card, FilterOptions, SortOption, COLLECTION_TYPES } from '../../types';
import LoadingSkeleton from '../LoadingSkeleton/LoadingSkeleton';
import MoveCardsModal from '../MoveCardsModal/MoveCardsModal';
import { apiService, PopRarityTier } from '../../services/api';
import './CardList.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

function cardImageUrl(filename: string): string {
  return `${API_BASE_URL}/files/processed/${encodeURIComponent(filename)}`;
}

interface CardListProps {
  onCardSelect?: (card: Card) => void;
  onEditCard?: (card: Card) => void;
  selectedCollectionId?: string | null;
}

const CardList: React.FC<CardListProps> = ({ onCardSelect, onEditCard, selectedCollectionId }) => {
  const { state, deleteCard, setCards } = useCards();
  const [filters, setFilters] = useState<FilterOptions>({});
  const [sortOption, setSortOption] = useState<SortOption>({ field: 'createdAt', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [ebayExporting, setEbayExporting] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<any>(null);
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [popTiers, setPopTiers] = useState<Map<string, PopRarityTier>>(new Map());
  const [popPrices, setPopPrices] = useState<Map<string, number>>(new Map());
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());

  // Load pop tiers and prices
  useEffect(() => {
    apiService.getPopSummary().then(summary => {
      const tiers = new Map<string, PopRarityTier>();
      const prices = new Map<string, number>();
      for (const entry of summary) {
        tiers.set(entry.cardId, entry.rarityTier);
        if (entry.popAdjustedAverage != null && entry.popAdjustedAverage > 0) {
          prices.set(entry.cardId, entry.popAdjustedAverage);
        }
      }
      if (tiers.size > 0) setPopTiers(tiers);
      if (prices.size > 0) setPopPrices(prices);
    }).catch(() => { /* non-critical */ });
  }, []);

  // Load the set of card ids that have been exported to eBay
  useEffect(() => {
    apiService.getExportedCardIds()
      .then(ids => { if (ids.length > 0) setExportedIds(new Set(ids)); })
      .catch(() => { /* non-critical */ });
  }, []);

  // Load collection info when selectedCollectionId changes
  React.useEffect(() => {
    if (selectedCollectionId) {
      apiService.getCollection(selectedCollectionId).then(collection => {
        setSelectedCollection(collection);
      }).catch(() => {
        setSelectedCollection(null);
      });
    } else {
      setSelectedCollection(null);
    }
  }, [selectedCollectionId]);


  const filteredAndSortedCards = useMemo(() => {
    let filtered = state.cards.filter(card => {
      // First apply collection filter if provided
      if (selectedCollectionId && card.collectionId !== selectedCollectionId) {
        return false;
      }

      const matchesCollectionType = !filters.collectionType || card.collectionType === filters.collectionType;

      const matchesSearch = searchTerm === '' ||
        card.player.toLowerCase().includes(searchTerm.toLowerCase()) ||
        card.team.toLowerCase().includes(searchTerm.toLowerCase()) ||
        card.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
        card.category.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesPlayer = !filters.player ||
        card.player.toLowerCase().includes(filters.player.toLowerCase());

      const matchesTeam = !filters.team ||
        card.team.toLowerCase().includes(filters.team.toLowerCase());

      const matchesYear = !filters.year || card.year === filters.year;

      const matchesBrand = !filters.brand ||
        card.brand.toLowerCase().includes(filters.brand.toLowerCase());

      const matchesCategory = !filters.category || card.category === filters.category;

      const matchesCondition = !filters.condition || card.condition === filters.condition;

      const matchesMinValue = !filters.minValue || card.currentValue >= filters.minValue;

      const matchesMaxValue = !filters.maxValue || card.currentValue <= filters.maxValue;

      const matchesSoldStatus = !filters.soldStatus ||
        (filters.soldStatus === 'sold' ? !!card.sellDate : !card.sellDate);

      return matchesCollectionType && matchesSearch && matchesPlayer && matchesTeam && matchesYear &&
             matchesBrand && matchesCategory && matchesCondition && matchesMinValue && matchesMaxValue &&
             matchesSoldStatus;
    });

    filtered.sort((a, b) => {
      const aValue = a[sortOption.field] as any;
      const bValue = b[sortOption.field] as any;
      
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (aValue < bValue) return sortOption.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOption.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [state.cards, filters, sortOption, searchTerm, selectedCollectionId]);

  const handleDeleteCard = useCallback(async (cardId: string) => {
    if (window.confirm('Are you sure you want to delete this card?')) {
      try {
        await deleteCard(cardId);
      } catch (error) {
        alert(`Failed to delete card: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }, [deleteCard]);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchTerm('');
  }, []);

  const toggleCardSelection = useCallback((cardId: string) => {
    setSelectedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedCards(new Set(filteredAndSortedCards.map(card => card.id)));
  }, [filteredAndSortedCards]);

  const clearSelection = useCallback(() => {
    setSelectedCards(new Set());
  }, []);

  const handleBulkEbayExport = useCallback(async () => {
    setEbayExporting(true);
    try {
      const cardIds = selectedCards.size > 0
        ? Array.from(selectedCards)
        : filteredAndSortedCards.map(c => c.id);

      const result = await apiService.generateEbayCsv({
        priceMultiplier: 0.9,
        cardIds,
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
  }, [selectedCards, filteredAndSortedCards]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedCards.size === 0) return;
    const count = selectedCards.size;
    const confirmMsg = `Delete ${count} card${count !== 1 ? 's' : ''}? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const ids = Array.from(selectedCards);
    const results = await Promise.allSettled(ids.map(id => deleteCard(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    const succeeded = results.length - failed;

    if (failed > 0) {
      alert(`Deleted ${succeeded} of ${count}. ${failed} failed — check the console for details.`);
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`Delete failed for ${ids[i]}:`, r.reason);
      });
    }

    clearSelection();
  }, [selectedCards, deleteCard, clearSelection]);

  const handleMoveCards = useCallback(async (cardIds: string[], targetCollectionId: string) => {
    try {
      await apiService.moveCardsToCollection(cardIds, targetCollectionId);

      // Reload cards from API to get the latest state
      const freshCards = await apiService.getAllCards();
      setCards(freshCards);

      clearSelection();
      setShowMoveModal(false);
    } catch (error) {
      console.error('Error moving cards:', error);
      // Reload from API to ensure consistency
      const freshCards = await apiService.getAllCards();
      setCards(freshCards);
      throw error;
    }
  }, [clearSelection, setCards]);

  const uniqueValues = useMemo(() => ({
    teams: [...new Set(state.cards.map(card => card.team))].sort(),
    brands: [...new Set(state.cards.map(card => card.brand))].sort(),
    categories: [...new Set(state.cards.map(card => card.category))].sort(),
    conditions: [...new Set(state.cards.map(card => card.condition))].sort(),
    years: [...new Set(state.cards.map(card => card.year))].sort((a, b) => b - a)
  }), [state.cards]);

  if (state.loading) {
    return (
      <div className="card-list-container">
        <div className="card-list-header">
          <h1>Card Inventory</h1>
          <div className="card-count">Loading...</div>
        </div>
        <LoadingSkeleton count={6} type="card" />
      </div>
    );
  }

  return (
    <div className="card-list-container">
      <div className="card-list-header">
        <h1>
          {selectedCollection ? (
            <>
              <span style={{ color: selectedCollection.color }}>{selectedCollection.icon}</span> {selectedCollection.name}
            </>
          ) : (
            'Card Inventory'
          )}
        </h1>
        <div className="card-count">
          {filteredAndSortedCards.length} of {state.cards.length} cards
          {selectedCollection && (
            <button 
              onClick={() => window.location.hash = ''} 
              className="clear-collection-btn"
              style={{ marginLeft: '10px' }}
            >
              ✕ Clear Collection Filter
            </button>
          )}
        </div>
      </div>

      <div className="filters-section">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search cards..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filters-grid">
          <select
            value={filters.team || ''}
            onChange={(e) => setFilters({...filters, team: e.target.value || undefined})}
            className="filter-select"
          >
            <option value="">All Teams</option>
            {uniqueValues.teams.map(team => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>

          <select
            value={filters.brand || ''}
            onChange={(e) => setFilters({...filters, brand: e.target.value || undefined})}
            className="filter-select"
          >
            <option value="">All Brands</option>
            {uniqueValues.brands.map(brand => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>

          <select
            value={filters.category || ''}
            onChange={(e) => setFilters({...filters, category: e.target.value || undefined})}
            className="filter-select"
          >
            <option value="">All Categories</option>
            {uniqueValues.categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={filters.year || ''}
            onChange={(e) => setFilters({...filters, year: e.target.value ? parseInt(e.target.value) : undefined})}
            className="filter-select"
          >
            <option value="">All Years</option>
            {uniqueValues.years.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>

          <select
            value={filters.condition || ''}
            onChange={(e) => setFilters({...filters, condition: e.target.value || undefined})}
            className="filter-select"
          >
            <option value="">All Conditions</option>
            {uniqueValues.conditions.map(condition => (
              <option key={condition} value={condition}>{condition}</option>
            ))}
          </select>

          <select
            value={filters.collectionType || ''}
            onChange={(e) => setFilters({...filters, collectionType: e.target.value || undefined})}
            className="filter-select"
          >
            <option value="">All Cards</option>
            {COLLECTION_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>

          <select
            value={filters.soldStatus || ''}
            onChange={(e) => setFilters({...filters, soldStatus: (e.target.value || undefined) as 'sold' | 'unsold' | undefined})}
            className="filter-select"
          >
            <option value="">Sold & Unsold</option>
            <option value="unsold">Unsold</option>
            <option value="sold">Sold</option>
          </select>

          <button onClick={clearFilters} className="clear-filters-btn">
            Clear Filters
          </button>
          <button onClick={handleBulkEbayExport} className="bulk-ebay-btn" disabled={ebayExporting}>
            {ebayExporting ? 'Exporting...' : '🛒 Bulk eBay Export'}
          </button>
        </div>

        <div className="sort-section">
          <label>Sort by:</label>
          <select
            value={`${sortOption.field}-${sortOption.direction}`}
            onChange={(e) => {
              const [field, direction] = e.target.value.split('-');
              setSortOption({ field: field as keyof Card, direction: direction as 'asc' | 'desc' });
            }}
            className="sort-select"
          >
            <option value="createdAt-desc">Date Added (Newest)</option>
            <option value="createdAt-asc">Date Added (Oldest)</option>
            <option value="player-asc">Player (A-Z)</option>
            <option value="player-desc">Player (Z-A)</option>
            <option value="year-desc">Year (Newest)</option>
            <option value="year-asc">Year (Oldest)</option>
            <option value="currentValue-desc">Value (Highest)</option>
            <option value="currentValue-asc">Value (Lowest)</option>
          </select>
        </div>
      </div>

      {/* Bulk Selection Controls */}
      {filteredAndSortedCards.length > 0 && (
        <div className="bulk-selection-controls">
          <div className="selection-info">
            {selectedCards.size > 0 ? (
              <>
                <span>{selectedCards.size} card{selectedCards.size !== 1 ? 's' : ''} selected</span>
                <button onClick={clearSelection} className="clear-selection-btn">
                  Clear Selection
                </button>
                <button onClick={() => setShowMoveModal(true)} className="move-cards-btn">
                  Move to Collection
                </button>
                <button onClick={handleBulkDelete} className="bulk-delete-btn">
                  Delete Selected
                </button>
              </>
            ) : (
              <button onClick={selectAll} className="select-all-btn">
                Select All ({filteredAndSortedCards.length})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="cards-grid">
        {filteredAndSortedCards.map(card => (
          <div key={card.id} className={`card-item ${card.sellDate ? 'sold' : ''} ${selectedCards.has(card.id) ? 'selected' : ''}`}>
            <div className="card-selection">
              <input
                type="checkbox"
                checked={selectedCards.has(card.id)}
                onChange={() => toggleCardSelection(card.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="card-actions">
              {onEditCard && (
                <button onClick={() => onEditCard(card)} className="edit-btn">
                  Edit
                </button>
              )}
              <button onClick={() => handleDeleteCard(card.id)} className="delete-btn">
                Delete
              </button>
            </div>
            
            <div className="card-content" onClick={() => onCardSelect && onCardSelect(card)}>
              {card.sellDate && (
                <div className="sold-banner">
                  <span>SOLD</span>
                </div>
              )}
              <div className="card-image-section">
                <div className="card-image-container">
                  <img 
                    src={card.images && card.images.length > 0 ? cardImageUrl(card.images[0]) : '/generic.png'}
                    alt={`${card.player} card`} 
                    className="card-main-image" 
                  />
                  {card.images && card.images.length > 1 && (
                    <div className="image-count-badge">
                      +{card.images.length - 1}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="card-player-name">
                <h4>{card.player}</h4>
                <p className="card-detail-line">
                  {card.year} {card.brand}{card.setName ? ` ${card.setName}` : ''}{card.cardNumber ? ` #${card.cardNumber}` : ''}
                </p>
                <div className="card-pills">
                  {popTiers.has(card.id) && (
                    <span className={`card-pop-badge card-pop-${popTiers.get(card.id)}`}>
                      {popTiers.get(card.id) === 'ultra-low' ? 'Ultra-Low Pop' :
                       popTiers.get(card.id) === 'low' ? 'Low Pop' :
                       popTiers.get(card.id) === 'medium' ? 'Med Pop' :
                       popTiers.get(card.id) === 'high' ? 'High Pop' : 'Very High Pop'}
                    </span>
                  )}
                  {popPrices.has(card.id) && (
                    <span className="card-pop-price-badge">
                      ${popPrices.get(card.id)!.toFixed(2)}
                    </span>
                  )}
                  {exportedIds.has(card.id) && (
                    <span className="card-ebay-badge" title="Exported to eBay">eBay</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredAndSortedCards.length === 0 && (
        <div className="empty-state">
          <p>No cards found matching your criteria.</p>
          {(Object.keys(filters).length > 0 || searchTerm) && (
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
          )}
        </div>
      )}
      
      {showMoveModal && selectedCards.size > 0 && (
        <MoveCardsModal
          cards={state.cards.filter(card => selectedCards.has(card.id))}
          onClose={() => setShowMoveModal(false)}
          onMove={handleMoveCards}
        />
      )}
    </div>
  );
};

export default memo(CardList);