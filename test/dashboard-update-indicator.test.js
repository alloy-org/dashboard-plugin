// Exercise the plugin update bridge and real tooltip interactions without a live Amplenote account.
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import plugin from "plugin";

const realTippy = jest.requireActual("../node_modules/tippy.js/dist/tippy.cjs.js").default;
await jest.unstable_mockModule("tippy.js", () => ({ default: realTippy }));
const { default: DashboardUpdateIndicator } = await import("dashboard-update-indicator");
const updateMessage = 'A newer version of Dashboard is available. Visit Jots and click "Update Mission Control Dashboard" to get the latest.';

let container, root;

// ----------------------------------------------------------------------------------------------
// @desc Mount the indicator and settle its background update check.
// @param {Object} app - Dashboard app bridge, or a local stub when exercising unavailable APIs.
// @returns {Promise<void>}
async function renderIndicator(app) {
  await act(async () => { root.render(createElement(DashboardUpdateIndicator, { app })); });
}

// ----------------------------------------------------------------------------------------------
// @desc Cover updates, unavailable APIs, failures, tooltip access, and click navigation to Jots across the bridge.
describe("Dashboard update indicator", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it.each(["mouseenter", "focusin", "click"])("shows the exact update instructions on %s", async eventName => {
    const context = { checkForUpdates: jest.fn().mockResolvedValue(true) };
    const navigate = jest.fn().mockResolvedValue(true);
    const app = { checkForUpdates: () => plugin.onEmbedCall({ context }, "checkForUpdates"),
      navigate: url => plugin.onEmbedCall({ navigate }, "navigate", url) };
    await renderIndicator(app);
    expect(context.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(context.checkForUpdates.mock.contexts[0]).toBe(context);
    const button = container.querySelector("button");
    expect(button.getAttribute("aria-label")).toBe(updateMessage);
    const reference = button.parentElement;
    await act(async () => {
      const target = eventName === "mouseenter" ? reference : button;
      target.dispatchEvent(new MouseEvent(eventName, { bubbles: true }));
    });
    expect(reference._tippy.state.isVisible).toBe(true);
    expect(document.querySelector(".tippy-content").textContent).toBe(updateMessage);
    if (eventName === "click") {
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("https://www.amplenote.com/notes/jots");
    } else {
      expect(navigate).not.toHaveBeenCalled();
    }
  });

  it.each([false, null, undefined, { error: "offline" }, "true"])("hides unconfirmed update result %p", async result => {
    const context = { checkForUpdates: jest.fn().mockResolvedValue(result) };
    await renderIndicator({ checkForUpdates: () => plugin.onEmbedCall({ context }, "checkForUpdates") });
    expect(container.querySelector("button")).toBeNull();
  });

  it("handles a plugin installed without a public source and a dev app without the bridge", async () => {
    expect(await plugin.onEmbedCall({ context: {} }, "checkForUpdates")).toBe(false);
    expect(await plugin.onEmbedCall({}, "checkForUpdates")).toBe(false);
    await renderIndicator({});
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps host failures and bridge rejections hidden", async () => {
    const checkForUpdates = jest.fn().mockRejectedValue(new Error("offline"));
    const hostApp = { context: { checkForUpdates } };
    await renderIndicator({ checkForUpdates: () => plugin.onEmbedCall(hostApp, "checkForUpdates") });
    expect(container.querySelector("button")).toBeNull();
    await renderIndicator({ checkForUpdates });
    expect(container.querySelector("button")).toBeNull();
  });

  it("ignores a pending result from a previous app instance", async () => {
    let resolveCheck;
    const pendingCheck = new Promise(resolve => { resolveCheck = resolve; });
    await renderIndicator({ checkForUpdates: () => pendingCheck });
    expect(container.querySelector("button")).toBeNull();
    await renderIndicator({ checkForUpdates: async () => false });
    await act(async () => { resolveCheck(true); });
    expect(container.querySelector("button")).toBeNull();
  });
});
