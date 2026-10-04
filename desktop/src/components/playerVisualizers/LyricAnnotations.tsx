import type { CSSProperties } from 'react';
import type { LyricRubySegment } from '@lx/core';

interface LyricTextProps {
  text: string;
  ruby?: LyricRubySegment[];
  reading?: string;
  showRuby?: boolean;
}

/** 源内容始终是 React 文本节点，只由本组件创建白名单 ruby/rt 元素。 */
export function LyricText({ text, ruby, reading, showRuby = false }: LyricTextProps) {
  if (!showRuby) return <>{text}</>;
  const segments = ruby ?? (reading ? [{ text, reading }] : undefined);
  if (!segments?.some(segment => segment.reading)) return <>{text}</>;
  return <>{segments.map((segment, index) => segment.reading ? (
    <ruby key={index} style={{ rubyPosition: 'over' }}>
      {segment.text}
      <rt style={{ fontSize: '0.5em', lineHeight: 1.1, color: 'var(--af-ruby-color, #f8fafc)', WebkitTextFillColor: 'var(--af-ruby-color, #f8fafc)' } as CSSProperties}>{segment.reading}</rt>
    </ruby>
  ) : <span key={index}>{segment.text}</span>)}</>;
}

export function LyricRomanization({ text, show = false }: { text?: string; show?: boolean }) {
  if (!show || !text?.trim()) return null;
  return <span className="af-lyric-romanization" style={{ display: 'block', marginTop: 5, fontSize: 'max(12px, 0.58em)', lineHeight: 1.45, fontWeight: 500, color: 'inherit', WebkitTextFillColor: 'currentColor', opacity: .82 }}>{text}</span>;
}
