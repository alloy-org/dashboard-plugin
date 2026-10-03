// Share one Dashboard work runtime and its widget mount coordinator with the mounted Dashboard tree. The context value
// changes only when the runtime is replaced, never as jobs come and go, so providing it does not re-render widgets on
// queue transitions. A component outside a provider reads null and keeps its unscheduled behavior.
import { createContext, useContext } from "react";

const DashboardWorkContext = createContext(null);

// ----------------------------------------------------------------------------------------------
// @desc Provide the Dashboard's work runtime to its descendants.
// @param {object} props - { children, value }: value is { mountCoordinator, runtime }, or null when scheduling is off.
export function DashboardWorkProvider({ children, value }) {
  return <DashboardWorkContext.Provider value={value}>{children}</DashboardWorkContext.Provider>;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the Dashboard's work runtime.
// @returns {object|null} { mountCoordinator, runtime }, or null outside a provider or while scheduling is off.
export function useDashboardWork() {
  return useContext(DashboardWorkContext);
}
