import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiService, ExtractedCardData } from '../../services/api';
import { useNotifications } from '../../hooks/useNotifications';
import { useSSE } from '../../hooks/useSSE';
import ImageLightbox from './ImageLightbox';
import ImageCropModal from './ImageCropModal';
import CardReviewForm from '../CardReviewForm/CardReviewForm';
import './HoldingPen.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

interface RawFile {
  name: string;
  size: number;
  modified: string;
  type: string;
}

interface CardPair {
  id: string;
  front: RawFile | null;
  back: RawFile | null;
  label: string;
  modified: string;
}

function groupIntoPairs(files: RawFile[]): CardPair[] {
  const pairs: CardPair[] = [];
  const paired = new Set<string>();

  for (const file of files) {
    if (paired.has(file.name)) continue;

    const ext = '.' + file.name.split('.').pop();
    const base = file.name.slice(0, file.name.length - ext.length);

    if (base.endsWith('-front')) {
      const prefix = base.slice(0, -6);
      const backName = prefix + '-back' + ext;
      const backFile = files.find(f => f.name === backName);

      paired.add(file.name);
      if (backFile) paired.add(backFile.name);

      pairs.push({
        id: prefix,
        front: file,
        back: backFile || null,
        label: prefix,
        modified: file.modified,
      });
    } else if (base.endsWith('-back')) {
      const prefix = base.slice(0, -5);
      const frontName = prefix + '-front' + ext;
      const frontFile = files.find(f => f.name === frontName);

      if (frontFile) {
        // Will be handled when we encounter the -front file
        continue;
      }

      paired.add(file.name);
      pairs.push({
        id: prefix,
        front: null,
        back: file,
        label: prefix,
        modified: file.modified,
      });
    } else {
      // Standalone file - treat as front only
      paired.add(file.name);
      pairs.push({
        id: base,
        front: file,
        back: null,
        label: base,
        modified: file.modified,
      });
    }
  }

  // Sort by most recent modified date
  pairs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return pairs;
}

