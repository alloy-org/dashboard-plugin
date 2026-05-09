/**
 * [gpt-5.4-authored file]
 * Prompt summary: "test seen-widget tracking and recent-widget pop-in derivation"
 */
import { describe, expect, it } from "@jest/globals";

import { deriveDashboardComponentsWithPopIn, mergeComponentsSeen, parseComponentsSeen } from "../lib/util/new-component-popin.js";

const DEFAULT_COMPONENTS = [
  { widgetId: "agenda", gridWidthSize: 2, gridHeightSize: 1, settings: {} },
  { widgetId: "calendar", gridWidthSize: 1, gridHeightSize: 1, settings: {} },
  { widgetId: "graveyard", gridWidthSize: 1, gridHeightSize: 1, settings: {} },
];

const WIDGET_REGISTRY = [
  { widgetId: "agenda" },
  { widgetId: "calendar" },
  { widgetId: "graveyard", introducedAt: "2026-05-09" },
];

// [OpenAI gpt-5.4] Generated tests for: new component pop-in utility behavior
describe("new-component-popin", () => {
  it("parses and sorts COMPONENTS_SEEN from mixed formats", () => {
    expect(parseComponentsSeen('["calendar","agenda","calendar"]')).toEqual(["agenda", "calendar"]);
    expect(parseComponentsSeen(["graveyard", "agenda", "graveyard"])).toEqual(["agenda", "graveyard"]);
    expect(parseComponentsSeen("not json")).toEqual([]);
  });

  it("appends a recent unseen widget to the visible layout and marks it as seen", () => {
    const result = deriveDashboardComponentsWithPopIn({
      componentsSeen: ["agenda"],
      defaultComponents: DEFAULT_COMPONENTS,
      now: new Date("2026-05-10T12:00:00.000Z"),
      visibleComponents: DEFAULT_COMPONENTS.filter(component => component.widgetId !== "graveyard"),
      widgetRegistry: WIDGET_REGISTRY,
    });

    expect(result.poppedInWidgetId).toBe("graveyard");
    expect(result.visibleComponents.map(component => component.widgetId)).toEqual(["agenda", "calendar", "graveyard"]);
    expect(result.componentsSeen).toEqual(["agenda", "calendar", "graveyard"]);
  });

  it("does not pop in a recent widget that has already been seen", () => {
    const result = deriveDashboardComponentsWithPopIn({
      componentsSeen: ["agenda", "graveyard"],
      defaultComponents: DEFAULT_COMPONENTS,
      now: new Date("2026-05-10T12:00:00.000Z"),
      visibleComponents: DEFAULT_COMPONENTS.filter(component => component.widgetId !== "graveyard"),
      widgetRegistry: WIDGET_REGISTRY,
    });

    expect(result.poppedInWidgetId).toBeNull();
    expect(result.visibleComponents.map(component => component.widgetId)).toEqual(["agenda", "calendar"]);
    expect(result.componentsSeen).toEqual(["agenda", "calendar", "graveyard"]);
  });

  it("merges newly visible widget ids into a sorted seen list", () => {
    expect(mergeComponentsSeen(["graveyard"], ["calendar", "agenda", "calendar"])).toEqual(
      ["agenda", "calendar", "graveyard"]
    );
  });
});
