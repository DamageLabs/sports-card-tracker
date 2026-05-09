import React, { useState, useEffect, useCallback } from 'react';
import { Card, StorageLocation } from '../../types';
import apiService from '../../services/api';
import './StorageManager.css';

interface LocationGroup {
  room: string;
  shelf: string;
  box: string;
  cardCount: number;
}

const STORAGE_METHODS = ['Raw', 'Penny Sleeve', 'Toploader', 'One-Touch', 'Screw Down', 'Binder', 'Graded Slab'];

const StorageManager: React.FC = () => {
  const [locations, setLocations] = useState<LocationGroup[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<{ room?: string; shelf?: string; box?: string } | null>(null);
  const [locationCards, setLocationCards] = useState<Card[]>([]);
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [unassignedCards, setUnassignedCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [assignForm, setAssignForm] = useState<StorageLocation>({ room: '', box: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'browse' | 'search'>('browse');

  const loadLocations = useCallback(async () => {
    try {
      const locs = await apiService.getStorageLocations();
      setLocations(locs);
    } catch (error) {
      console.error('Failed to load storage locations:', error);
    }
  }, []);

  const loadAllCards = useCallback(async () => {
    try {
      const cards = await apiService.getAllCards();
      setAllCards(cards);
      setUnassignedCards(cards.filter(c => !c.storageLocation));
    } catch (error) {
      console.error('Failed to load cards:', error);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadLocations(), loadAllCards()]);
      setLoading(false);
    };
    init();
  }, [loadLocations, loadAllCards]);

  const handleSelectLocation = async (loc: { room?: string; shelf?: string; box?: string }) => {
    setSelectedLocation(loc);
    try {
      const cards = await apiService.getCardsByStorage(loc);
      setLocationCards(cards);
    } catch (error) {
      console.error('Failed to load cards for location:', error);
    }
  };

  const handleBulkAssign = async () => {
    if (selectedCardIds.length === 0 || !assignForm.room) return;
    try {
      await apiService.bulkAssignStorage(selectedCardIds, assignForm);
      setShowAssignModal(false);
      setSelectedCardIds([]);
      setAssignForm({ room: '', box: '' });
      await Promise.all([loadLocations(), loadAllCards()]);
      if (selectedLocation) {
        await handleSelectLocation(selectedLocation);
      }
    } catch (error) {
      console.error('Failed to bulk assign:', error);
    }
  };

  const handleRemoveFromStorage = async (cardId: string) => {
    try {
      await apiService.updateCardStorage(cardId, null);
      await Promise.all([loadLocations(), loadAllCards()]);
      if (selectedLocation) {
        await handleSelectLocation(selectedLocation);
      }
    } catch (error) {
      console.error('Failed to remove card from storage:', error);
    }
  };

  const toggleCardSelection = (cardId: string) => {
    setSelectedCardIds(prev =>
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  };

  const searchResults = searchQuery.trim()
    ? allCards.filter(c => {
        const q = searchQuery.toLowerCase();
        return (
          c.player.toLowerCase().includes(q) ||
          c.brand.toLowerCase().includes(q) ||
          c.cardNumber.toLowerCase().includes(q) ||
          String(c.year).includes(q)
        );
      })
    : [];

  const formatLocation = (loc: StorageLocation | null | undefined): string => {
    if (!loc) return 'Not assigned';
    const parts = [];
    if (loc.room) parts.push(loc.room);
    if (loc.shelf) parts.push(`Shelf ${loc.shelf}`);
    if (loc.box) parts.push(`Box ${loc.box}`);
    if (loc.row) parts.push(`Row ${loc.row}`);
    if (loc.slot) parts.push(`Slot ${loc.slot}`);
    return parts.join(' > ') || 'Not assigned';
  };

  // Group locations by room for tree display
  const locationTree = locations.reduce<Record<string, LocationGroup[]>>((acc, loc) => {
    if (!acc[loc.room]) acc[loc.room] = [];
    acc[loc.room].push(loc);
    return acc;
  }, {});

  const totalStoredCards = locations.reduce((sum, l) => sum + l.cardCount, 0);

  if (loading) {
    return <div className="storage-manager"><div className="storage-loading">Loading storage data...</div></div>;
  }

  return (
    <div className="storage-manager">
      <div className="storage-header">
        <h2>Storage Manager</h2>
        <div className="storage-stats">
          <span className="stat">{totalStoredCards} stored</span>
          <span className="stat">{unassignedCards.length} unassigned</span>
          <span className="stat">{Object.keys(locationTree).length} rooms</span>
        </div>
      </div>

      <div className="storage-tabs">
        <button
          className={`storage-tab ${view === 'browse' ? 'active' : ''}`}
          onClick={() => setView('browse')}
        >
          Browse Locations
        </button>
        <button
          className={`storage-tab ${view === 'search' ? 'active' : ''}`}
          onClick={() => setView('search')}
        >
          Find a Card
        </button>
        <button className="storage-assign-btn" onClick={() => setShowAssignModal(true)}>
          Assign Cards
        </button>
      </div>

      {view === 'search' && (
        <div className="storage-search">
          <input
            type="text"
            placeholder="Search by player, brand, year, or card number..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="storage-search-input"
            autoFocus
          />
          {searchQuery.trim() && (
            <div className="storage-search-results">
              {searchResults.length === 0 ? (
                <div className="storage-empty">No cards found matching "{searchQuery}"</div>
              ) : (
                searchResults.map(card => (
                  <div key={card.id} className="storage-card-row">
                    <div className="storage-card-info">
                      <span className="storage-card-name">
                        {card.year} {card.brand} {card.player}{card.cardNumber ? ` #${card.cardNumber}` : ''}
                      </span>
                      {card.isGraded && card.gradingCompany && card.grade && (
                        <span className="storage-card-grade">{card.gradingCompany} {card.grade}</span>
                      )}
                    </div>
                    <div className="storage-card-location">
                      {formatLocation(card.storageLocation)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {view === 'browse' && (
        <div className="storage-browse">
          <div className="storage-sidebar">
            <h3>Locations</h3>
            {Object.keys(locationTree).length === 0 ? (
              <div className="storage-empty">No locations yet. Assign cards to create locations.</div>
            ) : (
              Object.entries(locationTree).map(([room, locs]) => {
                const roomTotal = locs.reduce((s, l) => s + l.cardCount, 0);
                return (
                  <div key={room} className="storage-room">
                    <button
                      className={`storage-room-btn ${selectedLocation?.room === room && !selectedLocation?.box ? 'active' : ''}`}
                      onClick={() => handleSelectLocation({ room })}
                    >
                      {room} ({roomTotal})
                    </button>
                    <div className="storage-boxes">
                      {locs.map((loc, i) => (
                        <button
                          key={i}
                          className={`storage-box-btn ${
                            selectedLocation?.room === loc.room &&
                            selectedLocation?.shelf === loc.shelf &&
                            selectedLocation?.box === loc.box
                              ? 'active'
                              : ''
                          }`}
                          onClick={() => handleSelectLocation({ room: loc.room, shelf: loc.shelf, box: loc.box })}
                        >
                          {loc.shelf ? `Shelf ${loc.shelf} / ` : ''}
                          {loc.box ? `Box ${loc.box}` : 'Unboxed'}
                          {' '}({loc.cardCount})
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {unassignedCards.length > 0 && (
              <div className="storage-room">
                <button
                  className={`storage-room-btn unassigned ${selectedLocation === null && locationCards.length > 0 ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedLocation(null);
                    setLocationCards(unassignedCards);
                  }}
                >
                  Unassigned ({unassignedCards.length})
                </button>
              </div>
            )}
          </div>

          <div className="storage-content">
            {locationCards.length === 0 ? (
              <div className="storage-empty">Select a location to view cards</div>
            ) : (
              <>
                <div className="storage-content-header">
                  <h3>
                    {selectedLocation
                      ? formatLocation(selectedLocation as StorageLocation)
                      : 'Unassigned Cards'}
                    {' '}({locationCards.length} cards)
                  </h3>
                </div>
                <div className="storage-card-list">
                  {locationCards.map(card => (
                    <div key={card.id} className="storage-card-row">
                      <div className="storage-card-info">
                        <span className="storage-card-name">
                          {card.year} {card.brand} {card.player}{card.cardNumber ? ` #${card.cardNumber}` : ''}
                        </span>
                        {card.isGraded && card.gradingCompany && card.grade && (
                          <span className="storage-card-grade">{card.gradingCompany} {card.grade}</span>
                        )}
                        <span className="storage-card-value">${card.currentValue.toFixed(2)}</span>
                      </div>
                      <div className="storage-card-actions">
                        {card.storageLocation?.method && (
                          <span className="storage-card-method">{card.storageLocation.method}</span>
                        )}
                        {card.storageLocation && (
                          <button
                            className="storage-remove-btn"
                            onClick={() => handleRemoveFromStorage(card.id)}
                            title="Remove from location"
                          >
                            x
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showAssignModal && (
        <div className="storage-modal-overlay" onClick={() => setShowAssignModal(false)}>
          <div className="storage-modal" onClick={e => e.stopPropagation()}>
            <h3>Assign Cards to Location</h3>

            <div className="storage-form">
              <div className="storage-form-row">
                <label>Room *</label>
                <input
                  type="text"
                  value={assignForm.room || ''}
                  onChange={e => setAssignForm({ ...assignForm, room: e.target.value })}
                  placeholder="e.g., Office, Closet, Safe"
                  list="room-suggestions"
                />
                <datalist id="room-suggestions">
                  {[...new Set(locations.map(l => l.room))].map(r => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
              <div className="storage-form-row">
                <label>Shelf</label>
                <input
                  type="text"
                  value={assignForm.shelf || ''}
                  onChange={e => setAssignForm({ ...assignForm, shelf: e.target.value })}
                  placeholder="e.g., Top, 1, A"
                />
              </div>
              <div className="storage-form-row">
                <label>Box</label>
                <input
                  type="text"
                  value={assignForm.box || ''}
                  onChange={e => setAssignForm({ ...assignForm, box: e.target.value })}
                  placeholder="e.g., 1, Baseball Box, Slab Box"
                />
              </div>
              <div className="storage-form-row">
                <label>Row</label>
                <input
                  type="text"
                  value={assignForm.row || ''}
                  onChange={e => setAssignForm({ ...assignForm, row: e.target.value })}
                  placeholder="e.g., Front, 1"
                />
              </div>
              <div className="storage-form-row">
                <label>Slot</label>
                <input
                  type="text"
                  value={assignForm.slot || ''}
                  onChange={e => setAssignForm({ ...assignForm, slot: e.target.value })}
                  placeholder="e.g., 1, 25"
                />
              </div>
              <div className="storage-form-row">
                <label>Storage Method</label>
                <select
                  value={assignForm.method || ''}
                  onChange={e => setAssignForm({ ...assignForm, method: e.target.value })}
                >
                  <option value="">-- Select --</option>
                  {STORAGE_METHODS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="storage-card-picker">
              <h4>Select Cards ({selectedCardIds.length} selected)</h4>
              <input
                type="text"
                placeholder="Filter cards..."
                className="storage-filter-input"
                onChange={e => {
                  const q = e.target.value.toLowerCase();
                  // Filter is visual only via CSS or we re-render
                  setSearchQuery(q);
                }}
              />
              <div className="storage-card-picker-list">
                {(searchQuery
                  ? allCards.filter(c => {
                      const q = searchQuery.toLowerCase();
                      return c.player.toLowerCase().includes(q) || c.brand.toLowerCase().includes(q) || String(c.year).includes(q);
                    })
                  : unassignedCards
                ).map(card => (
                  <label key={card.id} className="storage-card-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedCardIds.includes(card.id)}
                      onChange={() => toggleCardSelection(card.id)}
                    />
                    <span>{card.year} {card.brand} {card.player}{card.cardNumber ? ` #${card.cardNumber}` : ''}</span>
                    {card.storageLocation && (
                      <span className="storage-card-current-loc">({formatLocation(card.storageLocation)})</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="storage-modal-actions">
              <button className="storage-cancel-btn" onClick={() => {
                setShowAssignModal(false);
                setSelectedCardIds([]);
                setSearchQuery('');
              }}>
                Cancel
              </button>
              <button
                className="storage-save-btn"
                onClick={handleBulkAssign}
                disabled={selectedCardIds.length === 0 || !assignForm.room}
              >
                Assign {selectedCardIds.length} Card{selectedCardIds.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageManager;
