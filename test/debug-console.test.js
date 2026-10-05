// Verify Debug Console clipboard exports, rolling retention, empty state, and clipboard failure feedback.
import { jest } from "@jest/globals";
import DebugConsoleWidget from "debug-console";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getLogBuffer, logAlways, MAX_LOG_BUFFER } from "util/log";

let container;
let root;
let writeText;
const originalClipboard = navigator.clipboard;

// ------------------------------------------------------------------------------------------
// @desc Find a console header action by its accessible text.
// @param {string} label - Button label to locate.
// @returns {HTMLButtonElement} Matching action button.
function button(label) {
  return [...container.querySelectorAll("button")].find(element => element.textContent === label);
}

// ------------------------------------------------------------------------------------------
// @desc Emit numbered log messages and flush their deferred notifications into the rendered console.
// @param {number} count - Number of entries to emit.
function emitEntries(count) {
  act(() => {
    for (let index = 0; index < count; index += 1) logAlways(`Message ${ index }`);
    jest.runOnlyPendingTimers();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-04T12:34:56.789Z"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(DebugConsoleWidget, { adminToolsEnabled: false, app: {} })));
  act(() => button("Clear").click());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ------------------------------------------------------------------------------------------
// @desc Copy all retained entries or exactly the latest 500 in chronological order with displayed timestamps.
it("copies all entries and the latest 500 separately", async () => {
  emitEntries(505);
  await act(async () => button("Copy all").click());
  const allLines = writeText.mock.calls[0][0].split("\n");
  expect(allLines).toHaveLength(505);
  expect(allLines[0]).toBe("12:34:56.789 Message 0");
  expect(allLines[504]).toBe("12:34:56.789 Message 504");
  await act(async () => button("Copy recent").click());
  const recentLines = writeText.mock.calls[1][0].split("\n");
  expect(recentLines).toEqual(allLines.slice(-500));
  expect(container.querySelector('[role="status"]').textContent).toBe("Copied 500 entries.");
});

// ------------------------------------------------------------------------------------------
// @desc Keep shared and displayed retention aligned, including entries present before mounting the console.
it("retains up to 2000 entries across log updates and remounts", async () => {
  emitEntries(MAX_LOG_BUFFER + 5);
  expect(getLogBuffer()).toHaveLength(MAX_LOG_BUFFER);
  expect(container.querySelectorAll(".debug-console__entry")).toHaveLength(MAX_LOG_BUFFER);
  act(() => root.unmount());
  root = createRoot(container);
  act(() => root.render(createElement(DebugConsoleWidget, { adminToolsEnabled: false, app: {} })));
  await act(async () => button("Copy all").click());
  const copiedLines = writeText.mock.calls[0][0].split("\n");
  expect(copiedLines).toHaveLength(MAX_LOG_BUFFER);
  expect(copiedLines[0]).toBe("12:34:56.789 Message 5");
});

// ------------------------------------------------------------------------------------------
// @desc Small exports retain object/error formatting and multiline text; clearing disables both copy actions.
it("copies fewer than 500 entries and honors Clear", async () => {
  expect(button("Copy all").disabled).toBe(true);
  expect(button("Copy recent").disabled).toBe(true);
  act(() => {
    logAlways("First\nsecond", { value: 42 }, new Error("example"));
    jest.runOnlyPendingTimers();
  });
  await act(async () => button("Copy recent").click());
  expect(writeText).toHaveBeenCalledWith('12:34:56.789 First\nsecond {"value":42} Error: example');
  act(() => button("Clear").click());
  expect(button("Copy all").disabled).toBe(true);
  expect(button("Copy recent").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  emitEntries(1);
  await act(async () => button("Copy all").click());
  expect(writeText).toHaveBeenLastCalledWith("12:34:56.789 Message 0");
});

// ------------------------------------------------------------------------------------------
// @desc Report blocked clipboard access without discarding log entries or claiming the copy succeeded.
it("reports clipboard failures", async () => {
  emitEntries(1);
  writeText.mockRejectedValue(new Error("Permission denied"));
  await act(async () => button("Copy all").click());
  expect(container.querySelector('[role="status"]').textContent).toContain("Copy failed");
  expect(container.querySelectorAll(".debug-console__entry")).toHaveLength(1);
});
