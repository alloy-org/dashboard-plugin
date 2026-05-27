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
import { useState } from 'react';
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
      note: 'Long-press the following link, then choose Open in New Tab or Open in Browser. A normal click may have no visible effect.',
    };
  }
  const isMac = /Mac|iPhone|iPod|iPad/.test(platform) || /Mac OS X/.test(ua);
  if (isMac) {
    return {
      linkParenthetical: 'Cmd+click',
      note: 'Cmd-click the following link to open it. A normal click may have no visible effect.',
    };
  }
  const isWindows = /Win/.test(platform);
  if (isWindows) {
    return {
      linkParenthetical: 'Ctrl+click',
      note: 'Ctrl-click the following link to open it. A normal click may have no visible effect.',
    };
  }
  return {
    linkParenthetical: 'Ctrl+click',
    note: 'Ctrl-click the following link to open it. A normal click may have no visible effect',
  };
}

// ------------------------------------------------------------------------------------------
// @desc Renders the AI Provider section: LLM dropdown and API key input with show/hide toggle.
// [Claude claude-4.6-opus-high-thinking] Task: extract AI provider section into local render function
// Prompt: "break the settings popup render into local functions per section"
// [Claude claude-4.7-opus] Task: convert AI provider section to JSX component
// Prompt: "translate this project to render components with JSX instead"
function AiProviderSection({ apiKey, apiKeyVisible, linkParenthetical, note, onApiKeyChange, onProviderChange,
    onToggleKeyVisibility, providerApiKeyUrl, providerName, selectedProvider }) {
  return (
    <div className="dashboard-settings-section section">
      <div className="dashboard-settings-section-header">
        <h4 className="dashboard-settings-section-title">AI Provider</h4>
        <p className="dashboard-settings-section-desc">Enable analysis of quarterly plan & suggested tasks.</p>
      </div>
      <div className="config-field">
        <div className="config-line">
          <div className="config-field-label">LLM Provider</div>
          <select
            className="dashboard-settings-select"
            id="llm-provider-select"
            value={selectedProvider}
            onChange={e => onProviderChange(e.target.value)}
          >
            {LLM_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="config-line">
          <div className="config-field-label">API Key</div>
          <p className="dashboard-settings-api-key-hint">{note}</p>
          <a
            className="dashboard-settings-api-key-link"
            href={providerApiKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
          >{`Retrieve your ${ providerName } API key (${ linkParenthetical }) \u2192`}</a>
          <div className="dashboard-settings-api-key-input-row">
            <input
              className="dashboard-settings-api-key-input"
              type={apiKeyVisible ? 'text' : 'password'}
              value={apiKey}
              onChange={e => onApiKeyChange(e.target.value)}
              placeholder="Paste your API key here"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="dashboard-settings-api-key-toggle"
              type="button"
              onClick={onToggleKeyVisibility}
              title={apiKeyVisible ? 'Hide API key' : 'Show API key'}
              aria-label={apiKeyVisible ? 'Hide API key' : 'Show API key'}
            >{apiKeyVisible ? '🙈' : '👁️'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Renders the Background Image section: dropzone, preview, remove link, and display mode.
// [Claude claude-4.6-opus-high-thinking] Task: extract background image section into local render function
// Prompt: "break the settings popup render into local functions per section"
function BackgroundSection({ backgroundImageUrl, backgroundMode, dragOver, fileInputRef, onBackgroundModeChange,
    onDragLeave, onDragOver, onDrop, onFileInputChange, onRemoveImage, uploading }) {
  const dropzoneClassName = `dashboard-settings-dropzone${ dragOver ? ' dashboard-settings-dropzone--active' : '' }${ uploading ? ' dashboard-settings-dropzone--uploading' : '' }`;
  return (
    <div className="dashboard-settings-section section">
      <div className="dashboard-settings-section-header">
        <h4 className="dashboard-settings-section-title">Background Image</h4>
        <p className="dashboard-settings-section-desc">Upload an image to use as your dashboard background.</p>
      </div>
      <div className="config-field">
        <div
          className={dropzoneClassName}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="dashboard-settings-dropzone-input"
            onChange={onFileInputChange}
          />
          {uploading ? (
            <span className="dashboard-settings-dropzone-text">Uploading...</span>
          ) : backgroundImageUrl ? (
            <div className="dashboard-settings-dropzone-preview">
              <img
                src={backgroundImageUrl}
                alt="Background preview"
                className="dashboard-settings-dropzone-preview-img"
                onLoad={() => logIfEnabled('[settings-popup] background preview image loaded OK:', backgroundImageUrl)}
                onError={(e) => logIfEnabled('[settings-popup] background preview image FAILED to load:', backgroundImageUrl, e.type)}
              />
              <span className="dashboard-settings-dropzone-text">Drop a new image or click to replace</span>
            </div>
          ) : (
            <span className="dashboard-settings-dropzone-text">Drag & drop an image here, or click to upload</span>
          )}
        </div>
        {backgroundImageUrl && (
          <a
            className="dashboard-settings-remove-image"
            href="#"
            onClick={(e) => { e.preventDefault(); onRemoveImage(); }}
          >Remove image</a>
        )}
      </div>
      {backgroundImageUrl && (
        <div className="config-field">
          <div className="config-field-label">Display Mode</div>
          <select
            className="dashboard-settings-select"
            value={backgroundMode}
            onChange={e => onBackgroundModeChange(e.target.value)}
          >
            {BACKGROUND_MODE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Renders the Time & Date Format section: radio buttons for time format and week start.
// [Claude claude-4.6-opus-high-thinking] Task: extract time/date format section into local render function
// Prompt: "break the settings popup render into local functions per section"
function TimeDateSection({ onTimeFormatChange, onWeekFormatChange, timeFormat, weekFormat }) {
  return (
    <div className="dashboard-settings-section section">
      <div className="dashboard-settings-section-header">
        <h4 className="dashboard-settings-section-title">Time & Date Format</h4>
        <p className="dashboard-settings-section-desc">Choose how times and weeks are displayed across the dashboard.</p>
      </div>
      <div className="config-field">
        <div className="config-line">
          <div className="config-field-label">Time Format</div>
          <label>
            <input type="radio" name="time-format" value="meridian" checked={timeFormat === 'meridian'} onChange={() => onTimeFormatChange('meridian')} />
            Use meridian (am/pm) times
          </label>
          <label>
            <input type="radio" name="time-format" value="24h" checked={timeFormat === '24h'} onChange={() => onTimeFormatChange('24h')} />
            24 hour time
          </label>
        </div>
        <div className="config-line">
          <div className="config-field-label">Week Format</div>
          <label>
            <input type="radio" name="week-format" value="sunday" checked={weekFormat === 'sunday'} onChange={() => onWeekFormatChange('sunday')} />
            Week begins on Sunday
          </label>
          <label>
            <input type="radio" name="week-format" value="monday" checked={weekFormat === 'monday'} onChange={() => onWeekFormatChange('monday')} />
            Week begins on Monday
          </label>
        </div>
      </div>
    </div>
  );
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
// [Claude claude-4.7-opus] Task: migrate DashboardSettingsPopup from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DashboardSettingsPopup({ app, configParams, onCancel, onSave, pluginNoteUUID,
    timeFormat: initialTimeFormat, weekFormat: initialWeekFormat }) {
  const [scrollTop] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return window.scrollY ?? document.documentElement.scrollTop ?? 0;
  });
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

  return (
    <ConfigPopup
      title="⚙️ Dashboard Settings"
      scrollTop={scrollTop}
      onSubmit={() => onSave({
        apiKey,
        apiKeyProvider: providerOption.apiKeyProvider,
        backgroundImageUrl,
        backgroundMode,
        llmProvider: selectedProvider,
        timeFormat: timeFormatLocal,
        weekFormat: weekFormatLocal,
      })}
      onCancel={onCancel}
      submitLabel="Save Settings"
    >
      <div className="dashboard-settings-container">
        <BackgroundSection
          backgroundImageUrl={backgroundImageUrl}
          backgroundMode={backgroundMode}
          dragOver={dragOver}
          fileInputRef={fileInputRef}
          onBackgroundModeChange={setBackgroundMode}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onFileInputChange={handleFileInputChange}
          onRemoveImage={handleRemoveImage}
          uploading={uploading}
        />
        <AiProviderSection
          apiKey={apiKey}
          apiKeyVisible={apiKeyVisible}
          linkParenthetical={linkParenthetical}
          note={apiKeyLinkNote}
          onApiKeyChange={setApiKey}
          onProviderChange={handleProviderChange}
          onToggleKeyVisibility={() => setApiKeyVisible(v => !v)}
          providerApiKeyUrl={apiKeyUrl}
          providerName={providerName}
          selectedProvider={selectedProvider}
        />
        <TimeDateSection
          onTimeFormatChange={setTimeFormatLocal}
          onWeekFormatChange={setWeekFormatLocal}
          timeFormat={timeFormatLocal}
          weekFormat={weekFormatLocal}
        />
      </div>
    </ConfigPopup>
  );
}
