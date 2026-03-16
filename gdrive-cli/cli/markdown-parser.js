/**
 * Markdown to Google Docs API requests converter
 *
 * Converts markdown to Google Docs batchUpdate requests with proper indices
 */

import { marked } from 'marked';

/**
 * Decode HTML entities
 */
function decodeEntities(text) {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Apply smart typography (SmartyPants-style)
 * - Straight quotes → curly quotes
 * - -- → en-dash, --- → em-dash (but not HR or table syntax)
 * - ... → ellipsis
 */
function smartTypography(text) {
  // Process line by line to preserve table delimiter rows
  return text.split('\n').map(line => {
    // Skip table delimiter rows (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
      return line;
    }
    // Skip HR lines (---, ___, ***)
    if (/^(\-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      return line;
    }

    return line
      // Em-dash: only when surrounded by text
      .replace(/(\S)---(\S)/g, '$1\u2014$2')
      .replace(/(\S)---(\s)/g, '$1\u2014$2')
      .replace(/(\s)---(\S)/g, '$1\u2014$2')
      // En-dash: between numbers or surrounded by text
      .replace(/(\d)--(\d)/g, '$1\u2013$2')
      .replace(/(\S)--(\S)/g, '$1\u2013$2')
      // Ellipsis
      .replace(/\.\.\./g, '\u2026')
      // Opening double quote (after space or start)
      .replace(/(^|[\s(])"(\S)/g, '$1\u201C$2')
      // Closing double quote
      .replace(/"/g, '\u201D')
      // Apostrophe in contractions
      .replace(/(\w)'(\w)/g, '$1\u2019$2')
      // Opening single quote (after space)
      .replace(/(^|[\s(])'(\S)/g, '$1\u2018$2')
      // Remaining single quotes → closing
      .replace(/'/g, '\u2019');
  }).join('\n');
}

/**
 * Parse markdown and generate Google Docs API requests
 * @param {string} markdown - Input markdown text
 * @returns {{ text: string, requests: Array }} Plain text and formatting requests
 */
export function parseMarkdown(markdown, startIndex = 1) {
  const tokens = marked.lexer(markdown);
  let text = '';
  let requests = [];
  let tables = []; // Collect table info for special handling
  let currentIndex = startIndex;

  for (const token of tokens) {
    const result = processToken(token, currentIndex);
    const resultText = decodeEntities(result.text);
    text += resultText;
    requests.push(...result.requests);

    // Collect table info for second-pass processing
    if (result.tableInfo) {
      result.tableInfo.textIndex = currentIndex;
      tables.push(result.tableInfo);
    }

    currentIndex += resultText.length;
  }

  return { text, requests, tables };
}

/**
 * Process a single markdown token
 */
function processToken(token, startIndex) {
  switch (token.type) {
    case 'heading':
      return processHeading(token, startIndex);
    case 'paragraph':
      return processParagraph(token, startIndex);
    case 'list':
      return processList(token, startIndex);
    case 'table':
      return processTable(token, startIndex);
    case 'code':
      return processCodeBlock(token, startIndex);
    case 'blockquote':
      return processBlockquote(token, startIndex);
    case 'hr':
      return processHorizontalRule(startIndex);
    case 'space':
      return { text: '\n', requests: [] };
    default:
      return { text: '', requests: [] };
  }
}

/**
 * Process heading (# Header)
 */
function processHeading(token, startIndex) {
  const text = token.text + '\n';
  const endIndex = startIndex + text.length;

  const headingStyles = {
    1: 'HEADING_1',
    2: 'HEADING_2',
    3: 'HEADING_3',
    4: 'HEADING_4',
    5: 'HEADING_5',
    6: 'HEADING_6'
  };

  const requests = [{
    updateParagraphStyle: {
      range: { startIndex, endIndex: endIndex - 1 },
      paragraphStyle: {
        namedStyleType: headingStyles[token.depth] || 'HEADING_1'
      },
      fields: 'namedStyleType'
    }
  }];

  // Process inline formatting (bold, italic)
  requests.push(...processInlineFormatting(token.tokens || [], startIndex));

  return { text, requests };
}

/**
 * Process paragraph with inline formatting
 */
function processParagraph(token, startIndex) {
  const { text: rawText, requests: inlineRequests } = processInlineTokens(token.tokens || [], startIndex);
  const text = rawText + '\n';

  return { text, requests: inlineRequests };
}

/**
 * Process inline tokens (bold, italic, links, text)
 * Handles nested formatting (e.g., ***bold italic***)
 */
function processInlineTokens(tokens, startIndex) {
  let text = '';
  let requests = [];
  let currentIndex = startIndex;

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        // Check for nested italic inside bold
        const strongResult = processInlineTokens(token.tokens || [], currentIndex);
        text += strongResult.text;
        requests.push(...strongResult.requests);
        // Apply bold to entire range
        requests.push({
          updateTextStyle: {
            range: { startIndex: currentIndex, endIndex: currentIndex + strongResult.text.length },
            textStyle: { bold: true },
            fields: 'bold'
          }
        });
        currentIndex += strongResult.text.length;
        break;

      case 'em':
        // Check for nested bold inside italic
        const emResult = processInlineTokens(token.tokens || [], currentIndex);
        text += emResult.text;
        requests.push(...emResult.requests);
        // Apply italic to entire range
        requests.push({
          updateTextStyle: {
            range: { startIndex: currentIndex, endIndex: currentIndex + emResult.text.length },
            textStyle: { italic: true },
            fields: 'italic'
          }
        });
        currentIndex += emResult.text.length;
        break;

      case 'link':
        const linkText = getPlainText(token.tokens || [{ text: token.text }]);
        text += linkText;
        requests.push({
          updateTextStyle: {
            range: { startIndex: currentIndex, endIndex: currentIndex + linkText.length },
            textStyle: {
              link: { url: token.href },
              foregroundColor: { color: { rgbColor: { red: 0.06, green: 0.46, blue: 0.88 } } },
              underline: true
            },
            fields: 'link,foregroundColor,underline'
          }
        });
        currentIndex += linkText.length;
        break;

      case 'codespan':
        const codeText = decodeEntities(token.text);
        text += codeText;
        requests.push({
          updateTextStyle: {
            range: { startIndex: currentIndex, endIndex: currentIndex + codeText.length },
            textStyle: {
              weightedFontFamily: { fontFamily: 'Consolas' },
              backgroundColor: { color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } } }
            },
            fields: 'weightedFontFamily,backgroundColor'
          }
        });
        currentIndex += codeText.length;
        break;

      case 'text': {
        // If token has inline children, recurse into them
        if (token.tokens && token.tokens.length > 0) {
          const textResult = processInlineTokens(token.tokens, currentIndex);
          text += textResult.text;
          requests.push(...textResult.requests);
          currentIndex += textResult.text.length;
        } else {
          const plainText = decodeEntities(token.text);
          text += plainText;
          currentIndex += plainText.length;
        }
        break;
      }

      default: {
        if (token.tokens && token.tokens.length > 0) {
          const defResult = processInlineTokens(token.tokens, currentIndex);
          text += defResult.text;
          requests.push(...defResult.requests);
          currentIndex += defResult.text.length;
        } else if (token.text) {
          const defaultText = decodeEntities(token.text);
          text += defaultText;
          currentIndex += defaultText.length;
        }
      }
    }
  }

  return { text, requests };
}

/**
 * Process inline formatting within other elements
 */
function processInlineFormatting(tokens, startIndex) {
  const requests = [];
  let currentIndex = startIndex;

  for (const token of tokens) {
    const tokenText = getPlainText([token]);

    if (token.type === 'strong') {
      requests.push({
        updateTextStyle: {
          range: { startIndex: currentIndex, endIndex: currentIndex + tokenText.length },
          textStyle: { bold: true },
          fields: 'bold'
        }
      });
    } else if (token.type === 'em') {
      requests.push({
        updateTextStyle: {
          range: { startIndex: currentIndex, endIndex: currentIndex + tokenText.length },
          textStyle: { italic: true },
          fields: 'italic'
        }
      });
    }

    currentIndex += tokenText.length;
  }

  return requests;
}

/**
 * Get plain text from tokens (recursive, prefers parsed children over raw text)
 */
function getPlainText(tokens) {
  let text = '';
  for (const token of tokens) {
    if (token.tokens && token.tokens.length > 0) {
      text += getPlainText(token.tokens);
    } else if (token.text) {
      text += token.text;
    }
  }
  return text;
}

/**
 * Process bullet/numbered list with inline formatting support
 */
function processList(token, startIndex) {
  let text = '';
  let requests = [];
  let currentIndex = startIndex;

  for (const item of token.items) {
    const itemStart = currentIndex;
    const itemTokens = item.tokens || [];
    let itemText = '';
    for (const t of itemTokens) {
      if (t.type === 'text' || t.type === 'paragraph') {
        const inlineResult = processInlineTokens(t.tokens || [], currentIndex);
        itemText += inlineResult.text;
        requests.push(...inlineResult.requests);
      } else {
        itemText += decodeEntities(getPlainText([t]));
      }
    }
    itemText += '\n';
    text += itemText;
    // Reset to NORMAL_TEXT so list items don't inherit surrounding heading styles
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: itemStart, endIndex: itemStart + itemText.length - 1 },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: 'namedStyleType'
      }
    });
    currentIndex += itemText.length;
  }

  // Single bullet request for entire list range
  requests.push({
    createParagraphBullets: {
      range: { startIndex, endIndex: startIndex + text.length - 1 },
      bulletPreset: token.ordered ? 'NUMBERED_DECIMAL_NESTED' : 'BULLET_DISC_CIRCLE_SQUARE'
    }
  });

  return { text, requests };
}

