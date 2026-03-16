# gdrive-cli

Google Drive CLI — search, read, write, format. Covers Docs (with rich markdown formatting), Sheets, Slides, Forms, and file management. No MCP needed.

## Triggers

- "gdrive", "google drive cli", "gdocs", "formatted google doc", "edit google doc"
- "search drive", "find in drive"
- "create sheet", "format sheet", "create slides"
- "create doc with formatting", "read doc as markdown"

## Commands

```bash
# Search & Browse
gdrive search "query" --max 10 --type doc|sheet|folder|slides
gdrive list [folderId] --max 50
gdrive info <fileId>

# Read
gdrive read-doc <docId>
gdrive read-sheet <sheetId> --range "Sheet1!A1:E50"
gdrive read-slides <presId> --slide 0

# File Management
gdrive mkdir <name> --parent <folderId>
gdrive rm <fileId>
gdrive mv <fileId> <destFolderId>
gdrive rename <fileId> "New Name"
gdrive create-text <name> --content "text" --parent <folderId>

# File Transfer
gdrive export <id> --format pdf|docx|csv|xlsx|pptx|txt --output path
gdrive upload <localPath> --name --parent --replace <id> --convert-to doc|sheet|slides
gdrive download <id> --output path

# Docs (Rich Formatting) — markdown → native Google Docs formatting
gdrive create-doc <name> --md "# Title\n**bold**" --parent <id>
gdrive create-doc <name> --from-md input.md
gdrive format-doc <docId> --md "## Section" [--replace]
gdrive doc-append <docId> --md "## New Section\n- bullet"
gdrive doc-edit <docId> --old "text" --new "replacement"
gdrive doc-edit <docId> --old "text" --new-md "**formatted**" --all
gdrive doc-edit <docId> --section "Heading" --md "## Updated\nnew content"
gdrive read-md <docId>
gdrive read-md <docId> --section "Overview"
gdrive parse-md file.md   # offline test, no API call

# Docs (Plain Text)
gdrive doc-find-replace <docId> --old "text" --new "replacement" --match-case
gdrive doc-insert <docId> --at <index|end> --text "content"
gdrive doc-delete <docId> --start <index> --end <index>
gdrive doc-table-add-row <docId> --cells "cell1|cell2|cell3" [--table N] [--match "text"] [--after N]
gdrive doc-table-edit-cell <docId> --row N --col N --text "content" [--table N] [--match "text"]

# Sheets
gdrive create-sheet <name> --data '[["Name","Age"],["Alice","30"]]' --parent <id>
gdrive update-sheet <id> --range "A1:C3" --data '[["Updated","Data"]]'
gdrive format-sheet <id> --ops <json>           # Full ops: cells/text/number/borders/merge/conditional
gdrive format-sheet <id> --range "A1:B1" --bold --bg "0.9,0.9,0.9"  # Quick flags

# Slides
gdrive create-slides <name> --from slides.json --parent <id>
gdrive update-slides <id> --from slides.json
gdrive format-slides <id> --ops <json>          # Ops: text/paragraph/shape/background
gdrive add-textbox <presId> --slide <slideId> --text "..." --x N --y N --w N --h N
gdrive add-shape <presId> --slide <slideId> --type RECTANGLE --x N --y N --w N --h N

# Auth
gdrive auth
```

## Supported Markdown (Rich Docs)

| Syntax | Result |
|--------|--------|
| `# Header` | HEADING_1 through H6 |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `***both***` | Bold + italic |
| `[text](url)` | Hyperlink (blue, underlined) |
| `` `code` `` | Consolas font + gray background |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `> quote` | Blockquote with left border |
| `---` | Horizontal rule |
| ``` code ``` | Code block (Consolas, 10pt) |
| `| table |` | Native Google Docs table with bold header |

Smart typography auto-applied: curly quotes, em/en-dash, ellipsis.

## Data Input

`--data`, `--from`, `--ops` all accept:
- `file.json` — read from JSON file
- `-` — read from stdin (pipe)
- `'[["A","B"]]'` — inline JSON string

## CLI Path

```
~/.claude/skills/gdrive-cli/cli/index.js
```
