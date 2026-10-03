// Exercise createBrowserWorkDriver: admission passes coalesce into one frame, fall back to a timer while the page is
// hidden or frames are unavailable, follow visibility changes, and stop on dispose.
import { jest } from "@jest/globals";
import { createBrowserWorkDriver } from "dashboard/work-queue/browser-work-driver";

// ----------------------------------------------------------------------------------------------
// @desc A driver over hand-fired frames and timers and a document whose hidden flag the test sets.
// @returns {object} { driver, fireFrames, fireTimers, frames, runReady, setHidden, timers }.
function harness() {
  const frames = new Map();
  const timers = new Map();
  let nextId = 0;
  const documentObject = new EventTarget();
  documentObject.hidden = false;
  const runReady = jest.fn();
  const driver = createBrowserWorkDriver({ cancelFrame: id => frames.delete(id), clearTimer: id => timers.delete(id),
    documentObject, requestFrame: callback => { frames.set(++nextId, callback); return nextId; }, runReady,
    setTimer: callback => { timers.set(++nextId, callback); return nextId; } });
  const fire = callbacks => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); } };
  const setHidden = hidden => {
    documentObject.hidden = hidden;
    documentObject.dispatchEvent(new Event("visibilitychange"));
  };
  return { driver, fireFrames: () => fire(frames), fireTimers: () => fire(timers), frames, runReady, setHidden, timers };
}

describe("createBrowserWorkDriver", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Many requests before a frame produce one pass in that frame; a request after it asks for another frame.
  it("runs one admission pass per frame however many requests arrive", () => {
    const { driver, fireFrames, frames, runReady } = harness();
    driver.requestRun();
    driver.requestRun();
    driver.requestRun();
    expect(frames.size).toBe(1);
    fireFrames();
    expect(runReady).toHaveBeenCalledTimes(1);
    driver.requestRun();
    fireFrames();
    expect(runReady).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Hiding the page moves a queued frame pass onto a timer, tells subscribers, and later passes use timers too.
  it("uses a timer while the page is hidden and reports visibility", () => {
    const { driver, fireTimers, frames, runReady, setHidden, timers } = harness();
    const visibility = [];
    driver.subscribeVisibility(hidden => visibility.push(hidden));
    driver.requestRun();
    setHidden(true);
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(1);
    fireTimers();
    expect(runReady).toHaveBeenCalledTimes(1);
    driver.requestRun();
    expect(timers.size).toBe(1);
    setHidden(false);
    expect(visibility).toEqual([true, false]);
    expect(driver.hidden()).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Without frame callbacks the driver uses timers; after dispose nothing runs and no listener hears changes.
  it("falls back to timers without frames and stops on dispose", () => {
    const runReady = jest.fn();
    const timers = [];
    const driver = createBrowserWorkDriver({ documentObject: null, requestFrame: null, runReady,
      setTimer: callback => timers.push(callback) });
    driver.requestRun();
    timers.shift()();
    expect(runReady).toHaveBeenCalledTimes(1);
    const { driver: framedDriver, fireFrames, runReady: framedRunReady, setHidden } = harness();
    const listener = jest.fn();
    framedDriver.subscribeVisibility(listener);
    framedDriver.requestRun();
    framedDriver.dispose();
    fireFrames();
    setHidden(true);
    framedDriver.requestRun();
    expect(framedRunReady).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});
