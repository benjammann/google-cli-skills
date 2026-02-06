#!/usr/bin/env node

/**
 * Google Docs CLI - Rich markdown formatting via Google Docs API
 *
 * Converts markdown to beautifully formatted Google Docs with headers,
 * bold, italic, lists, tables, code blocks, and more.
 */

import { program } from 'commander';
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { generateDocRequests } from './markdown-parser.js';

// Default credential paths — override via environment variables:
//   GDOCS_CREDENTIALS_PATH  - path to OAuth client credentials JSON
//   GDOCS_TOKEN_PATH        - path to OAuth tokens JSON
const CREDENTIALS_PATH = process.env.GDOCS_CREDENTIALS_PATH
  || join(homedir(), '.config', 'gdocs-cli', 'credentials.json');
const TOKEN_PATH = process.env.GDOCS_TOKEN_PATH
  || join(homedir(), '.config', 'gdocs-cli', 'tokens.json');

/**
 * Get authenticated OAuth2 client (shared by Docs and Drive)
 */
function getAuthClient() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error('Error: OAuth credentials not found at', CREDENTIALS_PATH);
    console.error('See README for setup instructions.');
    process.exit(1);
  }

  if (!existsSync(TOKEN_PATH)) {
    console.error('Error: OAuth tokens not found at', TOKEN_PATH);
    console.error('Run `gdocs auth` to authenticate.');
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
  const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));

  const { client_id, client_secret } = credentials.installed || credentials.web;
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(token);

  return oauth2Client;
}

/**
 * Find tables in document and get cell indices
 */
function findTablesInDoc(doc) {
  const tables = [];
  for (const element of doc.body.content || []) {
    if (element.table) {
      const tableData = {
        startIndex: element.startIndex,
        rows: []
      };
      for (const row of element.table.tableRows || []) {
        const rowCells = [];
        for (const cell of row.tableCells || []) {
          const firstPara = cell.content?.[0];
          if (firstPara?.paragraph) {
            rowCells.push({
              startIndex: firstPara.startIndex,
              endIndex: firstPara.endIndex
            });
          }
        }
        tableData.rows.push(rowCells);
      }
      tables.push(tableData);
    }
  }
  return tables;
}

/**
 * Populate table cells with content and format header row as bold
 */
async function populateTable(docs, docId, tableInDoc, tableData) {
  const requests = [];
  const { cells } = tableData;

  // Insert text into each cell (reverse order to maintain indices)
  for (let r = cells.length - 1; r >= 0; r--) {
    for (let c = cells[r].length - 1; c >= 0; c--) {
      const cellIndex = tableInDoc.rows[r]?.[c]?.startIndex;
      if (cellIndex !== undefined && cells[r][c]) {
        requests.push({
          insertText: {
            location: { index: cellIndex },
            text: cells[r][c]
          }
        });
      }
    }
  }

  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests }
    });
  }

  // Format header row (bold) — re-read doc for updated indices
  const updatedDoc = await docs.documents.get({ documentId: docId });
  const updatedTables = findTablesInDoc(updatedDoc.data);

  if (updatedTables.length > 0) {
    const headerRequests = [];
    const firstTable = updatedTables[0];
    const headerRow = firstTable.rows[0];

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
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: headerRequests }
      });
    }
  }
}

/**
 * Process tables in document (insert structure, populate cells)
 * Tables are processed in reverse order to preserve document indices
 */
async function processTables(docs, docId, tables) {
  if (!tables || tables.length === 0) return;

  for (const tableInfo of [...tables].reverse()) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{
          insertTable: {
            rows: tableInfo.numRows,
            columns: tableInfo.numCols,
            location: { index: tableInfo.textIndex }
          }
        }]
      }
    });

    const doc = await docs.documents.get({ documentId: docId });
    const tablesInDoc = findTablesInDoc(doc.data);
    if (tablesInDoc.length > 0) {
      await populateTable(docs, docId, tablesInDoc[tablesInDoc.length - 1], tableInfo);
    }
  }
}

// CLI setup
program
  .name('gdocs')
  .description('Google Docs CLI — create and format docs from markdown')
  .version('1.0.0');

/**
 * Create new doc with markdown content
 */
