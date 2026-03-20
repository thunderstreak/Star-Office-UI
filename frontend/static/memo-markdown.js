(function (globalScope) {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeLink(rawHref) {
    if (typeof rawHref !== 'string') return null;
    const href = rawHref.trim();
    if (!href) return null;

    try {
      const parsed = new URL(href, 'https://memo.local');
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return null;
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !/^[a-z0-9.+-]+:/i.test(href)) {
        return null;
      }
      return href;
    } catch (_) {
      return null;
    }
  }

  function applyEmphasis(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  }

  function renderInline(text) {
    const tokens = [];
    const store = (html) => {
      const token = `%%MEMOTOKEN${tokens.length}%%`;
      tokens.push({ token, html });
      return token;
    };

    let working = String(text || '');
    working = working.replace(/`([^`\n]+)`/g, (_, code) => store(`<code>${escapeHtml(code)}</code>`));
    working = working.replace(/\[([^\]\n]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeLink(href);
      const safeLabel = applyEmphasis(escapeHtml(label));
      if (!safeHref) return store(safeLabel);
      const rel = safeHref.startsWith('mailto:') ? 'noopener noreferrer' : 'noopener noreferrer';
      return store(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="${rel}">${safeLabel}</a>`);
    });

    working = applyEmphasis(escapeHtml(working));

    for (const { token, html } of tokens) {
      working = working.split(token).join(html);
    }

    return working;
  }

  function renderParagraph(lines) {
    const text = lines.join(' ').trim();
    return text ? `<p>${renderInline(text)}</p>` : '';
  }

  function renderList(lines) {
    const items = lines
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
      .map((line) => `<li>${renderInline(line)}</li>`)
      .join('');
    return items ? `<ul>${items}</ul>` : '';
  }

  function renderBlockquote(lines) {
    const content = lines
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .join('\n')
      .trim();
    if (!content) return '';
    return `<blockquote>${renderBlocks(content)}</blockquote>`;
  }

  function renderHeading(line) {
    const match = line.match(/^(#{1,3})\s+(.*)$/);
    if (!match) return '';
    const level = match[1].length;
    return `<h${level}>${renderInline(match[2].trim())}</h${level}>`;
  }

  function renderCodeFence(lines, startIndex) {
    const opener = lines[startIndex].match(/^```\s*([\w-]+)?\s*$/);
    if (!opener) return null;

    const language = opener[1] ? opener[1].toLowerCase() : '';
    const codeLines = [];
    let index = startIndex + 1;

    while (index < lines.length && !/^```\s*$/.test(lines[index])) {
      codeLines.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length) {
      return {
        html: `<p>${renderInline(lines[startIndex])}</p>`,
        nextIndex: startIndex + 1,
      };
    }

    const className = language ? ` class="language-${escapeHtml(language)}"` : '';
    return {
      html: `<pre><code${className}>${escapeHtml(codeLines.join('\n'))}\n</code></pre>`,
      nextIndex: index + 1,
    };
  }

  function renderBlocks(input) {
    const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const codeFence = renderCodeFence(lines, index);
      if (codeFence) {
        blocks.push(codeFence.html);
        index = codeFence.nextIndex;
        continue;
      }

      if (/^#{1,3}\s+/.test(line)) {
        blocks.push(renderHeading(line));
        index += 1;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const listLines = [];
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          listLines.push(lines[index]);
          index += 1;
        }
        blocks.push(renderList(listLines));
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quoteLines.push(lines[index]);
          index += 1;
        }
        blocks.push(renderBlockquote(quoteLines));
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length
        && lines[index].trim()
        && !/^#{1,3}\s+/.test(lines[index])
        && !/^\s*[-*]\s+/.test(lines[index])
        && !/^\s*>\s?/.test(lines[index])
        && !/^```/.test(lines[index])
      ) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderParagraph(paragraphLines));
    }

    return blocks.filter(Boolean).join('');
  }

  function renderMemoHtml(markdown) {
    const source = typeof markdown === 'string' ? markdown : '';
    if (!source.trim()) return '';
    return `<div class="memo-markdown">${renderBlocks(source)}</div>`;
  }

  function renderPlainTextHtml(text) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim()) return '';
    return `<div class="memo-markdown memo-markdown--plain"><p>${escapeHtml(source).replace(/\n/g, '<br>')}</p></div>`;
  }

  function pickMemoSource(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const memoMarkdown = typeof source.memo_markdown === 'string' ? source.memo_markdown : '';
    if (memoMarkdown.trim()) return memoMarkdown;
    return typeof source.memo === 'string' ? source.memo : '';
  }

  const api = {
    escapeHtml,
    pickMemoSource,
    renderPlainTextHtml,
    renderMemoHtml,
    sanitizeLink,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.memoMarkdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
