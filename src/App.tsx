import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CardProvider, useCards } from './context/ApiCardContext';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
import CardList from './components/CardList/CardList';
import CardForm from './components/CardForm/CardForm';
import EnhancedCardForm from './components/EnhancedCardForm/EnhancedCardForm';
import CardDetail from './components/CardDetail/CardDetail';
import AuthForm from './components/Auth/AuthForm';
import AdminDashboard from './components/AdminDashboard/AdminDashboard';
import UserProfile from './components/UserProfile/UserProfile';
import UserManagement from './components/UserManagement/UserManagement';
import Collections from './components/Collections/Collections';
import Reports from './components/Reports/Reports';
import EbayListings from './components/EbayListings/EbayListings';
import { BackupRestore } from './components/BackupRestore/BackupRestore';
import About from './components/About/About';
import AuditLog from './components/AuditLog/AuditLog';
import HoldingPen from './components/HoldingPen/HoldingPen';
import ProcessedGallery from './components/ProcessedGallery/ProcessedGallery';
import GradingTracker from './components/GradingTracker/GradingTracker';
import { GradingRoiBatch } from './components/GradingRoiBatch/GradingRoiBatch';
import PortfolioHeatmap from './components/PortfolioHeatmap/PortfolioHeatmap';
import StorageManager from './components/StorageManager/StorageManager';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { Card } from './types';
import { saveEnhancedCard, mergeCardWithEnhanced, migrateLocalStorageEnhancedAttributes } from './utils/enhancedCardIntegration';
import { logInfo } from './utils/logger';
import './App.css';

type View = 'dashboard' | 'inventory' | 'add-card' | 'holding-pen' | 'processed' | 'admin' | 'profile' | 'reports' | 'ebay' | 'backup' | 'users' | 'collections' | 'about' | 'audit-log' | 'grading' | 'grading-roi' | 'heatmap' | 'storage';
type FormType = 'classic' | 'enhanced';

const AppContent: React.FC = () => {
  const { state: authState } = useAuth();
  const { addCard, updateCard } = useCards();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [formType, setFormType] = useState<FormType>('enhanced'); // Form type selection
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  
  logInfo('App', 'Application initialized');

  // Handle hash changes for collection navigation
  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#inventory?collection=')) {
        const collectionId = hash.split('=')[1];
        setSelectedCollectionId(collectionId);
        setCurrentView('inventory');
      }
    };

    // Check initial hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // One-shot drain of legacy localStorage enhanced-card payloads into the DB.
  React.useEffect(() => {
    if (!authState.user) return;
    migrateLocalStorageEnhancedAttributes().catch(err => {
      console.warn('Enhanced-attributes migration failed:', err);
    });
  }, [authState.user]);

  // Show auth form if user is not authenticated
  if (!authState.user) {
    return (
      <AuthForm 
        mode={authMode} 
        onToggleMode={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} 
      />
    );
  }

  const handleViewChange = (view: View) => {
    logInfo('App', `View changed to: ${view}`);
    setCurrentView(view);
    setSelectedCard(null);
    setEditingCard(null);
    // Clear collection filter when navigating away from inventory
    if (view !== 'inventory') {
      setSelectedCollectionId(null);
      window.location.hash = '';
    }
  };

  const handleCardSelect = (card: Card) => {
    setSelectedCard(card);
  };

  const handleEditCard = (card: Card) => {
    setSelectedCard(null); // Close any open detail view
    setEditingCard(card);
    setCurrentView('add-card');
  };

  const handleFormSuccess = () => {
    setEditingCard(null);
    setCurrentView('inventory');
  };

  const handleFormCancel = () => {
    setEditingCard(null);
    setCurrentView('inventory');
  };

  const handleCloseDetail = () => {
    setSelectedCard(null);
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'inventory':
        return (
          <CardList 
            onCardSelect={handleCardSelect}
            onEditCard={handleEditCard}
            selectedCollectionId={selectedCollectionId}
          />
        );
      case 'add-card':
        return (
          <>
            {/* Form Type Selector */}
            <div style={{ 
              marginBottom: '24px', 
              textAlign: 'center',
              background: '#f7fafc',
              padding: '16px',
              borderRadius: '12px'
            }}>
              <div style={{ marginBottom: '12px', fontSize: '16px', fontWeight: '600', color: '#2d3748' }}>
                Choose Entry Method:
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setFormType('classic')}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: formType === 'classic' ? '2px solid #f5a623' : '1px solid #e2e8f0',
                    background: formType === 'classic' ? '#fef3d1' : '#ffffff',
                    color: formType === 'classic' ? '#1a2b45' : '#4a5568',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: formType === 'classic' ? '600' : '400',
                    transition: 'all 0.2s'
                  }}
                >
                  📝 Classic Form
                </button>
                <button
                  onClick={() => setFormType('enhanced')}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: formType === 'enhanced' ? '2px solid #f5a623' : '1px solid #e2e8f0',
                    background: formType === 'enhanced' ? '#fef3d1' : '#ffffff',
                    color: formType === 'enhanced' ? '#1a2b45' : '#4a5568',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: formType === 'enhanced' ? '600' : '400',
                    transition: 'all 0.2s'
                  }}
                >
                  ⚡ Enhanced Form
                </button>
              </div>
            </div>

            {/* Render appropriate form based on selection */}
            {formType === 'classic' && (
              <CardForm 
                key={editingCard?.id || 'new-card'}
                card={editingCard || undefined}
                onSuccess={handleFormSuccess}
                onCancel={handleFormCancel}
              />
            )}
            {formType === 'enhanced' && (
              <EnhancedCardForm 
                key={editingCard?.id || 'new-card-enhanced'}
                card={editingCard ? mergeCardWithEnhanced(editingCard) : undefined}
                onSave={async (enhancedCardData) => {
                  try {
                    await saveEnhancedCard(enhancedCardData, addCard, updateCard);
                    handleFormSuccess();
                  } catch (error) {
                    console.error('Error saving enhanced card:', error);
                    alert('Failed to save card. Please try again.');
                  }
                }}
                onCancel={handleFormCancel}
              />
            )}
          </>
        );
      case 'holding-pen':
        return <HoldingPen />;
      case 'processed':
        return <ProcessedGallery />;
      case 'admin':
        return <AdminDashboard />;
      case 'profile':
        return <UserProfile />;
      case 'reports':
        return <Reports />;
      case 'ebay':
        return <EbayListings />;
      case 'backup':
        return <BackupRestore />;
      case 'users':
        return <UserManagement />;
      case 'audit-log':
        return <AuditLog />;
      case 'collections':
        return <Collections />;
      case 'grading':
        return <GradingTracker />;
      case 'grading-roi':
        return <GradingRoiBatch />;
      case 'heatmap':
        return <PortfolioHeatmap onCardSelect={handleCardSelect} />;
      case 'storage':
        return <StorageManager />;
      case 'about':
        return <About />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout currentView={currentView} onViewChange={handleViewChange}>
      {renderCurrentView()}
      
      {selectedCard && (
        <CardDetail
          card={selectedCard}
          onEdit={handleEditCard}
          onClose={handleCloseDetail}
        />
      )}
      
    </Layout>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <CardProvider>
          <AppContent />
        </CardProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;