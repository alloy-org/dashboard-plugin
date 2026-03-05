/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quotes widget — LLM-generated inspirational quotes with background images
 * Prompt summary: "widget that fetches quotes via callPlugin and displays on image tiles"
 */
import { createElement, useEffect, useState } from "react";
import WidgetWrapper from './widget-wrapper';
import { getRandomQuotes } from './quotes-data';

// [Claude] Task: display inspirational quotes — local random pool or LLM when plan content present
// Prompt: "add a set of 100 inspirational quotes randomly picked for the Inspiration component"
// Date: 2026-03-05 | Model: claude-sonnet-4-6
export default function QuotesWidget({ quotes, planContent }) {
  const h = createElement;
  // When plan content is available the LLM path can tailor quotes to goals; otherwise
  // use the built-in pool immediately so the widget renders without any network call.
  const [displayQuotes, setDisplayQuotes] = useState(quotes || (!planContent ? getRandomQuotes(2) : []));
  const [loading, setLoading] = useState(!quotes && !!planContent);

  // Background image queries for Unsplash
  // NOTE ON IMAGE SOURCING:
  // Unsplash API (https://unsplash.com/developers) is recommended:
  //   - Free: 50 req/hr (demo), 5000 req/hr (production)
  //   - Hotlinking REQUIRED (perfect for client-side plugins)
  //   - Attribution required (photographer name + Unsplash link)
  //   - Example: https://api.unsplash.com/photos/random?query=mountains&orientation=landscape
  //   - Pass API key as: Authorization: Client-ID YOUR_ACCESS_KEY
  //
  // Pexels API (https://www.pexels.com/api/) is the best alternative:
  //   - Free: 200 req/hr, 20K/month
  //   - Example: GET https://api.pexels.com/v1/search?query=nature&orientation=landscape
  //
  // For zero-cost MVP, use static Unsplash source URLs (no API key needed):
  //   https://source.unsplash.com/featured/?mountains,nature
  //   NOTE: This endpoint is deprecated; use the API instead.
  //
  // Pixabay (https://pixabay.com/api/) is NOT recommended because
  // it prohibits hotlinking — images must be downloaded server-side.
  //
  // For lowest-cost approach: bundle 10-20 curated image URLs and rotate them.

  const BG_IMAGES = [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=300&fit=crop',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600&h=300&fit=crop'
  ];

  useEffect(() => {
    if (!quotes && planContent) {
      // Only call the LLM when there is plan content to personalise against
      setLoading(true);
      callPlugin('fetchQuotes', planContent).then(q => {
        setDisplayQuotes(q && q.length ? q : getRandomQuotes(2));
        setLoading(false);
      });
    }
  }, []);

  if (loading) return h(WidgetWrapper, { title: 'Inspiration', icon: '💡', widgetId: 'quotes' },
    h('div', { className: 'quotes-loading' }, 'Generating quotes...')
  );

  return h(WidgetWrapper, { title: 'Inspiration', icon: '💡', widgetId: 'quotes' },
    h('div', { className: 'quotes-grid' },
      displayQuotes.slice(0, 2).map((q, i) =>
        h('div', {
          key: i,
          className: 'quote-tile',
          style: { backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.6)), url(' + BG_IMAGES[i % BG_IMAGES.length] + ')' }
        },
          h('p', { className: 'quote-text' }, '"' + q.text + '"'),
          q.author ? h('span', { className: 'quote-author' }, '— ' + q.author) : null
        )
      )
    )
  );
}
