// Cover reading a Task Domain's hasConnectedCalendar flag from getTaskDomains() and building its settings URL.
import { jest } from "@jest/globals";
import { taskDomainCalendarSettingsUrl, taskDomainHasConnectedCalendar }
  from "dashboard/proposed-agenda/task-domain-calendar-connection";

// ----------------------------------------------------------------------------------------------
// @desc An app stub whose getTaskDomains() resolves to the given value.
// @param {*} domainsResponse - What getTaskDomains() resolves to
// @returns {object} App stub
function appWithDomains(domainsResponse) {
  return { getTaskDomains: jest.fn().mockResolvedValue(domainsResponse) };
}

describe("taskDomainHasConnectedCalendar", () => {
  it("reports the flag Amplenote gives the matching domain", async () => {
    const app = appWithDomains([{ hasConnectedCalendar: true, name: "Work", uuid: "dom-work" },
      { hasConnectedCalendar: false, name: "Home", uuid: "dom-home" }]);
    expect(await taskDomainHasConnectedCalendar(app, "dom-work")).toBe(true);
    expect(await taskDomainHasConnectedCalendar(app, "dom-home")).toBe(false);
  });

  it("treats a client that omits the flag as unknown rather than unconnected", async () => {
    const app = appWithDomains([{ name: "Work", uuid: "dom-work" }]);
    expect(await taskDomainHasConnectedCalendar(app, "dom-work")).toBeNull();
  });

  it("answers unknown without a domain, for a missing domain, or without getTaskDomains", async () => {
    expect(await taskDomainHasConnectedCalendar(appWithDomains([]), null)).toBeNull();
    expect(await taskDomainHasConnectedCalendar(appWithDomains([{ hasConnectedCalendar: false, uuid: "other" }]),
      "dom-work")).toBeNull();
    expect(await taskDomainHasConnectedCalendar(appWithDomains({ error: "offline" }), "dom-work")).toBeNull();
    expect(await taskDomainHasConnectedCalendar({}, "dom-work")).toBeNull();
  });
});

describe("taskDomainCalendarSettingsUrl", () => {
  it("expands the given domain on the Task Domains settings page", () => {
    expect(taskDomainCalendarSettingsUrl("dom work")).toBe("https://www.amplenote.com/task_calendar?taskDomainUUID=dom%20work");
  });
});
