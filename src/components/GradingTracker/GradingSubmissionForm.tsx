import React, { useState, useEffect } from 'react';
import { apiService, GradingSubmission, GradingSubmissionInput } from '../../services/api';
import { Card } from '../../types';

interface GradingSubmissionFormProps {
  submission?: GradingSubmission | null;
  onClose: () => void;
  onSaved: () => void;
}

const GRADING_COMPANIES = ['PSA', 'BGS', 'SGC', 'CGC', 'HGA', 'Other'];
const GRADING_TIERS = ['Economy', 'Regular', 'Express', 'Super Express', 'Walk-Through'];

const GradingSubmissionForm: React.FC<GradingSubmissionFormProps> = ({ submission, onClose, onSaved }) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cardId, setCardId] = useState(submission?.cardId || '');
  const [gradingCompany, setGradingCompany] = useState(submission?.gradingCompany || 'PSA');
  const [submissionNumber, setSubmissionNumber] = useState(submission?.submissionNumber || '');
  const [tier, setTier] = useState(submission?.tier || 'Regular');
  const [cost, setCost] = useState(submission?.cost?.toString() || '');
  const [declaredValue, setDeclaredValue] = useState(submission?.declaredValue?.toString() || '');
  const [submittedAt, setSubmittedAt] = useState(
    submission?.submittedAt ? submission.submittedAt.split('T')[0] : new Date().toISOString().split('T')[0]
  );
  const [estimatedReturnDate, setEstimatedReturnDate] = useState(
    submission?.estimatedReturnDate ? submission.estimatedReturnDate.split('T')[0] : ''
  );
  const [notes, setNotes] = useState(submission?.notes || '');

  useEffect(() => {
    apiService.getAllCards().then(setCards).catch(() => setCards([]));
  }, []);

  const isEdit = !!submission;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isEdit) {
        await apiService.updateGradingSubmission(submission!.id, {
          gradingCompany,
          submissionNumber,
          tier,
          cost: parseFloat(cost) || 0,
          declaredValue: parseFloat(declaredValue) || 0,
          submittedAt: new Date(submittedAt).toISOString(),
          estimatedReturnDate: estimatedReturnDate ? new Date(estimatedReturnDate).toISOString() : undefined,
          notes,
        });
      } else {
        const input: GradingSubmissionInput = {
          cardId,
          gradingCompany,
          submissionNumber,
          tier,
          cost: parseFloat(cost) || 0,
          declaredValue: parseFloat(declaredValue) || 0,
          submittedAt: new Date(submittedAt).toISOString(),
          estimatedReturnDate: estimatedReturnDate ? new Date(estimatedReturnDate).toISOString() : undefined,
          notes,
        };
        await apiService.createGradingSubmission(input);
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save submission');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grading-grade-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="grading-grade-modal" style={{ maxWidth: '500px' }}>
        <h3>{isEdit ? 'Edit Submission' : 'New Grading Submission'}</h3>
        {error && <div style={{ color: '#e53e3e', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {!isEdit && (
            <div>
              <label>Card</label>
              <select
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                required
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
              >
                <option value="">Select a card...</option>
                {cards.map(card => (
                  <option key={card.id} value={card.id}>
                    {card.year} {card.brand} {card.player}{card.cardNumber ? ` #${card.cardNumber}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label>Grading Company</label>
              <select
                value={gradingCompany}
                onChange={(e) => setGradingCompany(e.target.value)}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
              >
                {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
              >
                {GRADING_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label>Submission Number</label>
            <input
              type="text"
              value={submissionNumber}
              onChange={(e) => setSubmissionNumber(e.target.value)}
              placeholder="e.g. PSA-12345678"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label>Cost ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="30.00"
              />
            </div>
            <div>
              <label>Declared Value ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={declaredValue}
                onChange={(e) => setDeclaredValue(e.target.value)}
                placeholder="100.00"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label>Submitted Date</label>
              <input
                type="date"
                value={submittedAt}
                onChange={(e) => setSubmittedAt(e.target.value)}
                required
              />
            </div>
            <div>
              <label>Est. Return Date</label>
              <input
                type="date"
                value={estimatedReturnDate}
                onChange={(e) => setEstimatedReturnDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box', resize: 'vertical' }}
              placeholder="Optional notes..."
            />
          </div>

          <div className="grading-grade-modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="confirm" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Submission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GradingSubmissionForm;
