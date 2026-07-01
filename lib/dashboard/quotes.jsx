/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Quotes widget — LLM-generated inspirational quotes with background images
 * Prompt summary: "widget that fetches quotes via callPlugin and displays on image tiles"
 */
import { widgetTitleFromId } from "constants/settings";
import { useEffect, useState } from "react";
import { getRandomQuotes } from "quotes-data";
import { backgroundSplashUrl } from "util/background-splash-images";
import WidgetWrapper from "widget-wrapper";
import "styles/quotes.scss"

// --------------------------------------------------------------------------------------
export default function QuotesWidget({ gridHeightSize, planContent, quotes }) {
  const quoteCount = (gridHeightSize || 1) >= 2 ? 4 : 2;
  const [displayQuotes, setDisplayQuotes] = useState(quotes || (!planContent ? getRandomQuotes(quoteCount) : []));
  const [loading, setLoading] = useState(!quotes && !!planContent);
  const [backgroundSeed] = useState(() => `${ Date.now() }-${ Math.random() }`);

  useEffect(() => {
    if (!quotes) {
      setDisplayQuotes(getRandomQuotes(quoteCount));
    }
  }, []);

  useEffect(() => {
    if (!loading && displayQuotes.length < quoteCount) {
      setDisplayQuotes(getRandomQuotes(quoteCount));
    }
  }, [quoteCount]);

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
