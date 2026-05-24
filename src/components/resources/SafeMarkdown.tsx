import { Link } from 'react-router-dom';
import { Fragment, type ReactNode } from 'react';

/**
 * Minimal safe Markdown renderer for admin-approved resource articles.
 *
 * Supported:
 *   - # / ## / ### headings
 *   - Unordered bullet lines starting with "- "
 *   - Paragraphs (blank-line separated)
 *   - Inline links [label](/internal) or [label](https://external)
 *
 * Intentionally NOT supported (security):
 *   - Raw HTML (rendered as plain text)
 *   - Images, scripts, iframes
 *   - dangerouslySetInnerHTML is never used
 */

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={`${keyBase}-t-${i++}`}>{text.slice(last, idx)}</Fragment>);
    const label = m[1];
    const href = m[2];
    if (href.startsWith('/')) {
      out.push(
        <Link key={`${keyBase}-l-${i++}`} to={href} className="text-primary hover:underline">
          {label}
        </Link>,
      );
    } else if (/^https?:\/\//i.test(href)) {
      out.push(
        <a
          key={`${keyBase}-l-${i++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {label}
        </a>,
      );
    } else {
      // Unsupported scheme — render label as plain text
      out.push(<Fragment key={`${keyBase}-l-${i++}`}>{label}</Fragment>);
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-t-${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'p';
  content?: string;
  items?: string[];
}

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', content: para.join(' ').trim() });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'ul', items: list });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    let m = /^###\s+(.*)$/.exec(line);
    if (m) { flushPara(); flushList(); blocks.push({ type: 'h3', content: m[1] }); continue; }
    m = /^##\s+(.*)$/.exec(line);
    if (m) { flushPara(); flushList(); blocks.push({ type: 'h2', content: m[1] }); continue; }
    m = /^#\s+(.*)$/.exec(line);
    if (m) { flushPara(); flushList(); blocks.push({ type: 'h1', content: m[1] }); continue; }
    m = /^[-*]\s+(.*)$/.exec(line);
    if (m) { flushPara(); list.push(m[1]); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export default function SafeMarkdown({ content }: { content: string }) {
  const blocks = parse(content || '');
  return (
    <div className="space-y-4 leading-relaxed text-foreground">
      {blocks.map((b, i) => {
        const key = `b-${i}`;
        if (b.type === 'h1') return <h1 key={key} className="text-3xl font-black font-heading mt-6">{renderInline(b.content ?? '', key)}</h1>;
        if (b.type === 'h2') return <h2 key={key} className="text-2xl font-bold font-heading mt-6">{renderInline(b.content ?? '', key)}</h2>;
        if (b.type === 'h3') return <h3 key={key} className="text-lg font-bold font-heading mt-4">{renderInline(b.content ?? '', key)}</h3>;
        if (b.type === 'ul') {
          return (
            <ul key={key} className="list-disc pl-6 space-y-1 text-muted-foreground">
              {(b.items ?? []).map((it, j) => (
                <li key={`${key}-i-${j}`}>{renderInline(it, `${key}-i-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key} className="text-muted-foreground">{renderInline(b.content ?? '', key)}</p>;
      })}
    </div>
  );
}
