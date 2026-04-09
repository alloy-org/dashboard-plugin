/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-sonnet-4-6
 * Task: Dashboard global settings popup — LLM provider selection, API key input, and background image upload
 * Prompt summary: "create a dashboard settings popup with LLM provider dropdown, API key input, and background image upload with display mode selector"
 */
import ConfigPopup from 'config-popup';
import { PROVIDER_API_KEY_RETRIEVE_URL } from 'constants/llm-providers';
import { apiKeyFromProvider, BACKGROUND_MODE_OPTIONS, SETTING_KEYS } from 'constants/settings';
import useBackgroundUploadFields from 'hooks/use-background-upload-fields';
import { createElement, useState } from "react";
import { logIfEnabled } from "util/log";
import "styles/dashboard-settings-popup.scss"

const LLM_OPTIONS = [
  { value: 'none',            label: 'None (disable AI features)', apiKeyProvider: null },
  { value: 'openai',           label: 'OpenAI ChatGPT', apiKeyProvider: 'openai' },
  { value: 'anthropic',        label: 'Anthropic Opus',           apiKeyProvider: 'anthropic' },
  { value: 'anthropic-sonnet', label: 'Anthropic Sonnet',         apiKeyProvider: 'anthropic' },
  { value: 'gemini',           label: 'Google Gemini',            apiKeyProvider: 'gemini' },
  { value: 'grok',             label: 'Grok',                     apiKeyProvider: 'grok' },
];

// ------------------------------------------------------------------------------------------
// @desc Platform-specific copy so the API key retrieval link works inside a sandboxed iframe.
// @returns {{ linkParenthetical: string, note: string }}
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

