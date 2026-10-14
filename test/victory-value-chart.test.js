// Verify the Victory Value SVG chart: one bar per day with a value, Task Stats style grid and labels, and the hovered
// day's highlight line, value pill, and tooltip.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const shownTooltips = [];
await jest.unstable_mockModule("dashboard/dashboard-tooltip-tippy", async () => ({
  useCanvasTippy: () => ({ cancelScheduledHide: () => {}, hide: () => {}, scheduleHide: () => {},
    show: (content, screenX, screenY) => shownTooltips.push({ content, screenX, screenY }) }),
}));

const { default: VictoryValueChart } = await import("dashboard/charts/victory-value-chart");

const CHART_HEIGHT = 200;
const CHART_WIDTH = 420;
const DAY_NAMES = [ "Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed" ];
const VALUES = [ 4, 0, 10, 2, 0, 6, 8 ];

// ------------------------------------------------------------------------------------------
// @desc Seven displayed days with single "No project" segments, as days without ledger data have.
// @returns {Array} Daily values.
function dailyValuesFixture() {
  return VALUES.map((value, index) => ({ date: `2026-10-${ String(8 + index).padStart(2, "0") }`, day: DAY_NAMES[index],
    segments: value ? [ { colorToken: "--dashboard-color-background-accent", key: "none", value } ] : [], value }));
}

// ------------------------------------------------------------------------------------------
// @desc Mount the chart with a measurable container size.
// @param {Object} props - Extra chart props.
// @returns {Promise<HTMLElement>} The mounted container.
async function renderChart(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(createElement(VictoryValueChart, { dailyValues: dailyValuesFixture(), hasProjectLegend: false,
      moodByDay: [], showMood: false, tooltipHtmlFromIndex: index => `tooltip ${ index }`, ...props }));
  });
  return container;
}

describe("VictoryValueChart", () => {
  let boundingRectSpy;

  beforeEach(() => {
    shownTooltips.length = 0;
    boundingRectSpy = jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ bottom: CHART_HEIGHT,
      height: CHART_HEIGHT, left: 0, right: CHART_WIDTH, top: 0, width: CHART_WIDTH, x: 0, y: 0 });
  });

  afterEach(() => {
    boundingRectSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("draws a bar for each day with a value, filled with the victory value gradient, over a labeled grid", async () => {
    const container = await renderChart();
    const barPaths = container.querySelectorAll(".victory-value-chart-bar path");
    expect(barPaths).toHaveLength(VALUES.filter(Boolean).length);
    expect(barPaths[0].getAttribute("fill")).toBe("url(#victory-value-bar-gradient)");
    expect(container.querySelectorAll(".stats-chart-grid-line").length).toBeGreaterThan(1);
    const dayLabels = Array.from(container.querySelectorAll(".stats-chart-x-axis-label")).map(label => label.textContent);
    expect(dayLabels).toEqual(DAY_NAMES);
  });

  it("keeps legend colors on project segments when bars are colored by project", async () => {
    const container = await renderChart({ hasProjectLegend: true });
    expect(container.querySelector(".victory-value-chart-bar path").getAttribute("fill"))
      .toBe("var(--dashboard-color-background-accent)");
  });

  it("marks the hovered day with a highlight line and value pill, and shows its tooltip", async () => {
    const container = await renderChart();
    expect(container.querySelector(".stats-chart-highlight-line")).toBeNull();
    const hitAreas = container.querySelectorAll(".stats-chart-hit-area");
    await act(async () => { hitAreas[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(container.querySelector(".stats-chart-highlight-line")).not.toBeNull();
    expect(container.querySelector(".stats-chart-value-pill text").textContent).toBe("10");
    expect(shownTooltips.at(-1).content).toBe("tooltip 2");
  });
});
