// Share a textarea that fits its content as text or available width changes across wizard pages.

import { useLayoutEffect, useRef } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Grow or shrink a one-row textarea to fit restored text, edits, and changes in available width.
// @param {object} params - An object with the following properties:
//   - {boolean} shouldAutoFocus - Whether to focus the field when requested.
//   - {string} value - Controlled text displayed in the field.
//   - {object} inputProps - Remaining textarea attributes and event handlers, including its class name.
// @returns {JSX.Element} A textarea whose height follows its content.
export default function ExpandingTextarea({ shouldAutoFocus, value, ...inputProps }) {
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    let previousWidth = input.clientWidth;

    // ----------------------------------------------------------------------------------------------
    // @desc Reset the height so shorter text can shrink, then fit the content plus the textarea's borders.
    const resizeInput = () => {
      input.style.height = "auto";
      input.style.height = `${ input.scrollHeight + input.offsetHeight - input.clientHeight }px`;
    };

    resizeInput();
    if (typeof ResizeObserver === "undefined") return undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (input.clientWidth === previousWidth) return;
      previousWidth = input.clientWidth;
      resizeInput();
    });
    resizeObserver.observe(input);
    return () => resizeObserver.disconnect();
  }, [value]);

  useLayoutEffect(() => {
    if (!shouldAutoFocus) return;
    inputRef.current?.focus();
  }, [shouldAutoFocus]);

  return <textarea { ...inputProps } ref={ inputRef } rows={ 1 } value={ value } />;
}
