/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Amplenote Rich Footnote rendering with content-type icons and tippy popups
 * Prompt summary: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
 */
import tippy from 'tippy.js';
import { renderMarkdown } from "util/utility";
import "dashboard/styles/amplenote-markdown-render.scss";

const FOOTNOTE_REF_RE = /\[([^\]]+)\]\[\^(\d+)\]/g;
const FOOTNOTE_DEF_RE = /^\[\^(\d+)\]:\s*(.*)/;
const FOOTNOTE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;
const FOOTNOTE_LINK_RE = /^\[([^\]]*)\]\(([^)]*)\)/;

const VIDEO_URL_RE = /\.(mp4|webm|ogg)(\?|$)/i;
const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
const VIMEO_RE = /vimeo\.com\/(\d+)/;

function isVideoUrl(url) {
  return VIDEO_URL_RE.test(url) || YOUTUBE_RE.test(url) || VIMEO_RE.test(url);
}

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// [Claude] Task: classify a single footnote-definition body line as link, image/video, or text
// Prompt: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function parseFootnoteLine(line, footnote) {
  const imageMatch = line.match(FOOTNOTE_IMAGE_RE);
  if (imageMatch) {
    const url = imageMatch[2];
    if (isVideoUrl(url)) {
      footnote.videos.push({ alt: imageMatch[1], url });
    } else {
      footnote.images.push({ alt: imageMatch[1], url });
    }
    return;
  }

  const linkMatch = line.match(FOOTNOTE_LINK_RE);
  if (linkMatch) {
    if (!footnote.description && !footnote.url) {
      footnote.description = linkMatch[1] || '';
      footnote.url = linkMatch[2] || '';
    } else {
      footnote.text.push(line);
    }
    return;
  }

  if (line) footnote.text.push(line);
}

// [Claude] Task: extract [^N] footnote definitions from markdown, return cleaned body + footnote map
// Prompt: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function parseFootnotes(markdown) {
  const lines = markdown.split('\n');
  const footnotes = {};
  const contentLines = [];
  let currentFnId = null;

  for (const line of lines) {
    const defMatch = line.match(FOOTNOTE_DEF_RE);
    if (defMatch) {
      currentFnId = defMatch[1];
      footnotes[currentFnId] = { description: '', url: '', images: [], videos: [], text: [] };
      const remainder = defMatch[2].trim();
      if (remainder) parseFootnoteLine(remainder, footnotes[currentFnId]);
      continue;
    }

    if (currentFnId !== null) {
      if (line.trim()) {
        parseFootnoteLine(line.trim(), footnotes[currentFnId]);
        continue;
      }
      currentFnId = null;
    }

    contentLines.push(line);
  }

  return { footnotes, cleanedMarkdown: contentLines.join('\n') };
}

function getIndicatorIcons(fn) {
  const icons = [];
  if (fn.images.length) icons.push({ cls: 'image', title: 'Contains image', symbol: '🖼' });
  if (fn.videos.length) icons.push({ cls: 'video', title: 'Contains video', symbol: '🎬' });
  if (!fn.images.length && !fn.videos.length) {
    if (fn.url) icons.push({ cls: 'url', title: 'Contains link', symbol: '🔗' });
    else if (fn.description || fn.text.length) icons.push({ cls: 'text', title: 'Contains details', symbol: '📝' });
  }
  return icons;
}

// [Claude] Task: build the tippy popup HTML for a single rich footnote
// Prompt: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function buildPopupHtml(fn) {
  const parts = ['<div class="rich-footnote-popup">'];

  if (fn.url) {
    parts.push(
      '<div class="rich-footnote-popup-url">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
      '<polyline points="15 3 21 3 21 9"/>' +
      '<line x1="10" y1="14" x2="21" y2="3"/>' +
      '</svg>' +
      `<a href="${escapeAttr(fn.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fn.url)}</a>` +
      '</div>'
    );
  }

  if (fn.description) {
    parts.push(`<div class="rich-footnote-popup-text">${escapeHtml(fn.description)}</div>`);
  }

  for (const t of fn.text) {
    parts.push(`<div class="rich-footnote-popup-text">${escapeHtml(t)}</div>`);
  }

  for (const img of fn.images) {
    parts.push(
      '<div class="rich-footnote-popup-media">' +
      `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}" loading="lazy"/>` +
      '</div>'
    );
  }

  for (const vid of fn.videos) {
    const ytMatch = vid.url.match(YOUTUBE_RE);
    const vimeoMatch = vid.url.match(VIMEO_RE);
    if (ytMatch) {
      parts.push(
        '<div class="rich-footnote-popup-media">' +
        `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>` +
        '</div>'
      );
    } else if (vimeoMatch) {
      parts.push(
        '<div class="rich-footnote-popup-media">' +
        `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" frameborder="0" allowfullscreen></iframe>` +
        '</div>'
      );
    } else {
      parts.push(
        '<div class="rich-footnote-popup-media">' +
        `<video src="${escapeAttr(vid.url)}" controls></video>` +
        '</div>'
      );
    }
  }

  parts.push(
    '<div class="rich-footnote-popup-actions">' +
    '<button class="rich-footnote-popup-close" type="button">CLOSE</button>' +
    '</div>'
  );

  parts.push('</div>');
  return parts.join('');
}

