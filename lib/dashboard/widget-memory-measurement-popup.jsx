// [GPT-5.6 Terra-authored file]
// Created: 2026-07-19 | Model: GPT-5.6 Terra
// Task: Admin-only incremental heap measurement panel for dashboard widgets.
// Prompt summary: "let an admin choose one component to load and display the memory consumed by it"
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DASHBOARD_WIDGET_LOADED_EVENT, DashboardLoadContext, useDashboardLoadTracker } from "dashboard-load-tracking";
import ConfigPopup from "config-popup";
import { WIDGET_REGISTRY } from "layout-profiles";
import { collectGarbageIfAvailable, lowestMemorySample } from "util/memory-instrumentation";
import "styles/widget-memory-measurement-popup.scss";

const SAMPLE_DURATION_MILLISECONDS = 3000;

// ------------------------------------------------------------------------------------------
// @desc Render an admin-only modal that establishes a heap baseline after DashboardApp unmounts its
//   normal widget grid, mounts one real dashboard widget with shared production data retained, then
//   reports its approximate retained JavaScript-heap delta. The host cannot force garbage collection,
//   so both baseline and post-mount values are minimums observed during short settling windows.
// @param {function(string): React.ReactNode} renderWidget - Renders the selected real widget cell.
// @param {function(): void} onClose - Closes the measurement panel.
export default function WidgetMemoryMeasurementPopup({ onClose, renderWidget }) {
  const supportedWidgets = WIDGET_REGISTRY;
  const [baselineSample, setBaselineSample] = useState(null);
  const [garbageCollectionRequested, setGarbageCollectionRequested] = useState(false);
  const [measurement, setMeasurement] = useState(null);
  const [mountedWidgetId, setMountedWidgetId] = useState(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState(supportedWidgets[0]?.widgetId || "");
  const [status, setStatus] = useState("idle");
  const awaitingWidgetIdRef = useRef(null);
  const baselineSampleRef = useRef(null);
  const measurementRunRef = useRef(0);
  baselineSampleRef.current = baselineSample;
  const loadTracker = useDashboardLoadTracker(mountedWidgetId ? [mountedWidgetId] : [], {
    onSettle: ({ errorCount }) => {
      if (errorCount > 0) {
        awaitingWidgetIdRef.current = null;
        setStatus("error");
      } else {
        setStatus("waitingForLoadedEvent");
      }
    },
  });

  // ------------------------------------------------------------------------------------------
  // @desc Start post-load heap sampling after the selected widget broadcasts its one-shot loaded
  //   event. This waits for data readiness rather than React mount settlement.
  const sampleAfterWidgetLoaded = useCallback((measurementRun) => {
    setStatus("sampling");
    setGarbageCollectionRequested(collectGarbageIfAvailable());
    lowestMemorySample(SAMPLE_DURATION_MILLISECONDS).then(afterSample => {
      const currentBaselineSample = baselineSampleRef.current;
      if (measurementRun !== measurementRunRef.current) return;
      if (!afterSample || !currentBaselineSample) {
        setStatus("unsupported");
        return;
      }
      setMeasurement({ afterSample, deltaMb: afterSample.usedMb - currentBaselineSample.usedMb });
      setStatus("complete");
    });
  }, []);

  useEffect(() => {
    const handleWidgetLoaded = (event) => {
      const detail = event.detail || {};
      if (!awaitingWidgetIdRef.current || detail.widgetId !== awaitingWidgetIdRef.current) return;
      const measurementRun = measurementRunRef.current;
      awaitingWidgetIdRef.current = null;
      if (detail.outcome === "error") {
        setStatus("error");
        return;
      }
      sampleAfterWidgetLoaded(measurementRun);
    };
    window.addEventListener(DASHBOARD_WIDGET_LOADED_EVENT, handleWidgetLoaded);
    return () => window.removeEventListener(DASHBOARD_WIDGET_LOADED_EVENT, handleWidgetLoaded);
  }, [sampleAfterWidgetLoaded]);

  // ------------------------------------------------------------------------------------------
  // @desc Unmount any prior measured widget, then observe a clean zero-widget baseline before
  //   mounting the selection. A synchronous baseline commit plus two animation frames ensures the
  //   baseline is visible and the browser has had a paint opportunity before the widget mounts.
  const beginMeasurement = useCallback(() => {
    measurementRunRef.current += 1;
    const measurementRun = measurementRunRef.current;
    setBaselineSample(null);
    setMeasurement(null);
    setMountedWidgetId(null);
    setStatus("clearing");
    window.requestAnimationFrame(() => {
      const requestedCollection = collectGarbageIfAvailable();
      lowestMemorySample(SAMPLE_DURATION_MILLISECONDS).then(nextBaselineSample => {
        if (measurementRun !== measurementRunRef.current) return;
        if (!nextBaselineSample) {
          setStatus("unsupported");
          return;
        }
        flushSync(() => {
          setBaselineSample(nextBaselineSample);
          setGarbageCollectionRequested(requestedCollection);
          setStatus("baselineReady");
        });
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (measurementRun !== measurementRunRef.current) return;
            awaitingWidgetIdRef.current = selectedWidgetId;
            setStatus("mounting");
            setMountedWidgetId(selectedWidgetId);
          });
        });
      });
    });
  }, [selectedWidgetId]);

  // ------------------------------------------------------------------------------------------
  // @desc Stop observing the mounted widget and invalidate any pending asynchronous heap sample.
  const unmountWidget = useCallback(() => {
    measurementRunRef.current += 1;
    awaitingWidgetIdRef.current = null;
    setMountedWidgetId(null);
    setStatus("idle");
  }, []);

  const selectedWidget = supportedWidgets.find(widget => widget.widgetId === selectedWidgetId);
  const deltaLabel = measurement ? `${ measurement.deltaMb >= 0 ? "+" : "" }${ measurement.deltaMb.toFixed(1) } MB` : "—";
  return (
    <ConfigPopup title="🧠 Widget Memory Measurement" onCancel={onClose} onSubmit={onClose} submitLabel="Close">
      <div className="widget-memory-measurement">
        <p className="widget-memory-measurement-description">
          Measures the selected widget on top of the dashboard's already-loaded shared data.
        </p>
        <label className="widget-memory-measurement-label" htmlFor="widget-memory-selector">Widget</label>
        <select
          className="widget-memory-measurement-select"
          id="widget-memory-selector"
          value={selectedWidgetId}
          onChange={event => setSelectedWidgetId(event.target.value)}
          disabled={!!mountedWidgetId}
        >
          {supportedWidgets.map(widget => (
            <option key={widget.widgetId} value={widget.widgetId}>{widget.icon} {widget.visibleTitle || widget.name}</option>
          ))}
        </select>
        <div className="widget-memory-measurement-actions">
          <button className="widget-memory-measurement-button" type="button" onClick={beginMeasurement}>
            {mountedWidgetId ? "Remount and measure" : "Mount and measure"}
          </button>
          <button className="widget-memory-measurement-button" type="button" onClick={unmountWidget}
            disabled={!mountedWidgetId}>Unmount</button>
        </div>
        <div className="widget-memory-measurement-results" aria-live="polite">
          <span>Baseline: {baselineSample ? `${ baselineSample.usedMb } MB` : "—"}</span>
          <span>After load: {measurement ? `${ measurement.afterSample.usedMb } MB` : "—"}</span>
          <strong>Incremental footprint: {deltaLabel}</strong>
          <span className="widget-memory-measurement-status">
            {status === "complete" ? `Sampled for ${ SAMPLE_DURATION_MILLISECONDS / 1000 } seconds after mount.`
              : status === "error" ? "The widget failed to mount; no measurement was recorded."
                : status === "unsupported" ? "This runtime does not expose performance.memory."
                  : status === "sampling" ? "Widget loaded; sampling its heap footprint…"
                    : status === "clearing" ? "Widget grid is cleared; sampling the zero-widget baseline…"
                      : status === "baselineReady" ? "Baseline captured before widget mount."
                      : status === "mounting" ? "Mounting selected widget…"
                        : status === "waitingForLoadedEvent" ? "Widget mounted; waiting for its loaded event…"
                      : "Choose a widget, then mount it to measure."}
          </span>
        </div>
        <p className="widget-memory-measurement-note">
          {garbageCollectionRequested ? "window.gc() was requested before sampling."
            : "window.gc() is unavailable; launch Chromium with --js-flags=--expose-gc to enable it."}
        </p>
        {mountedWidgetId ? (
          <div className="widget-memory-measurement-widget">
            <h4>{selectedWidget?.icon} {selectedWidget?.visibleTitle || selectedWidget?.name}</h4>
            <DashboardLoadContext.Provider value={loadTracker}>
              {renderWidget(mountedWidgetId)}
            </DashboardLoadContext.Provider>
          </div>
        ) : null}
      </div>
    </ConfigPopup>
  );
}
