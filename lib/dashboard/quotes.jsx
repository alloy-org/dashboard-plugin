/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quotes widget — LLM-generated inspirational quotes with background images
 * Prompt summary: "widget that fetches quotes via callPlugin and displays on image tiles"
 */
import { widgetTitleFromId } from "constants/settings";
import { useEffect, useState } from "react";
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
// [Claude] Task: accept providerApiKey prop and pass to fetchQuotes instead of reading app.settings
// Prompt: "for each widget that needs to call AI, use apiKeyFromProvider to pass a providerApiKey prop"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate QuotesWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function QuotesWidget({ app, gridHeightSize, planContent, providerApiKey, quotes }) {
  const quoteCount = (gridHeightSize || 1) >= 2 ? 4 : 2;
  const [displayQuotes, setDisplayQuotes] = useState(quotes || (!planContent ? getRandomQuotes(quoteCount) : []));
  const [loading, setLoading] = useState(!quotes && !!planContent);
  const [backgroundSeed] = useState(() => `${ Date.now() }-${ Math.random() }`);

  useEffect(() => {
    if (!quotes && planContent) {
      setLoading(true);
      fetchQuotesFromLLM(app, planContent, { apiKey: providerApiKey }).then(q => {
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

  const reseedButton = (
    <button className="widget-header-action" onClick={handleReseed} title="Reseed quotes">
      ↻ Reseed
    </button>
  );

  if (loading) {
    return (
      <WidgetWrapper title={widgetTitleFromId('quotes')} icon="💡" widgetId="quotes">
        <div className="quotes-loading">Generating quotes...</div>
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper title={widgetTitleFromId('quotes')} icon="💡" widgetId="quotes" headerActions={reseedButton}>
      <div className="quotes-grid">
        {displayQuotes.slice(0, quoteCount).map((q, i) => (
          <div
            key={i}
            className="quote-tile"
            style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.6)), url(' + backgroundSplashUrl('small', backgroundSeed, i) + ')' }}
          >
            <p className="quote-text">{'"' + q.text + '"'}</p>
            {q.author ? <span className="quote-author">{'— ' + q.author}</span> : null}
          </div>
        ))}
      </div>
    </WidgetWrapper>
  );
}
