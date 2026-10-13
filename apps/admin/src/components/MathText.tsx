import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Fragment, useMemo } from 'react';

/** Renders text with inline $...$ maths using KaTeX. Plain text is escaped by React. */
export function MathText({ text, className }: { text: string | null | undefined; className?: string }) {
  const parts = useMemo(() => {
    if (!text) return [];
    return text.split(/(\$[^$]+\$)/g).map((part) => {
      if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
        try {
          return { math: katex.renderToString(part.slice(1, -1), { throwOnError: false, output: 'html' }) };
        } catch {
          return { text: part };
        }
      }
      return { text: part };
    });
  }, [text]);

  return (
    <span className={className}>
      {parts.map((p, i) =>
        'math' in p ? <span key={i} dangerouslySetInnerHTML={{ __html: p.math! }} /> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </span>
  );
}
