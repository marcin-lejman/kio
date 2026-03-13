import sanitize from "sanitize-html";

/**
 * Clean messy verdict HTML (Word/PDF export) into semantic, consistently styled markup.
 * Strips all inline styles, removes junk tags, keeps only structural/semantic elements.
 */
export function cleanVerdictHtml(dirty: string): string {
  // Step 1: sanitize — keep only semantic tags, strip all attributes except href
  let clean = sanitize(dirty, {
    allowedTags: [
      "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "u", "sub", "sup",
      "ul", "ol", "li",
      "table", "thead", "tbody", "tr", "th", "td",
      "a", "blockquote", "pre",
    ],
    allowedAttributes: {
      a: ["href"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    // Convert <span style="font-weight:bold"> to <strong>, <span style="font-style:italic"> to <em>
    transformTags: {
      span: (tagName, attribs) => {
        const style = (attribs.style || "").toLowerCase();
        if (style.includes("font-weight") && (style.includes("bold") || style.includes("700") || style.includes("800") || style.includes("900"))) {
          return { tagName: "strong", attribs: {} };
        }
        if (style.includes("font-style") && style.includes("italic")) {
          return { tagName: "em", attribs: {} };
        }
        if (style.includes("text-decoration") && style.includes("underline")) {
          return { tagName: "u", attribs: {} };
        }
        // Unwrap plain spans — content passes through, tag is removed
        return { tagName: "", attribs: {} };
      },
      font: () => ({ tagName: "", attribs: {} }),
      div: () => ({ tagName: "p", attribs: {} }),
      b: () => ({ tagName: "strong", attribs: {} }),
      i: () => ({ tagName: "em", attribs: {} }),
    },
  });

  // Step 2: collapse runs of <br/> into paragraph breaks
  clean = clean.replace(/(<br\s*\/?>[\s]*){3,}/gi, "</p><p>");

  // Step 3: remove empty paragraphs and tags
  clean = clean.replace(/<p>\s*<\/p>/gi, "");
  clean = clean.replace(/<strong>\s*<\/strong>/gi, "");
  clean = clean.replace(/<em>\s*<\/em>/gi, "");
  clean = clean.replace(/<u>\s*<\/u>/gi, "");

  // Step 4: collapse adjacent identical inline tags: <strong>A</strong><strong>B</strong> → <strong>AB</strong>
  clean = clean.replace(/<\/strong>\s*<strong>/gi, " ");
  clean = clean.replace(/<\/em>\s*<em>/gi, " ");

  // Step 5: remove <sub>-</sub> artifacts (common in KIO HTML)
  clean = clean.replace(/<sub>\s*-\s*<\/sub>/gi, "");

  return clean.trim();
}
