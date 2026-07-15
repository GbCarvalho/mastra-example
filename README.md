# mastra-example

Job-search workflow built with [Mastra](https://mastra.ai/) — searches job postings across multiple portals, evaluates fit with an LLM agent, and presents ranked results.

## Stack

- **Framework:** Mastra (workflows, agents, tools, memory)
- **Model:** Anthropic Claude Sonnet 4 (`anthropic/claude-sonnet-4-6`)
- **Storage:** LibSQL (local + Turso for cloud)
- **Embeddings:** FastEmbed (local, no API key needed)
- **Tests:** Vitest

## Architecture

```
search → evaluate → present
  │         │          │
  │         │          └─ Formats FitEvaluation[] into markdown summary
  │         └─ Claude Sonnet agent with structured output (5-dimension scoring)
  └─ Parallel portal search (LinkedIn + freehire.dev), merged & deduplicated
```

## Project Structure

```
src/mastra/
├── index.ts                    # Mastra instance (workflows, agents, tools, storage)
├── agents/
│   └── fit-evaluator.ts        # Claude agent with candidate profile + scoring framework
├── workflows/
│   ├── job-search.ts           # search → evaluate → present pipeline
│   └── job-search.test.ts      # Integration tests (19 passing)
├── tools/
│   ├── linkedin-search.ts      # LinkedIn job posting scraper
│   ├── linkedin-search.test.ts # Tool unit tests
│   ├── freehire-search.ts      # freehire.dev API search
│   └── freehire-search.test.ts # Tool unit tests
└── schemas/
    ├── search-query.ts         # Workflow input schema
    ├── job-posting.ts          # Job posting data shape
    └── fit-evaluation.ts       # Fit evaluation + presentation schemas
```

## Primitives Demonstrated

| Primitive | Usage |
|-----------|-------|
| **Workflows** | 3-step chained pipeline (`.then()`) |
| **Agents** | Claude Sonnet 4.6 with `structuredOutput` |
| **Tools** | Portal search tools wrapping HTTP APIs |
| **Memory** | Semantic recall with LibSQL + FastEmbed |
| **Structured Output** | `fitEvaluationSchema` array enforced at API level |
| **Observability** | Storage + platform exporters with sensitive data filtering |

## Getting Started

```bash
npm install
cp .env.example .env   # Add your ANTHROPIC_API_KEY
npm run dev            # Opens Mastra Studio at http://localhost:4111
```

## Run Tests

```bash
npm test
```

## Inspiration

This project was inspired by the AI-augmented job search workflow in [ai-job-search](https://github.com/MadsLorentzen/ai-job-search), which demonstrated structured fit-evaluation as part of an application pipeline.

## Deploy

```bash
npx mastra deploy
```

Requires `ANTHROPIC_API_KEY` in your environment.