/**
 * Process table - creates native Google Docs table
 * Tables require special handling: insert table first, then populate cells
 */
function processTable(token, startIndex) {
  const numRows = token.rows.length + 1; // +1 for header
  const numCols = token.header.length;

  // Build cell content
  const cells = [];

  // Header row
  const headerCells = token.header.map(h => decodeEntities(getPlainText(h.tokens)));
  cells.push(headerCells);

  // Data rows
  for (const row of token.rows) {
    const rowCells = row.map(cell => decodeEntities(getPlainText(cell.tokens)));
    cells.push(rowCells);
  }

  // Store table data for second pass processing
  // The actual table will be inserted, then cells populated
  const tableInfo = {
    startIndex,
    numRows,
    numCols,
    cells,
    headerCells
  };

  // Return empty text (table insertion handles its own space)
  // and mark this as a table request for special handling
  return {
    text: '\n', // Placeholder for table position
    requests: [],
    tableInfo // Will be processed separately
  };
}

/**
 * Process code block
 */
function processCodeBlock(token, startIndex) {
  const text = token.text + '\n';
  const endIndex = startIndex + text.length;

  const requests = [{
    updateTextStyle: {
      range: { startIndex, endIndex: endIndex - 1 },
      textStyle: {
        weightedFontFamily: { fontFamily: 'Consolas' },
        fontSize: { magnitude: 10, unit: 'PT' }
      },
      fields: 'weightedFontFamily,fontSize'
    }
  }];

  return { text, requests };
}

