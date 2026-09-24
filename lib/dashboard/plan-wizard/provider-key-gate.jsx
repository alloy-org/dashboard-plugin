// The panel Plan Builder shows in place of its questions when the dashboard has no AI provider to run them
// against. Every page of the builder is produced by reading the user's notes and tasks with an LLM, so opening
// the sequence without one would walk the user through the first page before failing on the reading that page
// asks for. The panel names what is missing and hands the user straight to Dashboard Settings, where the key is
// entered; the caller reopens Plan Builder afterwards, and the reopened builder reads the key that was saved.

import "dashboard/styles/provider-key-gate.scss";

// ----------------------------------------------------------------------------------------------
// @desc Blocking notice that Plan Builder cannot run without an AI provider, offering the two ways out: open
//   Dashboard Settings to add an API key, or leave the builder.
// @param {object} props - An object with the following properties:
//   - {Function} onCancel - Closes Plan Builder.
//   - {Function|null} onOpenSettings - Leaves Plan Builder for Dashboard Settings. The button is left out when
//     no caller wired one up, so the panel still explains itself rather than offering a link that does nothing.
// @returns {JSX.Element} The gate panel.
export default function ProviderKeyGate({ onCancel, onOpenSettings = null }) {
  return (
    <div className="provider-key-gate" role="alert">
      <h2 className="provider-key-gate-title">Plan Builder needs an AI provider</h2>
      <p className="provider-key-gate-message">Plan Builder reads your notes and tasks with an AI model to propose
        the intents, projects, and pace for your quarter. It has no provider to ask yet.</p>
      <p className="provider-key-gate-message">Add an API key for Anthropic, OpenAI, Gemini, or Grok in Dashboard
        Settings, or install Ample Agent Pro to use AI features without a key of your own.</p>
      <div className="provider-key-gate-actions">
        { onOpenSettings ? (
          <button className="provider-key-gate-button provider-key-gate-button--primary" onClick={ onOpenSettings }
            type="button">⚙️ Open Dashboard Settings</button>
        ) : null }
        <button className="provider-key-gate-button" onClick={ onCancel } type="button">Cancel</button>
      </div>
      <p className="provider-key-gate-footnote">Plan Builder picks up the key as soon as you come back.</p>
    </div>
  );
}