function buildEnhancedLink(renderedText, fn) {
  const icons = getIndicatorIcons(fn);
  const popupData = encodeURIComponent(JSON.stringify({
    url: fn.url,
    description: fn.description,
    text: fn.text,
    images: fn.images,
    videos: fn.videos,
  }));

  const href = fn.url || '#';
  const iconHtml = icons.map(i =>
    `<span class="rich-footnote-indicator rich-footnote-indicator--${i.cls}" title="${i.title}">${i.symbol}</span>`
  ).join('');

  return '<span class="rich-footnote-wrap">' +
    `<a class="rich-footnote-link" href="${escapeAttr(href)}" ` +
    `data-rich-footnote="${popupData}" ` +
    `target="_blank" rel="noopener noreferrer">${renderedText}</a>` +
    iconHtml +
    '</span>';
}

// [Claude] Task: drop-in replacement for renderMarkdown that handles Amplenote Rich Footnotes
// Prompt: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
/**
 * Process markdown that may contain Amplenote Rich Footnotes.
 * Footnote references `[text][^N]` are turned into links with content-type
 * indicator icons. Call {@link attachFootnotePopups} on the containing DOM
 * element after inserting the returned HTML to wire up the tippy popups.
 *
 * @param {string} markdown - Raw markdown, potentially with `[^N]:` definitions
 * @returns {string} HTML string ready for `dangerouslySetInnerHTML`
 */
export function amplenoteMarkdownRender(markdown) {
  if (!markdown) return "";

  const { footnotes, cleanedMarkdown } = parseFootnotes(markdown);

  if (Object.keys(footnotes).length === 0) {
    return renderMarkdown(markdown);
  }

  const placeholders = [];

  const withPlaceholders = cleanedMarkdown.replace(FOOTNOTE_REF_RE, (match, text, fnId) => {
    if (!footnotes[fnId]) return match;
    const idx = placeholders.length;
    placeholders.push({ text, fnId });
    return `<!--FNREF:${idx}-->`;
  });

  let html = renderMarkdown(withPlaceholders);

  html = html.replace(/<!--FNREF:(\d+)-->/g, (_match, idxStr) => {
    const { text, fnId } = placeholders[parseInt(idxStr)];
    const fn = footnotes[fnId];
    if (!fn) return text;
    const renderedText = renderMarkdown(text);
    return buildEnhancedLink(renderedText, fn);
  });

  return html;
}

// [Claude] Task: attach tippy popups to rendered rich-footnote links inside a DOM container
// Prompt: "implement rich footnotes with icons and tippy popups showing text, images, video, URL"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
/**
 * Attach tippy popups to every `.rich-footnote-link[data-rich-footnote]`
 * element inside the given container. Must be called after the HTML from
 * {@link amplenoteMarkdownRender} has been inserted into the DOM.
 *
 * @param {HTMLElement} containerEl - Parent element that contains the rendered links
 */
export function attachFootnotePopups(containerEl) {
  if (!containerEl) return;

  const links = containerEl.querySelectorAll('.rich-footnote-link[data-rich-footnote]');
  for (const link of links) {
    if (link._tippyRichFootnote) continue;

    let data;
    try {
      data = JSON.parse(decodeURIComponent(link.dataset.richFootnote));
    } catch {
      continue;
    }

    const popupHtml = buildPopupHtml(data);

    link._tippyRichFootnote = tippy(link, {
      content: popupHtml,
      allowHTML: true,
      interactive: true,
      trigger: 'click',
      placement: 'bottom-start',
      theme: 'rich-footnote',
      maxWidth: 420,
      arrow: true,
      duration: [150, 100],
      appendTo: () => document.body,
      onShow() {
        link.addEventListener('click', preventDefaultHandler);
      },
      onShown(instance) {
        const closeBtn = instance.popper.querySelector('.rich-footnote-popup-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => instance.hide(), { once: true });
        }
      },
      onHide() {
        link.removeEventListener('click', preventDefaultHandler);
      },
    });
  }
}

function preventDefaultHandler(e) {
  e.preventDefault();
  e.stopPropagation();
}
