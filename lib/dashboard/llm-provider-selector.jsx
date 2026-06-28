// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "modern (not default-styled) AI-provider chooser — a ConfigPopup-based modal that lists every
//   offered provider with what it excels at, plus Submit / Cancel, replacing the native app.prompt radio dialog.
//   Shared by the proposed-agenda and dream-task widgets."
import ConfigPopup from "config-popup";
import { defaultSelectedProviderEm, LLM_PROVIDER_OPTIONS } from "llm-provider";
import { useState } from "react";
import { createPortal } from "react-dom";

import "styles/llm-provider-selector.scss";

// ----------------------------------------------------------------------------------------------
// @desc Modal AI-provider chooser styled to match the dashboard's other popups. Renders one themed radio per
//   offered provider (name + what it excels at); Submit resolves the chosen provider, Cancel/click-outside
//   dismisses without choosing.
// @param {object} props - { currentProviderEm, onCancel, onSelect, submitLabel, title }.
//   - {string|null} currentProviderEm - Provider pre-selected when the popup opens.
//   - {Function} onCancel - Called with no args when the user cancels or clicks outside.
//   - {Function} onSelect - Called with the chosen providerEm string when the user submits.
//   - {string} [submitLabel="Submit"] - Override for the submit button label.
//   - {string} [title] - Heading shown at the top of the popup.
// [Claude claude-opus-4-8 (1M context)] Task: modern in-widget AI-provider selector popup
// Prompt: "Update the LLM selector to have modern (not default) styling"
// Portaled to document.body: dashboard widget cells carry a CSS `transform`, which would otherwise make the
// popup's `position: fixed` overlay anchor to the (offscreen) cell rather than the viewport.
// Prompt: "It pops offscreen"
export default function LlmProviderSelector({ currentProviderEm, onCancel, onSelect, submitLabel = "Submit",
    title = "Generate with which AI provider?" }) {
  const [selected, setSelected] = useState(() => defaultSelectedProviderEm(currentProviderEm));
  const popup = (
    <ConfigPopup title={ title } submitLabel={ submitLabel } onCancel={ onCancel }
        onSubmit={ () => onSelect(selected) }>
      <div className="llm-provider-options">
        {
          LLM_PROVIDER_OPTIONS.map(option => (
          <label key={ option.providerEm } className="llm-provider-option">
            <input type="radio" name="llm-provider" value={ option.providerEm }
              checked={ selected === option.providerEm } onChange={ () => setSelected(option.providerEm) } />
            <span className="llm-provider-option-text">
              <span className="llm-provider-option-name">{ option.label }</span>
              <span className="llm-provider-option-desc">{ option.description }</span>
            </span>
          </label>))
        }
      </div>
    </ConfigPopup>
  );
  return typeof document !== "undefined" && document.body ? createPortal(popup, document.body) : popup;
}
