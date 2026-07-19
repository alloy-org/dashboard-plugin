/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "instrument memory usage" — verify heap sampling reads performance.memory when
 *   present, no-ops when absent (iOS WKWebView), and buckets pressure correctly.
 */
import { jest } from "@jest/globals";
import { logMemorySample, lowestMemorySample, memoryPressureBucket, readMemorySample,
  startMemorySampling } from "util/memory-instrumentation";

const MB = 1024 * 1024;

afterEach(() => {
  delete performance.memory;
  jest.restoreAllMocks();
});

// [Claude claude-opus-4-8 (1M context)] Task: install a fake performance.memory for the test
function stubMemory({ limitMb, totalMb, usedMb }) {
  Object.defineProperty(performance, "memory", { configurable: true,
    value: { jsHeapSizeLimit: limitMb * MB, totalJSHeapSize: totalMb * MB, usedJSHeapSize: usedMb * MB } });
}

describe("readMemorySample", () => {
  test("returns null when performance.memory is unavailable", () => {
    expect(readMemorySample()).toBeNull();
  });

  test("converts bytes to megabytes and derives the used ratio", () => {
    stubMemory({ limitMb: 2000, totalMb: 800, usedMb: 500 });
    const sample = readMemorySample();
    expect(sample.usedMb).toBe(500);
    expect(sample.limitMb).toBe(2000);
    expect(sample.usedRatio).toBe(0.25);
  });
});

describe("memoryPressureBucket", () => {
  test.each([
    [0.2, "low"],
    [0.5, "moderate"],
    [0.75, "high"],
    [0.92, "critical"],
  ])("maps ratio %p to %p", (ratio, bucket) => {
    expect(memoryPressureBucket(ratio)).toBe(bucket);
  });
});

describe("lowestMemorySample", () => {
  test("returns the lowest heap reading observed during the sampling window", async () => {
    jest.useFakeTimers();
    stubMemory({ limitMb: 1000, totalMb: 400, usedMb: 300 });
    const samplePromise = lowestMemorySample(1000, 250);
    stubMemory({ limitMb: 1000, totalMb: 400, usedMb: 250 });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(samplePromise).resolves.toEqual(expect.objectContaining({ usedMb: 250 }));
    jest.useRealTimers();
  });
});

describe("logMemorySample", () => {
  test("returns null and does not throw when heap data is unavailable", () => {
    expect(logMemorySample("init")).toBeNull();
  });

  test("returns the sample when heap data is available", () => {
    stubMemory({ limitMb: 1000, totalMb: 400, usedMb: 300 });
    const sample = logMemorySample("load-settle");
    expect(sample.usedMb).toBe(300);
  });
});

describe("startMemorySampling", () => {
  test("returns a no-op stopper when heap data is unavailable", () => {
    const stop = startMemorySampling(1000);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });

  test("samples on an interval and stops cleanly when heap data is available", () => {
    jest.useFakeTimers();
    stubMemory({ limitMb: 1000, totalMb: 400, usedMb: 300 });
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const stop = startMemorySampling(5000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
