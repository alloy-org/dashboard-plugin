/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-sonnet-4-6
 * Task: Dashboard global settings popup — LLM provider selection, API key input, and background image upload
 * Prompt summary: "create a dashboard settings popup with LLM provider dropdown, API key input, and background image upload with display mode selector"
 */
import { createElement, useState } from "react";
import ConfigPopup from 'config-popup';
import { PROVIDER_API_KEY_RETRIEVE_URL } from 'constants/llm-providers';
import { apiKeyFromProvider, BACKGROUND_MODE_OPTIONS, SETTING_KEYS } from 'constants/settings';
import useBackgroundUploadFields from 'hooks/use-background-upload-fields';
import { logIfEnabled } from "util/log";
import "styles/dashboard-settings-popup.scss"

const LLM_OPTIONS = [
  { value: 'none',            label: 'None (disable AI features)', apiKeyProvider: null },
  { value: 'openai',           label: 'OpenAI ChatGPT', apiKeyProvider: 'openai' },
  { value: 'anthropic',        label: 'Anthropic Claude',         apiKeyProvider: 'anthropic' },
  { value: 'anthropic-sonnet', label: 'Anthropic Sonnet',         apiKeyProvider: 'anthropic' },
  { value: 'gemini',           label: 'Google Gemini',            apiKeyProvider: 'gemini' },
  { value: 'grok',             label: 'Grok',                     apiKeyProvider: 'grok' },
];

// [Composer] Task: platform-specific copy so the API key retrieval link works inside a sandboxed iframe
// Prompt: "check if platform is macOS, Windows, or mobile ... Ctrl-Click / Cmd-Click / mobile"
// Date: 2026-04-05
function _apiKeyLinkPlatformHints() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isIpadOsDesktopUa = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  if (isMobileUa || isIpadOsDesktopUa) {
    return {
      linkParenthetical: 'long-press, Open in New Tab',
      note: 'This view runs in a sandboxed frame: long-press the following link, then choose Open in New Tab or Open in Browser. A normal tap may do nothing.',
    };
  }
  const isMac = /Mac|iPhone|iPod|iPad/.test(platform) || /Mac OS X/.test(ua);
  if (isMac) {
    return {
      linkParenthetical: 'Cmd+click',
      note: 'This view runs in a sandboxed frame: Cmd-click the following link to open it. A normal click may do nothing.',
    };
  }
  const isWindows = /Win/.test(platform);
  if (isWindows) {
    return {
      linkParenthetical: 'Ctrl+click',
      note: 'This view runs in a sandboxed frame: Ctrl-click the following link to open it. A normal click may do nothing.',
    };
  }
  return {
    linkParenthetical: 'Ctrl+click',
    note: 'This view runs in a sandboxed frame: Ctrl-click the following link to open it. A normal click may do nothing.',
  };
}

// [Claude] Task: look up the stored API key for a given provider option from configParams
// Prompt: "auto-populate the API key for that provider, if the user previously added it"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
function _storedKeyForProvider(configParams, apiKeyProvider) {
  if (!apiKeyProvider) return '';
  const settingKey = apiKeyFromProvider(apiKeyProvider);
  return (settingKey && configParams?.[settingKey]) || '';
}

