# Google CLI Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) skills for Google Workspace APIs. Lightweight CLI tools that Claude can invoke on-demand — no always-on MCP servers needed. Skills for Drive, Cal, and Gmail to be added soon. (Or ask Claude to make them based on this skill — auth will work for all skills once you set up a Google Cloud account the first time.)

## Skills

| Skill | What it does | Google APIs |
|-------|-------------|-------------|
| [gdocs-cli](./gdocs-cli/) | Markdown → formatted Google Docs | Docs, Drive |

## Install

Each skill is self-contained. Clone, copy, done:

```bash
git clone https://github.com/benjammann/google-cli-skills.git
cp -r google-cli-skills/gdocs-cli ~/.claude/skills/gdocs-cli
cd ~/.claude/skills/gdocs-cli/cli && npm install
```

See each skill's README for auth setup and usage.

## Auth

All skills use Google OAuth 2.0. Set up once, share across skills:

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable the relevant APIs
2. Create **OAuth 2.0 credentials** (Desktop app type)
3. Place credentials and tokens per each skill's README (env var overrides supported)

## Contributing

PRs welcome. Each skill lives in its own directory following this structure:

```
skill-name/
├── README.md       # Setup, usage, and examples
├── skill.md        # Claude Code skill definition (triggers + commands)
└── cli/
    ├── index.js    # CLI entry point
    └── package.json
```

## License

MIT
