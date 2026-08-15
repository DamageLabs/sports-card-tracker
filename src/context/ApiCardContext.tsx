import React, { createContext, useContext, ReactNode, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, PortfolioStats, CollectionType } from '../types';
import { apiService } from '../services/api';
import { useSSE } from '../hooks/useSSE';

interface CardState {
  cards: Card[];
  loading: boolean;
  error: string | null;
}

interface CardContextType {
  state: CardState;
  addCard: (card: Card) => Promise<void>;
  updateCard: (card: Card) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  setCards: (cards: Card[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getPortfolioStats: (collectionType?: CollectionType) => PortfolioStats;
  clearAllCards: () => void;
  refreshCards: () => Promise<void>;
}

const CardContext = createContext<CardContextType | undefined>(undefined);

export const CardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<CardState>({
    cards: [],
    loading: true,
    error: null
  });
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load cards from API on mount
  useEffect(() => {
    let isMounted = true;

    const loadCards = async () => {
      try {
        // Check API health first
        await apiService.healthCheck();

        const cards = await apiService.getAllCards();

        if (isMounted) {
          setState({
            cards,
            loading: false,
            error: null
          });
        }
      } catch (error) {
        console.error('Failed to load cards from API:', error);
        if (isMounted) {
          setState(prev => ({
            ...prev,
            loading: false,
            error: 'Failed to connect to server. Please make sure the server is running.'
          }));

          // Retry after 5 seconds
          retryTimeoutRef.current = setTimeout(() => {
            if (isMounted) {
              setState(prev => ({ ...prev, loading: true }));
              loadCards();
            }
          }, 5000);
        }
      }
    };

    loadCards();

    return () => {
      isMounted = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Silent refetch — updates card data in place without flipping the loading state
  const refreshCards = useCallback(async () => {
    try {
      const cards = await apiService.getAllCards();
      setState(prev => ({ ...prev, cards, error: null }));
    } catch {
      // non-critical: keep showing current data
    }
  }, []);

  // Background jobs (comp generation, batch image processing, eBay export)
  // mutate card data server-side; refresh when any of them completes so
  // values like comp-derived currentValue appear without a manual reload.
  const { on: onSSE } = useSSE(true);
  useEffect(() => {
    const unsubscribe = onSSE('job:completed', () => {
      refreshCards();
    });
    return unsubscribe;
  }, [onSSE, refreshCards]);

  const addCard = useCallback(async (card: Card) => {
    try {
      const created = await apiService.createCard(card);

      // Update state with the server-returned card
      setState(prev => ({
        ...prev,
        cards: [...prev.cards, created]
      }));
    } catch (error) {
      console.error('Error adding card:', error);
      throw error;
    }
  }, []);

  const updateCard = useCallback(async (card: Card) => {
    try {
      const updated = await apiService.updateCard(card);

      setState(prev => ({
        ...prev,
        cards: prev.cards.map(c => c.id === card.id ? updated : c)
      }));
    } catch (error) {
      console.error('Error updating card:', error);
      throw error;
    }
  }, []);

  const deleteCard = useCallback(async (id: string) => {
    try {
      await apiService.deleteCard(id);

      setState(prev => ({
        ...prev,
        cards: prev.cards.filter(c => c.id !== id)
      }));
    } catch (error) {
      console.error('Error deleting card:', error);
      throw error;
    }
  }, []);

  const setCards = useCallback((cards: Card[]) => {
    setState(prev => ({ ...prev, cards }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const getPortfolioStats = useCallback((collectionType?: CollectionType): PortfolioStats => {
    const cards = collectionType
      ? state.cards.filter(card => card.collectionType === collectionType)
      : state.cards;
    const totalCards = cards.length;
    const totalCostBasis = cards.reduce((sum, card) => sum + card.purchasePrice, 0);
    const totalCurrentValue = cards.reduce((sum, card) => sum + card.currentValue, 0);
    const totalProfit = totalCurrentValue - totalCostBasis;

    const soldCards = cards.filter(card => card.sellDate && card.sellPrice);
    const totalSold = soldCards.length;
    const totalSoldValue = soldCards.reduce((sum, card) => sum + (card.sellPrice || 0), 0);

    return {
      totalCards,
      totalCostBasis,
      totalCurrentValue,
      totalProfit,
      totalSold,
      totalSoldValue
    };
  }, [state.cards]);

  const clearAllCards = useCallback(async () => {
    try {
      // Delete all cards via API
      for (const card of state.cards) {
        await apiService.deleteCard(card.id);
      }
      setState(prev => ({ ...prev, cards: [] }));
    } catch (error) {
      console.error('Error clearing all cards:', error);
      throw error;
    }
  }, [state.cards]);

  const value: CardContextType = useMemo(() => ({
    state,
    addCard,
    updateCard,
    deleteCard,
    setCards,
    setLoading,
    setError,
    getPortfolioStats,
    clearAllCards,
    refreshCards
  }), [state, addCard, updateCard, deleteCard, setCards, setLoading, setError, getPortfolioStats, clearAllCards, refreshCards]);

  return <CardContext.Provider value={value}>{children}</CardContext.Provider>;
};

export const useCards = (): CardContextType => {
  const context = useContext(CardContext);
  if (!context) {
    throw new Error('useCards must be used within a CardProvider');
  }
  return context;
};
