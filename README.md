# AI Knowledge Inbox

Save short notes and URLs, then ask questions that are answered from your own saved
content, with citations back to the exact passage each claim came from.

Built for the Turium AI Full Stack Developer assignment.

```
React + Vite + Tailwind   ->   Express (TypeScript)   ->   SQLite
                                      |                   items, chunks,
                                      |                   float32 vectors,
                                      |                   ingest jobs
                                      v
                          async ingestion queue  ->  chunk -> embed -> store
                                      |
                                      v
                          retrieval (cosine + MMR) -> LLM with a citation contract
```

---

## Quick start

Requires Node 20.11 or newer. Nothing else: no Docker, no database server, and no
API key needed to get it running.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:4000> and Vite
proxies `/api` to it, so the browser only ever talks to one origin.

### With a real model provider

Everything works without credentials, but answers are extracted rather than
generated (see [Running without an API key](#running-without-an-api-key)). To get
semantic search and synthesised answers:

```bash
cp .env.example server/.env
# put your key in OPENAI_API_KEY, then
npm run dev
```

Any OpenAI-compatible endpoint works. For Groq, Together, OpenRouter, Ollama or a
local vLLM, set `OPENAI_BASE_URL` and the model names as well:

```bash
OPENAI_BASE_URL=https://api.groq.com/openai/v1
CHAT_MODEL=llama-3.3-70b-versatile
```

#### Google Gemini (verified on the free tier)

```bash
OPENAI_API_KEY=<your AI Studio key>
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
EMBEDDING_MODEL=gemini-embedding-001
CHAT_MODEL=gemini-3.1-flash-lite
```

Two things worth knowing, both found by testing against the live endpoint rather
than reading docs:

- **Use a non-reasoning chat model.** Gemini 3.x `flash` models spend their
  output budget on hidden thinking tokens and return HTTP 200 with empty
  content. `flash-lite` does not think and answers normally. The provider now
  says this explicitly when a completion comes back empty, instead of leaving
  you to suspect the prompt.
- **`gemini-embedding-001` returns 3072 dimensions**, already L2-normalised, so
  it satisfies the invariant the search layer relies on. It is 2x the memory and
  scan cost of `text-embedding-3-small`; set `EMBEDDING_DIMENSIONS=768` to trade
  a little accuracy for a 4x smaller index.

> Switching embedding model changes the vector space. The app refuses to mix
> dimensions and tells you to re-index (delete `server/data/*.db`) rather than
> silently returning garbage similarity scores.

### Other commands

```bash
npm test           # 126 tests (backend + frontend), no network or credentials
npm run typecheck  # strict tsc across both workspaces
npm run build      # production build of both halves
```

---

## Deployment

The app ships as a single container: the frontend is built into the server's
`public/` directory and served from the same origin, so there is one process, one
port and no CORS in production.

### Run the published image

Every push to `main` builds, smoke-tests and publishes an image to GitHub
Container Registry.

```bash
docker run -p 4000:4000 -v knowledge-inbox-data:/data \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/rishab2245/turium-knowledge-inbox:latest
```

Then open <http://localhost:4000>. Omit `OPENAI_API_KEY` to run in offline
fallback mode.

### Build it yourself

```bash
docker compose up --build    # http://localhost:4000
```

SQLite lives on a named volume, so data survives container rebuilds.

### Host it

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/rishab2245/turium-knowledge-inbox)

`render.yaml` provisions the service from the Dockerfile, sets
`healthCheckPath` to `/api/health` and attaches a 1 GB persistent disk at `/data`.
Set `OPENAI_API_KEY` in the dashboard after the first deploy.

> **The disk is not optional.** SQLite on a container's ephemeral filesystem is
> wiped on every deploy. The `disk:` block in `render.yaml` is what stops that,
> and it is the single most common way this stack surprises people.

The same image runs unchanged on Fly.io, Railway, Cloud Run (with a mounted
volume) or any Docker host.

### CI

`.github/workflows/ci.yml` typechecks, tests and builds both workspaces, then
builds the image, runs it, and asserts the real thing works: `/api/health`
responds, a note ingests and indexes, a query comes back with citations, and the
SPA is served from the same origin. A green run means the shipped artifact works
end to end, not just that it compiled.

---

## What it does

**Ingestion.** Paste a note or a URL. URLs are fetched server-side and their
readable text extracted. The endpoint returns `202` immediately with a `pending`
item; fetching, chunking and embedding happen on a background queue.

**Retrieval.** A question is embedded and compared against every stored chunk with
an exact cosine scan, then re-ranked with MMR to avoid returning three
near-identical passages from the same document.

**Answering.** The top passages go to a chat model under a strict citation
contract. The answer's `[n]` markers map to the returned `citations` array, and
markers the model invents are stripped before the response leaves the server.

**Scoping.** Tick any indexed sources to restrict a question to just those. The
UI passes `itemIds` to `POST /query`, which narrows the vector scan rather than
filtering after the fact, so "ask this document" genuinely searches only it.

**Inspectability.** Every query response carries the retrieved passages and their
scores alongside the answer, and the UI can show them. A RAG answer you cannot
inspect is a RAG answer you cannot debug.

---

## API

Base path `/api`. Every error has the same shape, with a stable machine-readable
`code` and the `requestId` that also appears in the server logs:

```json
{ "error": { "code": "validation_error", "message": "...", "details": [], "requestId": "..." } }
```

### `POST /ingest`

A discriminated union on `type`, so the contract is explicit in both directions.

```jsonc
{ "type": "note", "content": "...", "title": "optional" }
{ "type": "url",  "url": "https://...", "title": "optional" }
```

`202 Accepted` with the pending item and a `jobId`.
`200 OK` with `deduplicated: true` when that URL is already saved.
`400` on validation failure.

### `GET /items?limit=50&status=ready&cursor=...`

Newest first, keyset pagination on `(created_at, id)` so the page does not shift
while new items are being indexed. Returns `{ items, nextCursor, count }`.

### `GET /items/:id` and `GET /items/:id/chunks`

`/chunks` exposes exactly what the retriever sees, which is the fastest way to
tell a chunking problem from a retrieval problem.

### `DELETE /items/:id`

`204`. Chunks and jobs cascade.

### `POST /query`

```jsonc
{ "question": "what did I save about vector stores?", "topK": 6, "itemIds": ["..."] }
```

Returns the answer, its citations, the raw retrieved sources, and a `meta` block
with generator, model, chunks scanned and per-stage latency.

A question with no relevant context is a `200` with an empty citation list, not a
`404`. The query succeeded; the corpus had nothing to say.

### `GET /health`

Liveness plus which providers are live and how much is indexed.

---

## Design decisions and tradeoffs

### Chunking: paragraph-aware sliding window, 1100 chars with 180 overlap

Splitting on blank lines first means a retrieved chunk usually starts at the
beginning of a thought, which matters because chunks are shown to the user as
citations, not just fed to a model. Short paragraphs are packed together up to the
size cap, because one-line chunks produce vectors dominated by two or three terms
and score erratically. Text with no paragraph structure falls back to sentence
splitting, then to a hard cut.

The 180-character overlap exists so a fact that straddles a boundary is complete in
at least one chunk. It costs about 15% extra storage and embedding spend.

Chunk size is measured in characters, not tokens. It is a ~4x approximation for
English, needs no tokenizer dependency, and the size is a tuning knob anyway. A
token-exact splitter matters when you are packing a context window to its limit.
We retrieve six chunks of ~1100 characters, which is nowhere near any limit.

**What I would change with more time:** chunk size should adapt to document type.
1100 characters is reasonable for prose and bad for code or tables. A structure-
aware splitter (headings for Markdown, block boundaries for code) would beat any
single global number.

### Vector storage: SQLite BLOBs and a brute-force scan

Vectors are stored as raw little-endian float32 BLOBs next to their chunk text and
scanned linearly at query time with a dot product.

Why not pgvector, Qdrant or hnswlib:

- **Exact, not approximate.** No recall/latency knob to tune and no index to
  rebuild after every write.
- **One file, no service.** Clone, `npm install`, run. No container, no native
  index build, nothing to provision.
- **Fast enough at this scale.** 512-dimension vectors at ~10k chunks is a few
  milliseconds. The dominant cost of a query is the embedding round-trip, not the
  scan.

Everything is L2-normalised at the provider boundary, so cosine similarity reduces
to a single dot product in the hot loop.

**Where it breaks.** The scan is O(N x dim) and loads every vector into memory per
query. At roughly 10<sup>5</sup> chunks with 1536-dimension vectors that is ~600 MB of
floats and hundreds of milliseconds per query, and a single writer means concurrent
ingest and query contend. The migration path is Postgres + pgvector with an HNSW
index: the `ChunkRepository` interface is the only thing that changes, because
nothing above it knows how similarity is computed.

### Retrieval: over-fetch then MMR

Pure top-k on a sliding-window index returns neighbouring chunks of the same
paragraph, which wastes context and makes the answer cite one source three times.
The retriever fetches `topK x 4` candidates above a relevance floor and re-ranks
with Maximal Marginal Relevance (`lambda = 0.7`), trading a little relevance for
coverage across sources.

**Tradeoff:** MMR is O(k x candidates) similarity computations on top of the scan,
and a badly tuned lambda surfaces irrelevant-but-different chunks. At k=6 it is
negligible; at k=50 it would need a cheaper diversity heuristic.

**Not done:** hybrid search. A BM25 or SQLite FTS5 pass unioned with the vector
pass would fix the classic dense-retrieval failure on exact identifiers, error
codes and rare proper nouns. This is the single highest-value addition and the
first thing I would build next.

### Ingestion: asynchronous, with job state in SQLite

Fetching a URL and embedding its chunks takes seconds and depends on two external
services. Doing it inside `POST /ingest` would make the endpoint slow and tie the
work's lifetime to an HTTP connection the client may abandon. So ingestion returns
`202` and the UI polls until the item is `ready`.

The queue is in-process, but job *state* is a SQLite table, not an array in
memory. A crash mid-ingest leaves a `running` row that is requeued at next boot
instead of being lost silently. That is the durability that usually justifies
bringing in a broker, without the broker.

Retries use exponential backoff with jitter, and only for errors that retrying can
plausibly fix. A 404 page or a blocked address fails permanently on the first
attempt, because three retries only delay the error the user needs to see.

**What this does not give us:** work does not survive the process, there is no
fan-out across replicas, and two instances on one database file would contend on
writes. Moving to BullMQ or SQS changes `ingestion/queue.ts` and nothing else,
because the pipeline knows nothing about how it is scheduled.

### Polling, not websockets

The item list polls every 1.5s while anything is `pending` or `processing`, and
stops the moment everything is `ready`. For a single-user app this is one endpoint
and no connection lifecycle to manage. With multiple users or longer jobs, SSE on
a job-status stream would be the right call.

The non-obvious part is that polling has to coexist with pagination. A poll that
replaced state with page one would silently discard every page the user had
already loaded, so `refresh` merges the first page over the existing list by id
and keeps the tail. Items are newest-first and only freshly ingested items change
status, so page one always covers everything that can have moved. `loadMore` also
de-duplicates on id, because keyset pagination cannot see that an item shifted
across the page boundary between two requests.

### Citations are reconciled server-side

Models occasionally cite a source number that was never supplied. The server
strips markers outside the supplied range before responding, and returns only the
sources actually cited. Without this, the answer's brackets and the citation list
the UI renders drift apart, which is worse than a missing citation because it looks
correct.

### Running without an API key

With no `OPENAI_API_KEY` the app degrades deliberately rather than breaking:

- **Embeddings** fall back to a local hashed-feature model (word unigrams,
  bigrams and character 4-grams hashed into 512 dimensions, sub-linear term
  weighting, L2-normalised).
- **Answers** become extractive: the highest-scoring passages, trimmed to the
  sentences that overlap the question, each with its citation.

The UI says so, prominently, in both places. This is a real tradeoff, not a
disguised feature: the local embedder has no semantic generalisation, so "car" and
"automobile" land in unrelated dimensions. Character n-grams recover morphology and
typo tolerance, not synonymy. It exists so the project clones and runs, and so the
test suite needs no credentials and no network.

### Provider-agnostic, and what that actually costs

The app is written against the OpenAI-compatible surface rather than OpenAI
itself, so `OPENAI_BASE_URL` can point at Gemini, Groq, Together, OpenRouter,
Ollama or vLLM with no code change. That portability is not free: "compatible"
endpoints differ in small ways that are easy to miss and expensive to debug.

Two of them are handled here, both discovered by running against Gemini:

**Omitted zero indexes.** The embeddings response identifies each vector by an
`index` field so callers can restore request order. Gemini's endpoint omits
`index` entirely when it is 0, because protobuf drops default values on the
wire. A natural `data.sort((a, b) => a.index - b.index)` then evaluates `NaN`
for that element, and sorting with a NaN comparator is unspecified. It happens
to preserve order in V8, so it works by luck. The failure mode if that luck ever
runs out is silent and total: every chunk is stored with a neighbour's vector
and the entire index is quietly wrong, with nothing in the logs. `orderByIndex`
treats a missing index as 0, which is precisely the value protobuf elided, and
three tests pin the behaviour.

**Unknown embedding dimensions.** A hardcoded model-to-dimension map cannot know
about every model a third-party endpoint serves, and a 0 there silently disabled
the guard that stops two embedding spaces being mixed. The provider now corrects
its dimension from the first real response.

The general lesson, and the reason both fixes carry comments: the dangerous
incompatibilities are not the ones that throw. They are the ones that return 200
and quietly corrupt data.

### URL extraction: heuristics, not a Readability port

Fetched pages are stripped of scripts, landmark chrome and anything whose class
or id names it as furniture (`navbox`, `catlinks`, `reflist`, `sidebar`, ...),
then the densest remaining content container wins. About forty lines instead of a
jsdom dependency.

Two guards make the class-name rule safe, both found by testing against a real
page. Structural elements are never removed no matter how they are labelled:
Wikipedia puts feature flags like `vector-feature-language-in-main-menu` on
`<html>` itself, and matching that deleted the entire article. And furniture is
never most of the document, so an element holding over half the page text is
treated as content whatever its class says.

The effect is measurable: the RAG Wikipedia article went from 32 noisy chunks
(category lists, navboxes and reference footers included) to 15 chunks of article
prose.

**Limitation:** client-rendered pages return their empty shell. The app detects
that and fails the item with a message saying so rather than indexing nothing.

### SSRF guard on URL ingestion

The server fetches arbitrary user-supplied URLs, so it must refuse to be used as a
proxy into the private network. Hostnames are resolved and private, loopback,
link-local (including cloud metadata at 169.254.169.254) and multicast ranges are
rejected. Responses are capped by streaming and aborting past the byte limit, so a
huge or endless body cannot exhaust memory.

**Honest limitation:** this does not close the DNS-rebinding window between the
check and the socket connect. Production should pin the resolved address at connect
time or route egress through a filtering proxy.

---

## Debuggability

- **Structured JSON logs** (pino), pretty-printed in development. Every line
  carries a `requestId`, and background jobs inherit it via `AsyncLocalStorage`, so
  an ingest failure traces back to the HTTP call that triggered it.
- **`x-request-id`** is echoed on every response and included in every error body.
  An inbound header from a proxy is honoured.
- **Sensible status codes**: `202` accepted for async work, `400` validation,
  `404` not found, `422` unprocessable content, `502` upstream provider failure,
  `500` only for genuine bugs (whose message is not leaked in production).
- **`GET /api/health`** reports provider wiring and index size, which is what you
  actually want to know when behaviour is surprising.
- **`GET /api/items/:id/chunks`** shows exactly what was indexed.
- **Retrieval internals** are in every query response and expandable in the UI.

---

## Testing

```bash
npm test
```

126 tests, all offline, no credentials and no network.

```bash
npm test          # both suites
npm run test:api  # 84 backend tests (vitest)
npm run test:web  # 42 frontend tests (vitest + React Testing Library)
```

### Backend — 84 tests

| File | Covers |
| --- | --- |
| `chunker.test.ts` | size caps, overlap, paragraph packing, degenerate input |
| `retrieval.test.ts` | dot product, dimension-mismatch guard, MMR diversity, local embedder determinism and ranking, BLOB round-trip |
| `answerer.test.ts` | citation reconciliation, hallucinated markers, prompt assembly, extractive fallback |
| `ingestionQueue.test.ts` | job claiming, retry budget, permanent-failure short-circuit, crash recovery |
| `urlFetcher.test.ts` | content extraction, boilerplate stripping, title fallbacks, private-address classification |
| `openaiEmbeddings.test.ts` | batch ordering including omitted zero indexes, dimension discovery, normalisation, truncated batches |
| `api.test.ts` | every endpoint end-to-end over the real router, service, queue and schema, with only the providers stubbed |

The API tests run against an in-memory SQLite database with a stub chat provider,
so the whole suite is deterministic.

### Frontend — 42 tests

| File | Covers |
| --- | --- |
| `useAsk.test.ts` | answer state, scoping options, the abort-on-new-question race, network and validation failures |
| `useItems.test.ts` | first-page load, cursor pagination, cross-page de-duplication, poll-merge preserving later pages, optimistic delete and rollback |
| `AddSourceForm.test.tsx` | note and URL submission, payload shape, field-level error display, deduplicated saves |
| `AnswerCard.test.tsx` | citation chip rendering, unmatched markers, score formatting, collapsed retrieval internals, fallback warning |
| `App.test.tsx` | empty state, offline banner, ask-and-render, load-more, source scoping, failed-item display, delete |

Rather than mocking the API client, these stub `fetch` and route on the real URL
the client builds. Query-string construction, status handling and error parsing
stay inside the code under test instead of inside the mock.

Two of these pin bugs that were found and fixed rather than imagined: the
stale-answer race in `useAsk`, and a poll that discarded already-loaded
pages in `useItems`.

**Not covered:** no end-to-end browser test. The flows were driven manually in a
real browser, but a Playwright run against the built image would catch the
integration seams jsdom cannot see.

---

## Project structure

```
server/src/
  config/          validated, typed environment - fails fast at boot
  db/              connection, migrations, repositories (items, chunks, jobs)
  domain/          error taxonomy and shared types
  http/            routes, validation schemas, request-context and error middleware
  ingestion/       chunker, URL fetcher, pipeline, async queue
  rag/             similarity, retriever, prompt, answerers
  providers/       embedding and chat providers behind interfaces
  services/        application layer the routes delegate to
  lib/             logger, retry
  app.ts           composition root - everything constructed and injected here
web/src/
  api/             typed client and response types
  hooks/           useItems, useAsk, useHealth - one per state slice
  components/      presentational, no data fetching
  App.tsx          shell, wires the hooks together
```

Dependencies point inward: routes depend on services, services on repositories and
the RAG layer, and nothing depends on Express except `http/`. The composition root
is the only place that knows how the pieces fit, which is what makes the API tests
able to build a fully isolated app over an in-memory database.

**State management** on the frontend is plain React. Three hooks own three
independent slices and `App` wires them together. There is no shared mutable store
to keep in sync, so Redux or Zustand would add indirection without removing a
problem.

---

## What I would do before calling this production

1. **Hybrid retrieval** (SQLite FTS5 + vector). The biggest quality win available.
2. **Postgres + pgvector** once the corpus outgrows a linear scan.
3. **Auth and per-user scoping.** Deliberately absent; the assignment says
   single-user, and half an auth system is worse than none.
4. **Rate limiting and a spend cap** on the embedding and chat endpoints. Right now
   a loop over `POST /ingest` is an unbounded bill.
5. **A retrieval eval set.** A dozen question/expected-source pairs run in CI, so
   chunking and retrieval changes are measured instead of eyeballed.
6. **Re-index tooling.** Changing embedding model currently means deleting the
   database. A background re-embed job would make it a non-event.
7. **OpenTelemetry traces** across ingest and query, so latency attribution does not
   depend on reading timestamps in logs.
8. **A Playwright run** against the built image, covering the flows that are
   currently only verified by hand in a real browser.

---

## Notes on how this was built

Written with [Claude Code](https://claude.com/claude-code) as an agentic pair:
scaffolding, test generation and the repetitive parts of the React layer. Every
design decision recorded above, and the tradeoffs behind them, are mine. The code
was reviewed, run and tested end to end rather than accepted as generated.
