// [Claude claude-opus-5 (1M context)] Generated tests for: evaluateDebugExpression (host-side evaluation of
//   Debug Console expressions), runDebugEvaluationSession (its prompt → evaluate → show-result loop), and
//   servedFromDevServer (the runtime dev-origin check that also enables the Debug Console).
import { jest } from "@jest/globals";
import { runDebugEvaluationSession } from "dashboard/debug-evaluate-service";
import { evaluateDebugExpression } from "util/debug-evaluate";
import { servedFromDevServer } from "util/dev-environment";

// ----------------------------------------------------------------------------------------------
// @desc Point window.location at a fabricated hostname/port for one servedFromDevServer assertion.
// @param {Object} locationFields - { hostname, port } to expose; both default to empty strings.
function stubPageLocation(locationFields) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: "", port: "", ...locationFields },
    writable: true,
  });
}

describe("evaluateDebugExpression", () => {
  it("evaluates a bare expression and reports the value's type", async () => {
    const evaluation = await evaluateDebugExpression({}, "1 + 2");
    expect(evaluation.error).toBeNull();
    expect(evaluation.output).toBe("3");
    expect(evaluation.resultType).toBe("number");
  });

  it("awaits an app call and serializes the note handle it resolves to", async () => {
    const app = { findNote: async ({ uuid }) => ({ name: "Sample", uuid }) };
    const evaluation = await evaluateDebugExpression(app, 'await app.findNote({ uuid: "note-1" })');
    expect(evaluation.error).toBeNull();
    expect(JSON.parse(evaluation.output)).toEqual({ name: "Sample", uuid: "note-1" });
    expect(evaluation.resultType).toBe("Object");
  });

  it("runs a multi-line statement body that returns its own value", async () => {
    const app = { count: 4 };
    const evaluation = await evaluateDebugExpression(app, "const doubled = app.count * 2;\nreturn doubled;");
    expect(evaluation.error).toBeNull();
    expect(evaluation.output).toBe("8");
  });

  it("labels circular references rather than throwing on serialization", async () => {
    const evaluation = await evaluateDebugExpression({}, "const a = { name: 'a' }; a.self = a; return a;");
    expect(evaluation.error).toBeNull();
    expect(evaluation.output).toContain('"self": "[Circular]"');
  });

  it("distinguishes an empty string result from undefined", async () => {
    const emptyStringEvaluation = await evaluateDebugExpression({}, "''");
    expect(emptyStringEvaluation.output).toBe('""');
    const undefinedEvaluation = await evaluateDebugExpression({}, "undefined");
    expect(undefinedEvaluation.output).toBe("undefined");
    expect(undefinedEvaluation.resultType).toBe("undefined");
  });

  it("reports a syntax error as an error result instead of throwing", async () => {
    const evaluation = await evaluateDebugExpression({}, "const = ;");
    expect(evaluation.error).toMatch(/Could not compile/);
    expect(evaluation.resultType).toBe("error");
  });

  it("reports a thrown app failure with its name and message", async () => {
    const app = { findNote: async () => { throw new TypeError("no such note"); } };
    const evaluation = await evaluateDebugExpression(app, "await app.findNote({})");
    expect(evaluation.error).toMatch(/TypeError: no such note/);
    expect(evaluation.output).toBe("");
    expect(evaluation.resultType).toBe("error");
  });

  it("returns a 'none' result when nothing was entered", async () => {
    const evaluation = await evaluateDebugExpression({}, "   ");
    expect(evaluation.resultType).toBe("none");
    expect(evaluation.error).toMatch(/Nothing was entered/);
  });
});

describe("runDebugEvaluationSession", () => {
  it("sends the submitted expression to the host and shows the result it returns", async () => {
    const alert = jest.fn(async () => null);
    const debugEvaluate = jest.fn(async () => ({ error: null, expression: "1 + 1", output: "2", resultType: "number" }));
    const app = { alert, debugEvaluate, prompt: jest.fn(async () => "1 + 1") };

    await runDebugEvaluationSession(app);

    expect(debugEvaluate).toHaveBeenCalledWith("1 + 1");
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toContain("2");
    expect(alert.mock.calls[0][1].preface).toBe("1 + 1");
  });

  it("prompts again while the result dialog's run-again action is chosen", async () => {
    const prompt = jest.fn()
      .mockResolvedValueOnce("app.settings")
      .mockResolvedValueOnce(null);
    const alert = jest.fn(async () => "run-again");
    const app = { alert, debugEvaluate: jest.fn(async () => ({ error: null, expression: "app.settings",
      output: "{}", resultType: "Object" })), prompt };

    await runDebugEvaluationSession(app);

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("surfaces a bridge failure envelope as the result instead of pretending it evaluated", async () => {
    const alert = jest.fn(async () => null);
    const app = { alert, debugEvaluate: jest.fn(async () => ({ embedCallFailed: true, error: "host offline" })),
      prompt: jest.fn(async () => "app.getNoteContent({})") };

    await runDebugEvaluationSession(app);

    expect(alert.mock.calls[0][0]).toContain("host offline");
  });

  it("does not call the host when the prompt is cancelled", async () => {
    const debugEvaluate = jest.fn();
    const app = { alert: jest.fn(), debugEvaluate, prompt: jest.fn(async () => null) };

    await runDebugEvaluationSession(app);

    expect(debugEvaluate).not.toHaveBeenCalled();
  });
});

describe("servedFromDevServer", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation, writable: true });
  });

  it("recognizes loopback hostnames on any port", () => {
    stubPageLocation({ hostname: "localhost", port: "3000" });
    expect(servedFromDevServer()).toBe(true);
    stubPageLocation({ hostname: "127.0.0.1", port: "8080" });
    expect(servedFromDevServer()).toBe(true);
  });

  it("recognizes a LAN address on a dev server port, the localhost:3000 collision workaround", () => {
    stubPageLocation({ hostname: "192.168.1.42", port: "3000" });
    expect(servedFromDevServer()).toBe(true);
    stubPageLocation({ hostname: "10.0.0.8", port: "3001" });
    expect(servedFromDevServer()).toBe(true);
  });

  it("rejects a LAN address on an unrelated port and any public host", () => {
    stubPageLocation({ hostname: "192.168.1.42", port: "8080" });
    expect(servedFromDevServer()).toBe(false);
    stubPageLocation({ hostname: "www.amplenote.com", port: "" });
    expect(servedFromDevServer()).toBe(false);
  });

  it("rejects the production embed, whose data: URL carries no hostname", () => {
    stubPageLocation({ hostname: "", port: "" });
    expect(servedFromDevServer()).toBe(false);
  });
});
