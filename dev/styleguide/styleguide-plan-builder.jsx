// Style guide section that opens the real Plan Builder without an API key: a sample AI provider answers its prompts
// and an in-memory app holds its notes, so every page can be checked in any theme. Development only.
import { Button } from "dashboard/controls";
import PlanWizard from "dashboard/plan-wizard/plan-wizard";
import { useState } from "react";
import { MdAutoAwesome, MdKey } from "react-icons/md";
import { createSamplePlanApp } from "./sample-plan-app";
import { samplePlanProvider } from "./sample-plan-provider";

const MONTHS_PER_QUARTER = 3;
const SAMPLE_DOMAIN = { domainName: "Work", domainUuid: "sample-task-domain" };

// ----------------------------------------------------------------------------------------------
// @desc Two ways in: the Plan Builder with sample answers, and the screen a user with no AI provider sees.
// @returns {JSX.Element} The section body.
export function PlanBuilderSection() {
  const [ session, setSession ] = useState(null);
  // ----------------------------------------------------------------------------------------------
  // @desc Open the Plan Builder on a fresh sample app, with or without the sample provider installed.
  // @param {boolean} withSampleProvider - Answer prompts with sample data; false shows the missing-provider gate.
  const open = withSampleProvider => {
    if (withSampleProvider) globalThis.dashboardDevSampleProvider = samplePlanProvider;
    else delete globalThis.dashboardDevSampleProvider;
    setSession({ app: createSamplePlanApp(), key: Date.now() });
  };
  // ----------------------------------------------------------------------------------------------
  // @desc Close the Plan Builder and uninstall the sample provider.
  const close = () => {
    delete globalThis.dashboardDevSampleProvider;
    setSession(null);
  };
  const today = new Date();
  return (
    <div className="styleguide-sample-row">
      <Button Icon={ MdAutoAwesome } onClick={ () => open(true) } variant="raised">Open the Plan Builder</Button>
      <Button Icon={ MdKey } onClick={ () => open(false) } variant="outlined">Open it with no AI provider</Button>
      <span className="styleguide-note">Sample answers arrive after about a second; nothing is saved outside this page.</span>
      {
        session ? (
          <PlanWizard app={ session.app } { ...SAMPLE_DOMAIN } key={ session.key } onClose={ close }
            onFinished={ close } onOpenSettings={ close } quarter={ Math.floor(today.getMonth() / MONTHS_PER_QUARTER) + 1 }
            year={ today.getFullYear() } />
        ) : null
      }
    </div>
  );
}
