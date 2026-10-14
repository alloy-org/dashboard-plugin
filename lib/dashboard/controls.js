// The dashboard's shared controls. Import from "dashboard/controls" in every widget, popup, and the Plan
// Builder instead of writing raw <button>, <select>, spinners, or empty/loading/error markup; see
// doc/design-system.md.
export { default as Badge } from "dashboard/controls/badge";
export { default as Button } from "dashboard/controls/button";
export { Select, TextField } from "dashboard/controls/fields";
export { default as IconButton } from "dashboard/controls/icon-button";
export { default as PlainButton } from "dashboard/controls/plain-button";
export { default as Spinner } from "dashboard/controls/spinner";
export { EmptyState, ErrorState, LoadingState } from "dashboard/controls/states";
export { default as UnderlineTabs } from "dashboard/controls/underline-tabs";
