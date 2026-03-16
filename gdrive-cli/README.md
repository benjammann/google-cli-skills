# gdrive-cli

A comprehensive Google Drive CLI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that covers **Docs, Sheets, Slides, Forms, and file management** — all from the command line with zero MCP overhead.

**Key feature:** Rich markdown-to-Google-Docs formatting. Write markdown, get perfectly formatted Google Docs with headings, bold/italic, links, code blocks, tables, blockquotes, and more.

## Quick Start

```bash
# 1. Copy to your Claude Code skills directory
cp -r gdrive-cli ~/.claude/skills/

# 2. Install dependencies
cd ~/.claude/skills/gdrive-cli/cli && npm install

# 3. (Optional) Make it globally available
npm link

# 4. Authenticate
gdrive auth
```

## Commands

### Search & Browse
```bash
gdrive search "quarterly report" --type doc --max 10
gdrive list                          # root folder
gdrive list <folderId> --max 100     # specific folder
gdrive info <fileId>                 # file metadata
```

### Read
```bash
gdrive read-doc <docId>                      # plain text
gdrive read-doc <docId> --tab "Tab Name"     # multi-tab docs
gdrive read-sheet <sheetId> --range "A1:Z100"
gdrive read-slides <presId> --slide 0
gdrive read-md <docId>                       # Google Doc -> markdown
gdrive read-md <docId> --section "Overview"  # specific section only
```

### Docs - Rich Formatting (Markdown -> Google Docs)
```bash
# Create a new formatted doc
gdrive create-doc "My Report" --md "# Report\n\n**Key findings:**\n- Item 1\n- Item 2"
gdrive create-doc "My Report" --from-md report.md --parent <folderId>

# Append formatted content
gdrive doc-append <docId> --md "## New Section\n\nMore content here."

# Surgical edits (find-and-replace)
gdrive doc-edit <docId> --old "draft version" --new "final version"
gdrive doc-edit <docId> --old "plain text" --new-md "**formatted text**"
gdrive doc-edit <docId> --old "old text" --new "new text" --all   # replace all matches

# Section replace (replaces everything under a heading)
gdrive doc-edit <docId> --section "Introduction" --md "## Introduction\n\nNew intro content."

# Full doc replace (destructive - replaces entire doc)
gdrive format-doc <docId> --from-md report.md --replace

# Plain text operations
gdrive doc-find-replace <docId> --old "typo" --new "fixed" --match-case
gdrive doc-insert <docId> --at end --text "Appendix content"
gdrive doc-delete <docId> --start 100 --end 200
```

### Docs - Tables
```bash
# Add a row to an existing table
gdrive doc-table-add-row <docId> --cells "Alice|95|A"
gdrive doc-table-add-row <docId> --cells "Bob|87|B" --match "Student" --after 2

# Edit a specific cell
gdrive doc-table-edit-cell <docId> --row 1 --col 2 --text "Updated"
```

### Docs - Multi-Tab
```bash
gdrive read-doc <docId> --tab "Sheet2"
gdrive read-doc <docId> --tab 0           # by index
gdrive add-tab <docId> "New Tab" --md "# Tab Content"
```

### Sheets
```bash
gdrive create-sheet "Budget" --data '[["Item","Cost"],["Rent","2000"],["Food","500"]]'
gdrive update-sheet <id> --range "A1:B3" --data '[["Updated","Values"]]'

# Format with quick flags
gdrive format-sheet <id> --range "A1:C1" --bold --bg "0.9,0.9,0.9"

# Format with full ops array
gdrive format-sheet <id> --ops '[{"type":"text","range":"A1:C1","bold":true},{"type":"borders","range":"A1:C10","style":"SOLID"}]'
```

### Slides
```bash
gdrive create-slides "Q4 Review" --from '[{"title":"Overview","content":"Key metrics..."}]'
gdrive update-slides <id> --from slides.json
gdrive read-slides <id>
gdrive format-slides <id> --ops '[{"type":"text","objectId":"abc","bold":true}]'
gdrive add-textbox <id> --slide <slideId> --text "Hello" --x 100000 --y 100000 --w 3000000 --h 500000
gdrive add-shape <id> --slide <slideId> --type RECTANGLE --x 0 --y 0 --w 3000000 --h 3000000 --bg "0.2,0.4,0.8"
```

### Forms
```bash
gdrive read-form <formId>    # outputs form structure as markdown
```

### File Management
```bash
gdrive mkdir "Reports" --parent <folderId>
gdrive rm <fileId>                              # moves to trash
gdrive mv <fileId> <destinationFolderId>
gdrive rename <fileId> "New Name"
gdrive create-text "notes.txt" --content "Hello world"
```

### File Transfer
```bash
gdrive export <fileId> --format pdf --output report.pdf
gdrive upload ./data.csv --parent <folderId> --convert-to sheet
gdrive download <fileId> --output ./local-copy.pdf
```

## Supported Markdown

| Syntax | Google Docs Result |
|--------|-------------------|
| `# Heading 1` | HEADING_1 (through H6) |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `***bold italic***` | Bold + italic |
| `[link](url)` | Blue underlined hyperlink |
| `` `inline code` `` | Consolas font, gray background |
| `- bullet` | Unordered list |
| `1. numbered` | Ordered list |
| `> blockquote` | Indented with gray left border |
| `---` | Horizontal rule |
| ` ``` code ``` ` | Code block (Consolas, 10pt) |
| `\| table \|` | Native Google Docs table with bold header row |

### Smart Typography

Automatically applied to all markdown content:

| Input | Output |
|-------|--------|
| `"quoted"` | \u201Ccurly quotes\u201D |
| `it's` | it\u2019s (smart apostrophe) |
| `a -- b` | a \u2013 b (en-dash) |
| `a --- b` | a \u2014 b (em-dash) |
| `...` | \u2026 (ellipsis) |

## Setup

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable these APIs:
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
   - Google Forms API (optional, for `read-form`)

### 2. OAuth Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Desktop app** as application type
4. Download the JSON file
5. Save as `~/.config/gdrive-cli/credentials.json`

### 3. Authenticate

```bash
gdrive auth
```

This opens an OAuth flow in your browser. Tokens are saved to `~/.config/gdrive-cli/tokens.json`.

### Environment Variables

Override default credential paths:

```bash
export GDRIVE_CREDENTIALS_PATH=/path/to/credentials.json
export GDRIVE_TOKEN_PATH=/path/to/tokens.json
```

## Data Input

The `--data`, `--from`, and `--ops` flags accept three formats:

```bash
# 1. Inline JSON string
gdrive create-sheet "Test" --data '[["A","B"],["1","2"]]'

# 2. JSON file
gdrive create-sheet "Test" --data data.json

# 3. Stdin (pipe-friendly)
cat data.json | gdrive create-sheet "Test" --data -
```

## Claude Code Skill

This CLI is designed to be used as a [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills). The `skill.md` file defines triggers and usage patterns so Claude Code automatically invokes the right commands.

To install as a skill:
```bash
cp -r gdrive-cli ~/.claude/skills/
cd ~/.claude/skills/gdrive-cli/cli && npm install
```

## License

MIT
