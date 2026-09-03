# LinkedCtl Architecture & Project Structure

LinkedCtl is an enterprise-grade TypeScript monorepo combining a LinkedIn CLI, Model Context Protocol (MCP) server, autonomous multi-agent content publishing pipeline, and an interactive web studio.

---

## 🏛️ Monorepo Workspace Topology

Managed via **`pnpm workspaces`** and **`Turborepo`** (`turbo.json`):

```
linkedctl-main/
├── packages/
│   ├── core/                  # @linkedctl/core: LinkedIn API client, OAuth2 PKCE & types
│   ├── cli/                   # @linkedctl/cli: 'linkedctl' command-line interface
│   ├── linkedin-automation/   # @linkedctl/linkedin-automation: Claim verification & publishing pipeline
│   ├── mcp/                   # @linkedctl/mcp: Model Context Protocol (MCP) server
│   ├── e2e/                   # @linkedctl/e2e: End-to-end integration test suite
│   └── linkedctl/             # Umbrella package distributing CLI and core
├── flow-agent-main/           # @linkedctl/studio: Web dashboard & Google Flow Agent
│   ├── src/                   # Express orchestrator server (Port 3000)
│   ├── public/                # Web Dashboard UI (Composer, Discovery, Drafts, Queue)
│   ├── flow-agent/            # Python FastAPI backend & image generator (Port 8001)
│   ├── flow-extension/        # Chrome Extension for auth token capture (Port 9227)
│   └── tests/                 # Platform integration tests
├── scripts/                   # Workspace runner & maintenance scripts
├── docs/                      # Technical documentation & guides
├── pnpm-workspace.yaml        # Workspace configuration
└── turbo.json                 # Monorepo build and test caching pipeline
```

---

## 📦 Package Breakdown

### 1. `@linkedctl/core` (`packages/core`)
- Low-level LinkedIn REST API client and Rest.li protocol serializer.
- OAuth 2.0 PKCE authentication flow and token introspection.
- Services for member profiles, organization administration, media upload registrations, and analytics.

### 2. `@linkedctl/cli` (`packages/cli`)
- The `linkedctl` executable CLI tool.
- Supports commands: `post`, `comment`, `reaction`, `media`, `stats`, `org`, `profile`, `auth`, and `whoami`.
- Structured output in JSON and human-readable tables.

### 3. `@linkedctl/linkedin-automation` (`packages/linkedin-automation`)
- Multi-agent engineering intelligence pipeline:
  - **Activity Scorer & Change Grouper**: Scans Git commits and PRs to extract significant engineering changes.
  - **Claim Verifier**: Validates generated claims against actual code commits to prevent hallucination.
  - **Slop Guard**: Evaluates content quality, penalizing AI cliches, hashtags, and marketing buzzwords.
  - **Idempotent SQLite Storage**: Tracks candidate states (`REVIEW_REQUIRED`, `APPROVED`, `SCHEDULED`, `PUBLISHED`).
  - **Flow Agent Client**: Interfaces with Python FastAPI for diagram & visual synthesis.

### 4. `@linkedctl/mcp` (`packages/mcp`)
- Model Context Protocol (MCP) server conforming to `@modelcontextprotocol/sdk`.
- Allows AI desktop clients (Claude Desktop, Cursor, Cline) to safely compose, review, and publish to LinkedIn.

### 5. `@linkedctl/studio` (`flow-agent-main`)
- Full-stack graphical interface and real-time agent orchestrator:
  - **Tab 1: Post Composer**: Live LinkedIn feed mockup, word/character counter, quick hashtags, AI visual generation, local upload, and Gemini Vision auto-captioning.
  - **Tab 2: GitHub Discovery**: Analyzes repositories (e.g. `facebook/react`), runs commit fact extraction, and synthesizes engineering drafts.
  - **Tab 3: Drafts & Review Queue**: Filter and search drafts, view slop scores, edit full captions in modals, approve, reject, schedule, or post now.
  - **Tab 4: Queue & History**: Displays scheduled publishing queue and live LinkedIn feed links.
  - **Tab 5: Automation Settings**: Configures safe/semi/full autonomy modes and quality thresholds.
  - **Tab 6: System Logs**: Real-time terminal SSE log stream.

---

## 🚀 Quick Commands

### Monorepo Build & Test
```sh
pnpm build         # Build all packages and the studio in parallel
pnpm test          # Run all package unit test suites (1,000+ tests)
pnpm test:all      # Run package tests and studio platform tests
```

### Running LinkedCtl Studio
```sh
pnpm studio        # Start LinkedCtl Studio at http://localhost:3000
pnpm studio:dev    # Start in live auto-reload development mode
pnpm studio:build  # Build studio server TypeScript
pnpm studio:test   # Run studio platform verification tests
```

### Running the CLI
```sh
pnpm --filter @linkedctl/cli build
node packages/cli/dist/cli.js --help
```
