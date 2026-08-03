// [Claude claude-opus-5 (1M context)] Generated tests for: WidgetWrapper deriving its header icon,
//   title, and subtitle from widgetId via WIDGET_REGISTRY, so widgets need not pass them
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { default: WidgetWrapper } = await import("widget-wrapper");
const { widgetDataFromId } = await import("constants/settings");

// Goal Coach is the one widget whose subtitle is a fixed tagline, so it is the registry's subtitle case.
const SUBTITLE_WIDGET_ID = "dream-task";

// ----------------------------------------------------------------------------------------------
// @desc Render WidgetWrapper with the given props and return the mounted container.
// [Claude claude-opus-5 (1M context)] Task: mount the shared widget chrome for header assertions
async function renderWrapper(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(createElement(WidgetWrapper, props, "body"));
  });
  return container;
}

function headerText(container, selector) {
  return container.querySelector(selector)?.textContent ?? null;
}

describe("WidgetWrapper header defaults", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes the icon and title from the registry when the widget passes only its id", async () => {
    const registryEntry = widgetDataFromId("victory-value");
    const container = await renderWrapper({ widgetId: "victory-value" });
    expect(headerText(container, ".widget-icon")).toBe(registryEntry.icon);
    expect(headerText(container, ".widget-title__label")).toBe(registryEntry.name);
  });

  it("prefers the registry's visibleTitle over its name, as the widget's own call used to", async () => {
    const container = await renderWrapper({ widgetId: "mood" });
    expect(headerText(container, ".widget-title__label")).toBe(widgetDataFromId("mood").visibleTitle);
  });

  it("lets a widget with a state-dependent header override either default", async () => {
    const container = await renderWrapper({ icon: "🧪", title: "Overridden", widgetId: "victory-value" });
    expect(headerText(container, ".widget-icon")).toBe("🧪");
    expect(headerText(container, ".widget-title__label")).toBe("Overridden");
  });

  it("renders the registry's fixed subtitle, and nothing when the widget has none", async () => {
    const withSubtitle = await renderWrapper({ widgetId: SUBTITLE_WIDGET_ID });
    expect(headerText(withSubtitle, ".widget-title__subtitle"))
      .toBe(widgetDataFromId(SUBTITLE_WIDGET_ID).visibleSubtitle);

    const withoutSubtitle = await renderWrapper({ widgetId: "quotes" });
    expect(withoutSubtitle.querySelector(".widget-title__subtitle")).toBeNull();
  });

  it("lets a widget's own subtitle replace the registry's", async () => {
    const container = await renderWrapper({ subtitle: "Tue, Aug 3", widgetId: SUBTITLE_WIDGET_ID });
    expect(headerText(container, ".widget-title__subtitle")).toBe("Tue, Aug 3");
  });

  it("falls back to the id and no icon for a widget absent from the registry", async () => {
    const container = await renderWrapper({ widgetId: "not-a-registered-widget" });
    expect(headerText(container, ".widget-title__label")).toBe("not-a-registered-widget");
    expect(headerText(container, ".widget-icon")).toBe("");
  });
});
