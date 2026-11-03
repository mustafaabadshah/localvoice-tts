import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Cpu, Database, AlertTriangle, Copy, Check, FileText } from 'lucide-react';
import { BackendHealth, BackendMetrics, ExtractionDiagnostics } from '../../shared/types';
import { describeBackendError } from '../../shared/errors';

interface DiagnosticsModalProps {
  isOpen: boolean;
  backendUrl: string;
  diagnostics: ExtractionDiagnostics | null;
  onClose: () => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  backendUrl,
  diagnostics,
  onClose,
}) => {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [metrics, setMetrics] = useState<BackendMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, metricsRes] = await Promise.all([
        fetch(`${backendUrl}/api/v1/health`),
        fetch(`${backendUrl}/api/v1/metrics`)
      ]);

      if (healthRes.ok) setHealth(await healthRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } catch (e: any) {
      setError(describeBackendError(e, backendUrl));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
    }
  }, [isOpen]);

  const handleCopyDiagnostics = () => {
    const report = {
      timestamp: new Date().toISOString(),
      backend_health: health,
      backend_metrics: metrics,
      extraction_diagnostics: diagnostics
    };
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxHeight: '90vh', overflowY: 'auto', width: '92%', maxWidth: '370px', padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Cpu size={15} style={{ color: 'var(--primary)' }} />
            <h2>Diagnostics</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <button className="icon-btn" onClick={handleCopyDiagnostics} title="Copy Diagnostic JSON to Clipboard">
              {copied ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
            </button>
            <button className="icon-btn" onClick={fetchDiagnostics} disabled={loading} title="Refresh">
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--danger)', fontSize: '11px', marginBottom: '8px' }}>
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Webpage Extraction Diagnostics */}
          <div className="card" style={{ padding: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>
              <FileText size={11} />
              <span>LIVE PAGE EXTRACTION</span>
            </div>
            {diagnostics ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '10px' }}>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Title: <strong>{diagnostics.pageTitle || 'Untitled'}</strong>
                </div>
                <div>Strategy: <strong>{diagnostics.strategyUsed}</strong></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', marginTop: '2px' }}>
                  <div>Blocks: <strong>{diagnostics.totalBlocks}</strong></div>
                  <div>Words: <strong>{diagnostics.totalWords}</strong></div>
                  <div>Chars: <strong>{diagnostics.totalCharacters}</strong></div>
                  <div>Duration: <strong>{diagnostics.durationMs} ms</strong></div>
                </div>
                {diagnostics.previewBlocks.length > 0 && (
                  <div style={{ marginTop: '4px', backgroundColor: 'var(--bg-secondary)', padding: '4px 6px', borderRadius: 'var(--radius-sm)', maxHeight: '45px', overflowY: 'auto', fontSize: '9.5px', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                    <em>Preview:</em> {diagnostics.previewBlocks[0]}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                No extraction yet
              </div>
            )}
          </div>

          {/* Dual Engine Runtime Status */}
          <div className="card" style={{ padding: '8px' }}>
            <div className="section-label" style={{ marginBottom: '5px' }}>Runtime</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
              <div>Status: <strong>{health?.status || 'Unknown'}</strong></div>
              <div>Active: <strong style={{ color: health?.active_engine === 'kokoro' ? 'var(--accent)' : 'var(--primary)' }}>{health?.active_engine?.toUpperCase() || 'PIPER'}</strong></div>
              <div>Piper: <strong>{health?.piper_runtime || 'Available'} ({health?.piper_installed_voices || 1})</strong></div>
              <div>Kokoro: <strong>{health?.kokoro_runtime || 'Available'} ({health?.kokoro_installed_voices || 54})</strong></div>
              <div style={{ gridColumn: 'span 2' }}>
                Loaded Model: <strong>{health?.current_loaded_voice || 'None (Lazy load)'}</strong>
              </div>
            </div>
          </div>

          {/* Performance & Audio Cache */}
          <div className="card" style={{ padding: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '5px' }}>
              <Database size={11} />
              <span>Cache</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
              <div>Requests: <strong>{metrics?.total_requests || 0}</strong></div>
              <div>Avg Latency: <strong>{metrics?.average_latency_seconds ? `${metrics.average_latency_seconds}s` : '0.0s'}</strong></div>
              <div>Cached: <strong>{metrics?.cache_stats?.total_mb || 0} MB / {metrics?.cache_stats?.max_mb || 250} MB</strong></div>
              <div>Hit Rate: <strong>{metrics?.cache_stats?.hit_rate_pct || 0}%</strong></div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <button className="btn-secondary" onClick={onClose} style={{ fontSize: '10.5px', padding: '3px 8px' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
