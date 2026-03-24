/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quotes widget — LLM-generated inspirational quotes with background images
 * Prompt summary: "widget that fetches quotes via callPlugin and displays on image tiles"
 */
import { widgetTitleFromId } from "constants/settings";
import { createElement, useEffect, useState } from "react";
import { fetchQuotes as fetchQuotesFromLLM } from "data-service";
import { getRandomQuotes } from "quotes-data";
import { backgroundSplashUrl } from "util/background-splash-images";
import WidgetWrapper from "widget-wrapper";
import "styles/quotes.scss"

// [Claude] Task: display inspirational quotes — local random pool or LLM when plan content present
// Prompt: "add a set of 100 inspirational quotes randomly picked for the Inspiration component"
// Date: 2026-03-05 | Model: claude-sonnet-4-6
// [Claude] Task: accept gridHeightSize to show more quotes when widget is 2 vertical cells
// Prompt: "more quotes are shown in the inspiration component when it is 2 units tall"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export default function QuotesWidget({ app, gridHeightSize = 1, planContent, quotes }) {
  const h = createElement;
  const quoteCount = gridHeightSize >= 2 ? 4 : 2;
  const [displayQuotes, setDisplayQuotes] = useState(quotes || (!planContent ? getRandomQuotes(quoteCount) : []));
  const [loading, setLoading] = useState(!quotes && !!planContent);
  const [backgroundSeed] = useState(() => `${ Date.now() }-${ Math.random() }`);

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

  useEffect(() => {
    if (!quotes && planContent) {
      setLoading(true);
      fetchQuotesFromLLM(app, planContent).then(q => {
        setDisplayQuotes(q && q.length ? q : getRandomQuotes(quoteCount));
        setLoading(false);
      });
    }
  }, []);

  // [Claude] Task: refresh quote pool when quoteCount increases beyond what state holds
  // Prompt: "when quotes.js has vertical height of 2, it still only shows two quotes"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    if (!loading && displayQuotes.length < quoteCount) {
      setDisplayQuotes(getRandomQuotes(quoteCount));
    }
  }, [quoteCount]);

  // [Claude] Task: add reseed button to refresh quotes from random pool
  // Prompt: "Add a reseed button to the upper-right of the quotes widget"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  const handleReseed = () => {
    setDisplayQuotes(getRandomQuotes(quoteCount));
  };

  const reseedButton = h('button', {
    className: 'widget-header-action',
    onClick: handleReseed,
    title: 'Reseed quotes',
  }, '↻ Reseed');

  if (loading) return h(WidgetWrapper, { title: widgetTitleFromId('quotes'), icon: '💡', widgetId: 'quotes' },
    h('div', { className: 'quotes-loading' }, 'Generating quotes...')
  );

  return h(WidgetWrapper, { title: widgetTitleFromId('quotes'), icon: '💡', widgetId: 'quotes', headerActions: reseedButton },
    h('div', { className: 'quotes-grid' },
      displayQuotes.slice(0, quoteCount).map((q, i) =>
        h('div', {
          key: i,
          className: 'quote-tile',
          style: { backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.6)), url(' + backgroundSplashUrl('small', backgroundSeed, i) + ')' }
        },
          h('p', { className: 'quote-text' }, '"' + q.text + '"'),
          q.author ? h('span', { className: 'quote-author' }, '— ' + q.author) : null
        )
      )
    )
  );
}
