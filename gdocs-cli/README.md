# gdocs-cli

Create and format Google Docs from markdown — headings, bold, italic, lists, tables, code blocks, blockquotes, and smart typography.

Built as a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill for AI-assisted document creation.

<img width="720" alt="image" src="https://github.com/user-attachments/assets/8e5ed831-0188-4546-a071-dff4a7d177f7" />

## Quick Start

```bash
git clone https://github.com/benjammann/google-cli-skills.git
cd google-cli-skills/gdocs-cli/cli
npm install
npm link  # Makes 'gdocs' available globally
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
| `---` | Horizontal rule (styled line characters*) |

*\*The Google Docs API has no native horizontal rule insert — rendered as centered box-drawing characters.*

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
~/.config/gdocs-cli/tokens.json        # OAuth tokens (see step 3)
```

**Or use environment variables:**
```bash
export GDOCS_CREDENTIALS_PATH=/your/path/credentials.json
export GDOCS_TOKEN_PATH=/your/path/tokens.json
```

> **Sharing credentials across Google CLIs:** If you already have Google OAuth set up for another tool, you can point both env vars at your existing credential files.

### 3. Get Tokens

The CLI needs OAuth tokens to authenticate. You can get these by:

- Using an existing Google OAuth tool (e.g., GDrive MCP) and copying its `tokens.json`
- Running a one-time OAuth flow with a script like [google-auth-library](https://github.com/googleapis/google-auth-library-nodejs#oauth2)

Place the resulting tokens file at the path above (or set `GDOCS_TOKEN_PATH`).

## Using as a Claude Code Skill

Copy the `gdocs-cli` folder into your skills directory:

```bash
# User-level (available in all projects)
cp -r google-cli-skills/gdocs-cli ~/.claude/skills/gdocs-cli
cd ~/.claude/skills/gdocs-cli/cli && npm install

# Or project-level
cp -r google-cli-skills/gdocs-cli .claude/skills/gdocs-cli
cd .claude/skills/gdocs-cli/cli && npm install
```

Claude will automatically detect and use the skill when you ask it to create or format Google Docs.

## License

MIT
