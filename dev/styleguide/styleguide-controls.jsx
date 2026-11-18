// Style guide sections for the shared controls: every button, field, tab, badge, and spinner variant, the empty,
// loading, and error states, and the settings building blocks. Each sample is live, so hover and focus work.
import { Badge, Button, CheckboxField, ConfigField, ConfigSection, EmptyState, ErrorState, IconButton, LoadingState,
  PlainButton, RadioGroup, Select, Spinner, TextField, UnderlineTabs } from "dashboard/controls";
import { useState } from "react";
import { MdAdd, MdArrowForward, MdDelete, MdInbox, MdPushPin, MdRefresh } from "react-icons/md";

const BADGE_TONES = [ "neutral", "action", "status", "warning", "danger" ];
const ICON_BUTTON_SIZES = [ "small", "medium", "large", "dialog" ];
const SAMPLE_OPTIONS = [ { label: "Everyone", value: "all" }, { label: "Dana Cole", value: "dana" } ];
const SAMPLE_TABS = [ { id: "work", label: "Work" }, { id: "personal", label: "Personal" }, { id: "side", label: "Side Projects" } ];

// ------------------------------------------------------------------------------------------
// @desc Buttons, icon buttons, a plain button, fields, tabs, badges, and spinners.
// @returns {JSX.Element} The section body.
export function ControlsSection() {
  return (
    <div className="styleguide-stack">
      <ButtonSamples />
      <Sample title="IconButton: sizes, pressed, danger">
        { ICON_BUTTON_SIZES.map(size => <IconButton Icon={ MdRefresh } key={ size } label={ `Refresh (${ size })` } size={ size } />) }
        <IconButton Icon={ MdPushPin } label="Pinned" pressed />
        <IconButton Icon={ MdDelete } label="Delete" tone="danger" />
        <IconButton disabled Icon={ MdRefresh } label="Refresh (disabled)" />
      </Sample>
      <Sample title="PlainButton: a clickable row with its own layout">
        <PlainButton className="styleguide-plain-row">A clickable row; the widget styles it</PlainButton>
      </Sample>
      <FieldSamples />
      <Sample title="Badge tones, and uppercase={ false }">
        { BADGE_TONES.map(tone => <Badge key={ tone } tone={ tone }>{ tone }</Badge>) }
        <Badge title="Keeps its casing" tone="action" uppercase={ false }>Builder</Badge>
      </Sample>
      <Sample title="Spinner sizes">
        <Spinner size="small" />
        <Spinner />
        <Spinner size="large" />
      </Sample>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The settings building blocks inside sections, as a ConfigPopup body shows them.
// @returns {JSX.Element} The section body.
export function SettingsSection() {
  const [ range, setRange ] = useState("week");
  const [ provider, setProvider ] = useState("anthropic");
  const [ showMood, setShowMood ] = useState(true);
  return (
    <div className="styleguide-panel">
      <ConfigSection description="One sentence about what these settings change." title="A settings section">
        <RadioGroup label="Time range" onChange={ setRange } options={ [ { label: "Last 7 days", value: "week" },
          { label: "This month", value: "month" } ] } value={ range } />
        <ConfigField hint="A hint under the label." label="Mood overlay">
          <CheckboxField checked={ showMood } label="Show mood overlay" onChange={ setShowMood } />
        </ConfigField>
      </ConfigSection>
      <ConfigSection title="Options with descriptions">
        <RadioGroup label="AI provider" onChange={ setProvider } options={ [
          { description: "Thoughtful planning and writing", label: "Anthropic Claude", value: "anthropic" },
          { description: "Fast suggestions", label: "OpenAI ChatGPT", value: "openai" } ] } value={ provider } />
      </ConfigSection>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Empty, compact empty, loading, and error states side by side.
// @returns {JSX.Element} The section body.
export function StatesSection() {
  return (
    <div className="styleguide-state-grid">
      <div className="styleguide-panel">
        <EmptyState action={ <Button variant="outlined">Open tasks</Button> } Icon={ MdInbox }
          title="No tasks scheduled for today">New tasks land here.</EmptyState>
      </div>
      <div className="styleguide-panel">
        <EmptyState compact title="No tasks scheduled" />
        <LoadingState>Loading monthly task history…</LoadingState>
      </div>
      <div className="styleguide-panel">
        <ErrorState onRetry={ () => {} }>The note could not be loaded.</ErrorState>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Every Button variant, with icons, dense, danger, disabled, and a link inside a sentence.
// @returns {JSX.Element} The samples.
function ButtonSamples() {
  return (
    <>
      <Sample title="Button variants">
        <Button>Text</Button>
        <Button variant="outlined">Outlined</Button>
        <Button variant="raised">Raised</Button>
        <Button Icon={ MdAdd } variant="raised">Leading icon</Button>
        <Button TrailingIcon={ MdArrowForward }>Trailing icon</Button>
      </Sample>
      <Sample title="Dense, danger, disabled, link">
        <Button dense Icon={ MdAdd } iconSize={ 16 }>Dense</Button>
        <Button tone="danger">Remove</Button>
        <Button tone="danger" variant="raised">Delete</Button>
        <Button disabled variant="raised">Disabled</Button>
        <span>Inside a sentence: open <Button variant="link">AI settings</Button> to add a key.</span>
      </Sample>
    </>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Select and TextField in their sizes, plus underline tabs.
// @returns {JSX.Element} The samples.
function FieldSamples() {
  const [ person, setPerson ] = useState("all");
  const [ text, setText ] = useState("");
  const [ tab, setTab ] = useState("work");
  return (
    <>
      <div className="styleguide-field-grid">
        <Select label="Select" onChange={ setPerson } options={ SAMPLE_OPTIONS } value={ person } />
        <Select dense label="Select, dense" onChange={ setPerson } options={ SAMPLE_OPTIONS } value={ person } />
        <TextField label="TextField" onChange={ setText } placeholder="Placeholder" value={ text } />
        <TextField dense label="TextField, dense" onChange={ setText } placeholder="Placeholder" value={ text } />
        <TextField label="TextField, multiline" multiline onChange={ setText } placeholder="Details" value={ text } />
      </div>
      <Sample title="UnderlineTabs">
        <UnderlineTabs ariaLabel="Task domain" onChange={ setTab } tabs={ SAMPLE_TABS } value={ tab } />
      </Sample>
    </>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A labeled row of samples.
// @param {Object} props - { children, title }.
// @returns {JSX.Element} The row.
function Sample({ children, title }) {
  return (
    <div className="styleguide-sample">
      <h3 className="styleguide-subtitle">{ title }</h3>
      <div className="styleguide-sample-row">{ children }</div>
    </div>
  );
}
