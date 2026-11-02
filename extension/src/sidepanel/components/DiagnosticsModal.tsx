import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Cpu, Database, CheckCircle, AlertTriangle } from 'lucide-react';
import { BackendHealth, BackendMetrics } from '../../shared/types';

interface DiagnosticsModalProps {
  isOpen: boolean;
  backendUrl: string;
  onClose: () => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, backendUrl, onClose }) => {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [metrics, setMetrics] = useState<BackendMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(e.message || 'Could not connect to backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Cpu size={16} />
            <h2 style={{ fontSize: '15px', fontWeight: 600 }}>System Diagnostics</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="icon-btn" onClick={fetchDiagnostics} disabled={loading} title="Refresh">
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
            <button className="icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {error ? (
          <div style={{ padding: '12px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--danger)', fontSize: '12px' }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Runtime card */}
            <div className="card" style={{ padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>RUNTIME STATUS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
                <div>Status: <strong>{health?.status || 'Unknown'}</strong></div>
                <div>Engine: <strong>Piper TTS</strong></div>
                <div>Execution: <strong>CPU Only</strong></div>
                <div>Version: <strong>v{health?.version || '1.0.0'}</strong></div>
                <div style={{ gridColumn: 'span 2' }}>
                  Loaded Voice: <strong>{health?.current_loaded_voice || 'None'}</strong>
                </div>
              </div>
            </div>

            {/* Performance metrics */}
            <div className="card" style={{ padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>PERFORMANCE & REQUESTS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
                <div>Total Requests: <strong>{metrics?.total_requests || 0}</strong></div>
                <div>Successful: <strong style={{ color: 'var(--success)' }}>{metrics?.successful_requests || 0}</strong></div>
                <div>Failed: <strong style={{ color: 'var(--danger)' }}>{metrics?.failed_requests || 0}</strong></div>
                <div>Avg Latency: <strong>{metrics?.average_latency_seconds ? `${metrics.average_latency_seconds}s` : '0.0s'}</strong></div>
              </div>
            </div>

            {/* Disk Cache */}
            <div className="card" style={{ padding: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                <Database size={12} />
                <span>BOUNDED AUDIO CACHE</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
                <div>Stored Audio: <strong>{metrics?.cache_stats?.total_mb || 0} MB</strong></div>
                <div>Limit: <strong>{metrics?.cache_stats?.max_mb || 250} MB</strong></div>
                <div>Cached Files: <strong>{metrics?.cache_stats?.file_count || 0}</strong></div>
                <div>Hit Rate: <strong>{metrics?.cache_stats?.hit_rate_pct || 0}%</strong></div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
