import React from 'react';
import { FileText, Clock } from 'lucide-react';
import { TextBlock } from '../../shared/types';

interface PageInfoProps {
  pageTitle: string;
  blocks: TextBlock[];
}

export const PageInfo: React.FC<PageInfoProps> = ({ pageTitle, blocks }) => {
  const totalWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);
  const estimatedMinutes = Math.max(1, Math.round(totalWords / 150));

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FileText size={12} />
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Active Tab</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Clock size={10} />
          <span>~{estimatedMinutes} min read</span>
        </div>
      </div>

      <div style={{ fontWeight: 600, fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {pageTitle || 'No active webpage'}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
        {blocks.length} paragraphs extracted
      </div>
    </div>
  );
};