// [Claude] Task: render dashboard settings — reads from configParams prop (React state) not app.settings
// Prompt: "rename settings state to configParams; popup reads configParams props not app.settings"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function DashboardSettingsPopup({ app, configParams, pluginNoteUUID, onCancel, onSave }) {
  const h = createElement;
  const currentLlmProvider = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const currentBackgroundImageUrl = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const currentBackgroundMode = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE];

  const initialOption = LLM_OPTIONS.find(o => o.value === currentLlmProvider) || LLM_OPTIONS[0];
  const [selectedProvider, setSelectedProvider] = useState(currentLlmProvider || 'openai');
  const [apiKey, setApiKey] = useState(_storedKeyForProvider(configParams, initialOption.apiKeyProvider));
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  logIfEnabled('[settings-popup] rendering DashboardSettingsPopup, currentBackgroundImageUrl:', currentBackgroundImageUrl);

  const {
    backgroundImageUrl, backgroundMode, setBackgroundMode,
    uploading, dragOver, fileInputRef,
    handleDrop, handleDragOver, handleDragLeave, handleFileInputChange, handleRemoveImage,
  } = useBackgroundUploadFields({
    app,
    pluginNoteUUID,
    initialImageUrl: currentBackgroundImageUrl,
    initialMode: currentBackgroundMode,
  });

  const providerOption = LLM_OPTIONS.find(o => o.value === selectedProvider) || LLM_OPTIONS[0];
  const apiKeyUrl = PROVIDER_API_KEY_RETRIEVE_URL[providerOption.apiKeyProvider];
  const providerName = LLM_OPTIONS.find(opt => opt.value === selectedProvider)?.label;

  // [Claude] Task: auto-populate API key when provider changes, if a key was previously stored
  // Prompt: "auto-populate the API key for that provider, if the user previously added it"
  // Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
  const handleProviderChange = (newProviderValue) => {
    setSelectedProvider(newProviderValue);
    const newOption = LLM_OPTIONS.find(o => o.value === newProviderValue) || LLM_OPTIONS[0];
    const storedKey = _storedKeyForProvider(configParams, newOption.apiKeyProvider);
    setApiKey(storedKey);
  };

  const { linkParenthetical, note: apiKeyLinkNote } = _apiKeyLinkPlatformHints();

  return h(ConfigPopup, {
    title: '\u2699\uFE0F Dashboard Settings',
    onSubmit: () => onSave({
      llmProvider: selectedProvider,
      apiKey,
      apiKeyProvider: providerOption.apiKeyProvider,
      backgroundMode,
      backgroundImageUrl,
    }),
    onCancel,
    submitLabel: 'Save Settings',
  },
    h('div', { className: 'dashboard-settings-container' },

      // ── Background Image section ──
      h('div', { className: 'dashboard-settings-section' },
        h('div', { className: 'dashboard-settings-section-header' },
          h('h4', { className: 'dashboard-settings-section-title' }, 'Background Image'),
          h('p', { className: 'dashboard-settings-section-desc' },
            'Upload an image to use as your dashboard background.'
          )
        ),
        h('div', { className: 'config-field' },
          h('div', {
            className: `dashboard-settings-dropzone${dragOver ? ' dashboard-settings-dropzone--active' : ''}${uploading ? ' dashboard-settings-dropzone--uploading' : ''}`,
            onDrop: handleDrop,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            onClick: () => !uploading && fileInputRef.current?.click(),
          },
            h('input', {
              ref: fileInputRef,
              type: 'file',
              accept: 'image/*',
              className: 'dashboard-settings-dropzone-input',
              onChange: handleFileInputChange,
            }),
            uploading
              ? h('span', { className: 'dashboard-settings-dropzone-text' }, 'Uploading...')
              : backgroundImageUrl
                ? h('div', { className: 'dashboard-settings-dropzone-preview' },
                    h('img', {
                      src: backgroundImageUrl,
                      alt: 'Background preview',
                      className: 'dashboard-settings-dropzone-preview-img',
                      onLoad: () => logIfEnabled('[settings-popup] background preview image loaded OK:', backgroundImageUrl),
                      onError: (e) => logIfEnabled('[settings-popup] background preview image FAILED to load:', backgroundImageUrl, e.type),
                    }),
                    h('span', { className: 'dashboard-settings-dropzone-text' }, 'Drop a new image or click to replace')
                  )
                : h('span', { className: 'dashboard-settings-dropzone-text' },
                    'Drag & drop an image here, or click to upload'
                  )
          ),
          backgroundImageUrl && h('a', {
            className: 'dashboard-settings-remove-image',
            href: '#',
            onClick: (e) => { e.preventDefault(); handleRemoveImage(); },
          }, 'Remove image')
        ),
        backgroundImageUrl && h('div', { className: 'config-field' },
          h('div', { className: 'config-field-label' }, 'Display Mode'),
          h('select', {
            className: 'dashboard-settings-select',
            value: backgroundMode,
            onChange: e => setBackgroundMode(e.target.value),
          }, ...BACKGROUND_MODE_OPTIONS.map(opt =>
            h('option', { key: opt.value, value: opt.value }, opt.label)
          ))
        ),
        h('div', { className: 'dashboard-settings-section' },
          h('div', { className: 'dashboard-settings-section-header' },
            h('h4', { className: 'dashboard-settings-section-title' }, 'AI Provider'),
            h('p', { className: 'dashboard-settings-section-desc' }, 'Enable analysis of quarterly plan & suggested tasks.')
          ),
        ),
        h('div', { className: 'config-field' },
          h('div', { className: 'config-line' },
            h('div', { className: 'config-field-label' }, 'LLM Provider'),
            h('select', {
              className: 'dashboard-settings-select',
              id: 'llm-provider-select',
              value: selectedProvider,
              onChange: e => handleProviderChange(e.target.value),
            }, ...LLM_OPTIONS.map(opt =>
              h('option', { key: opt.value, value: opt.value }, opt.label)
            ))
          ),
          h('div', { className: 'config-line' },
            h('div', { className: 'config-field-label' }, 'API Key'),
            h('p', { className: 'dashboard-settings-api-key-hint' }, apiKeyLinkNote),
            h('a', {
              className: 'dashboard-settings-api-key-link',
              href: apiKeyUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
            }, `Retrieve your API key (${ linkParenthetical }) \u2192`),
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
    )
  );
}
