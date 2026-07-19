/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "instrument memory usage" — verify the OOM crash breadcrumb: an unstamped record
 *   found at next launch means the prior session died mid-render; a stamped one means a clean load.
 */
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { detectPriorCrash, parseBreadcrumb, reportPriorCrashIfAny, stampBreadcrumbSettled,
  writeRenderBreadcrumb } from "crash-breadcrumb";

const DEVICE_PROFILE = { cores: 6, memoryGb: 4, mobile: true, tier: "low" };

// [Claude claude-opus-4-8 (1M context)] Task: minimal app stub capturing setSetting writes
function buildMockApp() {
  const settings = {};
  return { setSetting: jest.fn(async (key, value) => { settings[key] = value; }), settings };
}

describe("parseBreadcrumb", () => {
  test("parses a JSON string", () => {
    expect(parseBreadcrumb('{"widgetCount":3}')).toEqual({ widgetCount: 3 });
  });

  test("passes through a pre-parsed object", () => {
    expect(parseBreadcrumb({ widgetCount: 3 })).toEqual({ widgetCount: 3 });
  });

  test("returns null for missing or garbage input", () => {
    expect(parseBreadcrumb(undefined)).toBeNull();
    expect(parseBreadcrumb("{not json")).toBeNull();
  });
});

describe("detectPriorCrash", () => {
  test("reports a crash when the prior breadcrumb was never stamped settled", () => {
    const settings = { [SETTING_KEYS.RENDER_BREADCRUMB]: { settledAt: null, widgetCount: 10 } };
    expect(detectPriorCrash(settings)).toEqual({ breadcrumb: { settledAt: null, widgetCount: 10 }, crashed: true });
  });

  test("reports no crash when the prior breadcrumb was stamped settled", () => {
    const settings = { [SETTING_KEYS.RENDER_BREADCRUMB]: { settledAt: 1234, widgetCount: 10 } };
    expect(detectPriorCrash(settings)).toEqual({ breadcrumb: { settledAt: 1234, widgetCount: 10 }, crashed: false });
  });

  test("returns null when no breadcrumb exists", () => {
    expect(detectPriorCrash({})).toBeNull();
  });
});

describe("reportPriorCrashIfAny", () => {
  test("returns the crashing breadcrumb when the prior session did not settle", () => {
    const breadcrumb = { cores: 6, memoryGb: 4, mobile: true, settledAt: null, tier: "low",
      widgetCount: 12, widgetIds: ["agenda", "calendar"] };
    const result = reportPriorCrashIfAny({ [SETTING_KEYS.RENDER_BREADCRUMB]: breadcrumb });
    expect(result).toEqual(breadcrumb);
  });

  test("returns null on a clean prior session", () => {
    const breadcrumb = { settledAt: 999, widgetCount: 12 };
    expect(reportPriorCrashIfAny({ [SETTING_KEYS.RENDER_BREADCRUMB]: breadcrumb })).toBeNull();
  });
});

describe("writeRenderBreadcrumb / stampBreadcrumbSettled", () => {
  test("writes an unstamped breadcrumb before render", async () => {
    const app = buildMockApp();
    const written = await writeRenderBreadcrumb(app, { deviceProfile: DEVICE_PROFILE, startedAt: 1000,
      widgetIds: ["agenda", "calendar", "mood"] });
    expect(written.settledAt).toBeNull();
    expect(written.widgetCount).toBe(3);
    expect(written.tier).toBe("low");
    const persisted = JSON.parse(app.settings[SETTING_KEYS.RENDER_BREADCRUMB]);
    expect(persisted.settledAt).toBeNull();
    expect(persisted.widgetIds).toEqual(["agenda", "calendar", "mood"]);
  });

  test("stamping settled makes the next launch see a clean load", async () => {
    const app = buildMockApp();
    await writeRenderBreadcrumb(app, { deviceProfile: DEVICE_PROFILE, startedAt: 1000,
      widgetIds: ["agenda", "calendar"] });
    await stampBreadcrumbSettled(app, { deviceProfile: DEVICE_PROFILE, settledAt: 2000, startedAt: 1000,
      widgetIds: ["agenda", "calendar"] });
    const detection = detectPriorCrash(app.settings);
    expect(detection.crashed).toBe(false);
  });

});
