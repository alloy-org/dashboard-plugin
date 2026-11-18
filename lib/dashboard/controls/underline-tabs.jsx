// Underline tabs like the host app's Task Stats header: low-contrast labels, the selected one over a 2px
// rule.
import { useRef } from "react";
import classNameFromList from "dashboard/controls/class-names";
import "dashboard/styles/dashboard-controls.scss";

// ----------------------------------------------------------------------------------------------
// @desc A tab list. Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects. When no tab is
//   selected the first tab takes keyboard focus, so the list is always reachable with Tab.
// @param {Object} props - An object with the following properties:
//   - {string} ariaLabel - What the tabs choose between, e.g. "Task domain".
//   - {string} [className] - Extra class names for layout.
//   - {boolean} [deselectable] - Clicking the selected tab calls onChange(null), for tabs that open and close
//     a panel.
//   - {Function} onChange - Called with the chosen tab's id, or null when deselecting.
//   - {Array<Object>} tabs - [{ id, label, className }]; `className` is added to that tab.
//   - {string} [value] - The selected tab's id; null or undefined when none is selected.
// @returns {JSX.Element} The tabs.
export default function UnderlineTabs({ ariaLabel, className, deselectable, onChange, tabs, value }) {
  const listRef = useRef(null);
  const selectedIndex = tabs.findIndex(tab => tab.id === value);
  const focusableIndex = selectedIndex === -1 ? 0 : selectedIndex;
  // ----------------------------------------------------------------------------------------------
  // @desc Move the selection and focus to the neighboring tab on ArrowLeft / ArrowRight.
  const onKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const tabElements = [ ...(listRef.current?.querySelectorAll("[role='tab']") || []) ];
    const currentIndex = Math.max(0, tabElements.indexOf(event.target));
    const nextIndex = (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[nextIndex].id);
    tabElements[nextIndex]?.focus();
  };
  return (
    <div aria-label={ ariaLabel } className={ classNameFromList("dashboard-underline-tabs", className) }
      onKeyDown={ onKeyDown } ref={ listRef } role="tablist">
      {
        tabs.map((tab, index) => (
          <button aria-selected={ tab.id === value }
            className={ classNameFromList("dashboard-underline-tab", tab.className) } key={ tab.id }
            onClick={ () => onChange(deselectable && tab.id === value ? null : tab.id) } role="tab"
            tabIndex={ index === focusableIndex ? 0 : -1 } type="button">
            { tab.label }
          </button>
        ))
      }
    </div>
  );
}