/**
 * Process blockquote
 */
function processBlockquote(token, startIndex) {
  // Extract text from blockquote tokens
  let text = '';
  for (const child of token.tokens || []) {
    if (child.type === 'paragraph') {
      text += decodeEntities(getPlainText(child.tokens)) + '\n';
    } else if (child.text) {
      text += decodeEntities(child.text) + '\n';
    }
  }

  const endIndex = startIndex + text.length;

  // Style blockquote with indent and gray color
  const requests = [
    {
      updateParagraphStyle: {
        range: { startIndex, endIndex: endIndex - 1 },
        paragraphStyle: {
          indentStart: { magnitude: 36, unit: 'PT' },
          borderLeft: {
            color: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
            width: { magnitude: 3, unit: 'PT' },
            padding: { magnitude: 12, unit: 'PT' },
            dashStyle: 'SOLID'
          }
        },
        fields: 'indentStart,borderLeft'
      }
    },
    {
      updateTextStyle: {
        range: { startIndex, endIndex: endIndex - 1 },
        textStyle: {
          foregroundColor: { color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } } }
        },
        fields: 'foregroundColor'
      }
    }
  ];

  return { text, requests };
}

/**
 * Process horizontal rule
 * REST API has no insertHorizontalRule - use visible line characters as workaround
 */
function processHorizontalRule(startIndex) {
  // Use heavy horizontal line character, styled light gray
  const line = '\u2501'.repeat(40); // ━ (BOX DRAWINGS HEAVY HORIZONTAL)
  const text = line + '\n';

  const requests = [{
    updateTextStyle: {
      range: { startIndex, endIndex: startIndex + line.length },
      textStyle: {
        foregroundColor: { color: { rgbColor: { red: 0.8, green: 0.8, blue: 0.8 } } },
        fontSize: { magnitude: 8, unit: 'PT' }
      },
      fields: 'foregroundColor,fontSize'
    }
  }, {
    updateParagraphStyle: {
      range: { startIndex, endIndex: startIndex + line.length },
      paragraphStyle: {
        alignment: 'CENTER',
        spaceAbove: { magnitude: 6, unit: 'PT' },
        spaceBelow: { magnitude: 6, unit: 'PT' }
      },
      fields: 'alignment,spaceAbove,spaceBelow'
    }
  }];

  return { text, requests };
}

/**
 * Generate complete batchUpdate request body
 * @param {string} markdown - Input markdown
 * @param {number} insertAt - Index to insert at (1 for start of doc)
 * @returns {{ text: string, requests: Array }}
 */
export function generateDocRequests(markdown, insertAt = 1, options = {}) {
  // Apply smart typography to source BEFORE parsing (so indices match)
  const processedMarkdown = options.smartTypography !== false ? smartTypography(markdown) : markdown;
  const { text, requests, tables } = parseMarkdown(processedMarkdown, insertAt);

  // Separate bullet requests from other formatting
  // Bullets FIRST, then headings override bullet styling on heading paragraphs
  const bulletRequests = requests.filter(r => r.createParagraphBullets);
  const otherRequests = requests.filter(r => !r.createParagraphBullets);

  // Order: insert text → bullets → heading/text styles (headings override bullets)
  const allRequests = [
    {
      insertText: {
        location: { index: insertAt },
        text
      }
    },
    ...bulletRequests,
    ...otherRequests
  ];

  // Add table info for two-pass processing
  return { text, requests: allRequests, tables };
}

