/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "instrument memory usage, then use viewport-gated lazy mounting" — verify the
 *   device-tier classification that gates crash breadcrumbs and defensive behavior.
 */
import { jest } from "@jest/globals";
import { deviceProfile, deviceTier, isMemoryConstrainedDevice, isMobilePlatform,
  publishDeviceProfileDiagnostic } from "util/device-profile";

const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

// [Claude claude-opus-4-8 (1M context)] Task: override navigator/screen/window fields per test
function stubEnvironment({ cores, deviceMemory, innerWidth, maxTouchPoints = 0, screenHeight = 900,
    screenWidth = 1440, userAgent }) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: deviceMemory });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: cores });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  Object.defineProperty(window.screen, "width", { configurable: true, value: screenWidth });
  Object.defineProperty(window.screen, "height", { configurable: true, value: screenHeight });
}

afterEach(() => {
  delete window.__dashboardViewportDiag;
  jest.restoreAllMocks();
});

describe("isMobilePlatform", () => {
  test("detects an iPhone user agent", () => {
    stubEnvironment({ cores: 6, deviceMemory: 4, innerWidth: 390, screenHeight: 844, screenWidth: 390, userAgent: IPHONE_UA });
    expect(isMobilePlatform()).toBe(true);
  });

  test("detects an iPadOS device that reports a desktop UA but exposes touch points", () => {
    stubEnvironment({ cores: 8, deviceMemory: 8, innerWidth: 1024, maxTouchPoints: 5,
      screenHeight: 1366, screenWidth: 1024, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    expect(isMobilePlatform()).toBe(true);
  });

  test("returns false for a plain desktop", () => {
    stubEnvironment({ cores: 12, deviceMemory: 16, innerWidth: 1440, userAgent: DESKTOP_UA });
    expect(isMobilePlatform()).toBe(false);
  });
});

describe("deviceTier", () => {
  test("classifies a phone with a small viewport as low", () => {
    stubEnvironment({ cores: 6, deviceMemory: 4, innerWidth: 390, screenHeight: 844, screenWidth: 390, userAgent: IPHONE_UA });
    expect(deviceTier()).toBe("low");
  });

  test("classifies constrained RAM as low even on a wide viewport", () => {
    stubEnvironment({ cores: 8, deviceMemory: 2, innerWidth: 1440, userAgent: DESKTOP_UA });
    expect(deviceTier()).toBe("low");
  });

  test("classifies few cores as low", () => {
    stubEnvironment({ cores: 2, deviceMemory: 8, innerWidth: 1440, userAgent: DESKTOP_UA });
    expect(deviceTier()).toBe("low");
  });

  test("classifies an ample desktop as high", () => {
    stubEnvironment({ cores: 12, deviceMemory: 16, innerWidth: 1440, userAgent: DESKTOP_UA });
    expect(deviceTier()).toBe("high");
  });

  test("classifies a large tablet without strong low signals as medium", () => {
    stubEnvironment({ cores: 8, deviceMemory: 8, innerWidth: 900, maxTouchPoints: 5,
      screenHeight: 1180, screenWidth: 820, userAgent: IPHONE_UA });
    expect(deviceTier()).toBe("medium");
  });
});

describe("isMemoryConstrainedDevice", () => {
  test("is true for mobile devices", () => {
    stubEnvironment({ cores: 8, deviceMemory: 8, innerWidth: 900, maxTouchPoints: 5,
      screenHeight: 1180, screenWidth: 820, userAgent: IPHONE_UA });
    expect(isMemoryConstrainedDevice()).toBe(true);
  });

  test("is false for an ample desktop", () => {
    stubEnvironment({ cores: 12, deviceMemory: 16, innerWidth: 1440, userAgent: DESKTOP_UA });
    expect(isMemoryConstrainedDevice()).toBe(false);
  });
});

describe("deviceProfile / publishDeviceProfileDiagnostic", () => {
  test("returns null for browser-unsupported fields rather than omitting them", () => {
    stubEnvironment({ cores: undefined, deviceMemory: undefined, innerWidth: 1440, userAgent: DESKTOP_UA });
    const profile = deviceProfile();
    expect(profile.cores).toBeNull();
    expect(profile.memoryGb).toBeNull();
    expect(profile.mobile).toBe(false);
    expect(profile).toHaveProperty("tier");
  });

  test("publishes the profile onto window.__dashboardViewportDiag", () => {
    stubEnvironment({ cores: 12, deviceMemory: 16, innerWidth: 1440, userAgent: DESKTOP_UA });
    const published = publishDeviceProfileDiagnostic();
    expect(window.__dashboardViewportDiag).toBe(published);
    expect(window.__dashboardViewportDiag.tier).toBe("high");
  });
});
