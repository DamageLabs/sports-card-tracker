import React, { useEffect, useCallback } from 'react';
import './GradeReportModal.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

interface Centering {
  measurable: boolean;
  leftRight?: { left: number; right: number };
  topBottom?: { top: number; bottom: number };
  note?: string;
}

interface Defect {
  side: 'front' | 'back';
  area: string;
  location: string;
  type: string;
  severity: 'minor' | 'moderate' | 'severe';
  description: string;
  cropFile?: string;
}

export interface GradePredictionData {
  predictedAt?: string;
  frontCentering?: Centering;
  backCentering?: Centering | null;
  defects?: Defect[];
  caps?: Record<string, number>;
  ceiling?: number;
  estimatedRange?: string;
  summary?: string;
}

interface GradeReportModalProps {
  cardName: string;
  prediction: GradePredictionData;
  onClose: () => void;
}

function centeringText(c: Centering | null | undefined): string {
  if (!c || !c.measurable) return 'Not measurable';
  const parts: string[] = [];
  if (c.leftRight) parts.push(`${c.leftRight.left}L / ${c.leftRight.right}R`);
  if (c.topBottom) parts.push(`${c.topBottom.top}T / ${c.topBottom.bottom}B`);
  return parts.length > 0 ? parts.join('  ·  ') : 'Not measurable';
}

const GradeReportModal: React.FC<GradeReportModalProps> = ({ cardName, prediction, onClose }) => {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const caps = prediction.caps || {};
  const limiting = Object.entries(caps).sort((a, b) => a[1] - b[1])[0]?.[0];
  const defects = prediction.defects || [];

  return (
    <div className="gr-overlay" onClick={onClose}>
      <div className="gr-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gr-header">
          <div>
            <h3>Grade Report</h3>
            <p className="gr-card-name">{cardName}</p>
          </div>
          <div className="gr-verdict">
            <span className="gr-range">{prediction.estimatedRange || '--'}</span>
            <span className="gr-range-label">est. range · ceiling {prediction.ceiling ?? '--'}</span>
          </div>
          <button className="gr-close" onClick={onClose}>×</button>
        </div>

        <div className="gr-section">
          <h4>Centering <span className="gr-measured-tag">measured</span></h4>
          <div className="gr-centering-grid">
            <div>
              <span className="gr-side-label">Front</span>
              <span className="gr-centering-value">{centeringText(prediction.frontCentering)}</span>
            </div>
            <div>
              <span className="gr-side-label">Back</span>
              <span className="gr-centering-value">{centeringText(prediction.backCentering)}</span>
            </div>
          </div>
        </div>

        <div className="gr-section">
          <h4>Grade Caps by Factor</h4>
          <div className="gr-caps-grid">
            {(['centering', 'corners', 'edges', 'surface'] as const).map(k => (
              <div key={k} className={`gr-cap ${k === limiting ? 'limiting' : ''}`}>
                <span className="gr-cap-value">{caps[k] ?? '--'}</span>
                <span className="gr-cap-label">{k}{k === limiting ? ' · limiting' : ''}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="gr-section">
          <h4>Identified Defects ({defects.length})</h4>
          {defects.length === 0 ? (
            <p className="gr-no-defects">No notable defects visible in the scans.</p>
          ) : (
            <div className="gr-defects">
              {defects.map((d, i) => (
                <div key={i} className="gr-defect">
                  {d.cropFile && (
                    <img
                      src={`${API_BASE_URL}/files/analysis/${encodeURIComponent(d.cropFile)}`}
                      alt={`${d.location} ${d.type}`}
                      className="gr-defect-crop"
                      loading="lazy"
                    />
                  )}
                  <div className="gr-defect-info">
                    <div className="gr-defect-title">
                      <span className={`gr-severity ${d.severity}`}>{d.severity}</span>
                      <span className="gr-defect-type">{d.type}</span>
                      <span className="gr-defect-loc">{d.side} · {d.location}</span>
                    </div>
                    <p className="gr-defect-desc">{d.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="gr-disclaimer">
          Scan-based estimate. Flatbed scans hide some surface issues (gloss breaks, fine scratches),
          so treat this as a ceiling — verify with a loupe before submitting for grading.
          {prediction.predictedAt ? ` Analyzed ${new Date(prediction.predictedAt).toLocaleString()}.` : ''}
        </p>
      </div>
    </div>
  );
};

export default GradeReportModal;
