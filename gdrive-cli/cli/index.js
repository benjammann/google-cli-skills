#!/usr/bin/env node
// gdrive-cli - Google Drive CLI for Claude Code skills
// Usage: node index.js <command> [args]

import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { generateDocRequests } from './markdown-parser.js';

// Paths
const HOME = process.env.HOME || process.env.USERPROFILE;
const CONFIG_DIR = path.join(HOME, '.config', 'gdrive-cli');
const CREDENTIALS_PATH = process.env.GDRIVE_CREDENTIALS_PATH || path.join(CONFIG_DIR, 'credentials.json');
const TOKENS_PATH = process.env.GDRIVE_TOKEN_PATH || path.join(CONFIG_DIR, 'tokens.json');

// Scopes
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body.readonly'
];

// Exit codes
const EXIT = { OK: 0, AUTH: 1, NOT_FOUND: 2, API: 3 };

// Output helpers
const out = (data) => console.log(JSON.stringify(data, null, 2));
const err = (msg, code = EXIT.API) => {
  console.error(JSON.stringify({ error: true, message: msg }));
  process.exit(code);
};

// Parse args for flags
function parseArgs(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { flags, positional };
}

// Prompt for user input
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Read JSON from file, stdin pipe, or inline string
async function readJsonInput(value) {
  if (!value) return null;
  if (value === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  if (fs.existsSync(value)) return JSON.parse(fs.readFileSync(value, 'utf8'));
  return JSON.parse(value);
}

// Parse A1 range notation → Sheets GridRange
function parseA1Range(rangeStr, sheetId = 0) {
  let range = rangeStr;
  if (range.includes('!')) range = range.split('!')[1];
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = (c) => {
    let n = 0;
    for (const ch of c.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  return { sheetId, startRowIndex: parseInt(m[2]) - 1, endRowIndex: parseInt(m[4]), startColumnIndex: col(m[1]), endColumnIndex: col(m[3]) + 1 };
}

// Build Sheets batchUpdate requests from ops array
function buildSheetFormatRequests(ops, sheetId = 0) {
  const requests = [];
  for (const op of ops) {
    const gr = parseA1Range(op.range, sheetId);
    if (!gr) { console.error(`Skipping invalid range: ${op.range}`); continue; }
    switch (op.type) {
      case 'cells': {
        const fmt = {};
        if (op.backgroundColor) fmt.backgroundColor = op.backgroundColor;
        if (op.horizontalAlignment) fmt.horizontalAlignment = op.horizontalAlignment;
        if (op.verticalAlignment) fmt.verticalAlignment = op.verticalAlignment;
        if (op.wrapStrategy) fmt.wrapStrategy = op.wrapStrategy;
        requests.push({ repeatCell: { range: gr, cell: { userEnteredFormat: fmt }, fields: Object.keys(fmt).map(k => `userEnteredFormat.${k}`).join(',') } });
        break;
      }
      case 'text': {
        const tf = {};
        if (op.bold !== undefined) tf.bold = op.bold;
        if (op.italic !== undefined) tf.italic = op.italic;
        if (op.underline !== undefined) tf.underline = op.underline;
        if (op.strikethrough !== undefined) tf.strikethrough = op.strikethrough;
        if (op.fontSize) tf.fontSize = op.fontSize;
        if (op.fontFamily) tf.fontFamily = op.fontFamily;
        if (op.foregroundColor) tf.foregroundColor = op.foregroundColor;
        requests.push({ repeatCell: { range: gr, cell: { userEnteredFormat: { textFormat: tf } }, fields: Object.keys(tf).map(k => `userEnteredFormat.textFormat.${k}`).join(',') } });
        break;
      }
      case 'number': {
        requests.push({ repeatCell: { range: gr, cell: { userEnteredFormat: { numberFormat: { type: op.numberType || 'NUMBER', pattern: op.pattern } } }, fields: 'userEnteredFormat.numberFormat' } });
        break;
      }
      case 'borders': {
        const b = { style: op.style || 'SOLID', width: op.width || 1 };
        if (op.color) b.color = op.color;
        const u = { range: gr };
        const sides = ['top', 'bottom', 'left', 'right', 'innerHorizontal', 'innerVertical'];
        const hasAny = sides.some(s => op[s]);
        for (const s of sides) { if (op[s] || !hasAny) u[s] = b; }
        requests.push({ updateBorders: u });
        break;
      }
      case 'merge':
        requests.push({ mergeCells: { range: gr, mergeType: op.mergeType || 'MERGE_ALL' } });
        break;
      case 'conditional': {
        requests.push({
          addConditionalFormatRule: {
            rule: { ranges: [gr], booleanRule: { condition: { type: op.condition.type, values: [{ userEnteredValue: op.condition.value }] }, format: op.format } },
            index: 0
          }
        });
        break;
      }
    }
  }
  return requests;
}

// Build Slides batchUpdate requests from ops array
function buildSlidesFormatRequests(ops) {
  const bulletPresets = { DISC: 'BULLET_DISC_CIRCLE_SQUARE', ARROW: 'BULLET_ARROW_DIAMOND_DISC', STAR: 'BULLET_STAR_CIRCLE_SQUARE', SQUARE: 'BULLET_CHECKBOX', DIAMOND: 'BULLET_DIAMONDX_ARROW3D_SQUARE', NUMBERED: 'NUMBERED_DIGIT_ALPHA_ROMAN' };
  const requests = [];
  for (const op of ops) {
    switch (op.type) {
      case 'text': {
        const style = {};
        if (op.bold !== undefined) style.bold = op.bold;
        if (op.italic !== undefined) style.italic = op.italic;
        if (op.underline !== undefined) style.underline = op.underline;
        if (op.strikethrough !== undefined) style.strikethrough = op.strikethrough;
        if (op.fontSize) style.fontSize = { magnitude: op.fontSize, unit: 'PT' };
        if (op.fontFamily) style.fontFamily = op.fontFamily;
        if (op.foregroundColor) style.foregroundColor = { opaqueColor: { rgbColor: op.foregroundColor } };
        const textRange = op.startIndex !== undefined ? { type: 'FIXED_RANGE', startIndex: op.startIndex, endIndex: op.endIndex } : { type: 'ALL' };
        requests.push({ updateTextStyle: { objectId: op.objectId, style, textRange, fields: Object.keys(style).join(',') } });
        break;
      }
      case 'paragraph': {
        const style = {};
        if (op.alignment) style.alignment = op.alignment;
        if (op.lineSpacing) style.lineSpacing = op.lineSpacing;
        if (Object.keys(style).length) requests.push({ updateParagraphStyle: { objectId: op.objectId, style, fields: Object.keys(style).join(',') } });
        if (op.bulletStyle && op.bulletStyle !== 'NONE') {
          requests.push({ createParagraphBullets: { objectId: op.objectId, bulletPreset: bulletPresets[op.bulletStyle] || 'BULLET_DISC_CIRCLE_SQUARE' } });
        } else if (op.bulletStyle === 'NONE') {
          requests.push({ deleteParagraphBullets: { objectId: op.objectId } });
        }
        break;
      }
      case 'shape': {
        const props = {}; const fields = [];
        if (op.backgroundColor) {
          props.shapeBackgroundFill = { solidFill: { color: { rgbColor: op.backgroundColor }, alpha: op.backgroundColor.alpha || 1 } };
          fields.push('shapeBackgroundFill');
        }
        if (op.outlineColor || op.outlineWeight || op.outlineDashStyle) {
          props.outline = {};
          if (op.outlineColor) props.outline.outlineFill = { solidFill: { color: { rgbColor: op.outlineColor } } };
          if (op.outlineWeight) props.outline.weight = { magnitude: op.outlineWeight, unit: 'PT' };
          if (op.outlineDashStyle) props.outline.dashStyle = op.outlineDashStyle;
          fields.push('outline');
        }
        requests.push({ updateShapeProperties: { objectId: op.objectId, shapeProperties: props, fields: fields.join(',') } });
        break;
      }
      case 'background': {
        for (const pid of op.pageObjectIds || []) {
          requests.push({ updatePageProperties: { objectId: pid, pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: op.backgroundColor } } } }, fields: 'pageBackgroundFill' } });
        }
        break;
      }
    }
  }
  return requests;
}

// OAuth client
async function getAuthClient(forceReauth = false) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    err(`Credentials not found at ${CREDENTIALS_PATH}. Set up Google OAuth first.\nSee README for setup instructions.`, EXIT.AUTH);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'http://localhost');

  if (!forceReauth && fs.existsSync(TOKENS_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    oauth2Client.setCredentials(tokens);
    return oauth2Client;
  }

  console.error('\nAuthentication required...\n');
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  console.error('Authorize this app by visiting:\n');
  console.error(authUrl);
  console.error('\n');

  const code = await prompt('Enter the authorization code: ');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Tokens saved.\n');

  return oauth2Client;
}

// ─── Rich Docs Helpers ────────────────────────────────────────

