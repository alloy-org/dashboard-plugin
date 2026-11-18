// SVG markup for a react-icons icon, for the few places that build HTML strings outside React (rendered markdown
// footnote indicators). The icon still comes from react-icons/md; this only serializes the element it returns.

const DEFAULT_ICON_SIZE = 14;

// ----------------------------------------------------------------------------------------------
// @desc SVG markup for a react-icons component, aria-hidden and drawn in the current text color.
// @param {Function} Icon - A react-icons component, e.g. MdLink.
// @param {Object} [options] - { className, size }: class on the svg, and its size in px (default 14).
// @returns {string} The svg element as HTML.
export function svgMarkupFromIcon(Icon, { className = "material-icon", size = DEFAULT_ICON_SIZE } = {}) {
  const element = Icon({});
  const viewBox = element.props.attr?.viewBox || "0 0 24 24";
  return `<svg aria-hidden="true" class="${ attributeValueFromText(className) }" fill="currentColor" focusable="false" `
    + `height="${ size }" viewBox="${ attributeValueFromText(viewBox) }" width="${ size }">`
    + `${ markupFromChildren(element.props.children) }</svg>`;
}

// ----------------------------------------------------------------------------------------------
// @desc Escape text for a double-quoted HTML attribute.
// @param {*} text - Attribute text.
// @returns {string} Escaped text.
function attributeValueFromText(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

// ----------------------------------------------------------------------------------------------
// @desc Markup for an icon's child elements (paths, circles, groups), recursively.
// @param {*} children - React children of the icon.
// @returns {string} Markup.
function markupFromChildren(children) {
  return [].concat(children || []).filter(child => child && typeof child.type === "string").map(child => {
    const { children: grandchildren, ...attributes } = child.props;
    const attributeMarkup = Object.entries(attributes).map(([ name, value ]) => {
      const attributeName = name.replace(/[A-Z]/g, letter => `-${ letter.toLowerCase() }`);
      return ` ${ attributeName }="${ attributeValueFromText(value) }"`;
    }).join("");
    return `<${ child.type }${ attributeMarkup }>${ markupFromChildren(grandchildren) }</${ child.type }>`;
  }).join("");
}
