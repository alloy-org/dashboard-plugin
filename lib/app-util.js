import { logIfEnabled } from "./util/log"

// --------------------------------------------------------------------------
// Deploy every trick in the book to try to form jsonText into something that can be parsed by JSON.parse
// Handles both single objects (e.g., { jsonStuff: true }) and arrays (e.g., [{ jsonStuff: true }])
export function jsonFromAiText(jsonText) {
  let json;

  // Trim and look for the root structure type
  const trimmed = jsonText.trim();

  // Determine if we're dealing with an array or object by looking at what character comes first
  // (ignoring markdown code fences and other preamble)
  let arrayStart = trimmed.indexOf("[");
  let objectStart = trimmed.indexOf("{");

  // Check if there's a closing bracket without an opening - this helps identify the intended type
  const hasClosingBrace = trimmed.includes("}");
  const hasClosingBracket = trimmed.includes("]");

  let isArray = false;
  let jsonStart = -1;

  // If we have a closing } but no opening {, it's meant to be an object
  if (hasClosingBrace && objectStart === -1) {
    jsonText = `{${ jsonText }`;
    objectStart = 0;
  }

  // If we have a closing ] but no opening [, it's meant to be an array
  if (hasClosingBracket && arrayStart === -1) {
    jsonText = `[${ jsonText }`;
    arrayStart = 0;
  }

  // Re-check positions after potentially adding opening brackets
  arrayStart = jsonText.indexOf("[");
  objectStart = jsonText.indexOf("{");

  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    // Array comes first or is the only structure
    isArray = true;
    jsonStart = arrayStart;
  } else if (objectStart !== -1) {
    // Object comes first
    isArray = false;
    jsonStart = objectStart;
  } else {
    // No opening bracket found, assume object
    jsonText = `{${ jsonText }}`;
    jsonStart = 0;
    isArray = false;
  }

  // Extract based on detected type
  const endChar = isArray ? "]" : "}";
  let jsonEnd = jsonText.lastIndexOf(endChar);

  if (jsonEnd === -1) {
    // If we didn't finish the JSON, there might still be usable signal if we can adapt it to be parseable
    if (jsonText[jsonText.length - 1] === ",") jsonText = jsonText.substring(0, jsonText.length - 1);

    // Fix missing brackets for nested structures
    const missingArrayClose = jsonText.includes("[") && !jsonText.includes("]");
    const missingObjectClose = jsonText.includes("{") && !jsonText.includes("}");

    if (missingArrayClose && missingObjectClose) {
      // Both array and object are open, close both (object first, then array)
      jsonText += "}]";
    } else if (missingArrayClose) {
      jsonText += "]";
    } else if (missingObjectClose) {
      jsonText += "}";
    } else {
      // No nested brackets found, just close the main structure
      jsonText = isArray ? `${ jsonText }]` : `${ jsonText }}`;
    }
  } else {
    jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
  }

  try {
    json = JSON.parse(jsonText);
    return json;
  } catch (e) {
    const parseTextWas = jsonText;
    jsonText = balancedJsonFromString(jsonText);
    logIfEnabled(`Failed to parse jsonText START:\n${ parseTextWas }\nEND\n due to ${ e }. Attempted rebalance yielded: ${ jsonText } (original size ${ parseTextWas.length || "(null)" }, rebalance size ${ jsonText?.length || "(0)" })`);
    try {
      json = JSON.parse(jsonText);
      return json;
    } catch (e)  {
      logIfEnabled("Rebalanced jsonText still fails", e);
    }

    // Fix possibly unescaped quotes and newlines
    let reformattedText = jsonText.replace(/"""/g, `"\\""`).replace(/"\n/g, `"\\n`);

    // Fix missing opening quote on property names (e.g., {result": -> {"result":)
    reformattedText = reformattedText.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)":/g, '$1"$2":');

    // Fix potential use of single or unicode quote characters for array members when JSON.parse expects doubles
    reformattedText = reformattedText.replace(/\n\s*['“”]/g, `\n"`).
    replace(/['“”],\s*\n/g, `",\n`).replace(/['“”]\s*([\n\]])/, `"$1`);

    if (reformattedText !== jsonText) {
      try {
        json = JSON.parse(reformattedText);
        return json;
      } catch (e) {
        logIfEnabled("Reformatted text still fails", e)
      }
    }
  }

  return null;
}

// --------------------------------------------------------------------------
export function noteUrlFromUUID(noteUUID) {
  return `https://www.amplenote.com/notes/${ noteUUID }`;
}

// --------------------------------------------------------------------------
export function pluralize(number, noun) {
  // Convert string numbers to actual numbers
  const numValue = typeof number === 'string' ? parseFloat(number) : number;

  if (!Number.isInteger(numValue) && !Number.isFinite(numValue)) {
    throw new Error("pluralize() requires an integer to be given");
  }

  const numberPart = numValue.toLocaleString();
  return `${ numberPart } ${ noun }${ parseInt(numValue) === 1 ? "" : "s" }`;
}

// --------------------------------------------------------------------------
// Local helper functions
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
function balancedJsonFromString(string) {
  const jsonStart = string.indexOf("{"); // As of Dec 2023, WBH observes that OpenAI is fond of sending back strings like "data: {\"choices\":[{\"finish_reason\":\"length\"}]}\n\n"
  if (jsonStart === -1) return null;
  const jsonAndAfter = string.substring(jsonStart).trim();
  const pendingBalance = [];
  let jsonText = "";
  for (const char of jsonAndAfter) {
    jsonText += char;
    if (char === "{") {
      pendingBalance.push("}");
    } else if (char === "}") {
      if (pendingBalance[pendingBalance.length - 1] === "}") pendingBalance.pop();
    } else if (char === "[") {
      pendingBalance.push("]");
    } else if (char === "]") {
      if (pendingBalance[pendingBalance.length - 1] === "]") pendingBalance.pop();
    }
    if (pendingBalance.length === 0) break;
  }

  if (pendingBalance.length) {
    logIfEnabled("Found", pendingBalance.length, "characters to append to balance", jsonText, ". Adding ", pendingBalance.reverse().join(""));
    jsonText += pendingBalance.reverse().join("");
  }
  return jsonText;
}
