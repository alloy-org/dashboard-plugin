// Verify the standalone planning service works in a host without React, require, or browser globals.

import { assertHostPluginBoundary } from "../host-plugin-boundary.js";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";

// ----------------------------------------------------------------------------------------------
// @desc Bundle the actual service graph and exercise reads/writes without mounting any dashboard code.
test("planning service bundles and persists goals in a bare host context", async () => {
  const buildScript = `
    import esbuild from "esbuild";
    import path from "node:path";
    import { createLibImportsPlugin } from "./lib-imports-plugin.js";
    const result = await esbuild.build({
      bundle: true, define: { "process.env.NODE_ENV": '"production"' },
      entryPoints: ["lib/plan-wizard/plan-wizard-service.js"], format: "iife", globalName: "PlanWizard",
      metafile: true, packages: "external", plugins: [createLibImportsPlugin(path.resolve("lib"))], write: false,
    });
    process.stdout.write(JSON.stringify({ code: result.outputFiles[0].text, metadata: result.metafile }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", buildScript], { encoding: "utf8" }));
  expect(() => assertHostPluginBoundary(result.metadata)).not.toThrow();
  const service = runInNewContext(`${ result.code }\nPlanWizard;`, {});
  const app = createPlanWizardApp();
  const scope = { domainName: "Work", domainUuid: "domain-work", quarter: 4, year: 2026 };
  const goals = [{ capturedAt: "2026-09-06", goalRank: 1, goalText: "Grow revenue", userCategoryEm: "work" }];
  await expect(service.savePlanGoals(app, { ...scope, goals })).resolves.toMatchObject({ goals: [expect.objectContaining({ goalText: "Grow revenue" })] });
  expect((await service.readPlanGoals(app, scope)).goals[0].goalText).toBe("Grow revenue");
});
