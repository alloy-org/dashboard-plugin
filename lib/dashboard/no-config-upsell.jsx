// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "When a widget has no available LLM key, print a NoConfig upsell equivalent to the one Goal
//   Coach (DreamTask) shows, but highlighting different features. Extract the upsell into a standalone component
//   called by both DreamTask and Proposed Agenda, parameterized by the features it highlights."
import { Badge, Button } from "dashboard/controls";
import { AMPLE_AGENT_PRO_URL } from "providers/ai-provider-settings";
import { MdBolt, MdCheck } from "react-icons/md";
import WidgetWrapper from "widget-wrapper";

import "styles/no-config-upsell.scss";
const DEFAULT_HEADLINE = "Unlock 21 AI features — no API key needed";
const DEFAULT_SUBHEAD = "Amplenote provides free access to frontier models for writing, task management, research, and more.";

// ----------------------------------------------------------------------------------------------
// @desc Marketing/no-config card shown when a widget can't reach an LLM (no API key configured). Promotes
//   Ample Agent Pro and is shared by every widget that needs an AI provider; each caller supplies the
//   widgetId and the feature list it wants to highlight, so the same card sells different features.
// @param {object} props - { app, features, headline, moreFeaturesLabel, subhead, widgetId }.
//   - {object} app - Amplenote app bridge (used to navigate to the Ample Agent Pro listing).
//   - {Array<{Icon: Function, label: string}>} features - Features to highlight, each with a react-icons component.
//   - {string} [headline] - Override the default headline.
//   - {string|null} [moreFeaturesLabel] - Optional "+ N more features" line beneath the pills.
//   - {string} [subhead] - Override the default subhead copy.
//   - {string} widgetId - Widget id, which is also where WidgetWrapper reads the header icon and title.
// [Claude claude-opus-4-8 (1M context)] Task: shared, feature-parameterized no-config upsell card
// [Claude claude-opus-5 (1M context)] Task: drop the forwarded icon/title now that WidgetWrapper
//   resolves both from widgetId
export default function NoConfigUpsell({ app, features = [], headline = DEFAULT_HEADLINE,
    moreFeaturesLabel = null, subhead = DEFAULT_SUBHEAD, widgetId }) {
  return (
    <WidgetWrapper widgetId={ widgetId }>
      <div className="no-config-upsell">
        <div className="no-config-upsell-badges">
          <Badge className="no-config-upsell-badge--brand" tone="action">Ample Agent Pro</Badge>
          <Badge className="no-config-upsell-badge--price" uppercase={ false }>
            Early Adopters $8/mo Special
          </Badge>
        </div>
        <h3 className="no-config-upsell-headline">{ headline }</h3>
        <p className="no-config-upsell-subhead">{ subhead }</p>
        <div className="no-config-upsell-features">
          { features.map(feature => (
            <span key={ feature.label } className="no-config-upsell-feature">
              <feature.Icon className="no-config-upsell-feature-icon" />
              { feature.label }
            </span>
          )) }
        </div>
        { moreFeaturesLabel ? <p className="no-config-upsell-more">{ moreFeaturesLabel }</p> : null }
        <div className="no-config-upsell-actions">
          <Button className="no-config-upsell-button no-config-upsell-button--primary" Icon={ MdBolt }
            onClick={ () => app.navigate(AMPLE_AGENT_PRO_URL) } variant="raised">Start for $8/month</Button>
          <Button className="no-config-upsell-button no-config-upsell-button--secondary"
            onClick={ () => app.navigate(AMPLE_AGENT_PRO_URL) }>See all features</Button>
        </div>
        <p className="no-config-upsell-footnote">
          <MdCheck size={ 16 } />No API key required for core features
        </p>
      </div>
    </WidgetWrapper>
  );
}