program
  .command('create <title>')
  .description('Create a new Google Doc with formatted content')
  .option('-f, --from-markdown <file>', 'Markdown file to convert')
  .option('-m, --markdown <text>', 'Inline markdown text')
  .option('-p, --parent <folderId>', 'Parent folder ID')
  .action(async (title, options) => {
    try {
      const auth = getAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth });

      // Create empty doc
      const fileMetadata = {
        name: title,
        mimeType: 'application/vnd.google-apps.document'
      };
      if (options.parent) {
        fileMetadata.parents = [options.parent];
      }

      const file = await drive.files.create({
        resource: fileMetadata,
        fields: 'id, webViewLink'
      });

      const docId = file.data.id;
      console.log('Created doc:', docId);

      // Get markdown content
      let markdown = '';
      if (options.fromMarkdown) {
        if (!existsSync(options.fromMarkdown)) {
          console.error('Markdown file not found:', options.fromMarkdown);
          process.exit(1);
        }
        markdown = readFileSync(options.fromMarkdown, 'utf8');
      } else if (options.markdown) {
        markdown = options.markdown;
      }

      // Apply formatting
      if (markdown) {
        const { requests, tables } = generateDocRequests(markdown);

        if (requests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests }
          });
        }

        await processTables(docs, docId, tables);
        console.log('Applied formatting');
      }

      console.log('URL:', file.data.webViewLink);
      console.log(JSON.stringify({ id: docId, url: file.data.webViewLink }));
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * Format existing doc from markdown
 */
program
  .command('format <docId>')
  .description('Apply markdown formatting to existing doc')
  .option('-f, --from-markdown <file>', 'Markdown file to convert')
  .option('-m, --markdown <text>', 'Inline markdown text')
  .option('--replace', 'Replace all content (default: append)')
  .action(async (docId, options) => {
    try {
      const auth = getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      let markdown = '';
      if (options.fromMarkdown) {
        markdown = readFileSync(options.fromMarkdown, 'utf8');
      } else if (options.markdown) {
        markdown = options.markdown;
      } else {
        console.error('Provide --from-markdown or --markdown');
        process.exit(1);
      }

      // Get current doc state
      const doc = await docs.documents.get({ documentId: docId });
      const endIndex = doc.data.body.content.slice(-1)[0]?.endIndex || 1;

      let requests = [];

      // If replacing, delete existing content first
      if (options.replace && endIndex > 2) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: 1, endIndex: endIndex - 1 }
          }
        });
      }

      const insertAt = options.replace ? 1 : endIndex - 1;
      const { requests: formatRequests, tables } = generateDocRequests(markdown, insertAt);
      requests.push(...formatRequests);

      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests }
        });
      }

      // Process tables in reverse order to preserve indices
      await processTables(docs, docId, tables);

      console.log('Formatting applied to doc:', docId);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * Append markdown content to doc
 */
program
  .command('append <docId> <markdown>')
  .description('Append formatted markdown to existing doc')
  .action(async (docId, markdown) => {
    try {
      const auth = getAuthClient();
      const docs = google.docs({ version: 'v1', auth });

      const doc = await docs.documents.get({ documentId: docId });
      const endIndex = doc.data.body.content.slice(-1)[0]?.endIndex || 1;

      const { requests, tables } = generateDocRequests('\n' + markdown, endIndex - 1);

      if (requests.length > 0) {
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests }
        });
        await processTables(docs, docId, tables);
        console.log('Appended content to doc:', docId);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * Get doc info
 */
program
  .command('get <docId>')
  .description('Get doc info and content')
  .option('--json', 'Output as JSON')
  .action(async (docId, options) => {
    try {
      const auth = getAuthClient();
      const docs = google.docs({ version: 'v1', auth });
      const doc = await docs.documents.get({ documentId: docId });

      if (options.json) {
        console.log(JSON.stringify(doc.data, null, 2));
      } else {
        console.log('Title:', doc.data.title);
        console.log('ID:', doc.data.documentId);

        let text = '';
        for (const element of doc.data.body.content || []) {
          if (element.paragraph) {
            for (const el of element.paragraph.elements || []) {
              if (el.textRun) {
                text += el.textRun.content;
              }
            }
          }
        }
        console.log('\nContent:\n', text);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * Test markdown parsing (no API call)
 */
program
  .command('parse <file>')
  .description('Test markdown parsing without API calls')
  .action((file) => {
    try {
      const markdown = readFileSync(file, 'utf8');
      const result = generateDocRequests(markdown);
      console.log('Text to insert:');
      console.log(result.text);
      console.log('\nRequests:');
      console.log(JSON.stringify(result.requests, null, 2));
      if (result.tables && result.tables.length > 0) {
        console.log('\nTables:');
        console.log(JSON.stringify(result.tables, null, 2));
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
