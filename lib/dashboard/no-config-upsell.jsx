// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "When a widget has no available LLM key, print a NoConfig upsell equivalent to the one Goal
//   Coach (DreamTask) shows, but highlighting different features. Extract the upsell into a standalone component
//   called by both DreamTask and Proposed Agenda, parameterized by the features it highlights."
import WidgetWrapper from "widget-wrapper";

import "styles/no-config-upsell.scss";

const AMPLE_AGENT_PRO_URL = "https://www.amplenote.com/plugins/ample_agent_pro";
const DEFAULT_HEADLINE = "Unlock 21 AI features — no API key needed";
const DEFAULT_SUBHEAD = "Amplenote provides free access to frontier models for writing, task management, research, and more.";

// ----------------------------------------------------------------------------------------------
// @desc Marketing/no-config card shown when a widget can't reach an LLM (no API key configured). Promotes
//   Ample Agent Pro and is shared by every widget that needs an AI provider; each caller supplies the icon,
//   title, widgetId, and the feature list it wants to highlight, so the same card sells different features.
// @param {object} props - { app, features, headline, icon, moreFeaturesLabel, subhead, title, widgetId }.
//   - {object} app - Amplenote app bridge (used to navigate to the Ample Agent Pro listing).
//   - {Array<{icon: string, label: string}>} features - Feature pills to highlight for this widget.
//   - {string} [headline] - Override the default headline.
//   - {string} icon - Widget icon shown in the WidgetWrapper header.
//   - {string|null} [moreFeaturesLabel] - Optional "+ N more features" line beneath the pills.
//   - {string} [subhead] - Override the default subhead copy.
//   - {string} title - Widget title shown in the WidgetWrapper header.
//   - {string} widgetId - Widget id for WidgetWrapper styling/telemetry.
// [Claude claude-opus-4-8 (1M context)] Task: shared, feature-parameterized no-config upsell card
export default function NoConfigUpsell({ app, features = [], headline = DEFAULT_HEADLINE, icon,
    moreFeaturesLabel = null, subhead = DEFAULT_SUBHEAD, title, widgetId }) {
  return (
    <WidgetWrapper title={ title } icon={ icon } widgetId={ widgetId }>
      <div className="no-config-upsell">
        <div className="no-config-upsell-badges">
          <span className="no-config-upsell-badge no-config-upsell-badge--brand">Ample Agent Pro</span>
          <span className="no-config-upsell-badge no-config-upsell-badge--price">Early Adopters $8/mo Special</span>
        </div>
        <h3 className="no-config-upsell-headline">{ headline }</h3>
        <p className="no-config-upsell-subhead">{ subhead }</p>
        <div className="no-config-upsell-features">
          { features.map(feature => (
            <span key={ feature.label } className="no-config-upsell-feature">
              <span className="no-config-upsell-feature-icon" aria-hidden="true">{ feature.icon }</span>
              { feature.label }
            </span>
          )) }
        </div>
        { moreFeaturesLabel ? <p className="no-config-upsell-more">{ moreFeaturesLabel }</p> : null }
        <div className="no-config-upsell-actions">
          <a href="#0" onClick={ () => app.navigate(AMPLE_AGENT_PRO_URL) }
            className="no-config-upsell-button no-config-upsell-button--primary">⚡ Start for $8/month</a>
          <a href="#0" onClick={ () => app.navigate(AMPLE_AGENT_PRO_URL) }
            className="no-config-upsell-button no-config-upsell-button--secondary">See all features →</a>
        </div>
        <p className="no-config-upsell-footnote">✓ No API key required for core features</p>
      </div>
    </WidgetWrapper>
  );
}
