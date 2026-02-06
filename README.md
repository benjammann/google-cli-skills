# Google CLI Skills

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) skills for Google Workspace APIs. Lightweight CLI tools that Claude can use on-demand — no always-on MCP servers.

## Skills

| Skill | Description |
|-------|-------------|
| [gdocs-cli](./gdocs-cli/) | Create and format Google Docs from markdown |

## Install

Each skill is self-contained. Pick the ones you need:

```bash
# Clone the repo
git clone https://github.com/benjammann/google-cli-skills.git

# Copy a skill to your Claude skills directory
cp -r google-cli-skills/gdocs-cli ~/.claude/skills/gdocs-cli

# Install its dependencies
cd ~/.claude/skills/gdocs-cli/cli && npm install
```

## Auth

All skills share Google OAuth credentials. Set up once, use everywhere:

1. Create a [Google Cloud project](https://console.cloud.google.com/) with the relevant APIs enabled
2. Create OAuth 2.0 credentials (Desktop app type)
3. Place credentials at `~/.config/gdocs-cli/credentials.json` (or set env vars — see each skill's README)

## License

MIT
