import React from 'react';
import { FileText } from 'lucide-react';
import { TextBlock } from '../../shared/types';

interface PageInfoProps {
  pageTitle: string;
  blocks: TextBlock[];
}

export const PageInfo: React.FC<PageInfoProps> = ({ pageTitle, blocks }) => {
  const totalWords = blocks.reduce((acc, b) => acc + b.text.split(/\s+/).filter(Boolean).length, 0);
  const minutes = Math.max(1, Math.round(totalWords / 150));
  const hasContent = blocks.length > 0;

  // No "Active Tab" label and no "N paragraphs extracted" sentence: the title plus
  // two tabular numbers say the same thing in one row, and the row disappears
  // entirely until a page has actually been read.
  return (
    <div className="spread" style={{ padding: '0 1px' }}>
      <div className="row" style={{ gap: '5px' }}>
        <FileText size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span
          title={pageTitle}
          style={{
            fontSize: '11.5px',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {pageTitle || '—'}
        </span>
      </div>

      {hasContent && (
        <span className="meta" title={`${totalWords} words`}>
          {blocks.length} para · {minutes} min
        </span>
      )}
    </div>
  );
};
