/**
 * [Claude-authored file]
 * Created: 2026-08-07 | Model: claude-opus-5[1m]
 * Task: Tests for the shared Sentry loader snippet and the status logging that reports whether the SDK arrived
 * Prompt summary: "Does the logging indicate when Sentry has successfully loaded? Currently I see zero logProgress
 *   concerning whether Sentry was attempted"
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { setLoggingEnabled } from "util/log";
import { buildSentryLoaderScripts } from "util/sentry-loader";
import { installDashboardSentryReporting, logSentryStatus } from "util/sentry-reporting";

const TEST_DSN = "https://abc@o1.ingest.sentry.io/1";

// ------------------------------------------------------------------------------------------
// @desc Extract the loader's inline snippet from the emitted script tags and execute it against the jsdom window,
//   standing in for the browser parsing it out of <head>. Running the real emitted text — rather than a
//   reimplementation — is the point: it is what catches the snippet and the bundle drifting apart.
// @param {string} environment - Sentry environment tag to build the snippet with
// @returns {void}
function runLoaderSnippet(environment) {
  const scripts = buildSentryLoaderScripts({ dsn: TEST_DSN, environment });
  const inlineSource = scripts.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function(inlineSource)();
}

const LOADER_GLOBAL_NAMES = ["Sentry", "__dashboardSentryQueue", "__dashboardSentryReady", "__dashboardSentryStatus",
  "__dashboardSentryStatusChanged", "__dashboardSentryFailed", "__initDashboardSentry", "__dashboardDrainSentryQueue"];

describe("sentry-loader", () => {
  let loggedLines;

  beforeEach(() => {
    loggedLines = [];
    jest.spyOn(console, "log").mockImplementation((...args) => loggedLines.push(args.join(" ")));
    jest.spyOn(console, "error").mockImplementation(() => {});
    setLoggingEnabled(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setLoggingEnabled(false);
    for (const globalName of LOADER_GLOBAL_NAMES) delete window[globalName];
  });

  it("emits nothing at all when no DSN was configured at build time", () => {
    expect(buildSentryLoaderScripts({ dsn: "", environment: "dashboard-dev" })).toBe("");
  });

  it("reports the loader's absence rather than staying silent, so a missing DSN is diagnosable", () => {
    installDashboardSentryReporting();
    logSentryStatus();
    expect(loggedLines[0]).toMatch(/loader absent — no SENTRY_DSN/);
  });

  it("reports that the SDK is still in flight when the CDN has not settled yet", () => {
    runLoaderSnippet("dashboard-dev");
    installDashboardSentryReporting();
    logSentryStatus();
    expect(loggedLines[0]).toMatch(/still loading from https:\/\/browser\.sentry-cdn\.com/);
    expect(loggedLines[0]).toMatch(/dashboard-dev/);
  });

  it("reports success when the SDK initializes after the bundle has already loaded", () => {
    runLoaderSnippet("dashboard-dev");
    installDashboardSentryReporting();
    loggedLines.length = 0;
    window.Sentry = { init: jest.fn(), withScope: jest.fn() };
    window.__initDashboardSentry();
    expect(window.__dashboardSentryReady).toBe(true);
    expect(loggedLines.join("\n")).toMatch(/SDK loaded and initialized after \d+ms, environment "dashboard-dev"/);
  });

  it("reports a CDN that never delivered the SDK", () => {
    runLoaderSnippet("dashboard-embed");
    installDashboardSentryReporting();
    loggedLines.length = 0;
    window.__dashboardSentryFailed("CDN script failed to load");
    expect(loggedLines.join("\n")).toMatch(/SDK unavailable — cdn-failed \(CDN script failed to load\)/);
  });

  it("reports an SDK that arrived without an init function", () => {
    runLoaderSnippet("dashboard-embed");
    installDashboardSentryReporting();
    loggedLines.length = 0;
    window.Sentry = {};
    window.__initDashboardSentry();
    expect(loggedLines.join("\n")).toMatch(/SDK unavailable — sdk-without-init/);
  });

  it("survives an init() that throws instead of leaving the dashboard mid-boot", () => {
    runLoaderSnippet("dashboard-embed");
    installDashboardSentryReporting();
    loggedLines.length = 0;
    window.Sentry = { init: () => { throw new Error("bad dsn"); } };
    expect(() => window.__initDashboardSentry()).not.toThrow();
    expect(window.__dashboardSentryReady).toBeUndefined();
    expect(loggedLines.join("\n")).toMatch(/SDK unavailable — init-threw \(bad dsn\)/);
  });

  it("stays silent while the Console Logging setting is off", () => {
    setLoggingEnabled(false);
    runLoaderSnippet("dashboard-dev");
    installDashboardSentryReporting();
    logSentryStatus();
    expect(loggedLines).toEqual([]);
  });
});