// Fetch doc with tab resolution. Returns { docData, tabId, tabs }
// docData.body/lists are from the selected tab (first tab by default)
async function fetchDoc(docs, docId, tabFlag) {
  const res = await docs.documents.get({ documentId: docId, includeTabsContent: true });
  const raw = res.data;
  const tabs = raw.tabs || [];

  if (tabs.length === 0) {
    return { docData: raw, tabId: null, tabs: [] };
  }

  let tab;
  if (tabFlag != null && tabFlag !== false) {
    const idx = parseInt(tabFlag);
    if (!isNaN(idx)) tab = tabs[idx];
    // Match by tab ID (supports both "t.xxxxxx" URL format and bare "xxxxxx" API format)
    const bareId = String(tabFlag).replace(/^t\./, '');
    if (!tab) tab = tabs.find(t => t.tabProperties.tabId === tabFlag || t.tabProperties.tabId === bareId);
    if (!tab) tab = tabs.find(t => t.tabProperties.title.toLowerCase() === String(tabFlag).toLowerCase());
    if (!tab) {
      const avail = tabs.map((t, i) => `  [${i}] "${t.tabProperties.title}" (id: ${t.tabProperties.tabId})`).join('\n');
      err(`Tab "${tabFlag}" not found.\nAvailable tabs:\n${avail}`);
    }
  } else {
    tab = tabs[0];
  }

  const docData = {
    ...raw,
    body: tab.documentTab.body,
    lists: tab.documentTab.lists || {}
  };
  const tabsMeta = tabs.map((t, i) => ({ index: i, title: t.tabProperties.title, id: t.tabProperties.tabId }));
  return { docData, tabId: tab.tabProperties.tabId, tabs: tabsMeta };
}

function readMarkdownInput(flags) {
  if (flags['from-md'] && fs.existsSync(flags['from-md']))
    return fs.readFileSync(flags['from-md'], 'utf8');
  return flags.md || null;
}

function findTablesInDoc(doc) {
  const tables = [];
  for (const element of doc.body.content || []) {
    if (element.table) {
      const tableData = { startIndex: element.startIndex, rows: [] };
      for (const row of element.table.tableRows || []) {
        const rowCells = [];
        for (const cell of row.tableCells || []) {
          const firstPara = cell.content?.[0];
          if (firstPara?.paragraph) {
            rowCells.push({ startIndex: firstPara.startIndex, endIndex: firstPara.endIndex });
          }
        }
        tableData.rows.push(rowCells);
      }
      tables.push(tableData);
    }
  }
  return tables;
}

async function populateTable(docs, docId, tableInDoc, tableData) {
  const requests = [];
  const { cells } = tableData;
  for (let r = cells.length - 1; r >= 0; r--) {
    for (let c = cells[r].length - 1; c >= 0; c--) {
      const cellIndex = tableInDoc.rows[r]?.[c]?.startIndex;
      if (cellIndex !== undefined && cells[r][c]) {
        requests.push({ insertText: { location: { index: cellIndex }, text: cells[r][c] } });
      }
    }
  }
  if (requests.length > 0) {
    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
  }
  const updatedDoc = await docs.documents.get({ documentId: docId });
  const updatedTables = findTablesInDoc(updatedDoc.data);
  if (updatedTables.length > 0) {
    // Find the same table we just populated (closest to original startIndex)
    let target = updatedTables[0];
    let minDist = Math.abs(target.startIndex - tableInDoc.startIndex);
    for (const t of updatedTables) {
      const dist = Math.abs(t.startIndex - tableInDoc.startIndex);
      if (dist < minDist) { minDist = dist; target = t; }
    }
    const headerRequests = [];
    const headerRow = target.rows[0];
    for (const cell of headerRow || []) {
      if (cell.startIndex < cell.endIndex - 1) {
        headerRequests.push({
          updateTextStyle: {
            range: { startIndex: cell.startIndex, endIndex: cell.endIndex - 1 },
            textStyle: { bold: true },
            fields: 'bold'
          }
        });
      }
    }
    if (headerRequests.length > 0) {
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: headerRequests } });
    }
  }
}

async function processTables(docs, docId, tables) {
  if (!tables || tables.length === 0) return;
  for (const tableInfo of [...tables].reverse()) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertTable: { rows: tableInfo.numRows, columns: tableInfo.numCols, location: { index: tableInfo.textIndex } } }]
      }
    });
    const doc = await docs.documents.get({ documentId: docId });
    const tablesInDoc = findTablesInDoc(doc.data);
    if (tablesInDoc.length > 0) {
      // Find table closest to insertion point (not always the last one)
      let closest = tablesInDoc[0];
      let minDist = Math.abs(closest.startIndex - tableInfo.textIndex);
      for (const t of tablesInDoc) {
        const dist = Math.abs(t.startIndex - tableInfo.textIndex);
        if (dist < minDist) { minDist = dist; closest = t; }
      }
      await populateTable(docs, docId, closest, tableInfo);
    }
  }
}

function buildTextMap(doc) {
  let plaintext = '';
  const indexMap = [];
  const sections = [];
  let currentSection = null;
  const HEADING_LEVELS = {
    'HEADING_1': 1, 'HEADING_2': 2, 'HEADING_3': 3,
    'HEADING_4': 4, 'HEADING_5': 5, 'HEADING_6': 6
  };
  for (const element of doc.body.content || []) {
    if (element.paragraph) {
      const style = element.paragraph.paragraphStyle?.namedStyleType;
      const level = HEADING_LEVELS[style];
      if (level) {
        if (currentSection) {
          currentSection.endIndex = element.startIndex;
          sections.push(currentSection);
        }
        let headingText = '';
        for (const el of element.paragraph.elements || []) {
          if (el.textRun?.content) headingText += el.textRun.content;
        }
        currentSection = { heading: headingText.trim(), level, startIndex: element.startIndex, endIndex: null };
      }
      for (const el of element.paragraph.elements || []) {
        if (el.textRun?.content) {
          const content = el.textRun.content;
          for (let i = 0; i < content.length; i++) {
            indexMap.push(el.startIndex + i);
            plaintext += content[i];
          }
        }
      }
    } else if (element.table) {
      indexMap.push(element.startIndex);
      plaintext += '\u0000';
    }
  }
  if (currentSection) {
    const lastElement = doc.body.content.slice(-1)[0];
    currentSection.endIndex = lastElement?.endIndex || currentSection.startIndex;
    sections.push(currentSection);
  }
  return { plaintext, indexMap, sections };
}

function docToMarkdown(doc, sectionFilter) {
  const HEADING_MAP = {
    'HEADING_1': '# ', 'HEADING_2': '## ', 'HEADING_3': '### ',
    'HEADING_4': '#### ', 'HEADING_5': '##### ', 'HEADING_6': '###### '
  };
  let filterStart = null, filterEnd = null;
  if (sectionFilter) {
    const { sections } = buildTextMap(doc);
    const target = sections.find(s => s.heading.toLowerCase() === sectionFilter.toLowerCase());
    if (!target) {
      const available = sections.map(s => `  "${s.heading}" (H${s.level})`).join('\n');
      err(`Section "${sectionFilter}" not found.\nAvailable sections:\n${available}`);
    }
    filterStart = target.startIndex;
    filterEnd = target.endIndex;
  }
  let md = '';
  const elements = doc.body.content || [];
  let inList = false;
  for (const element of elements) {
    if (filterStart !== null) {
      if (element.startIndex < filterStart) continue;
      if (element.endIndex > filterEnd) break;
    }
    if (element.paragraph) {
      const para = element.paragraph;
      const style = para.paragraphStyle?.namedStyleType;
      const bullet = para.bullet;
      let line = '';
      for (const el of para.elements || []) {
        if (!el.textRun) continue;
        const ts = el.textRun.textStyle || {};
        let text = el.textRun.content;
        if (text.endsWith('\n')) text = text.slice(0, -1);
        if (!text) continue;
        const isCode = ts.weightedFontFamily?.fontFamily === 'Consolas' ||
                       ts.weightedFontFamily?.fontFamily === 'Courier New';
        const isBold = ts.bold;
        const isItalic = ts.italic;
        const link = ts.link?.url;
        let chunk = text;
        if (isCode) {
          chunk = `\`${chunk}\``;
        } else {
          if (isBold && isItalic) chunk = `***${chunk}***`;
          else if (isBold) chunk = `**${chunk}**`;
          else if (isItalic) chunk = `*${chunk}*`;
        }
        if (link) chunk = `[${chunk}](${link})`;
        line += chunk;
      }
      const heading = HEADING_MAP[style];
      if (heading) {
        if (inList) { md += '\n'; inList = false; }
        md += heading + line + '\n\n';
      } else if (bullet) {
        const nestLevel = bullet.nestingLevel || 0;
        const indent = '  '.repeat(nestLevel);
        const listId = bullet.listId;
        const listProps = doc.lists?.[listId]?.listProperties?.nestingLevels?.[nestLevel];
        const isOrdered = listProps?.glyphType && listProps.glyphType !== 'GLYPH_TYPE_UNSPECIFIED';
        const prefix = isOrdered ? '1. ' : '- ';
        md += indent + prefix + line + '\n';
        inList = true;
      } else if (para.paragraphStyle?.indentStart?.magnitude > 0 &&
                 para.paragraphStyle?.borderLeft) {
        if (inList) { md += '\n'; inList = false; }
        md += '> ' + line + '\n';
      } else {
        if (inList) { md += '\n'; inList = false; }
        if (line.trim()) {
          md += line + '\n\n';
        } else {
          md += '\n';
        }
      }
    } else if (element.table) {
      if (inList) { md += '\n'; inList = false; }
      const rows = element.table.tableRows || [];
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].tableCells || [];
        const cellTexts = cells.map(cell => {
          let text = '';
          for (const content of cell.content || []) {
            if (content.paragraph) {
              for (const el of content.paragraph.elements || []) {
                if (el.textRun?.content) {
                  text += el.textRun.content.replace(/\n$/, '');
                }
              }
            }
          }
          return text;
        });
        md += '| ' + cellTexts.join(' | ') + ' |\n';
        if (r === 0) {
          md += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
        }
      }
      md += '\n';
    }
  }
  return md.trimEnd() + '\n';
}

