// [GPT-5.6 Terra-authored file]
// Created: 2026-07-19 | Model: GPT-5.6 Terra
// Task: Admin-only incremental heap measurement panel for dashboard widgets.
// Prompt summary: "let an admin choose one component to load and display the memory consumed by it"
import { useCallback, useRef, useState } from "react";
import { DashboardLoadContext, useDashboardLoadTracker } from "dashboard-load-tracking";
import ConfigPopup from "config-popup";
import { WIDGET_REGISTRY } from "layout-profiles";
import { lowestMemorySample, readMemorySample } from "util/memory-instrumentation";
import "styles/widget-memory-measurement-popup.scss";

const SAMPLE_DURATION_MILLISECONDS = 3000;

// ------------------------------------------------------------------------------------------
// @desc Render an admin-only modal that establishes a heap baseline, mounts one real dashboard
//   widget with the production data already loaded by DashboardApp, then reports its approximate
//   retained JavaScript-heap delta. The host cannot force garbage collection, so the post-mount
//   number is the lowest sample observed during a short settling window rather than an exact value.
// @param {function(string): React.ReactNode} renderWidget - Renders the selected real widget cell.
// @param {function(): void} onClose - Closes the measurement panel.
export default function WidgetMemoryMeasurementPopup({ onClose, renderWidget }) {
  const supportedWidgets = WIDGET_REGISTRY;
  const [baselineSample, setBaselineSample] = useState(null);
  const [measurement, setMeasurement] = useState(null);
  const [mountedWidgetId, setMountedWidgetId] = useState(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState(supportedWidgets[0]?.widgetId || "");
  const [status, setStatus] = useState("idle");
  const measurementRunRef = useRef(0);
  const loadTracker = useDashboardLoadTracker(mountedWidgetId ? [mountedWidgetId] : [], {
    onSettle: ({ errorCount }) => {
      const measurementRun = measurementRunRef.current;
      if (errorCount > 0) {
        setStatus("error");
        return;
      }
      setStatus("sampling");
      lowestMemorySample(SAMPLE_DURATION_MILLISECONDS).then(afterSample => {
        if (measurementRun !== measurementRunRef.current) return;
        if (!afterSample || !baselineSample) {
          setStatus("unsupported");
          return;
        }
        setMeasurement({ afterSample, deltaMb: afterSample.usedMb - baselineSample.usedMb });
        setStatus("complete");
      });
    },
  });

  // ------------------------------------------------------------------------------------------
  // @desc Unmount any previous widget before recording a fresh baseline and mounting the selected
  //   widget. A new animation frame gives React a committed unmounted state before the next run.
  const beginMeasurement = useCallback(() => {
    measurementRunRef.current += 1;
    setBaselineSample(null);
    setMeasurement(null);
    setMountedWidgetId(null);
    setStatus("preparing");
    window.requestAnimationFrame(() => {
      const nextBaselineSample = readMemorySample();
      if (!nextBaselineSample) {
        setStatus("unsupported");
        return;
      }
      setBaselineSample(nextBaselineSample);
      setMountedWidgetId(selectedWidgetId);
      setStatus("mounting");
    });
  }, [selectedWidgetId]);

  // ------------------------------------------------------------------------------------------
  // @desc Stop observing the mounted widget and invalidate any pending asynchronous heap sample.
  const unmountWidget = useCallback(() => {
    measurementRunRef.current += 1;
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
                  : status === "sampling" ? "Widget mounted; sampling its heap footprint…"
                    : status === "mounting" || status === "preparing" ? "Preparing measurement…"
                      : "Choose a widget, then mount it to measure."}
          </span>
        </div>
        <p className="widget-memory-measurement-note">
          This is an approximation: the production embed cannot force garbage collection. Use DevTools'
          Collect garbage and heap snapshots for exact retained-size investigation.
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
