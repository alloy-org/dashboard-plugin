// The contract that lets the wizard's shared Back and Next buttons run the current step's save-then-navigate
// handler while living outside that step's markup.
//
// This was previously done natively: each step rendered a <form id>, and the navigation buttons carried a
// matching form="" attribute so the browser routed their clicks to that form's submit event. Amplenote serves
// the dashboard from a sandboxed iframe without allow-forms, so the browser refuses the submission outright --
// "Blocked form submission to '' because the form's frame is sandboxed and the 'allow-forms' permission is not
// set" -- and because the submit event never fires, the step's onSubmit handler never runs and the wizard
// silently stays on the page. The sandbox is set by the host, so the fix is to stop asking for native
// submission at all: a step hands its handler up through onRegisterNavigate, and the buttons call it directly.

import { useEffect } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Publish a step's save-then-navigate handler to the wizard for as long as the step is mounted, and
//   withdraw it on unmount so the navigation never calls into a page the user has already left.
// @param {Function|null} onRegisterNavigate - Wizard callback receiving the handler, or null when unused.
// @param {Function} handleNavigate - Resolves once the step's pending edits saved and navigation may proceed.
export function useRegisteredNavigate(onRegisterNavigate, handleNavigate) {
  useEffect(() => {
    if (!onRegisterNavigate) return undefined;
    onRegisterNavigate(handleNavigate);
    return () => onRegisterNavigate(null);
  });
}