// Commands
const commands = {
  async auth(positional, flags) {
    try {
      const auth = await getAuthClient(true);
      const drive = google.drive({ version: 'v3', auth });
      const about = await drive.about.get({ fields: 'user' });
      out({
        success: true,
        message: 'Authenticated successfully',
        email: about.data.user.emailAddress,
        displayName: about.data.user.displayName
      });
    } catch (e) {
      err(`Auth failed: ${e.message}`, EXIT.AUTH);
    }
  },

  async search(positional, flags) {
    const query = positional.join(' ').trim();
    if (!query) {
      err('Usage: gdrive search <query> [--max N] [--type doc|sheet|folder|slides]', EXIT.API);
    }

    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      // Build query
      let q = `name contains '${query.replace(/'/g, "\\'")}'`;

      // Add type filter
      if (flags.type) {
        const mimeTypes = {
          doc: 'application/vnd.google-apps.document',
          sheet: 'application/vnd.google-apps.spreadsheet',
          folder: 'application/vnd.google-apps.folder',
          slides: 'application/vnd.google-apps.presentation'
        };
        if (mimeTypes[flags.type]) {
          q += ` and mimeType='${mimeTypes[flags.type]}'`;
        }
      }

      // Exclude trashed
      q += ' and trashed=false';

      const res = await drive.files.list({
        q: q,
        pageSize: parseInt(flags.max) || 20,
        fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      const files = res.data.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType.split('.').pop(),
        modified: f.modifiedTime,
        url: f.webViewLink
      }));

      out({ success: true, query: query, count: files.length, data: files });
    } catch (e) {
      err(`Search failed: ${e.message}`, EXIT.API);
    }
  },

  async 'read-doc'(positional, flags) {
    const [docId] = positional;
    if (!docId) {
      err('Usage: gdrive read-doc <document-id> [--tab <name|index>]', EXIT.API);
    }

    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      const { docData, tabs } = await fetchDoc(docs, docId, flags.tab);

      // Extract text content
      let text = '';
      const content = docData.body?.content || [];

      for (const element of content) {
        if (element.paragraph) {
          for (const elem of element.paragraph.elements || []) {
            if (elem.textRun?.content) {
              text += elem.textRun.content;
            }
          }
        } else if (element.table) {
          for (const row of element.table.tableRows || []) {
            for (const cell of row.tableCells || []) {
              for (const cellContent of cell.content || []) {
                if (cellContent.paragraph) {
                  for (const elem of cellContent.paragraph.elements || []) {
                    if (elem.textRun?.content) {
                      text += elem.textRun.content;
                    }
                  }
                }
              }
              text += '\t';
            }
            text += '\n';
          }
        }
      }

      const result = {
        id: docId,
        title: docData.title,
        content: text
      };
      if (tabs.length > 1) result.tabs = tabs;

      out({ success: true, data: result });
    } catch (e) {
      if (e.code === 404) {
        err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      }
      err(`Read failed: ${e.message}`, EXIT.API);
    }
  },

  async 'read-sheet'(positional, flags) {
    const [sheetId] = positional;
    if (!sheetId) {
      err('Usage: gdrive read-sheet <spreadsheet-id> [--range "Sheet1!A1:Z100"]', EXIT.API);
    }

    try {
      const auth = await getAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      // Get spreadsheet metadata first
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const sheetNames = meta.data.sheets.map(s => s.properties.title);

      // Get data from specified range or first sheet
      const range = flags.range || `${sheetNames[0]}`;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range
      });

      out({
        success: true,
        data: {
          id: sheetId,
          title: meta.data.properties.title,
          sheets: sheetNames,
          range: range,
          rows: res.data.values || []
        }
      });
    } catch (e) {
      if (e.code === 404) {
        err(`Spreadsheet not found: ${sheetId}`, EXIT.NOT_FOUND);
      }
      err(`Read failed: ${e.message}`, EXIT.API);
    }
  },

  async list(positional, flags) {
    const [folderId] = positional;

    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      let q = 'trashed=false';
      if (folderId) {
        q += ` and '${folderId}' in parents`;
      } else {
        q += " and 'root' in parents";
      }

      const res = await drive.files.list({
        q: q,
        pageSize: parseInt(flags.max) || 50,
        fields: 'files(id, name, mimeType, modifiedTime)',
        orderBy: 'folder,name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });

      const files = res.data.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType.includes('folder') ? 'folder' : f.mimeType.split('.').pop(),
        modified: f.modifiedTime
      }));

      out({ success: true, folderId: folderId || 'root', count: files.length, data: files });
    } catch (e) {
      err(`List failed: ${e.message}`, EXIT.API);
    }
  },

  async info(positional, flags) {
    const [fileId] = positional;
    if (!fileId) {
      err('Usage: gdrive info <file-id>', EXIT.API);
    }

    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      const file = await drive.files.get({
        fileId: fileId,
        fields: 'id, name, mimeType, modifiedTime, createdTime, size, webViewLink, parents',
        supportsAllDrives: true
      });

      out({
        success: true,
        data: {
          id: file.data.id,
          name: file.data.name,
          type: file.data.mimeType,
          modified: file.data.modifiedTime,
          created: file.data.createdTime,
          size: file.data.size,
          url: file.data.webViewLink,
          parents: file.data.parents
        }
      });
    } catch (e) {
      if (e.code === 404) {
        err(`File not found: ${fileId}`, EXIT.NOT_FOUND);
      }
      err(`Info failed: ${e.message}`, EXIT.API);
    }
  },

  // ─── File Management ───────────────────────────────────────────

  async mkdir(positional, flags) {
    const name = positional.join(' ').trim();
    if (!name) err('Usage: gdrive mkdir <name> [--parent <folderId>]');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
      if (flags.parent) meta.parents = [flags.parent];
      const res = await drive.files.create({ requestBody: meta, fields: 'id, name, webViewLink', supportsAllDrives: true });
      out({ success: true, data: { id: res.data.id, name: res.data.name, url: res.data.webViewLink } });
    } catch (e) { err(`mkdir failed: ${e.message}`); }
  },

  async rm(positional, flags) {
    const [fileId] = positional;
    if (!fileId) err('Usage: gdrive rm <fileId>');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
      out({ success: true, message: `Trashed ${fileId}` });
    } catch (e) {
      if (e.code === 404) err(`File not found: ${fileId}`, EXIT.NOT_FOUND);
      err(`rm failed: ${e.message}`);
    }
  },

  async mv(positional, flags) {
    const [fileId, destId] = positional;
    if (!fileId || !destId) err('Usage: gdrive mv <fileId> <destinationFolderId>');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      // Get current parents to remove
      const file = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
      const prev = (file.data.parents || []).join(',');
      const res = await drive.files.update({ fileId, addParents: destId, removeParents: prev, fields: 'id, name, parents', supportsAllDrives: true });
      out({ success: true, data: { id: res.data.id, name: res.data.name, parents: res.data.parents } });
    } catch (e) {
      if (e.code === 404) err(`Not found: ${fileId}`, EXIT.NOT_FOUND);
      err(`mv failed: ${e.message}`);
    }
  },

  async rename(positional, flags) {
    const [fileId, ...nameParts] = positional;
    const newName = nameParts.join(' ').trim();
    if (!fileId || !newName) err('Usage: gdrive rename <fileId> <newName>');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const res = await drive.files.update({ fileId, requestBody: { name: newName }, fields: 'id, name', supportsAllDrives: true });
      out({ success: true, data: { id: res.data.id, name: res.data.name } });
    } catch (e) {
      if (e.code === 404) err(`Not found: ${fileId}`, EXIT.NOT_FOUND);
      err(`rename failed: ${e.message}`);
    }
  },

  async 'create-text'(positional, flags) {
    const name = positional.join(' ').trim();
    if (!name || !flags.content) err('Usage: gdrive create-text <name> --content "text" [--parent <folderId>]');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const meta = { name };
      if (flags.parent) meta.parents = [flags.parent];
      const media = { mimeType: 'text/plain', body: flags.content };
      const res = await drive.files.create({ requestBody: meta, media, fields: 'id, name, webViewLink', supportsAllDrives: true });
      out({ success: true, data: { id: res.data.id, name: res.data.name, url: res.data.webViewLink } });
    } catch (e) { err(`create-text failed: ${e.message}`); }
  },

  // ─── Sheets ────────────────────────────────────────────────────

  async 'create-sheet'(positional, flags) {
    const name = positional.join(' ').trim();
    if (!name || !flags.data) err('Usage: gdrive create-sheet <name> --data <json|file|-> [--parent <folderId>]');
    try {
      const data = await readJsonInput(flags.data);
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const sheets = google.sheets({ version: 'v4', auth });

      // Create spreadsheet via Drive (supports parents)
      const meta = { name, mimeType: 'application/vnd.google-apps.spreadsheet' };
      if (flags.parent) meta.parents = [flags.parent];
      const created = await drive.files.create({ requestBody: meta, fields: 'id, name, webViewLink', supportsAllDrives: true });

      // Populate data
      if (data && data.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: created.data.id,
          range: 'Sheet1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: data }
        });
      }

      out({ success: true, data: { id: created.data.id, name: created.data.name, url: created.data.webViewLink, rows: data?.length || 0 } });
    } catch (e) { err(`create-sheet failed: ${e.message}`); }
  },

  async 'update-sheet'(positional, flags) {
    const [sheetId] = positional;
    if (!sheetId || !flags.range || !flags.data) err('Usage: gdrive update-sheet <id> --range "A1:C3" --data <json|file|->');
    try {
      const data = await readJsonInput(flags.data);
      const auth = await getAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: flags.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: data }
      });

      out({ success: true, data: { id: sheetId, range: flags.range, updatedCells: res.data.updatedCells } });
    } catch (e) {
      if (e.code === 404) err(`Spreadsheet not found: ${sheetId}`, EXIT.NOT_FOUND);
      err(`update-sheet failed: ${e.message}`);
    }
  },

  async 'format-sheet'(positional, flags) {
    const [sheetId] = positional;
    if (!sheetId) err('Usage: gdrive format-sheet <id> --ops <json> OR --range "A1:C1" --bold/--bg/--number/--merge/--borders');
    try {
      const auth = await getAuthClient();
      const sheets = google.sheets({ version: 'v4', auth });

      let ops;
      if (flags.ops) {
        // Full ops array
        ops = await readJsonInput(flags.ops);
      } else if (flags.range) {
        // Quick one-liner flags
        ops = [];
        if (flags.bold) ops.push({ type: 'text', range: flags.range, bold: true });
        if (flags.italic) ops.push({ type: 'text', range: flags.range, italic: true });
        if (flags.bg) {
          const [r, g, b] = flags.bg.split(',').map(Number);
          ops.push({ type: 'cells', range: flags.range, backgroundColor: { red: r, green: g, blue: b } });
        }
        if (flags.align) ops.push({ type: 'cells', range: flags.range, horizontalAlignment: flags.align.toUpperCase() });
        if (flags.number) ops.push({ type: 'number', range: flags.range, pattern: flags.number });
        if (flags.merge) ops.push({ type: 'merge', range: flags.range, mergeType: flags.merge === true ? 'MERGE_ALL' : `MERGE_${flags.merge.toUpperCase()}` });
        if (flags.borders) ops.push({ type: 'borders', range: flags.range, style: typeof flags.borders === 'string' ? flags.borders.toUpperCase() : 'SOLID' });
        if (flags.wrap) ops.push({ type: 'cells', range: flags.range, wrapStrategy: flags.wrap.toUpperCase() });
        if (flags.font) ops.push({ type: 'text', range: flags.range, fontFamily: flags.font });
        if (flags.size) ops.push({ type: 'text', range: flags.range, fontSize: parseInt(flags.size) });
        if (!ops.length) err('No format flags provided. Use --bold, --bg, --number, --merge, --borders, --align, --wrap, --font, --size');
      } else {
        err('Provide --ops <json> or --range with format flags');
      }

      // Resolve sheet ID (first sheet by default)
      let targetSheetId = 0;
      if (flags.sheet) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
        const found = meta.data.sheets.find(s => s.properties.title === flags.sheet);
        if (found) targetSheetId = found.properties.sheetId;
      }

      const requests = buildSheetFormatRequests(ops, targetSheetId);
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });

      out({ success: true, data: { id: sheetId, opsApplied: requests.length } });
    } catch (e) {
      if (e.code === 404) err(`Spreadsheet not found: ${sheetId}`, EXIT.NOT_FOUND);
      err(`format-sheet failed: ${e.message}`);
    }
  },

  // ─── Slides ────────────────────────────────────────────────────

  async 'create-slides'(positional, flags) {
    const name = positional.join(' ').trim();
    if (!name || !flags.from) err('Usage: gdrive create-slides <name> --from <json|file|-> [--parent <folderId>]');
    try {
      const slides = await readJsonInput(flags.from);
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });
      const drive = google.drive({ version: 'v3', auth });

      // Create presentation
      const pres = await slidesApi.presentations.create({ requestBody: { title: name } });
      const presId = pres.data.presentationId;

      // Move to parent folder if specified
      if (flags.parent) {
        const file = await drive.files.get({ fileId: presId, fields: 'parents' });
        await drive.files.update({ fileId: presId, addParents: flags.parent, removeParents: (file.data.parents || []).join(',') });
      }

      if (slides && slides.length > 0) {
        // Get initial blank slide ID
        const initialSlideId = pres.data.slides[0].objectId;

        // Create new slides with TITLE_AND_BODY layout
        const createReqs = slides.map((_, i) => ({
          createSlide: { insertionIndex: i, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' } }
        }));
        // Delete initial blank slide
        createReqs.push({ deleteObject: { objectId: initialSlideId } });
        await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests: createReqs } });

        // Get updated presentation to find placeholder IDs
        const updated = await slidesApi.presentations.get({ presentationId: presId });
        const textReqs = [];
        for (let i = 0; i < updated.data.slides.length && i < slides.length; i++) {
          const slide = updated.data.slides[i];
          for (const el of slide.pageElements || []) {
            if (el.shape?.placeholder) {
              const pType = el.shape.placeholder.type;
              if ((pType === 'TITLE' || pType === 'CENTERED_TITLE') && slides[i].title) {
                textReqs.push({ insertText: { objectId: el.objectId, text: slides[i].title, insertionIndex: 0 } });
              } else if ((pType === 'BODY' || pType === 'SUBTITLE') && slides[i].content) {
                textReqs.push({ insertText: { objectId: el.objectId, text: slides[i].content, insertionIndex: 0 } });
              }
            }
          }
        }
        if (textReqs.length > 0) {
          await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests: textReqs } });
        }
      }

      out({ success: true, data: { id: presId, name, slides: slides?.length || 0, url: `https://docs.google.com/presentation/d/${presId}/edit` } });
    } catch (e) { err(`create-slides failed: ${e.message}`); }
  },

  async 'update-slides'(positional, flags) {
    const [presId] = positional;
    if (!presId || !flags.from) err('Usage: gdrive update-slides <id> --from <json|file|->');
    try {
      const slides = await readJsonInput(flags.from);
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });

      // Get current slides
      const pres = await slidesApi.presentations.get({ presentationId: presId });
      const oldIds = pres.data.slides.map(s => s.objectId);

      // Create new slides first (can't have empty presentation)
      const createReqs = slides.map((_, i) => ({
        createSlide: { insertionIndex: oldIds.length + i, slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' } }
      }));
      await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests: createReqs } });

      // Delete old slides
      const deleteReqs = oldIds.map(id => ({ deleteObject: { objectId: id } }));
      await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests: deleteReqs } });

      // Insert text into new slides
      const updated = await slidesApi.presentations.get({ presentationId: presId });
      const textReqs = [];
      for (let i = 0; i < updated.data.slides.length && i < slides.length; i++) {
        const slide = updated.data.slides[i];
        for (const el of slide.pageElements || []) {
          if (el.shape?.placeholder) {
            const pType = el.shape.placeholder.type;
            if ((pType === 'TITLE' || pType === 'CENTERED_TITLE') && slides[i].title) {
              textReqs.push({ insertText: { objectId: el.objectId, text: slides[i].title, insertionIndex: 0 } });
            } else if ((pType === 'BODY' || pType === 'SUBTITLE') && slides[i].content) {
              textReqs.push({ insertText: { objectId: el.objectId, text: slides[i].content, insertionIndex: 0 } });
            }
          }
        }
      }
      if (textReqs.length > 0) {
        await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests: textReqs } });
      }

      out({ success: true, data: { id: presId, slides: slides.length } });
    } catch (e) {
      if (e.code === 404) err(`Presentation not found: ${presId}`, EXIT.NOT_FOUND);
      err(`update-slides failed: ${e.message}`);
    }
  },

  async 'read-slides'(positional, flags) {
    const [presId] = positional;
    if (!presId) err('Usage: gdrive read-slides <id> [--slide <index>]');
    try {
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });
      const pres = await slidesApi.presentations.get({ presentationId: presId });

      const slideIdx = flags.slide !== undefined ? parseInt(flags.slide) : null;
      const slidesData = pres.data.slides
        .filter((_, i) => slideIdx === null || i === slideIdx)
        .map((slide, i) => {
          const elements = (slide.pageElements || []).map(el => {
            const info = { objectId: el.objectId, type: el.shape ? 'shape' : el.table ? 'table' : el.image ? 'image' : 'other' };
            if (el.shape?.placeholder) info.placeholder = el.shape.placeholder.type;
            if (el.shape?.shapeType) info.shapeType = el.shape.shapeType;
            // Extract text content
            const textElements = el.shape?.text?.textElements || [];
            const text = textElements.map(te => te.textRun?.content || '').join('');
            if (text.trim()) info.text = text.trim();
            if (el.size) info.size = el.size;
            if (el.transform) info.transform = el.transform;
            return info;
          });
          return { index: slideIdx !== null ? slideIdx : i, pageObjectId: slide.objectId, elements };
        });

      out({ success: true, data: { id: presId, title: pres.data.title, slideCount: pres.data.slides.length, slides: slidesData } });
    } catch (e) {
      if (e.code === 404) err(`Presentation not found: ${presId}`, EXIT.NOT_FOUND);
      err(`read-slides failed: ${e.message}`);
    }
  },

  async 'format-slides'(positional, flags) {
    const [presId] = positional;
    if (!presId || !flags.ops) err('Usage: gdrive format-slides <id> --ops <json|file|->');
    try {
      const ops = await readJsonInput(flags.ops);
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });
      const requests = buildSlidesFormatRequests(ops);
      await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests } });
      out({ success: true, data: { id: presId, opsApplied: requests.length } });
    } catch (e) {
      if (e.code === 404) err(`Presentation not found: ${presId}`, EXIT.NOT_FOUND);
      err(`format-slides failed: ${e.message}`);
    }
  },

  async 'add-textbox'(positional, flags) {
    const [presId] = positional;
    if (!presId || !flags.slide || !flags.text) err('Usage: gdrive add-textbox <presId> --slide <slideId> --text "..." --x N --y N --w N --h N [--bold] [--size N]');
    try {
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });
      const elementId = `textbox_${Date.now()}`;
      const requests = [
        {
          createShape: {
            objectId: elementId,
            shapeType: 'TEXT_BOX',
            elementProperties: {
              pageObjectId: flags.slide,
              size: { width: { magnitude: parseInt(flags.w) || 3000000, unit: 'EMU' }, height: { magnitude: parseInt(flags.h) || 500000, unit: 'EMU' } },
              transform: { scaleX: 1, scaleY: 1, translateX: parseInt(flags.x) || 0, translateY: parseInt(flags.y) || 0, unit: 'EMU' }
            }
          }
        },
        { insertText: { objectId: elementId, text: flags.text, insertionIndex: 0 } }
      ];
      if (flags.bold || flags.size) {
        const style = {};
        if (flags.bold) style.bold = true;
        if (flags.size) style.fontSize = { magnitude: parseInt(flags.size), unit: 'PT' };
        requests.push({ updateTextStyle: { objectId: elementId, style, textRange: { type: 'ALL' }, fields: Object.keys(style).join(',') } });
      }
      await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests } });
      out({ success: true, data: { id: presId, elementId, slide: flags.slide } });
    } catch (e) { err(`add-textbox failed: ${e.message}`); }
  },

  async 'add-shape'(positional, flags) {
    const [presId] = positional;
    if (!presId || !flags.slide || !flags.type) err('Usage: gdrive add-shape <presId> --slide <slideId> --type RECTANGLE --x N --y N --w N --h N [--bg "r,g,b"]');
    try {
      const auth = await getAuthClient();
      const slidesApi = google.slides({ version: 'v1', auth });
      const elementId = `shape_${Date.now()}`;
      const requests = [
        {
          createShape: {
            objectId: elementId,
            shapeType: flags.type.toUpperCase(),
            elementProperties: {
              pageObjectId: flags.slide,
              size: { width: { magnitude: parseInt(flags.w) || 3000000, unit: 'EMU' }, height: { magnitude: parseInt(flags.h) || 3000000, unit: 'EMU' } },
              transform: { scaleX: 1, scaleY: 1, translateX: parseInt(flags.x) || 0, translateY: parseInt(flags.y) || 0, unit: 'EMU' }
            }
          }
        }
      ];
      if (flags.bg) {
        const [r, g, b] = flags.bg.split(',').map(Number);
        requests.push({
          updateShapeProperties: {
            objectId: elementId,
            shapeProperties: { shapeBackgroundFill: { solidFill: { color: { rgbColor: { red: r, green: g, blue: b } } } } },
            fields: 'shapeBackgroundFill'
          }
        });
      }
      await slidesApi.presentations.batchUpdate({ presentationId: presId, requestBody: { requests } });
      out({ success: true, data: { id: presId, elementId, slide: flags.slide, shapeType: flags.type.toUpperCase() } });
    } catch (e) { err(`add-shape failed: ${e.message}`); }
  },

  // ─── Docs Editing ─────────────────────────────────────────────

  async 'doc-find-replace'(positional, flags) {
    const [docId] = positional;
    if (!docId || !flags.old || !flags.new) err('Usage: gdrive doc-find-replace <docId> --old "text" --new "replacement" [--match-case]');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const res = await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            replaceAllText: {
              containsText: { text: flags.old, matchCase: !!flags['match-case'] },
              replaceText: flags.new
            }
          }]
        }
      });
      const count = res.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
      out({ success: true, data: { docId, old: flags.old, new: flags.new, replacements: count } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-find-replace failed: ${e.message}`);
    }
  },

  async 'doc-insert'(positional, flags) {
    const [docId] = positional;
    if (!docId || !flags.text || !flags.at) err('Usage: gdrive doc-insert <docId> --at <index|end> --text <text>');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      let index = parseInt(flags.at);
      if (flags.at === 'end') {
        const doc = await docs.documents.get({ documentId: docId });
        const body = doc.data.body?.content || [];
        index = body[body.length - 1]?.endIndex - 1 || 1;
      }
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: [{ insertText: { location: { index }, text: flags.text } }] }
      });
      out({ success: true, data: { docId, insertedAt: index, length: flags.text.length } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-insert failed: ${e.message}`);
    }
  },

  async 'doc-delete'(positional, flags) {
    const [docId] = positional;
    if (!docId || !flags.start || !flags.end) err('Usage: gdrive doc-delete <docId> --start <index> --end <index>');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: [{ deleteContentRange: { range: { startIndex: parseInt(flags.start), endIndex: parseInt(flags.end) } } }] }
      });
      out({ success: true, data: { docId, deletedFrom: parseInt(flags.start), deletedTo: parseInt(flags.end) } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-delete failed: ${e.message}`);
    }
  },

  // ─── File Transfer ────────────────────────────────────────────

  async export(positional, flags) {
    const [fileId] = positional;
    if (!fileId || !flags.format) err('Usage: gdrive export <fileId> --format pdf|docx|csv|xlsx|pptx|txt [--output <path>]');
    const mimeMap = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      csv: 'text/csv',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain'
    };
    const mimeType = mimeMap[flags.format.toLowerCase()];
    if (!mimeType) err(`Unsupported format: ${flags.format}. Use: ${Object.keys(mimeMap).join(', ')}`);
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      // Get filename for default output
      const meta = await drive.files.get({ fileId, fields: 'name', supportsAllDrives: true });
      const outputPath = flags.output || `${meta.data.name}.${flags.format.toLowerCase()}`;
      const res = await drive.files.export({ fileId, mimeType }, { responseType: 'stream' });
      const dest = fs.createWriteStream(outputPath);
      await new Promise((resolve, reject) => { res.data.pipe(dest).on('finish', resolve).on('error', reject); });
      out({ success: true, data: { fileId, format: flags.format, output: outputPath } });
    } catch (e) {
      if (e.code === 404) err(`File not found: ${fileId}`, EXIT.NOT_FOUND);
      err(`export failed: ${e.message}`);
    }
  },

  async upload(positional, flags) {
    const [localPath] = positional;
    if (!localPath) err('Usage: gdrive upload <localPath> [--name <name>] [--parent <folderId>] [--replace <existingFileId>] [--convert-to doc|sheet|slides]');
    if (!fs.existsSync(localPath)) err(`File not found: ${localPath}`);
    const convertMap = { doc: 'application/vnd.google-apps.document', sheet: 'application/vnd.google-apps.spreadsheet', slides: 'application/vnd.google-apps.presentation' };
    const extMime = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv', '.txt': 'text/plain', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.html': 'text/html', '.md': 'text/markdown', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const fileName = flags.name || path.basename(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeType = extMime[ext] || 'application/octet-stream';
      const media = { mimeType, body: fs.createReadStream(localPath) };
      let res;
      if (flags.replace) {
        res = await drive.files.update({ fileId: flags.replace, media, fields: 'id, name, webViewLink', supportsAllDrives: true });
      } else {
        const meta = { name: fileName };
        if (flags.parent) meta.parents = [flags.parent];
        if (flags['convert-to'] && convertMap[flags['convert-to']]) meta.mimeType = convertMap[flags['convert-to']];
        res = await drive.files.create({ requestBody: meta, media, fields: 'id, name, webViewLink', supportsAllDrives: true });
      }
      out({ success: true, data: { id: res.data.id, name: res.data.name, url: res.data.webViewLink } });
    } catch (e) { err(`upload failed: ${e.message}`); }
  },

  async download(positional, flags) {
    const [fileId] = positional;
    if (!fileId) err('Usage: gdrive download <fileId> [--output <path>]');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const meta = await drive.files.get({ fileId, fields: 'name', supportsAllDrives: true });
      const outputPath = flags.output || meta.data.name;
      const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
      const dest = fs.createWriteStream(outputPath);
      await new Promise((resolve, reject) => { res.data.pipe(dest).on('finish', resolve).on('error', reject); });
      out({ success: true, data: { fileId, output: outputPath } });
    } catch (e) {
      if (e.code === 404) err(`File not found: ${fileId}`, EXIT.NOT_FOUND);
      err(`download failed: ${e.message}`);
    }
  },

  // ─── Docs (Rich Formatting) ─────────────────────────────────

  async 'create-doc'(positional, flags) {
    const name = positional.join(' ').trim();
    if (!name) err('Usage: gdrive create-doc <name> [--md "markdown"] [--from-md file.md] [--parent <id>]');
    try {
      const auth = await getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth });

      const meta = { name, mimeType: 'application/vnd.google-apps.document' };
      if (flags.parent) meta.parents = [flags.parent];
      const file = await drive.files.create({ requestBody: meta, fields: 'id, webViewLink', supportsAllDrives: true });
      const docId = file.data.id;

      const markdown = readMarkdownInput(flags);
      if (markdown) {
        const { requests, tables } = generateDocRequests(markdown);
        if (requests.length > 0) {
          await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
        }
        await processTables(docs, docId, tables);
      }

      out({ success: true, data: { id: docId, name, url: file.data.webViewLink } });
    } catch (e) { err(`create-doc failed: ${e.message}`); }
  },

  async 'format-doc'(positional, flags) {
    const [docId] = positional;
    if (!docId) err('Usage: gdrive format-doc <docId> --md "markdown" | --from-md file.md [--replace]');
    const markdown = readMarkdownInput(flags);
    if (!markdown) err('Provide --md or --from-md');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      const doc = await docs.documents.get({ documentId: docId });
      const endIndex = doc.data.body.content.slice(-1)[0]?.endIndex || 1;

      let requests = [];
      if (flags.replace && endIndex > 2) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
        // Reset formatting on the remaining paragraph so inserts don't inherit stale styles
        requests.push({ updateTextStyle: {
          range: { startIndex: 1, endIndex: 2 },
          textStyle: {},
          fields: 'bold,italic,underline,strikethrough,fontSize,foregroundColor,link,weightedFontFamily,baselineOffset'
        }});
        requests.push({ updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 2 },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType'
        }});
      }

      const insertAt = flags.replace ? 1 : endIndex - 1;
      const { requests: fmtReqs, tables } = generateDocRequests(markdown, insertAt);
      requests.push(...fmtReqs);

      if (requests.length > 0) {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
      }
      await processTables(docs, docId, tables);

      out({ success: true, data: { docId, action: flags.replace ? 'replaced' : 'appended' } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`format-doc failed: ${e.message}`);
    }
  },

  async 'doc-append'(positional, flags) {
    const [docId, ...rest] = positional;
    if (!docId) err('Usage: gdrive doc-append <docId> [markdown] [--md "markdown"] [--from-md file.md]');
    const markdown = readMarkdownInput(flags) || rest.join(' ').trim();
    if (!markdown) err('Provide markdown as argument, --md, or --from-md');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      const doc = await docs.documents.get({ documentId: docId });
      const endIndex = doc.data.body.content.slice(-1)[0]?.endIndex || 1;

      const { requests, tables } = generateDocRequests('\n' + markdown, endIndex - 1);
      if (requests.length > 0) {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
        await processTables(docs, docId, tables);
      }

      out({ success: true, data: { docId, action: 'appended' } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-append failed: ${e.message}`);
    }
  },

  async 'doc-edit'(positional, flags) {
    const [docId] = positional;
    if (!docId) err('Usage: gdrive doc-edit <docId> --old "text" --new "text" | --section "Heading" --md "content"');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const docRes = await docs.documents.get({ documentId: docId });
      const doc = docRes.data;

      if (flags.section) {
        // === Section replace mode ===
        const markdown = readMarkdownInput(flags);
        if (!markdown) err('Section mode requires --md or --from-md');

        const { sections } = buildTextMap(doc);
        const target = sections.find(s => s.heading.toLowerCase() === flags.section.toLowerCase());
        if (!target) {
          const available = sections.map(s => `  "${s.heading}" (H${s.level})`).join('\n');
          err(`Section "${flags.section}" not found.\nAvailable sections:\n${available}`);
        }

        const mdTrimmed = markdown.trimStart();
        const replaceHeading = /^#{1,6}\s/.test(mdTrimmed);

        let headingEndIndex = target.startIndex;
        for (const element of doc.body.content || []) {
          if (element.startIndex === target.startIndex && element.paragraph) {
            headingEndIndex = element.endIndex;
            break;
          }
        }

        const deleteFrom = replaceHeading ? target.startIndex : headingEndIndex;
        const deleteTo = target.endIndex;
        const requests = [];

        if (deleteTo > deleteFrom) {
          const lastElement = doc.body.content.slice(-1)[0];
          const docEnd = lastElement?.endIndex || 1;
          const safeEnd = Math.min(deleteTo, docEnd - 1);
          if (safeEnd > deleteFrom) {
            requests.push({ deleteContentRange: { range: { startIndex: deleteFrom, endIndex: safeEnd } } });
          }
        }

        const { requests: fmtReqs, tables } = generateDocRequests(markdown, deleteFrom);
        requests.push(...fmtReqs);

        if (requests.length > 0) {
          await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
          await processTables(docs, docId, tables);
        }

        out({ success: true, data: { docId, action: 'section-replaced', section: flags.section } });

      } else if (flags.old) {
        // === Find-and-replace mode ===
        const { plaintext, indexMap } = buildTextMap(doc);
        const searchText = flags.old;

        const matches = [];
        let searchFrom = 0;
        while (true) {
          const pos = plaintext.indexOf(searchText, searchFrom);
          if (pos === -1) break;
          matches.push({
            charStart: pos, charEnd: pos + searchText.length,
            docStart: indexMap[pos], docEnd: indexMap[pos + searchText.length - 1] + 1
          });
          searchFrom = pos + 1;
        }

        if (matches.length === 0) {
          const lower = searchText.toLowerCase();
          const idx = plaintext.toLowerCase().indexOf(lower);
          if (idx !== -1) {
            const context = plaintext.slice(Math.max(0, idx - 20), idx + searchText.length + 20);
            err(`Not found (exact). Did you mean: "...${context}..."`);
          } else {
            err(`"${searchText}" not found in document.`);
          }
        }

        if (matches.length > 1 && !flags.all) {
          const previews = matches.slice(0, 3).map(m => {
            const context = plaintext.slice(Math.max(0, m.charStart - 15), m.charEnd + 15);
            return `  "...${context}..."`;
          }).join('\n');
          err(`Found ${matches.length} matches. Use --all to replace all.\n${previews}`);
        }

        const toReplace = flags.all ? matches : [matches[0]];
        const replacement = flags['new-md'] || flags.new;
        const isMarkdown = !!flags['new-md'];
        if (!replacement) err('Provide --new or --new-md for replacement text');

        const requests = [];
        for (const match of [...toReplace].reverse()) {
          requests.push({ deleteContentRange: { range: { startIndex: match.docStart, endIndex: match.docEnd } } });
          if (isMarkdown) {
            const { requests: fmtReqs } = generateDocRequests(replacement, match.docStart);
            requests.push(...fmtReqs);
          } else {
            requests.push({ insertText: { location: { index: match.docStart }, text: replacement } });
          }
        }

        if (requests.length > 0) {
          await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
        }

        out({ success: true, data: { docId, action: 'find-replaced', replacements: toReplace.length } });

      } else {
        err('Provide --old for find-and-replace, or --section for section replace');
      }
    } catch (e) {
      if (e.code === 409) err('Conflict: document was modified. Retry.');
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-edit failed: ${e.message}`);
    }
  },

  async 'read-md'(positional, flags) {
    const [docId] = positional;
    if (!docId) err('Usage: gdrive read-md <docId> [--tab <name|index>] [--section "Heading"]');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const { docData } = await fetchDoc(docs, docId, flags.tab);
      const md = docToMarkdown(docData, flags.section);
      // Output raw markdown (not JSON) for direct use
      console.log(md);
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`read-md failed: ${e.message}`);
    }
  },

  async 'parse-md'(positional, flags) {
    const [filePath] = positional;
    if (!filePath) err('Usage: gdrive parse-md <file.md>');
    if (!fs.existsSync(filePath)) err(`File not found: ${filePath}`);
    try {
      const markdown = fs.readFileSync(filePath, 'utf8');
      const result = generateDocRequests(markdown);
      console.log('Text to insert:');
      console.log(result.text);
      console.log('\nRequests:');
      console.log(JSON.stringify(result.requests, null, 2));
      if (result.tables && result.tables.length > 0) {
        console.log('\nTables:');
        console.log(JSON.stringify(result.tables, null, 2));
      }
    } catch (e) { err(`parse-md failed: ${e.message}`); }
  },

  // ─── Forms ───────────────────────────────────────────────────

  async 'read-form'(positional, flags) {
    const [formId] = positional;
    if (!formId) err('Usage: gdrive read-form <formId>', EXIT.API);
    try {
      const auth = await getAuthClient();
      const forms = google.forms({ version: 'v1', auth });
      const res = await forms.forms.get({ formId });
      const form = res.data;

      let md = `# ${form.info?.title || 'Untitled Form'}\n\n`;
      if (form.info?.description) md += `${form.info.description}\n\n`;

      for (const item of form.items || []) {
        if (item.pageBreakItem) {
          md += `---\n\n## ${item.title || 'Section'}\n\n`;
          if (item.description) md += `${item.description}\n\n`;
          continue;
        }
        if (item.questionItem) {
          const q = item.questionItem.question;
          md += `### ${item.title || 'Untitled'}\n`;
          if (item.description) md += `*${item.description}*\n`;
          if (q.choiceQuestion) {
            md += `*Type: ${q.choiceQuestion.type}*\n`;
            for (const opt of q.choiceQuestion.options || []) {
              md += `- ${opt.value}\n`;
            }
          } else if (q.textQuestion) {
            md += `*Type: ${q.textQuestion.paragraph ? 'Long text' : 'Short text'}*\n`;
          } else if (q.scaleQuestion) {
            md += `*Type: Scale (${q.scaleQuestion.low} to ${q.scaleQuestion.high})*\n`;
          } else if (q.dateQuestion) {
            md += `*Type: Date*\n`;
          } else if (q.timeQuestion) {
            md += `*Type: Time*\n`;
          } else if (q.fileUploadQuestion) {
            md += `*Type: File upload*\n`;
          }
          if (q.required) md += `**Required**\n`;
          md += '\n';
        }
        if (item.questionGroupItem) {
          md += `### ${item.title || 'Question Group'}\n`;
          if (item.description) md += `*${item.description}*\n`;
          const grid = item.questionGroupItem.grid;
          if (grid) {
            md += `*Columns:*\n`;
            for (const col of grid.columns?.options || []) {
              md += `- ${col.value}\n`;
            }
          }
          for (const q of item.questionGroupItem.questions || []) {
            if (q.rowQuestion) md += `- ${q.rowQuestion.title}\n`;
          }
          md += '\n';
        }
        if (item.textItem) {
          if (item.title) md += `**${item.title}**\n`;
          if (item.description) md += `${item.description}\n`;
          md += '\n';
        }
        if (item.imageItem) md += `[Image: ${item.title || 'Untitled'}]\n\n`;
        if (item.videoItem) md += `[Video: ${item.title || 'Untitled'}]\n\n`;
      }

      console.log(md);
    } catch (e) {
      if (e.code === 404) err(`Form not found: ${formId}`, EXIT.NOT_FOUND);
      if (e.code === 403) err(`Forms API access denied. Re-auth with: gdrive auth`, EXIT.AUTH);
      err(`read-form failed: ${e.message}`, EXIT.API);
    }
  },

  // ─── Doc Tabs ─────────────────────────────────────────────────

  async 'add-tab'(positional, flags) {
    const [docId, ...titleParts] = positional;
    const tabTitle = titleParts.join(' ').trim();
    if (!docId || !tabTitle) err('Usage: gdrive add-tab <docId> <tabTitle> [--md "content"] [--from-md file.md]');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      // Create the new tab
      const createRes = await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            addDocumentTab: {
              tabProperties: { title: tabTitle }
            }
          }]
        }
      });

      const reply = createRes.data.replies?.[0]?.addDocumentTab;
      const newTabId = reply?.tabProperties?.tabId;
      if (!newTabId) err('Failed to get new tab ID from API response');

      // Add content if provided
      const markdown = readMarkdownInput(flags);
      if (markdown) {
        const { requests, tables } = generateDocRequests(markdown);

        // Add tabId to all location/range references
        const tabRequests = requests.map(req => {
          const r = JSON.parse(JSON.stringify(req));
          for (const action of Object.values(r)) {
            if (action && typeof action === 'object') {
              if (action.location) action.location.tabId = newTabId;
              if (action.range) action.range.tabId = newTabId;
            }
          }
          return r;
        });

        if (tabRequests.length > 0) {
          await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: tabRequests } });
        }

        // Handle tables in the new tab
        if (tables && tables.length > 0) {
          for (const tableInfo of [...tables].reverse()) {
            await docs.documents.batchUpdate({
              documentId: docId,
              requestBody: {
                requests: [{ insertTable: { rows: tableInfo.numRows, columns: tableInfo.numCols, location: { index: tableInfo.textIndex, tabId: newTabId } } }]
              }
            });
            // Re-read doc to find table in the new tab
            const docRes = await docs.documents.get({ documentId: docId, includeTabsContent: true });
            const tab = docRes.data.tabs.find(t => t.tabProperties.tabId === newTabId);
            if (!tab) continue;
            const tabDoc = { body: tab.documentTab.body, lists: tab.documentTab.lists || {} };
            const tablesInDoc = findTablesInDoc(tabDoc);
            if (tablesInDoc.length > 0) {
              let closest = tablesInDoc[0];
              let minDist = Math.abs(closest.startIndex - tableInfo.textIndex);
              for (const t of tablesInDoc) {
                const dist = Math.abs(t.startIndex - tableInfo.textIndex);
                if (dist < minDist) { minDist = dist; closest = t; }
              }
              // Populate table cells (with tabId)
              const cellRequests = [];
              const { cells } = tableInfo;
              for (let r = cells.length - 1; r >= 0; r--) {
                for (let c = cells[r].length - 1; c >= 0; c--) {
                  const cellIndex = closest.rows[r]?.[c]?.startIndex;
                  if (cellIndex !== undefined && cells[r][c]) {
                    cellRequests.push({ insertText: { location: { index: cellIndex, tabId: newTabId }, text: cells[r][c] } });
                  }
                }
              }
              if (cellRequests.length > 0) {
                await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: cellRequests } });
              }
              // Bold header row
              const updatedRes = await docs.documents.get({ documentId: docId, includeTabsContent: true });
              const updatedTab = updatedRes.data.tabs.find(t => t.tabProperties.tabId === newTabId);
              if (updatedTab) {
                const updatedTabDoc = { body: updatedTab.documentTab.body, lists: updatedTab.documentTab.lists || {} };
                const updatedTables = findTablesInDoc(updatedTabDoc);
                if (updatedTables.length > 0) {
                  let target = updatedTables[0];
                  let minD = Math.abs(target.startIndex - closest.startIndex);
                  for (const t of updatedTables) {
                    const d = Math.abs(t.startIndex - closest.startIndex);
                    if (d < minD) { minD = d; target = t; }
                  }
                  const hdrReqs = [];
                  for (const cell of target.rows[0] || []) {
                    if (cell.startIndex < cell.endIndex - 1) {
                      hdrReqs.push({ updateTextStyle: { range: { startIndex: cell.startIndex, endIndex: cell.endIndex - 1, tabId: newTabId }, textStyle: { bold: true }, fields: 'bold' } });
                    }
                  }
                  if (hdrReqs.length > 0) {
                    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: hdrReqs } });
                  }
                }
              }
            }
          }
        }
      }

      out({ success: true, data: { docId, tabTitle, tabId: newTabId } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`add-tab failed: ${e.message}`);
    }
  },

  // ─── Doc Table Row ────────────────────────────────────────────

  async 'doc-table-add-row'(positional, flags) {
    const [docId] = positional;
    if (!docId || !flags.cells) err('Usage: gdrive doc-table-add-row <docId> --cells "cell1|cell2|cell3" [--table N] [--match "text"] [--after N]');
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const docRes = await docs.documents.get({ documentId: docId });
      const doc = docRes.data;
      const tables = findTablesInDoc(doc);
      if (tables.length === 0) err('No tables found in document.');

      // Select target table
      let tableIdx = flags.table !== undefined ? parseInt(flags.table) : 0;
      if (flags.match) {
        const matchLower = flags.match.toLowerCase();
        tableIdx = -1;
        for (const element of doc.body.content || []) {
          if (!element.table) continue;
          let tableText = '';
          for (const row of element.table.tableRows || []) {
            for (const cell of row.tableCells || []) {
              for (const content of cell.content || []) {
                if (content.paragraph) {
                  for (const el of content.paragraph.elements || []) {
                    if (el.textRun?.content) tableText += el.textRun.content;
                  }
                }
              }
            }
          }
          if (tableText.toLowerCase().includes(matchLower)) {
            tableIdx = tables.findIndex(t => t.startIndex === element.startIndex);
            break;
          }
        }
        if (tableIdx === -1) err(`No table found containing "${flags.match}"`);
      }

      if (tableIdx >= tables.length) err(`Table index ${tableIdx} out of range (${tables.length} tables found)`);
      const targetTable = tables[tableIdx];
      const insertAfterRow = flags.after !== undefined ? parseInt(flags.after) : targetTable.rows.length - 1;

      // Insert the row
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            insertTableRow: {
              tableCellLocation: {
                tableStartLocation: { index: targetTable.startIndex },
                rowIndex: insertAfterRow,
                columnIndex: 0
              },
              insertBelow: true
            }
          }]
        }
      });

      // Re-fetch to get new cell indices
      const updatedRes = await docs.documents.get({ documentId: docId });
      const updatedTables = findTablesInDoc(updatedRes.data);
      let updated = updatedTables[0];
      let minDist = Math.abs(updated.startIndex - targetTable.startIndex);
      for (const t of updatedTables) {
        const dist = Math.abs(t.startIndex - targetTable.startIndex);
        if (dist < minDist) { minDist = dist; updated = t; }
      }
      const newRow = updated.rows[insertAfterRow + 1];
      if (!newRow) err('Failed to find newly inserted row.');

      // Fill cells (reverse order to preserve indices)
      const cellTexts = flags.cells.split('|');
      const insertRequests = [];
      for (let c = cellTexts.length - 1; c >= 0; c--) {
        const text = cellTexts[c].trim();
        const cell = newRow[c];
        if (text && cell) {
          insertRequests.push({ insertText: { location: { index: cell.startIndex }, text } });
        }
      }
      if (insertRequests.length > 0) {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: insertRequests } });
      }

      out({ success: true, data: { docId, tableIndex: tableIdx, insertedAfterRow: insertAfterRow, cells: cellTexts } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-table-add-row failed: ${e.message}`);
    }
  },

  async 'doc-table-edit-cell'(positional, flags) {
    const [docId] = positional;
    if (!docId || flags.row === undefined || flags.col === undefined) {
      err('Usage: gdrive doc-table-edit-cell <docId> --row N --col N --text "content" [--table N] [--match "text"]');
    }
    try {
      const auth = await getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const docRes = await docs.documents.get({ documentId: docId });
      const doc = docRes.data;
      const tables = findTablesInDoc(doc);
      if (tables.length === 0) err('No tables found in document.');

      // Select target table
      let tableIdx = flags.table !== undefined ? parseInt(flags.table) : 0;
      if (flags.match) {
        const matchLower = flags.match.toLowerCase();
        tableIdx = -1;
        for (const element of doc.body.content || []) {
          if (!element.table) continue;
          let tableText = '';
          for (const row of element.table.tableRows || []) {
            for (const cell of row.tableCells || []) {
              for (const content of cell.content || []) {
                if (content.paragraph) {
                  for (const el of content.paragraph.elements || []) {
                    if (el.textRun?.content) tableText += el.textRun.content;
                  }
                }
              }
            }
          }
          if (tableText.toLowerCase().includes(matchLower)) {
            tableIdx = tables.findIndex(t => t.startIndex === element.startIndex);
            break;
          }
        }
        if (tableIdx === -1) err(`No table found containing "${flags.match}"`);
      }

      if (tableIdx >= tables.length) err(`Table index ${tableIdx} out of range (${tables.length} tables found)`);
      const targetTable = tables[tableIdx];
      const rowIdx = parseInt(flags.row);
      const colIdx = parseInt(flags.col);
      const cell = targetTable.rows[rowIdx]?.[colIdx];
      if (!cell) err(`Cell [row=${rowIdx}, col=${colIdx}] not found in table ${tableIdx}`);

      const newText = flags.text !== undefined ? String(flags.text) : '';
      const requests = [];

      // Clear existing cell content (if any), then insert new text
      if (cell.endIndex - cell.startIndex > 1) {
        requests.push({ deleteContentRange: { range: { startIndex: cell.startIndex, endIndex: cell.endIndex - 1 } } });
      }
      if (newText) {
        requests.push({ insertText: { location: { index: cell.startIndex }, text: newText } });
      }

      if (requests.length > 0) {
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
      }

      out({ success: true, data: { docId, tableIndex: tableIdx, row: rowIdx, col: colIdx, text: newText } });
    } catch (e) {
      if (e.code === 404) err(`Document not found: ${docId}`, EXIT.NOT_FOUND);
      err(`doc-table-edit-cell failed: ${e.message}`);
    }
  },

  // ─── Help ──────────────────────────────────────────────────────

  help() {
    console.log(`gdrive-cli - Google Drive CLI for Claude Code

Usage: gdrive <command> [options]

  Search & Browse:
    search <query>               Search files (--max N, --type doc|sheet|folder|slides)
    list [folder-id]             List folder contents (--max N)
    info <file-id>               File metadata

  Read:
    read-doc <id>                Google Doc content (--tab <name|index> for multi-tab docs)
    read-sheet <id>              Sheet content (--range "Sheet1!A1:Z100")
    read-slides <id>             Slides with element IDs (--slide <index>)

  File Management:
    mkdir <name>                 Create folder (--parent <id>)
    rm <id>                      Trash file/folder
    mv <id> <destId>             Move to folder
    rename <id> <newName>        Rename file/folder
    create-text <name>           Create text file (--content "text", --parent <id>)

  File Transfer:
    export <id>                  Export Google file (--format pdf|docx|csv|xlsx|pptx|txt, --output <path>)
    upload <localPath>           Upload file (--name, --parent, --replace <id>, --convert-to doc|sheet|slides)
    download <id>                Download file (--output <path>)

  Sheets:
    create-sheet <name>          Create spreadsheet (--data <json>, --parent <id>)
    update-sheet <id>            Update cells (--range "A1:C3", --data <json>)
    format-sheet <id>            Format cells:
        --ops <json>               Full ops array (cells/text/number/borders/merge/conditional)
        --range + quick flags:     --bold --italic --bg "r,g,b" --number "$#,##0.00"
                                   --merge [all|columns|rows] --borders [solid|dashed|dotted]
                                   --align [left|center|right] --wrap [wrap|clip] --font --size

  Slides:
    create-slides <name>         Create presentation (--from <json>, --parent <id>)
    update-slides <id>           Replace all slides (--from <json>)
    format-slides <id>           Format elements (--ops <json>: text/paragraph/shape/background)
    add-textbox <presId>         Add text box (--slide <id> --text "..." --x --y --w --h)
    add-shape <presId>           Add shape (--slide <id> --type RECTANGLE --x --y --w --h)

  Docs (Rich Formatting):
    create-doc <name>            Create formatted doc (--md, --from-md, --parent)
    format-doc <id>              Apply markdown formatting (--md, --from-md, --replace)
    doc-append <id>              Append formatted markdown (--md, --from-md)
    doc-edit <id>                Advanced edit:
        Find-replace:              --old "text" --new "text" [--new-md "**bold**"] [--all]
        Section replace:           --section "Heading" --md "new content" [--from-md file.md]
    read-md <id>                 Read doc as markdown (--tab <name|index>, --section "Heading")
    parse-md <file>              Test markdown parsing (offline, no API call)

  Docs (Plain Text):
    doc-find-replace <id>        Find and replace text (--old "text" --new "replacement" [--match-case])
    doc-insert <id>              Insert text (--at <index|end> --text "content")
    doc-delete <id>              Delete text range (--start <index> --end <index>)
    doc-table-add-row <id>       Add row to existing table:
        --cells "a|b|c"            Pipe-delimited cell content (required)
        --table N                  Target table index, 0-based (default: 0)
        --match "text"             Find table containing this text
        --after N                  Insert after row index (default: last row)
    doc-table-edit-cell <id>     Edit a single table cell:
        --row N --col N            Cell coordinates, 0-based (required)
        --text "content"           New cell text (omit or empty to clear)
        --table N                  Target table index (default: 0)
        --match "text"             Find table containing this text

  Doc Tabs:
    add-tab <docId> <title>      Add new tab to doc (--md, --from-md for content)

  Forms:
    read-form <formId>           Read Google Form as markdown (questions, options, sections)

  Auth:
    auth                         Authenticate (OAuth flow)

Data Input (--data, --from, --ops):
  file.json                      Read from JSON file
  -                              Read from stdin (pipe-friendly)
  '[["A","B"]]'                  Inline JSON string

Environment Variables:
  GDRIVE_CREDENTIALS_PATH        Path to OAuth credentials.json (default: ~/.config/gdrive-cli/credentials.json)
  GDRIVE_TOKEN_PATH              Path to stored tokens (default: ~/.config/gdrive-cli/tokens.json)

Examples:
  gdrive search "Budget" --type sheet
  gdrive create-doc "My Report" --from-md report.md
  gdrive doc-edit 1abc --old "draft" --new "final"
  gdrive create-sheet "Data" --data '[["Name","Score"],["Alice","95"]]'
  gdrive format-sheet 1abc --range "A1:B1" --bold --bg "0.9,0.9,0.9"
  gdrive read-slides 1abc --slide 0`);
    process.exit(0);
  }
};

// Main
async function main() {
  const [cmd, ...rawArgs] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    commands.help();
  }

  const { flags, positional } = parseArgs(rawArgs);

  if (flags.help || flags.h) {
    commands.help();
  }

  if (!commands[cmd]) {
    err(`Unknown command: ${cmd}. Run 'gdrive --help' for usage.`, EXIT.API);
  }

  await commands[cmd](positional, flags);
}

main().catch(e => {
  err(`Unexpected error: ${e.message}`, EXIT.API);
});
