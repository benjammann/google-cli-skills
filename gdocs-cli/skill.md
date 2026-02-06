# gdocs-cli

Google Docs CLI with rich markdown formatting. Creates and formats docs with headers, bold, italic, bullets, tables, and more via the Google Docs API.

## Triggers

- "gdocs", "google docs cli"
- "create doc with formatting"
- "formatted google doc"

## Commands

```bash
# Create new doc with markdown content
gdocs create "Title" --from-markdown input.md
gdocs create "Title" -m "# Header\n- bullet 1\n- bullet 2"

# Format existing doc
gdocs format <docId> --from-markdown input.md
gdocs format <docId> --replace --from-markdown input.md

# Append to existing doc
gdocs append <docId> "## New Section\n**bold text**"

# Get doc info
gdocs get <docId>
gdocs get <docId> --json

# Test markdown parsing (no API call)
gdocs parse input.md
```

## Supported Markdown

| Syntax | Result |
|--------|--------|
| `# Header` | HEADING_1 |
| `## Header` | HEADING_2 (through H6) |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `***both***` | Bold + italic (nested) |
| `[text](url)` | Clickable hyperlink |
| `` `code` `` | Monospace with background |
| `- item` | Bullet list (with inline formatting) |
| `1. item` | Numbered list |
| `> quote` | Blockquote with left border |
| `---` | Horizontal rule |
| ``` ``` code ``` ``` | Code block |

## Smart Typography (Auto)

| Input | Output |
|-------|--------|
| `"quotes"` | \u201Ccurly quotes\u201D |
| `it's` | it\u2019s (smart apostrophe) |
| `...` | \u2026 (ellipsis) |
| `--` | \u2013 (en-dash) |
| `---` | \u2014 (em-dash) |

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable **Google Docs API** and **Google Drive API**
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download the credentials JSON

### 2. Configure Credentials

Place your OAuth credentials at one of these locations:

**Default path:**
```
~/.config/gdocs-cli/credentials.json
~/.config/gdocs-cli/tokens.json
```

**Or set environment variables:**
```bash
export GDOCS_CREDENTIALS_PATH=/path/to/credentials.json
export GDOCS_TOKEN_PATH=/path/to/tokens.json
```

### 3. Install

```bash
cd ~/.claude/skills/gdocs-cli/cli
npm install
npm link  # Makes 'gdocs' available globally
```

### 4. Get Tokens

The CLI needs an OAuth `tokens.json` file. Get one by using an existing Google OAuth tool (e.g., GDrive MCP) and copying its tokens, or by running a one-time OAuth flow with [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs#oauth2).

## CLI Path

Run directly: `node ~/.claude/skills/gdocs-cli/cli/index.js create "Test"`
