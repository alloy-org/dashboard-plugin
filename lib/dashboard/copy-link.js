// [claude-sonnet-4-6-authored file]
// Prompt summary: "extract CopyPluginLink into a standalone reusable component for copying URLs in sandboxed iframes"

import { createElement, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Anchor that copies its href to the clipboard on click instead of navigating.
// Falls back silently when the Clipboard API is unavailable. Intended for use inside sandboxed
// iframes where external navigation is blocked. Shows a brief confirmation after a successful copy.
// @param {object} props
// @param {string} props.url - The URL to copy and use as href.
// @param {string} props.children - Link label text.
// @param {string} [props.className] - Optional CSS class.
// @param {number} [props.confirmationMs=2500] - How long to show the "copied" state.
// [Claude claude-sonnet-4-6] Task: reusable copy-to-clipboard link for sandboxed iframe contexts
// Prompt: "make CopyPluginLink its own standalone file since other contexts (API key dialog) may also need it"
export default function CopyLink({ url, children, className, confirmationMs = 2500 }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), confirmationMs);
    } catch {
      // Clipboard API unavailable — no-op; the href and title tooltip still expose the URL.
    }
  };

  return createElement('a', {
    href: url,
    className,
    onClick: handleClick,
    title: copied ? 'Copied to clipboard!' : `Click to copy: ${ url }`,
  }, copied ? '\u2713 Link copied!' : children);
}
