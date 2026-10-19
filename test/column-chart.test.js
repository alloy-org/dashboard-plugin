// Verify the generic ColumnChart: side-by-side series, stacked segments, thinned axis labels, and the hovered column's
// highlight line, value pill, and tooltip.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const shownTooltips = [];
await jest.unstable_mockModule("dashboard/charts/stats-chart-tooltip", async () => ({
  useStatsChartTooltip: () => ({ scheduleHide: () => {},
    show: (content, screenX, screenY) => shownTooltips.push({ content, screenX, screenY }) }),
}));

const { default: ColumnChart } = await import("dashboard/charts/column-chart");

const CHART_HEIGHT = 200;
const CHART_WIDTH = 420;

// ------------------------------------------------------------------------------------------
// @desc Mount a ColumnChart with a measurable container size.
// @param {Object} props - Chart props.
// @returns {Promise<HTMLElement>} The mounted container.
async function renderChart(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(createElement(ColumnChart, props)); });
  return container;
}

describe("ColumnChart", () => {
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

  it("draws each series side by side in its column, skipping empty values", async () => {
    const container = await renderChart({ className: "test-chart", columns: [ { key: "a", label: "A" },
      { key: "b", label: "B" } ], renderTooltip: () => null, series: [
      { className: "test-bar test-bar--created", key: "created", values: [ 3, 0 ] },
      { className: "test-bar test-bar--completed", key: "completed", values: [ 5, 2 ] } ] });
    expect(container.querySelectorAll(".test-bar--created path")).toHaveLength(1);
    expect(container.querySelectorAll(".test-bar--completed path")).toHaveLength(2);
    const [ createdBar ] = container.querySelectorAll(".test-bar--created path");
    const [ completedBar ] = container.querySelectorAll(".test-bar--completed path");
    const leftEdge = path => Number(path.getAttribute("d").match(/^M([\d.]+)/)[1]);
    expect(leftEdge(createdBar)).toBeLessThan(leftEdge(completedBar));
  });

  it("stacks segments with their own fills and labels only every Nth column when columns are narrow", async () => {
    const columns = Array.from({ length: 24 }, (unused, index) => ({ key: String(index), label: `${ index }h` }));
    const values = columns.map((column, index) => (index ? 0 : [ { fill: "red", key: "one", value: 1 },
      { fill: "blue", key: "two", value: 2 } ]));
    const container = await renderChart({ className: "test-chart", columns, labelMinimumSpacing: 44,
      labelSteps: [ 1, 2, 3, 4, 6, 8, 12 ], renderTooltip: () => null, series: [ { key: "only", values } ] });
    expect(Array.from(container.querySelectorAll("path")).map(path => path.getAttribute("fill")))
      .toEqual([ "red", "blue" ]);
    const labels = Array.from(container.querySelectorAll(".stats-chart-x-axis-label")).map(label => label.textContent);
    expect(labels.length).toBeLessThan(columns.length);
    expect(labels[0]).toBe("0h");
  });

  it("marks the hovered column and shows its tooltip and value pill", async () => {
    const container = await renderChart({ className: "test-chart", columns: [ { key: "a", label: "A" },
      { key: "b", label: "B" } ], renderTooltip: index => `tooltip ${ index }`,
      series: [ { key: "only", values: [ 4, 9 ] } ], valuePillFromIndex: index => ({ text: String([ 4, 9 ][index]) }) });
    await act(async () => {
      container.querySelectorAll(".stats-chart-hit-area")[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(container.querySelector(".stats-chart-highlight-line")).not.toBeNull();
    expect(container.querySelector(".stats-chart-value-pill text").textContent).toBe("9");
    expect(shownTooltips.at(-1).content).toBe("tooltip 1");
  });
});
