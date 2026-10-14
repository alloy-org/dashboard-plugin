/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-sonnet-4-6
 * Task: Dashboard global settings popup — LLM provider selection, API key input, and time/date formats
 * Prompt summary: "create a dashboard settings popup with LLM provider dropdown, API key input, and background image upload with display mode selector"
 */
import ConfigPopup from 'config-popup';
import { PROVIDER_API_KEY_RETRIEVE_URL } from 'constants/llm-providers';
import { apiKeySettingFromKeyProvider, BUILD_DATE, JEV_KEY_PROVIDER, SETTING_KEYS } from 'constants/settings';
import { Button, ConfigField, ConfigSection, IconButton, RadioGroup, Select, TextField } from "dashboard/controls";
import { useState } from 'react';
import { MdOpenInNew, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { logIfEnabled } from "util/log";
import "styles/dashboard-settings-popup.scss"

const API_KEY_LINK_ICON_SIZE = 14;
const TIME_FORMAT_OPTIONS = [
  { label: "Use meridian (am/pm) times", value: "meridian" },
  { label: "24 hour time", value: "24h" },
];
const WEEK_FORMAT_OPTIONS = [
  { label: "Week begins on Sunday", value: "sunday" },
  { label: "Week begins on Monday", value: "monday" },
];

// An option marked keyOnly edits a key without becoming the LLM Provider setting: Jev rates tasks against projects
// but cannot write text, so choosing it leaves the generative provider chosen before it in place. keyLinkName names
// the service the key retrieval link opens when it is not the option's own label.
const LLM_OPTIONS = [
  { value: 'none',            label: 'None (disable AI features)', apiKeyProvider: null },
  { value: 'openai',           label: 'OpenAI ChatGPT', apiKeyProvider: 'openai' },
  { value: 'anthropic',        label: 'Anthropic Opus',           apiKeyProvider: 'anthropic' },
  { value: 'anthropic-sonnet', label: 'Anthropic Sonnet',         apiKeyProvider: 'anthropic' },
  { value: 'gemini',           label: 'Google Gemini',            apiKeyProvider: 'gemini' },
  { value: 'grok',             label: 'Grok',                     apiKeyProvider: 'grok' },
  { value: 'jev',              label: 'Jev (task ranking only)',  apiKeyProvider: JEV_KEY_PROVIDER, keyLinkName: 'OpenRouter', keyOnly: true },
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
// @desc Explain what a key-only option's key is used for, naming the generative provider that stays selected.
// @param {string} generativeProvider - The LLM_OPTIONS value that will be saved as the LLM Provider setting.
// @returns {string} One or two sentences for the hint beneath the provider dropdown.
function _jevKeyHint(generativeProvider) {
  const generativeOption = LLM_OPTIONS.find(option => option.value === generativeProvider);
  const generativeSentence = !generativeOption || generativeOption.value === 'none' ? 'other AI features stay disabled.'
    : `other AI features keep using ${ generativeOption.label }.`;
  const rankingSentence = 'Jev rates your tasks against each quarterly project, accepting a TypeSafe or OpenRouter key. '
    + 'Without one, ranking falls back to your LLM provider or Ample Agent Pro.';
  return `${ rankingSentence } Jev does not write text, so ${ generativeSentence }`;
}

// ------------------------------------------------------------------------------------------
// @desc Renders the AI Provider section: LLM dropdown and API key input with show/hide toggle.
// @param {object} props - Includes keyOnlyHint, a sentence shown under the dropdown while a key-only option such as
//   Jev is selected, or null otherwise.
// [Claude claude-4.6-opus-high-thinking] Task: extract AI provider section into local render function
// Prompt: "break the settings popup render into local functions per section"
// [Claude claude-4.7-opus] Task: convert AI provider section to JSX component
// Prompt: "translate this project to render components with JSX instead"
function AiProviderSection({ apiKey, apiKeyVisible, keyOnlyHint, linkParenthetical, note, onApiKeyChange, onProviderChange,
    onToggleKeyVisibility, providerApiKeyUrl, providerName, selectedProvider }) {
  return (
    <ConfigSection description="Enable analysis of quarterly plan & suggested tasks." title="AI Provider">
      <div>
        <Select className="dashboard-settings-select" label="LLM Provider" onChange={ onProviderChange }
          options={ LLM_OPTIONS } value={ selectedProvider } />
        {keyOnlyHint ? <p className="dashboard-settings-api-key-hint">{keyOnlyHint}</p> : null}
      </div>
      <ConfigField hint={ note } label="API Key">
        <a
          className="dashboard-settings-api-key-link"
          href={providerApiKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {`Retrieve your ${ providerName } API key (${ linkParenthetical })`}
          <MdOpenInNew size={ API_KEY_LINK_ICON_SIZE } />
        </a>
        <div className="dashboard-settings-api-key-input-row">
          <TextField autoComplete="off" className="dashboard-settings-api-key-input" hideLabel
            label="API Key" onChange={ onApiKeyChange } placeholder="Paste your API key here"
            spellCheck={ false }
            type={ apiKeyVisible ? 'text' : 'password' } value={ apiKey } />
          <IconButton className="dashboard-settings-api-key-toggle"
            Icon={ apiKeyVisible ? MdVisibilityOff : MdVisibility }
            label={ apiKeyVisible ? 'Hide API key' : 'Show API key' } onClick={ onToggleKeyVisibility }
            size="large" />
        </div>
      </ConfigField>
    </ConfigSection>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Render administrator-only diagnostics actions. The parent only supplies this section when
//   the persisted DEBUG_CONSOLE setting is enabled, so regular users never see measurement tools.
// @param {function(): void} onOpenMemoryMeasurement - Opens the widget memory measurement panel.
function DebugToolsSection({ onOpenMemoryMeasurement }) {
  return (
    <ConfigSection description="Measure a widget's approximate incremental JavaScript heap footprint."
      title="Debug Tools">
      <Button className="dashboard-settings-debug-button" dense onClick={ onOpenMemoryMeasurement }
        variant="outlined">
        Open widget memory measurement
      </Button>
    </ConfigSection>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Renders the Time & Date Format section: radio buttons for time format and week start.
// [Claude claude-4.6-opus-high-thinking] Task: extract time/date format section into local render function
// Prompt: "break the settings popup render into local functions per section"
function TimeDateSection({ onTimeFormatChange, onWeekFormatChange, timeFormat, weekFormat }) {
  return (
    <ConfigSection description="Choose how times and weeks are displayed across the dashboard."
      title="Time & Date Format">
      <RadioGroup label="Time Format" onChange={ onTimeFormatChange } options={ TIME_FORMAT_OPTIONS }
        value={ timeFormat } />
      <RadioGroup label="Week Format" onChange={ onWeekFormatChange } options={ WEEK_FORMAT_OPTIONS }
        value={ weekFormat } />
    </ConfigSection>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Renders the build stamp for the left side of the popup's button row. The dashboard is installed by pasting
//   build/compiled.js into a note, so this is how a user (or Bill, reading a bug report) can tell which compile
//   of the dashboard is actually running in front of them.
function BuildVersionFooter() {
  return (
    <span>Dashboard build: <span className="config-popup-footer-monospace">{BUILD_DATE}</span></span>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Looks up the stored API key for a given provider from configParams.
// [Claude] Task: look up the stored API key for a given provider option from configParams
// Prompt: "auto-populate the API key for that provider, if the user previously added it"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
function _storedKeyForProvider(configParams, apiKeyProvider) {
  if (!apiKeyProvider) return '';
  const settingKey = apiKeySettingFromKeyProvider(apiKeyProvider);
  return (settingKey && configParams?.[settingKey]) || '';
}

// ------------------------------------------------------------------------------------------
// @desc Root settings popup component. Composes AI provider and time/date sections.
// [Claude] Task: render dashboard settings — reads from configParams prop (React state) not app.settings
// Prompt: "rename settings state to configParams; popup reads configParams props not app.settings"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.6-opus-high-thinking] Task: break monolithic render into local section functions
// Prompt: "create local render functions per section to clarify the settings popup structure"
// [Claude claude-4.7-opus] Task: migrate DashboardSettingsPopup from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DashboardSettingsPopup({ configParams, onCancel, onOpenMemoryMeasurement, onSave,
    timeFormat: initialTimeFormat, weekFormat: initialWeekFormat }) {
  const [scrollTop] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return window.scrollY ?? document.documentElement.scrollTop ?? 0;
  });
  const currentLlmProvider = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];

  const initialOption = LLM_OPTIONS.find(o => o.value === currentLlmProvider) || LLM_OPTIONS[0];
  const [apiKey, setApiKey] = useState(_storedKeyForProvider(configParams, initialOption.apiKeyProvider));
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(currentLlmProvider || 'openai');
  // The provider saved as LLM Provider: the last selected option that is not key-only
  const [generativeProvider, setGenerativeProvider] = useState(currentLlmProvider || 'openai');
  const [timeFormatLocal, setTimeFormatLocal] = useState(initialTimeFormat || 'meridian');
  const [weekFormatLocal, setWeekFormatLocal] = useState(initialWeekFormat || 'sunday');


  const providerOption = LLM_OPTIONS.find(o => o.value === selectedProvider) || LLM_OPTIONS[0];
  const apiKeyUrl = PROVIDER_API_KEY_RETRIEVE_URL[providerOption.apiKeyProvider];
  const providerName = providerOption.keyLinkName || providerOption.label;
  const keyOnlyHint = providerOption.keyOnly ? _jevKeyHint(generativeProvider) : null;

  // [Claude] Task: auto-populate API key when provider changes, if a key was previously stored
  // Prompt: "auto-populate the API key for that provider, if the user previously added it"
  // Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
  const handleProviderChange = (newProviderValue) => {
    setSelectedProvider(newProviderValue);
    const newOption = LLM_OPTIONS.find(o => o.value === newProviderValue) || LLM_OPTIONS[0];
    if (!newOption.keyOnly) setGenerativeProvider(newProviderValue);
    const storedKey = _storedKeyForProvider(configParams, newOption.apiKeyProvider);
    setApiKey(storedKey);
  };

  const { linkParenthetical, note: apiKeyLinkNote } = _apiKeyLinkPlatformHints();

  return (
    <ConfigPopup
      title="Dashboard Settings"
      footerLeft={<BuildVersionFooter />}
      scrollTop={scrollTop}
      onSubmit={() => onSave({
        apiKey,
        apiKeyProvider: providerOption.apiKeyProvider,
        llmProvider: generativeProvider,
        timeFormat: timeFormatLocal,
        weekFormat: weekFormatLocal,
      })}
      onCancel={onCancel}
      submitLabel="Save Settings"
    >
      <div className="dashboard-settings-container">
        <AiProviderSection
          apiKey={apiKey}
          apiKeyVisible={apiKeyVisible}
          keyOnlyHint={keyOnlyHint}
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
        {onOpenMemoryMeasurement ? <DebugToolsSection onOpenMemoryMeasurement={onOpenMemoryMeasurement} /> : null}
      </div>
    </ConfigPopup>
  );
}
