# gdocs-cli

Create and format Google Docs from markdown — headings, bold, italic, lists, tables, code blocks, blockquotes, and smart typography.

Built as a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) for AI-assisted document creation.

## Quick Start

```bash
cd cli
npm install
npm link
```

Set up Google OAuth credentials (see [Setup](#setup) below), then:

```bash
# Create a formatted doc from a markdown file
gdocs create "My Document" --from-markdown notes.md

# Inline markdown
gdocs create "Quick Doc" -m "# Title\n\n**Bold** and *italic* text\n\n- Bullet one\n- Bullet two"

# Format an existing doc
gdocs format <docId> --from-markdown content.md --replace

# Append content
gdocs append <docId> "## New Section\nMore content here"

# Read a doc
gdocs get <docId>

# Test parsing without API calls
gdocs parse myfile.md
```

## Supported Markdown

| Syntax | Renders As |
|--------|-----------|
| `# H1` through `###### H6` | Google Docs heading styles |
| `**bold**` | Bold |
| `*italic*` | Italic |
| `***both***` | Bold + italic |
| `[text](url)` | Hyperlink |
| `` `code` `` | Monospace with gray background |
| `- item` / `* item` | Bullet list |
| `1. item` | Numbered list |
| `\| table \|` | Native Google Docs table |
| `> quote` | Indented blockquote with left border |
| ` ``` code ``` ` | Code block (Consolas, 10pt) |
| `---` | Horizontal rule |

**Smart typography** is applied automatically:
- `"straight quotes"` → "curly quotes"
- `it's` → smart apostrophe
- `...` → ellipsis (…)
- `--` → en-dash (–), `---` → em-dash (—)

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Docs API** and **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Choose **Desktop application** as the type
6. Download the JSON file

### 2. Place Credentials

**Default locations:**
```
~/.config/gdocs-cli/credentials.json   # OAuth client config
~/.config/gdocs-cli/tokens.json        # Auth tokens (created after first login)
```

**Or use environment variables:**
```bash
export GDOCS_CREDENTIALS_PATH=/your/path/credentials.json
export GDOCS_TOKEN_PATH=/your/path/tokens.json
```

> **Sharing credentials across Google CLIs:** If you already have Google OAuth set up for another tool, you can point both env vars at your existing credential files.

### 3. First Authentication

Run any command — it will prompt you to authenticate via browser if tokens don't exist yet.

## Using as a Claude Code Skill

Drop the entire repo into your skills directory:

```bash
# User-level (available in all projects)
cp -r gdocs-cli ~/.claude/skills/gdocs-cli

# Or project-level
cp -r gdocs-cli .claude/skills/gdocs-cli
```

Then install dependencies:
```bash
cd ~/.claude/skills/gdocs-cli/cli && npm install
```

Claude will automatically detect and use the skill when you ask it to create or format Google Docs.

## License

MIT
