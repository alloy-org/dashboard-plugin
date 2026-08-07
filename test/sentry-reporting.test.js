/**
 * [Cursor Grok 4.5-authored file, extended by Cursor Opus 5]
 * Created: 2026-08-07 | Model: Cursor Grok 4.5 | Extended: 2026-08-07 | Model: Cursor Opus 5
 * Task: Unit tests for embed-side Sentry capture helpers, including pre-init queueing and bridge observation
 * Prompt summary: "report every error that could plausibly occur, without wrapping calls that have no way to fail"
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { captureDashboardException, captureDashboardMessage, capturePluginFailure, drainSentryQueue,
  installDashboardSentryReporting, observeEmbedCall } from "util/sentry-reporting";

describe("sentry-reporting", () => {
  let captureException;
  let captureMessage;
  let scope;
  let withScope;

  // Stand in for the CDN SDK. Tests that exercise the queue delete this again to model "still loading".
  function installSentryDouble() {
    captureException = jest.fn().mockReturnValue("event-1");
    captureMessage = jest.fn().mockReturnValue("event-2");
    scope = { setExtra: jest.fn(), setLevel: jest.fn(), setTag: jest.fn() };
    withScope = jest.fn(callback => callback(scope));
    window.Sentry = { captureException, captureMessage, withScope };
  }

  beforeEach(() => {
    installSentryDouble();
  });

  afterEach(() => {
    delete window.Sentry;
    delete window.__dashboardDrainSentryQueue;
    delete window.__dashboardSentryQueue;
    delete window.__dashboardSentryReady;
  });

  it("no-ops when neither Sentry nor a queue is available", () => {
    delete window.Sentry;
    expect(captureDashboardException(new Error("x"), { source: "init" })).toBeUndefined();
  });

  it("captures exceptions with source and widget tags", () => {
    const error = new Error("boom");
    const eventId = captureDashboardException(error, { source: "widget-boundary", widgetId: "mood" });
    expect(eventId).toBe("event-1");
    expect(captureException).toHaveBeenCalledWith(error);
    expect(scope.setTag).toHaveBeenCalledWith("dashboard.source", "widget-boundary");
    expect(scope.setTag).toHaveBeenCalledWith("dashboard.widgetId", "mood");
  });

  it("captures messages at the requested level and keeps unknown context as extras", () => {
    const eventId = captureDashboardMessage("init stalled", { level: "warning", source: "init-watchdog", tier: "low" });
    expect(eventId).toBe("event-2");
    expect(captureMessage).toHaveBeenCalledWith("init stalled");
    expect(scope.setLevel).toHaveBeenCalledWith("warning");
    expect(scope.setExtra).toHaveBeenCalledWith("tier", "low");
  });

  it("wraps non-Error throws so the event still carries a stack", () => {
    captureDashboardException("string failure", { source: "bridge-reject" });
    const [reported] = captureException.mock.calls[0];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("string failure");
  });

  // The plugin runs in the host app's context and cannot report for itself, so its stack has to survive the bridge —
  // otherwise every plugin-side failure groups under the same embed-side call site.
  it("capturePluginFailure preserves the plugin-side stack", () => {
    const envelope = { error: "getNoteTasks exploded", errorStack: "Error: getNoteTasks exploded\n  at plugin.js:1" };
    capturePluginFailure(envelope, { action: "getNoteTasks", source: "bridge-call" });
    const [reported] = captureException.mock.calls[0];
    expect(reported.message).toBe("getNoteTasks exploded");
    expect(reported.stack).toContain("at plugin.js:1");
    expect(scope.setTag).toHaveBeenCalledWith("dashboard.action", "getNoteTasks");
  });

  it("capturePluginFailure accepts the initFailures record shape", () => {
    capturePluginFailure({ message: "mood unavailable", source: "init-mood", stack: "Error: mood unavailable\n  at x" },
      { action: "init-mood", source: "init-soft-fail" });
    const [reported] = captureException.mock.calls[0];
    expect(reported.message).toBe("mood unavailable");
    expect(reported.stack).toContain("at x");
  });

  describe("observeEmbedCall", () => {
    it("reports a resolved embedCallFailed envelope and returns the original value", async () => {
      const envelope = { embedCallFailed: true, error: "setSetting failed", errorStack: "Error: setSetting failed" };
      const result = Promise.resolve(envelope);

      expect(observeEmbedCall("setSetting", result)).toBe(result);
      await result;
      await Promise.resolve();

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(scope.setTag).toHaveBeenCalledWith("dashboard.action", "setSetting");
      expect(scope.setTag).toHaveBeenCalledWith("dashboard.source", "bridge-call");
    });

    it("reports a rejected bridge call", async () => {
      const result = Promise.reject(new Error("bridge died"));
      observeEmbedCall("getNoteContent", result);
      await expect(result).rejects.toThrow("bridge died");
      await Promise.resolve();

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(scope.setTag).toHaveBeenCalledWith("dashboard.source", "bridge-reject");
    });

    it("stays quiet for a successful call, and for a result that merely carries an error key", async () => {
      const serviceResult = Promise.resolve({ error: "No AI provider configured", errorCode: "no_provider" });
      observeEmbedCall("dreamTaskAnalyze", serviceResult);
      await serviceResult;
      await Promise.resolve();

      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("pre-init queueing", () => {
    it("queues events while the SDK is still loading and flushes them on drain", () => {
      window.__dashboardSentryQueue = [];
      delete window.Sentry;

      expect(captureDashboardException(new Error("during boot"), { source: "window-error" })).toBeUndefined();
      expect(window.__dashboardSentryQueue).toHaveLength(1);

      installSentryDouble();
      window.__dashboardSentryReady = true;
      drainSentryQueue();

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException.mock.calls[0][0].message).toBe("during boot");
      expect(window.__dashboardSentryQueue).toBeNull();
    });

    it("keeps queued events when Sentry never becomes available", () => {
      window.__dashboardSentryQueue = [];
      delete window.Sentry;

      captureDashboardMessage("still loading", { source: "init-watchdog" });
      drainSentryQueue();

      expect(window.__dashboardSentryQueue).toHaveLength(1);
    });

    it("queues rather than handing events to an SDK whose init has not run", () => {
      window.__dashboardSentryQueue = [];

      captureDashboardException(new Error("too early"), { source: "init-empty" });

      expect(captureException).not.toHaveBeenCalled();
      expect(window.__dashboardSentryQueue).toHaveLength(1);
    });

    it("installDashboardSentryReporting registers the loader's drain hook and flushes what is ready", () => {
      window.__dashboardSentryQueue = [{ error: new Error("queued before mount"), tags: {} }];
      window.__dashboardSentryReady = true;

      installDashboardSentryReporting();

      expect(typeof window.__dashboardDrainSentryQueue).toBe("function");
      expect(captureException).toHaveBeenCalledTimes(1);
    });
  });
});