function rawFileUrl(filename: string): string {
  return `${API_BASE_URL}/files/raw/${encodeURIComponent(filename)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const HoldingPen: React.FC = () => {
  const [files, setFiles] = useState<RawFile[]>([]);
  const [pairs, setPairs] = useState<CardPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [processedRaw, setProcessedRaw] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<CardPair | null>(null);
  const [cropTarget, setCropTarget] = useState<{ filename: string; url: string } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{
    pair: CardPair;
    data: ExtractedCardData;
  } | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [defaultCollectionId, setDefaultCollectionId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { permission, enabled, setEnabled, requestPermission, notify } = useNotifications();
  const { on: onSSE } = useSSE(activeJobId !== null);

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const rawFiles = await apiService.getRawFiles();
      setFiles(rawFiles);
      setPairs(groupIntoPairs(rawFiles));
      apiService.getProcessedRawFiles()
        .then(names => setProcessedRaw(new Set(names)))
        .catch(() => { /* non-critical — pills just won't show */ });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    apiService.getCollections()
      .then(cols => setCollections(cols.map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
    apiService.getDefaultCollection()
      .then(col => { if (col?.id) setDefaultCollectionId(col.id); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    if (!activeJobId) return;

    const unsubComplete = onSSE('job:completed', (data: { jobId: string; result?: Record<string, unknown> }) => {
      if (data.jobId !== activeJobId) return;
      const result = data.result || {};
      const processed = (result.processed as number) || 0;
      const failed = (result.failed as number) || 0;
      notify('Batch Complete', {
        body: `${processed} processed, ${failed} failed`,
      });
      setActiveJobId(null);
      setProcessing(new Set());
      setSelectedIds(new Set());
      fetchFiles();
    });

    const unsubFailed = onSSE('job:failed', (data: { jobId: string; error?: string }) => {
      if (data.jobId !== activeJobId) return;
      notify('Batch Processing Failed', {
        body: data.error || 'Unknown error',
      });
      setError(data.error || 'Batch processing failed');
      setActiveJobId(null);
      setProcessing(new Set());
    });

    return () => {
      unsubComplete();
      unsubFailed();
    };
  }, [activeJobId, onSSE, notify, fetchFiles]);

  const handleUpload = async (fileList: FileList | File[]) => {
    const validFiles = Array.from(fileList).filter(f =>
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff)$/i.test(f.name)
    );
    if (validFiles.length === 0) return;

    setUploading(true);
    try {
      await apiService.uploadRawFiles(validFiles);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleDelete = async (pair: CardPair) => {
    const filenames = [pair.front?.name, pair.back?.name].filter(Boolean) as string[];
    const confirmMsg = filenames.length > 1
      ? `Delete both ${filenames.join(' and ')}?`
      : `Delete ${filenames[0]}?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await Promise.all(filenames.map(f => apiService.deleteRawFile(f)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(pair.id);
        return next;
      });
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleProcess = async (pair: CardPair) => {
    const frontFile = pair.front?.name;
    const backFile = pair.back?.name;
    if (!frontFile && !backFile) return;

    const primaryFile = frontFile || backFile!;
    setProcessing(prev => new Set(prev).add(pair.id));
    try {
      const data = await apiService.identifyCard(
        primaryFile,
        frontFile && backFile ? backFile : undefined
      );
      const label = [data.year, data.brand, data.player].filter(Boolean).join(' ') || pair.label;
      notify('Card Identified', { body: label });
      // Open review form with vision results
      setReviewTarget({ pair, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Identification failed';
      notify('Identification Failed', { body: `${pair.label}: ${msg}` });
      setError(msg);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(pair.id);
        return next;
      });
    }
  };

  const handleReviewConfirm = async (data: ExtractedCardData) => {
    if (!reviewTarget) return;
    const { pair } = reviewTarget;
    const frontFile = pair.front?.name;
    const backFile = pair.back?.name;
    const primaryFile = frontFile || backFile!;

    setReviewSaving(true);
    try {
      const result = await apiService.confirmCard(
        primaryFile,
        data,
        frontFile && backFile ? backFile : undefined,
        reviewTarget.data
      );
      if (result.status === 'failed' || result.status === 'duplicate' || result.status === 'skipped') {
        const player = data.player || pair.label;
        notify('Card Confirmation Issue', { body: `${player}: ${result.status}` });
        setError(result.error || `Processing ${result.status}`);
      } else {
        const player = data.player || pair.label;
        notify('Card Added', { body: `${player} confirmed and saved` });
      }
      setReviewTarget(null);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setReviewSaving(false);
    }
  };

  const handleBulkProcess = async () => {
    const selectedPairs = pairs.filter(p => selectedIds.has(p.id));
    const allFilenames = selectedPairs.flatMap(p =>
      [p.front?.name, p.back?.name].filter(Boolean) as string[]
    );
    if (allFilenames.length === 0) return;

    setProcessing(new Set(selectedIds));
    try {
      const job = await apiService.processRawImages(allFilenames, defaultCollectionId || undefined);
      setActiveJobId(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk processing failed');
      setProcessing(new Set());
    }
  };

  const handleBulkDelete = async () => {
    const selectedPairs = pairs.filter(p => selectedIds.has(p.id));
    const allFilenames = selectedPairs.flatMap(p =>
      [p.front?.name, p.back?.name].filter(Boolean) as string[]
    );
    if (allFilenames.length === 0) return;

    if (!window.confirm(`Delete ${allFilenames.length} file(s) from ${selectedPairs.length} card(s)?`)) return;

    try {
      await Promise.all(allFilenames.map(f => apiService.deleteRawFile(f)));
      setSelectedIds(new Set());
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    }
  };

  const handleCropSave = async (blob: Blob) => {
    if (!cropTarget) return;
    try {
      await apiService.replaceRawFile(cropTarget.filename, blob);
      setCropTarget(null);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cropped image');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pairs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pairs.map(p => p.id)));
    }
  };

  if (loading) {
    return (
      <div className="holding-pen-container">
        <div className="holding-pen-loading">Loading raw files...</div>
      </div>
    );
  }

  return (
    <div className="holding-pen-container">
      <div className="holding-pen-header">
        <h2>Holding Pen</h2>
        <p className="holding-pen-subtitle">
          {pairs.length} card{pairs.length !== 1 ? 's' : ''} ({files.length} file{files.length !== 1 ? 's' : ''}) awaiting review
        </p>
      </div>

      {error && (
        <div className="holding-pen-error">
          {error}
          <button onClick={() => setError(null)} className="holding-pen-error-dismiss">&times;</button>
        </div>
      )}

      {/* Upload drop zone */}
      <div
        className={`holding-pen-dropzone ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff"
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <span>Uploading...</span>
        ) : (
          <span>Drop card images here or click to upload</span>
        )}
      </div>

      {/* Bulk actions toolbar */}
      {pairs.length > 0 && (
        <div className="holding-pen-toolbar">
          <label className="holding-pen-select-all">
            <input
              type="checkbox"
              checked={selectedIds.size === pairs.length && pairs.length > 0}
              onChange={toggleSelectAll}
            />
            Select All
          </label>
          {selectedIds.size > 0 && (
            <div className="holding-pen-bulk-actions">
              <span className="holding-pen-selection-count">{selectedIds.size} selected</span>
              <button className="holding-pen-bulk-btn process" onClick={handleBulkProcess}>
                Process Selected
              </button>
              <button className="holding-pen-bulk-btn delete" onClick={handleBulkDelete}>
                Delete Selected
              </button>
            </div>
          )}
          <label
            className="holding-pen-notification-toggle"
            title={permission === 'denied' ? 'Notifications blocked by browser' : permission === 'unsupported' ? 'Notifications not supported' : ''}
          >
            <input
              type="checkbox"
              checked={enabled && permission === 'granted'}
              disabled={permission === 'denied' || permission === 'unsupported'}
              onChange={() => {
                if (permission === 'default') {
                  requestPermission().then(p => { if (p === 'granted') setEnabled(true); });
                } else {
                  setEnabled(!enabled);
                }
              }}
            />
            Notifications
          </label>
        </div>
      )}

      {/* Card grid */}
      {pairs.length === 0 ? (
        <div className="holding-pen-empty">
          No raw images found. Drop card photos above to get started.
        </div>
      ) : (
        <div className="holding-pen-grid">
          {pairs.map(pair => (
            <div
              key={pair.id}
              className={`holding-pen-card ${selectedIds.has(pair.id) ? 'selected' : ''} ${processing.has(pair.id) ? 'processing' : ''}`}
            >
              <div className="holding-pen-card-select">
                <input
                  type="checkbox"
                  checked={selectedIds.has(pair.id)}
                  onChange={() => toggleSelect(pair.id)}
                />
              </div>

              <div className="holding-pen-card-images">
                {pair.front && (
                  <div className="holding-pen-thumb-container">
                    <img
                      src={rawFileUrl(pair.front.name)}
                      alt={`${pair.label} front`}
                      className="holding-pen-thumb"
                      loading="lazy"
                      onClick={() => setLightbox(pair)}
                    />
                    <span className="holding-pen-thumb-label">Front</span>
                  </div>
                )}
                {pair.back && (
                  <div className="holding-pen-thumb-container">
                    <img
                      src={rawFileUrl(pair.back.name)}
                      alt={`${pair.label} back`}
                      className="holding-pen-thumb"
                      loading="lazy"
                      onClick={() => setLightbox(pair)}
                    />
                    <span className="holding-pen-thumb-label">Back</span>
                  </div>
                )}
              </div>

              <div className="holding-pen-card-info">
                <div className="holding-pen-card-label" title={pair.label}>
                  {pair.label}
                  {[pair.front, pair.back].some(f => f && processedRaw.has(f.name)) && (
                    <span className="holding-pen-processed-pill" title="This scan has already been confirmed into Processed">
                      Processed
                    </span>
                  )}
                </div>
                <div className="holding-pen-card-meta">
                  {[pair.front, pair.back].filter(Boolean).map(f => (
                    <span key={f!.name} className="holding-pen-file-size">{formatFileSize(f!.size)}</span>
                  ))}
                </div>
              </div>

              {processing.has(pair.id) && (
                <div className="holding-pen-card-spinner">Processing...</div>
              )}

              <div className="holding-pen-card-actions">
                <button
                  className="holding-pen-action-btn view"
                  title="View"
                  onClick={() => setLightbox(pair)}
                >
                  View
                </button>
                {pair.front && (
                  <button
                    className="holding-pen-action-btn crop"
                    title="Crop front image"
                    onClick={() => setCropTarget({ filename: pair.front!.name, url: rawFileUrl(pair.front!.name) })}
                  >
                    Crop
                  </button>
                )}
                <button
                  className="holding-pen-action-btn process"
                  title="Process"
                  onClick={() => handleProcess(pair)}
                  disabled={processing.has(pair.id)}
                >
                  Process
                </button>
                <button
                  className="holding-pen-action-btn delete"
                  title="Delete"
                  onClick={() => handleDelete(pair)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox
          frontUrl={lightbox.front ? rawFileUrl(lightbox.front.name) : null}
          backUrl={lightbox.back ? rawFileUrl(lightbox.back.name) : null}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Crop modal */}
      {cropTarget && (
        <ImageCropModal
          imageUrl={cropTarget.url}
          filename={cropTarget.filename}
          onSave={handleCropSave}
          onClose={() => setCropTarget(null)}
        />
      )}

      {/* Review form */}
      {reviewTarget && (
        <CardReviewForm
          initialData={reviewTarget.data}
          imageUrls={{
            front: reviewTarget.pair.front ? rawFileUrl(reviewTarget.pair.front.name) : undefined,
            back: reviewTarget.pair.back ? rawFileUrl(reviewTarget.pair.back.name) : undefined,
          }}
          mode="review"
          saving={reviewSaving}
          collections={collections}
          defaultCollectionId={defaultCollectionId}
          onSave={handleReviewConfirm}
          onCancel={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
};

export default HoldingPen;
