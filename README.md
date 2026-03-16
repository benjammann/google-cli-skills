# Google CLI Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) skills for Google Workspace APIs. Lightweight CLI tools that Claude can invoke on-demand -- no always-on MCP servers needed.

## Skills

| Skill | What it does | Google APIs |
|-------|-------------|-------------|
| [gdrive-cli](./gdrive-cli/) | Full Google Drive CLI -- Docs, Sheets, Slides, Forms, file management | Drive, Docs, Sheets, Slides, Forms |
| [gdocs-cli](./gdocs-cli/) | *(deprecated -- use gdrive-cli)* | Docs, Drive |

## Install

Each skill is self-contained. Clone, copy, done:

```bash
git clone https://github.com/benjammann/google-cli-skills.git
cp -r google-cli-skills/gdrive-cli ~/.claude/skills/gdrive-cli
cd ~/.claude/skills/gdrive-cli/cli && npm install
```

See each skill's README for auth setup and usage.

## What's Included

**gdrive-cli** covers the full Google Workspace surface:

- **Search & Browse** -- find files, list folders, get metadata
- **Docs (Rich)** -- create, format, append, edit docs with full markdown support (headings, bold, italic, links, tables, code blocks, blockquotes)
- **Docs (Plain)** -- find-replace, insert, delete, table row/cell operations
- **Sheets** -- create, update, format (bold, borders, colors, conditional formatting)
- **Slides** -- create, update, format, add text boxes and shapes
- **Forms** -- read form structure as markdown
- **File Management** -- mkdir, rm, mv, rename, upload, download, export
- **Smart Typography** -- automatic curly quotes, em/en-dashes, ellipsis

## Auth

All skills use Google OAuth 2.0. Set up once:

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable the relevant APIs (Drive, Docs, Sheets, Slides, Forms)
2. Create **OAuth 2.0 credentials** (Desktop app type)
3. Save credentials to `~/.config/gdrive-cli/credentials.json`
4. Run `gdrive auth` to complete the OAuth flow

Environment variable overrides: `GDRIVE_CREDENTIALS_PATH`, `GDRIVE_TOKEN_PATH`

## Contributing

PRs welcome. Each skill lives in its own directory following this structure:

```
skill-name/
├── README.md       # Setup, usage, and examples
├── skill.md        # Claude Code skill definition (triggers + commands)
└── cli/
    ├── index.js    # CLI entry point
    ├── package.json
    └── *.js        # Supporting modules
```

## License

MIT
