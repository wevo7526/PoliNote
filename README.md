# Policy Digression Workbench (PoliNote)

TypeScript digression workbench on Vercel: Scope Contract → digression graph → append-only domain event log. LangGraph multi-agent crew + in-app MCP (Streamable HTTP). No Railway. No LangSmith.

## Stack

- Next.js App Router (Node / Fluid Compute)
- Zod contracts + Drizzle / Neon Postgres
- `@langchain/langgraph` (later) with Postgres checkpointer
- `mcp-handler` Streamable HTTP routes (later)

## Repo layout

```
src/
  app/                 # UI + future API/MCP routes
  components/workbench # Canvas, inspector, scope panel
  schemas/             # Shared Zod: Scope, Node/Edge, RunEvent
  db/                  # Drizzle schema + Neon client
  data/                # Static EV-tariff digression seed
  tools/               # Shared tool registry (MCP wraps these)
  agents/              # LangGraph crew (scaffold)
  mcp/                 # MCP server name constants
```

## Setup

```bash
cp .env.example .env.local
# set DATABASE_URL, ANTHROPIC_API_KEY or OPENAI_API_KEY, FRED_API_KEY
npm install
npm run dev
```

DB (when Neon is linked):

```bash
npm run db:generate
npm run db:migrate
```

## Current milestone

Static Scope Contract + EV-tariff digression canvas (no LLM). Next: event log SSE + scrubber, then econ-series MCP.
