/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-sonnet-4-6
 * Task: Dashboard global settings popup — LLM provider selection and API key input
 * Prompt summary: "create a dashboard settings popup linked next to the Layout button, with LLM provider dropdown and API key input persisted to app.settings"
 */
import { createElement, useState } from "react";
import ConfigPopup from 'config-popup';
import { PROVIDER_API_KEY_RETRIEVE_URL } from 'constants/llm-providers';
import { SETTING_KEYS } from 'constants/settings';

// anthropic-sonnet reuses the Anthropic console URL since it is a model variant,
// not a separate provider with its own API key portal.
const LLM_OPTIONS = [
  { value: 'none',            label: 'None (disable AI features)', apiKeyProvider: null },
  { value: 'openai',           label: 'OpenAI ChatGPT', apiKeyProvider: 'openai' },
  { value: 'anthropic',        label: 'Anthropic Claude',         apiKeyProvider: 'anthropic' },
  { value: 'anthropic-sonnet', label: 'Anthropic Sonnet',         apiKeyProvider: 'anthropic' },
  { value: 'gemini',           label: 'Google Gemini',            apiKeyProvider: 'gemini' },
  { value: 'grok',             label: 'Grok',                     apiKeyProvider: 'grok' },
];

// [Claude] Task: render AI settings section with provider dropdown and API key input with visibility toggle
// Prompt: "create a dashboard settings popup linked next to the Layout button, with LLM provider dropdown and API key input persisted to app.settings"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
//
// @param {string}   props.currentLlmProvider - The persisted LLM provider key (e.g. 'openai')
// @param {string}   props.currentApiKey      - The persisted API key string
// @param {Function} props.onSave             - Called with { llmProvider, apiKey } on save
// @param {Function} props.onCancel           - Called when the user dismisses without saving
// @returns {ReactElement}
export default function DashboardSettingsPopup({ currentLlmProvider, currentApiKey, onSave, onCancel }) {
  const h = createElement;
  const [selectedProvider, setSelectedProvider] = useState(currentLlmProvider || 'openai');
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  const providerOption = LLM_OPTIONS.find(o => o.value === selectedProvider) || LLM_OPTIONS[0];
  const apiKeyUrl = PROVIDER_API_KEY_RETRIEVE_URL[providerOption.apiKeyProvider];
  const providerName = LLM_OPTIONS.find(opt => opt.value === selectedProvider)?.label;

  return h(ConfigPopup, {
    title: '\u2699\uFE0F Dashboard Settings',
    onSubmit: () => onSave({ llmProvider: selectedProvider, apiKey }),
    onCancel,
    submitLabel: 'Save Settings',
  },
    h('div', { className: 'dashboard-settings-container' },
    h('div', { className: 'dashboard-settings-section' },
      h('div', { className: 'dashboard-settings-section-header' },
        h('h4', { className: 'dashboard-settings-section-title' }, 'AI Settings'),
        h('p', { className: 'dashboard-settings-section-desc' },
          'Connect your dashboard to an LLM to have your quarterly plan interpreted into suggested tasks.'
        )
      ),
      h('div', { className: 'config-field' },
        h('div', { className: 'config-field-label' }, 'LLM Provider'),
        h('select', {
          className: 'dashboard-settings-select',
          value: selectedProvider,
          onChange: e => setSelectedProvider(e.target.value),
        }, ...LLM_OPTIONS.map(opt =>
          h('option', { key: opt.value, value: opt.value }, opt.label)
        ))
      ),
      providerOption.apiKeyProvider && h('div', { className: 'config-field' },
        h('div', { className: 'config-field-label' }, 'API Key'),
        h('a', {
          className: 'dashboard-settings-api-key-link',
          href: apiKeyUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, `Retrieve your ${ providerName } API key \u2192`),
        h('div', { className: 'dashboard-settings-api-key-input-row' },
          h('input', {
            className: 'dashboard-settings-api-key-input',
            type: apiKeyVisible ? 'text' : 'password',
            value: apiKey,
            onChange: e => setApiKey(e.target.value),
            placeholder: 'Paste your API key here',
            autoComplete: 'off',
            spellCheck: false,
          }),
          h('button', {
            className: 'dashboard-settings-api-key-toggle',
            type: 'button',
            onClick: () => setApiKeyVisible(v => !v),
            title: apiKeyVisible ? 'Hide API key' : 'Show API key',
            'aria-label': apiKeyVisible ? 'Hide API key' : 'Show API key',
          }, apiKeyVisible ? '\uD83D\uDE48' : '\uD83D\uDC41\uFE0F')
        )
      )
    )
    )
  );
}