// ------------------------------------------------------------------------------------------
// @desc Renders the AI Provider section: LLM dropdown and API key input with show/hide toggle.
// [Claude claude-4.6-opus-high-thinking] Task: extract AI provider section into local render function
// Prompt: "break the settings popup render into local functions per section"
function renderAiProviderSection(h, { apiKey, apiKeyVisible, linkParenthetical, note, onApiKeyChange, onProviderChange,
    onToggleKeyVisibility, providerApiKeyUrl, providerName, selectedProvider }) {
  return [
    h('div', { className: 'dashboard-settings-section', key: 'ai-header' },
      h('div', { className: 'dashboard-settings-section-header' },
        h('h4', { className: 'dashboard-settings-section-title' }, 'AI Provider'),
        h('p', { className: 'dashboard-settings-section-desc' }, 'Enable analysis of quarterly plan & suggested tasks.')
      ),
    ),
    h('div', { className: 'config-field', key: 'ai-fields' },
      h('div', { className: 'config-line' },
        h('div', { className: 'config-field-label' }, 'LLM Provider'),
        h('select', {
          className: 'dashboard-settings-select',
          id: 'llm-provider-select',
          value: selectedProvider,
          onChange: e => onProviderChange(e.target.value),
        }, ...LLM_OPTIONS.map(opt =>
          h('option', { key: opt.value, value: opt.value }, opt.label)
        ))
      ),
      h('div', { className: 'config-line' },
        h('div', { className: 'config-field-label' }, 'API Key'),
        h('p', { className: 'dashboard-settings-api-key-hint' }, note),
        h('a', {
          className: 'dashboard-settings-api-key-link',
          href: providerApiKeyUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, `Retrieve your ${ providerName } API key (${ linkParenthetical }) \u2192`),
        h('div', { className: 'dashboard-settings-api-key-input-row' },
          h('input', {
            className: 'dashboard-settings-api-key-input',
            type: apiKeyVisible ? 'text' : 'password',
            value: apiKey,
            onChange: e => onApiKeyChange(e.target.value),
            placeholder: 'Paste your API key here',
            autoComplete: 'off',
            spellCheck: false,
          }),
          h('button', {
            className: 'dashboard-settings-api-key-toggle',
            type: 'button',
            onClick: onToggleKeyVisibility,
            title: apiKeyVisible ? 'Hide API key' : 'Show API key',
            'aria-label': apiKeyVisible ? 'Hide API key' : 'Show API key',
          }, apiKeyVisible ? '\uD83D\uDE48' : '\uD83D\uDC41\uFE0F')
        )
      )
    ),
  ];
}

// ------------------------------------------------------------------------------------------
// @desc Renders the Background Image section: dropzone, preview, remove link, and display mode.
// [Claude claude-4.6-opus-high-thinking] Task: extract background image section into local render function
// Prompt: "break the settings popup render into local functions per section"
function renderBackgroundSection(h, { backgroundImageUrl, backgroundMode, dragOver, fileInputRef, onBackgroundModeChange,
    onDragLeave, onDragOver, onDrop, onFileInputChange, onRemoveImage, uploading }) {
  return h('div', { className: 'dashboard-settings-section' },
    h('div', { className: 'dashboard-settings-section-header' },
      h('h4', { className: 'dashboard-settings-section-title' }, 'Background Image'),
      h('p', { className: 'dashboard-settings-section-desc' }, 'Upload an image to use as your dashboard background.')
    ),
    h('div', { className: 'config-field' },
      h('div', {
        className: `dashboard-settings-dropzone${ dragOver ? ' dashboard-settings-dropzone--active' : '' }${ uploading ? ' dashboard-settings-dropzone--uploading' : '' }`,
        onDrop, onDragOver, onDragLeave,
        onClick: () => !uploading && fileInputRef.current?.click(),
      },
        h('input', {
          ref: fileInputRef, type: 'file', accept: 'image/*',
          className: 'dashboard-settings-dropzone-input',
          onChange: onFileInputChange,
        }),
        uploading
          ? h('span', { className: 'dashboard-settings-dropzone-text' }, 'Uploading...')
          : backgroundImageUrl
            ? h('div', { className: 'dashboard-settings-dropzone-preview' },
                h('img', {
                  src: backgroundImageUrl, alt: 'Background preview',
                  className: 'dashboard-settings-dropzone-preview-img',
                  onLoad: () => logIfEnabled('[settings-popup] background preview image loaded OK:', backgroundImageUrl),
                  onError: (e) => logIfEnabled('[settings-popup] background preview image FAILED to load:', backgroundImageUrl, e.type),
                }),
                h('span', { className: 'dashboard-settings-dropzone-text' }, 'Drop a new image or click to replace')
              )
            : h('span', { className: 'dashboard-settings-dropzone-text' }, 'Drag & drop an image here, or click to upload')
      ),
      backgroundImageUrl && h('a', {
        className: 'dashboard-settings-remove-image', href: '#',
        onClick: (e) => { e.preventDefault(); onRemoveImage(); },
      }, 'Remove image')
    ),
    backgroundImageUrl && h('div', { className: 'config-field' },
      h('div', { className: 'config-field-label' }, 'Display Mode'),
      h('select', {
        className: 'dashboard-settings-select', value: backgroundMode,
        onChange: e => onBackgroundModeChange(e.target.value),
      }, ...BACKGROUND_MODE_OPTIONS.map(opt =>
        h('option', { key: opt.value, value: opt.value }, opt.label)
      ))
    ),
  );
}

// ------------------------------------------------------------------------------------------
// @desc Renders the Time & Date Format section: radio buttons for time format and week start.
// [Claude claude-4.6-opus-high-thinking] Task: extract time/date format section into local render function
// Prompt: "break the settings popup render into local functions per section"
function renderTimeDateSection(h, { onTimeFormatChange, onWeekFormatChange, timeFormat, weekFormat }) {
  return [
    h('div', { className: 'dashboard-settings-section', key: 'time-date-header' },
      h('div', { className: 'dashboard-settings-section-header' },
        h('h4', { className: 'dashboard-settings-section-title' }, 'Time & Date Format'),
        h('p', { className: 'dashboard-settings-section-desc' }, 'Choose how times and weeks are displayed across the dashboard.')
      ),
    ),
    h('div', { className: 'config-field', key: 'time-date-fields' },
      h('div', { className: 'config-line' },
        h('div', { className: 'config-field-label' }, 'Time Format'),
        h('label', null,
          h('input', { type: 'radio', name: 'time-format', value: 'meridian', checked: timeFormat === 'meridian', onChange: () => onTimeFormatChange('meridian') }),
          'Use meridian (am/pm) times'
        ),
        h('label', null,
          h('input', { type: 'radio', name: 'time-format', value: '24h', checked: timeFormat === '24h', onChange: () => onTimeFormatChange('24h') }),
          '24 hour time'
        )
      ),
      h('div', { className: 'config-line' },
        h('div', { className: 'config-field-label' }, 'Week Format'),
        h('label', null,
          h('input', { type: 'radio', name: 'week-format', value: 'sunday', checked: weekFormat === 'sunday', onChange: () => onWeekFormatChange('sunday') }),
          'Week begins on Sunday'
        ),
        h('label', null,
          h('input', { type: 'radio', name: 'week-format', value: 'monday', checked: weekFormat === 'monday', onChange: () => onWeekFormatChange('monday') }),
          'Week begins on Monday'
        )
      )
    ),
  ];
}

// ------------------------------------------------------------------------------------------
// @desc Looks up the stored API key for a given provider from configParams.
// [Claude] Task: look up the stored API key for a given provider option from configParams
// Prompt: "auto-populate the API key for that provider, if the user previously added it"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
function _storedKeyForProvider(configParams, apiKeyProvider) {
  if (!apiKeyProvider) return '';
  const settingKey = apiKeyFromProvider(apiKeyProvider);
  return (settingKey && configParams?.[settingKey]) || '';
}

// ------------------------------------------------------------------------------------------
// @desc Root settings popup component. Composes background, AI provider, and time/date sections.
// [Claude] Task: render dashboard settings — reads from configParams prop (React state) not app.settings
// Prompt: "rename settings state to configParams; popup reads configParams props not app.settings"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.6-opus-high-thinking] Task: break monolithic render into local section functions
// Prompt: "create local render functions per section to clarify the settings popup structure"
export default function DashboardSettingsPopup({ app, configParams, onCancel, onSave, pluginNoteUUID,
    timeFormat: initialTimeFormat, weekFormat: initialWeekFormat }) {
  const h = createElement;
  const currentLlmProvider = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const currentBackgroundImageUrl = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const currentBackgroundMode = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE];

  const initialOption = LLM_OPTIONS.find(o => o.value === currentLlmProvider) || LLM_OPTIONS[0];
  const [apiKey, setApiKey] = useState(_storedKeyForProvider(configParams, initialOption.apiKeyProvider));
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(currentLlmProvider || 'openai');
  const [timeFormatLocal, setTimeFormatLocal] = useState(initialTimeFormat || 'meridian');
  const [weekFormatLocal, setWeekFormatLocal] = useState(initialWeekFormat || 'sunday');

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
      apiKey,
      apiKeyProvider: providerOption.apiKeyProvider,
      backgroundImageUrl,
      backgroundMode,
      llmProvider: selectedProvider,
      timeFormat: timeFormatLocal,
      weekFormat: weekFormatLocal,
    }),
    onCancel,
    submitLabel: 'Save Settings',
  },
    h('div', { className: 'dashboard-settings-container' },
      renderBackgroundSection(h, {
        backgroundImageUrl, backgroundMode, dragOver, fileInputRef,
        onBackgroundModeChange: setBackgroundMode,
        onDragLeave: handleDragLeave, onDragOver: handleDragOver, onDrop: handleDrop,
        onFileInputChange: handleFileInputChange, onRemoveImage: handleRemoveImage, uploading,
      }),
      ...renderAiProviderSection(h, {
        apiKey, apiKeyVisible, linkParenthetical, note: apiKeyLinkNote,
        onApiKeyChange: setApiKey, onProviderChange: handleProviderChange,
        onToggleKeyVisibility: () => setApiKeyVisible(v => !v),
        providerApiKeyUrl: apiKeyUrl, providerName, selectedProvider,
      }),
      ...renderTimeDateSection(h, {
        onTimeFormatChange: setTimeFormatLocal, onWeekFormatChange: setWeekFormatLocal,
        timeFormat: timeFormatLocal, weekFormat: weekFormatLocal,
      }),
    )
  );
}
