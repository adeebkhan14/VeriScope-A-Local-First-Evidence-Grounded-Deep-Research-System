# VeriScope --- Local-First Evidence-Grounded Deep Research System

VeriScope is a local-first research system that searches the web,
extracts webpage content, retrieves relevant evidence using lexical +
semantic search, and generates a grounded answer using a locally running
Qwen 3.5 9B model.

The current architecture is:

``` text
React UI
   ↓
Express Backend
   ↓
Research Pipeline
   ├── SearXNG → web discovery
   ├── Axios + Cheerio → webpage extraction
   ├── Playwright → JS-heavy webpage fallback
   ├── Chunking
   ├── BM25 → lexical retrieval
   ├── MiniLM → semantic embeddings
   ├── Hybrid retrieval
   ├── Evidence selection
   └── Ollama + Qwen 3.5 9B → grounded answer
```

Completed research results are stored in the browser's local IndexedDB
database. The research library supports full-text search over saved
questions and answers, saved-result filtering, reopening, copying answer
text, deleting individual entries, and clearing the local library. This
browser storage is not sent to the backend or synchronized across devices.

------------------------------------------------------------------------

# 1. Prerequisites

The same Docker Compose project runs on macOS and Windows with Docker
Desktop. Ollama and Qwen 3.5 9B remain native host prerequisites; SearXNG,
the frontend, backend, and MiniLM run in Compose.

You need:

- Docker Engine (Docker Desktop on macOS/Windows)
- Ollama installed on the host
- The `qwen3.5:9b` model downloaded in Ollama
- Node.js, npm, and Python 3 only for native/manual development

## Ubuntu/Linux startup

On Ubuntu, Docker Engine can run the SearXNG and MiniLM containers while
the frontend and backend run natively. This keeps Ollama on its default
loopback-only listener, which containers cannot reach through
`host.docker.internal` on Linux.

Make sure Docker Engine is running and your account can access it. If you
were just added to the `docker` group, sign out and back in, or run
`newgrp docker` in the terminal you use below. Install Node.js 22 or
newer and Ollama, then download the model with `ollama run qwen3.5:9b`.

From the project root, create a private SearXNG secret and start the
containerized services:

```sh
cp .env.example .env
sed -i "s/^SEARXNG_SECRET=.*/SEARXNG_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build searxng embedding
```

In one terminal, install and start the backend:

```sh
cd backend
npm ci
node --env-file=../.env src/server.js
```

In another terminal, install and start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Keep Ollama running on the host. The
embedding image downloads the MiniLM model on its first start and may
take a few minutes. To stop the containerized services, run
`docker compose down` from the project root.

For a Docker-only launch, verify Docker Desktop is running:

```text
docker --version
docker compose version
docker info
```

# 2. Project structure

The repository contains the React frontend, Express backend, FastAPI
embedding service, Compose definition, and project-managed SearXNG
settings. SearXNG's cache and Valkey state are stored in named Docker
volumes.

# 3. Install Docker Desktop

Install Docker Desktop for macOS or Windows from the official Docker
website. On Windows, use the WSL 2 backend if Docker Desktop offers the
choice.

After installation, open Docker Desktop and wait until Docker is
running.

------------------------------------------------------------------------

# 4. Configure SearXNG and local environment

SearXNG is used by VeriScope for web search/discovery.

It is NOT the final retrieval system. It gives VeriScope URLs that can
then be scraped and processed locally.

Copy the sample environment file once.

macOS:

```sh
cp .env.example .env
openssl rand -hex 32
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Put the generated value in `.env` as `SEARXNG_SECRET`. Keep `.env`
private; it is ignored by Git. The checked-in
[`searxng/settings.yml`](./searxng/settings.yml) preserves the existing
default SearXNG settings and JSON search format. The secret is supplied at
runtime, not stored in the settings file or image.

The previous separate SearXNG project is not modified or removed by this
migration. VeriScope now has its own managed SearXNG configuration and
persistent cache/Valkey volumes. If the old service is still using port
8080, either stop it yourself when convenient or change `SEARXNG_PORT` in
`.env` (for example, to `8081`). For native backend development, also set
`SEARXNG_URL=http://localhost:8081` in `.env`. Compose backend traffic
continues to use the internal `searxng:8080` address. The old project
remains available independently.

------------------------------------------------------------------------

# 5. Install Ollama

Ollama runs the local language model used by VeriScope.

Install Ollama for macOS or Windows from the official Ollama download
page. Keep Ollama running on the host; it is deliberately not
containerized.

After installation, check:

``` bash
ollama --version
```

Check installed models:

``` bash
ollama list
```

------------------------------------------------------------------------

# 6. Install Qwen 3.5 9B

VeriScope uses the `qwen3.5:9b` model by default. You can override the
model with the `OLLAMA_MODEL` environment variable.

Download/run it:

``` bash
ollama run qwen3.5:9b
```

The first run downloads the model. Verify it is installed:

``` bash
ollama list
```

------------------------------------------------------------------------

# 7. Ollama connectivity

Native backend development uses `http://localhost:11434`. A containerized
backend uses `http://host.docker.internal:11434`. Compose maps that name to
the host gateway.

On Linux, a host Ollama service bound only to `127.0.0.1` is reachable by a
native backend but not by a container through the Docker gateway. Keep the
native URL as `http://localhost:11434`. For Compose, use
`http://host.docker.internal:11434`. The Linux Compose override provides a
small bridge-only proxy that listens on the Docker host-gateway address and
forwards to `127.0.0.1:11434`; the Ollama service stays loopback-only. The
proxy refuses to bind unless the address belongs to a Docker bridge interface.
It does not change firewall rules or expose Ollama to a LAN/public interface.

------------------------------------------------------------------------

# 8. Native/manual development prerequisites

The Compose startup does not require local Node.js or Python. For the
native workflow, install project dependencies once:

```sh
cd backend
npm ci
cd ../frontend
npm ci
```

------------------------------------------------------------------------

# 9. Setup the Local MiniLM Embedding Service

For manual development, start MiniLM in its own terminal. From the
repository root on macOS:

```sh
python3 -m venv backend/embedding-service/venv
source backend/embedding-service/venv/bin/activate
pip install -r backend/embedding-service/requirements.txt
cd backend/embedding-service
uvicorn app:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell:

```powershell
py -3 -m venv backend\embedding-service\venv
.\backend\embedding-service\venv\Scripts\Activate.ps1
python -m pip install -r backend\embedding-service\requirements.txt
Set-Location backend\embedding-service
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

------------------------------------------------------------------------

# 10. Start the VeriScope Backend

Start Ollama and MiniLM, then start the Compose-managed SearXNG service
from the repository root with `docker compose up -d searxng`. Keep `.env`
in the repository root, then start the backend from `backend/` so Node loads the native
service URLs from that file:

```sh
cd backend
node --env-file=../.env src/server.js
```

Without `.env`, native defaults use SearXNG at `http://localhost:8080`,
Ollama at `http://localhost:11434`, and MiniLM at
`http://127.0.0.1:8000`.

------------------------------------------------------------------------

# 11. Test the Backend Research API

You can test the complete research pipeline without React.

From another terminal on macOS:

```sh
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"How does Kubernetes perform service discovery?"}'
```

On Windows PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5001/api/search -ContentType 'application/json' -Body '{"query":"How does Kubernetes perform service discovery?"}'
```

The `query` field must be a non-empty string. `forceWebSearch`, when
provided, must be a boolean. Invalid fields and malformed JSON return a
JSON `400` response with a message describing the problem.

If SearXNG is unavailable, the API returns `503`; invalid or failed
upstream responses return `502`. Unexpected server errors return `500`
with a generic client-safe message. Individual page scrape failures do
not stop the rest of the search: available snippets and successfully
scraped pages are used, and recovery details are returned in `warnings`.

The pipeline should execute:

``` text
Query
 ↓
SearXNG
 ↓
Web URLs
 ↓
Axios/Cheerio
 ↓
Playwright fallback if required
 ↓
Chunks
 ↓
BM25
 ↓
MiniLM embeddings
 ↓
Hybrid retrieval
 ↓
Evidence package
 ↓
Qwen 3.5 9B
 ↓
Answer + citations
```

------------------------------------------------------------------------

# 12. Start React

In another terminal:

```sh
cd frontend
npm run dev
```

React should normally be available at:

``` text
http://localhost:5173
```

Open that address in your browser.

------------------------------------------------------------------------

# 13. Run VeriScope with Docker Compose

After completing section 4 and setting `SEARXNG_SECRET`, start the Compose
stack. On Linux, use the additional file to enable the loopback-preserving
Ollama bridge:

```text
docker compose -f compose.yaml -f compose.linux.yaml up --build -d
```

On Docker Desktop, use the standard Compose file:

```text
docker compose up --build -d
```

Open **http://localhost:5173**. The backend API is available at
**http://localhost:5001**. Ollama and Qwen 3.5 9B remain native host services.
The backend waits for healthy SearXNG and MiniLM services before starting.

| Service | Host address | Notes |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | React/Vite app served by the frontend container |
| Backend | `http://localhost:5001` | Express API |
| SearXNG | `http://localhost:8080` | Host port configurable with `SEARXNG_PORT`; internal address is `searxng:8080` |
| MiniLM | `embedding:8000` | Compose-only; native development uses `http://127.0.0.1:8000` |
| Ollama | `http://localhost:11434` | Native host service; Linux Compose reaches it through the bridge-only proxy |
| Valkey | `valkey:6379` | Internal SearXNG state; not published to the host |

------------------------------------------------------------------------

# 14. Quick Health Checks

Before searching, check:

### Docker

``` bash
docker ps
```

### SearXNG

macOS:

```sh
curl "http://localhost:8080/search?q=test&format=json"
```

Windows PowerShell:

```powershell
Invoke-RestMethod "http://localhost:8080/search?q=test&format=json"
```

### Ollama

macOS:

```sh
curl http://localhost:11434/api/tags
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

Test actual model generation (not just connectivity):

```sh
curl http://localhost:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.5:9b","prompt":"Reply with exactly QWEN_OK","stream":false,"think":false,"options":{"num_predict":64,"temperature":0}}'
```

### Qwen 3.5 9B

``` bash
ollama list
```

### MiniLM

``` bash
docker compose exec backend node -e "fetch('http://embedding:8000/').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })"
```

Check the backend's Compose-network connections to its dependencies:

```sh
docker compose exec backend node -e "fetch('http://searxng:8080/search?q=test&format=json').then(r => { console.log('SearXNG HTTP ' + r.status); process.exit(r.ok ? 0 : 1); })"
docker compose exec backend node -e "fetch('http://embedding:8000/').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); })"
docker compose exec backend node -e "fetch('http://host.docker.internal:11434/api/tags').then(r => { console.log('Ollama HTTP ' + r.status); process.exit(r.ok ? 0 : 1); })"
```

The `/api/health` endpoint reports connectivity status for all three
upstream services, the configured model name, and whether it is installed.
Ollama health uses `/api/tags` only; it does not load the model or generate
text during frontend polling.

Check Ollama's GPU offload and NVIDIA utilization:

```sh
ollama ps
nvidia-smi
```

`ollama ps` reports the CPU/GPU split. A 9B model may use both system RAM and
VRAM depending on available memory; do not infer full GPU residency from the
GPU model alone.

### Backend

macOS:

```sh
curl http://localhost:5001/
```

Windows PowerShell:

```powershell
Invoke-RestMethod http://localhost:5001/
```

### React

Open:

``` text
http://localhost:5173
```

------------------------------------------------------------------------

# 15. Stopping Services

Stop the Compose stack while preserving named data volumes:

```text
docker compose down
```

This does not stop native Ollama. The previous separate SearXNG project
is untouched.

------------------------------------------------------------------------

## Troubleshooting: macOS

- If `docker info` cannot connect, open Docker Desktop and wait for its
  engine to finish starting. `docker compose ps` should show healthy
  services after startup.
- Check host ports with `lsof -nP -iTCP:8080 -sTCP:LISTEN` and the same
  command for `5173`, `5001`, and `11434`. If another local SearXNG owns
  8080, change `SEARXNG_PORT` in `.env`; Compose-to-Compose traffic still
  uses `searxng:8080`.
- Test host Ollama with `curl http://localhost:11434/api/tags`. If that
  works but the container check fails, see the host-listener and firewall
  instructions in section 7.
- Inspect service startup with `docker compose ps` and
  `docker compose logs searxng valkey backend embedding`.

## Troubleshooting: Windows

- Start Docker Desktop and confirm its WSL 2 backend is running before
  using `docker compose`. In PowerShell, `docker info` must show server
  details.
- Check port conflicts with
  `Get-NetTCPConnection -State Listen -LocalPort 8080,5173,5001,11434`.
  Change `SEARXNG_PORT` in `.env` if local port 8080 is occupied.
- Test host Ollama with
  `Invoke-RestMethod http://localhost:11434/api/tags`. If Compose cannot
  reach it, confirm Windows Defender Firewall permits local Docker
  Desktop traffic to port 11434; do not create a public inbound rule.
- From the backend container, run the `host.docker.internal` check in
  section 14. For SearXNG and MiniLM use their Compose service names;
  `localhost` inside a container refers to that container itself.
- Use `docker compose logs searxng valkey backend embedding` to inspect
  startup failures. The first MiniLM start downloads model weights and
  may take several minutes.

# 16. Important: Why Does Research Take \~3 Minutes?

A 3-minute end-to-end response on an M2 MacBook Air does NOT necessarily
mean Qwen alone takes 3 minutes.

VeriScope currently performs many sequential operations:

``` text
1. Search SearXNG
       ↓
2. Scrape several webpages
       ↓
3. Possibly launch Playwright
       ↓
4. Chunk all webpages
       ↓
5. Generate embeddings for every chunk
       ↓
6. Generate query embedding
       ↓
7. Calculate BM25 scores
       ↓
8. Calculate semantic scores
       ↓
9. Normalize scores
       ↓
10. Calculate hybrid scores
       ↓
11. Select evidence
       ↓
12. Send evidence to Qwen
       ↓
13. Generate final answer
```

Several of these are currently performed sequentially.

The Playwright fallback can also be relatively expensive because the
current scraper opens a browser for each fallback page.

Therefore, before optimizing Qwen, measure where the time is actually
being spent.

------------------------------------------------------------------------

# 17. Will It Be Faster on Another Computer?

Yes.

Local LLM performance depends heavily on the hardware.

Local Qwen performance depends on your hardware; a machine with a
significantly faster GPU and/or more memory can generate responses much
faster.

The biggest differences usually come from:

-   GPU performance
-   available VRAM/unified memory
-   memory bandwidth
-   CPU performance
-   model size
-   quantization
-   prompt/context size
-   number of generated tokens

A modern NVIDIA GPU machine can be substantially faster for local LLM
inference than an older M2 Air.

A newer Apple Silicon Mac can also improve performance. Ollama has
continued improving its Apple Silicon backend, including MLX-based
optimizations.

However, **your 3-minute total time is not a good measurement of
Qwen's raw generation speed** because the VeriScope pipeline includes
web searching, scraping, embedding, retrieval, and then generation.

------------------------------------------------------------------------

# 18. How We Should Optimize VeriScope Later

Do NOT optimize everything at once.

First measure each stage.

The ideal next improvement is to add timing:

``` text
SearXNG:          2.1s
Scraping:        18.5s
Chunking:         0.2s
BM25:             0.1s
Embeddings:      35.2s
Hybrid retrieval: 0.1s
Qwen:             95.4s
-----------------------
Total:           151.6s
```

Then we know exactly what is slow.

Likely future optimizations include:

### Scraping

Instead of opening Playwright for every difficult page:

``` text
Axios/Cheerio
      ↓
Is content sufficient?
      ↓
Yes → continue
No  → Playwright
```

This is already the basic strategy in the current implementation.

### Embeddings

Later we can:

-   cache embeddings
-   avoid embedding duplicate content
-   batch requests
-   avoid recomputing unchanged webpages

### Retrieval

We can improve:

-   chunk size
-   overlap
-   BM25 weighting
-   semantic weighting
-   duplicate removal
-   source ranking

### Qwen

We can measure:

-   time to first token
-   tokens/second
-   prompt size
-   output length

We can also test another local model later and compare it against
Qwen rather than changing the architecture immediately.

------------------------------------------------------------------------

# 19. Important Project Principle

VeriScope is designed so that Qwen is NOT the search engine and NOT
the source of truth.

The flow is:

``` text
Internet
   ↓
SearXNG
   ↓
Web pages
   ↓
Local extraction
   ↓
Local retrieval
   ↓
Evidence
   ↓
Qwen
   ↓
Grounded answer
```

Qwen should synthesize the evidence supplied by VeriScope rather than
independently inventing the research.

This is important for the project's evidence-grounding and citation
goals.

------------------------------------------------------------------------

# 20. Useful Commands Cheat Sheet

### Compose stack (all app services and SearXNG)

``` bash
docker compose up --build
docker compose down
```

For native/manual development, start only the Compose-managed search
services with `docker compose up -d searxng`.

To check persistence across a restart, use `docker compose down`, then
`docker compose up --build` and repeat the search test. Do not use
`docker compose down -v` unless you intend to delete named state volumes.

### Ollama

``` bash
ollama list
ollama run qwen3.5:9b
ollama serve
```

### MiniLM

``` bash
docker compose exec backend node -e "fetch('http://embedding:8000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
```

### Backend

``` bash
cd backend
node --env-file=../.env src/server.js
```

### React

``` bash
cd frontend
npm run dev
```

For the complete API research test, use the macOS or PowerShell command
in section 11.

------------------------------------------------------------------------

# 21. Official Documentation

For installation details and updates, use the official documentation
for:

-   Docker Desktop for macOS and Windows
-   SearXNG container installation
-   Ollama
-   Ollama Qwen 3.5 9B model

The commands in this README are intended for the current VeriScope
development setup and may need minor adjustments when dependencies or
upstream services change.

------------------------------------------------------------------------

# 22. Local Ollama, context, and retrieval tuning

The backend reads `OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
`OLLAMA_KEEP_ALIVE`, `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_NUM_PREDICT`,
`OLLAMA_TEMPERATURE`, `OLLAMA_REQUEST_TIMEOUT_MS`, and the `OLLAMA_*`
context-management values in the root `.env`. `OLLAMA_URL` remains
supported as a legacy alias for `OLLAMA_BASE_URL`. The Compose default
for `OLLAMA_CONTEXT_LENGTH` is 4096; it is not raised automatically.
Requests preserve the configured model, temperature, and keep-alive and
set Ollama's `num_ctx`, `num_predict`, and `stream` fields.

The initial context is 4096 tokens, the maximum generation setting is
2048 tokens, the minimum output reserve is 696 tokens, and a 256-token
safety margin is held back. The request's `num_predict` is reduced when
the estimated prompt needs more room. Research reduces its evidence
budget before omitting the current question or core instructions. FAST,
NORMAL, and MAX default to Top-K/token budgets of 5/2000, 10/4000, and
20/5000. These values can be changed in `.env` using
`RESEARCH_{FAST,NORMAL,MAX}_TOP_K` and
`RESEARCH_{FAST,NORMAL,MAX}_EVIDENCE_TOKEN_BUDGET`. BM25/MiniLM alpha
is independent of depth: 0.3 is semantic-heavy, 0.5 balanced, and 0.7
keyword-heavy. The browser remembers depth/alpha and completed research
results locally in IndexedDB; conversation messages are persisted by the
backend in SQLite.

Context selection keeps up to five recent complete exchanges within
`OLLAMA_HISTORY_TOKEN_BUDGET` (1600 tokens by default), in chronological
order. Failed or incomplete exchanges are omitted. Older completed turns
are summarized with the configured local Ollama model when the history
exceeds `OLLAMA_SUMMARY_THRESHOLD_MESSAGES` (16 messages by default).
Summaries update incrementally after at least
`OLLAMA_SUMMARY_MIN_NEW_MESSAGES` (6) new older messages; they are stored
in SQLite and never replace original messages. Failed summary attempts
fall back to bounded recent context and are retried after
`OLLAMA_SUMMARY_RETRY_INTERVAL_MS`.

Stored excerpts added to ordinary conversation context retain their
original source/chunk IDs but are explicitly marked as unverified
continuity context. For factual follow-ups, deterministic routing can
select the original passages saved with one earlier research answer;
those passages keep their original IDs and must pass the same
evidence-sufficiency gate and citation verification as newly retrieved
evidence. If they are insufficient, the existing SearXNG retrieval
pipeline runs. A stored summary or assistant answer is never authoritative
evidence.

Simple rephrasing and clarification requests use conversation context
without web search. Queries that explicitly request current information or
fresh verification go directly to web research. Leadership and employment
status changes, market prices/metrics, and software version or availability
questions also require fresh research. Stable explanations, programming
questions, and ordinary conversation use local knowledge. Ambiguous
references with no conversation antecedent receive a clarification prompt.
Only unresolved requests use a non-streaming local route classifier. The
route is finalized before answer generation starts; local answers and
evidence-backed answers cannot switch modes after their first token.

No model tokenizer dependency is used. Token counts are conservative
estimates based on text characters plus per-message overhead, with a
safety margin; they are not exact Qwen token counts, especially for code,
URLs, and non-English text. The 4096 context setting should be benchmarked
on the target hardware before changing it. `keep_alive=30m` keeps model
weights and runner state loaded between requests; it does not retain a
conversation.

In development, set `VERISCOPE_DEBUG_CONTEXT=true` for counts-only
diagnostics: conversation ID, available/selected messages, summary use,
estimated prompt/evidence tokens, `num_ctx`, output limit, and truncation.
It is disabled by default and never logs message contents. The existing
streaming research endpoint and SSE event names remain unchanged.

## Optional native Linux systemd tuning

Ollama is a separate native service; backend `.env` values do not change
the systemd service. The following is an operator procedure, not an
automatic project install. First inspect the effective service with
`systemctl cat ollama.service`. Then use a systemd drop-in instead of
editing or replacing the unit:

```sh
sudo install -d -m 0755 /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/90-veriscope.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_CONTEXT_LENGTH=4096"
EOF
```

This adds a separate drop-in and does not replace the unit or its existing
environment. Review the resulting configuration before reloading and
restarting only the Ollama service:

```sh
systemctl cat ollama.service
sudo systemctl daemon-reload
sudo systemctl restart ollama.service
```

Verify the service environment and GPU allocation:

```sh
systemctl show ollama.service -p DropInPaths --value
systemctl show ollama.service -p Environment --value |
  tr ' ' '\n' |
  grep -E '^OLLAMA_(FLASH_ATTENTION|KV_CACHE_TYPE|KEEP_ALIVE|NUM_PARALLEL|MAX_LOADED_MODELS|CONTEXT_LENGTH)='
ollama ps
nvidia-smi
```

The API's `num_ctx` request option is the application-level context
setting; the service's `OLLAMA_CONTEXT_LENGTH` supplies the server
default. Do not set `num_gpu` or a fixed GPU-layer count. Ollama chooses
offload placement based on available VRAM. `ollama ps` reports the
actual CPU/GPU split after a model is loaded. The dashboard's GPU and
model-allocation measurements are on-demand; unavailable measurements
remain explicitly unavailable.

Flash Attention enables Ollama's quantized K/V cache. `q8_0` uses
approximately half the memory of the default `f16` cache with little
quality impact in typical use; `q4_0` uses less memory but can cause more
noticeable quality loss. KV quantization is a server-wide setting.
Reducing cache precision trades a small amount of numerical fidelity for
more context headroom; it does not shrink model weights or guarantee the
whole model fits in 8 GiB VRAM. With 16 GiB system RAM, leave placement
automatic and observe actual GPU/CPU allocation.

To roll back only this drop-in (the inspected unit currently has no
existing drop-ins), remove its file and restart Ollama:

```sh
sudo rm /etc/systemd/system/ollama.service.d/90-veriscope.conf
sudo systemctl daemon-reload
sudo systemctl restart ollama.service
```

Do not run the rollback command if you have since added other settings to
that drop-in; review `systemctl cat ollama.service` first. The rollback
leaves the original unit and all other drop-ins untouched.

## Monitoring and model comparison

`GET /api/monitoring` gathers Ollama `/api/tags` and `/api/ps`, a
single `nvidia-smi` snapshot, host CPU memory, and the last request's
retrieval/generation timing. The UI refreshes this only when requested.
Ollama does not expose a KV cache quantization field in these monitoring
responses, so verify `OLLAMA_KV_CACHE_TYPE` in the effective service
environment and check Ollama logs during an inference; do not infer cache
precision from model allocation.

No replacement model is selected automatically. A smaller text-only
Qwen candidate should be compared against the installed Qwen 3.5 9B on
the same evidence-grounded research prompts, context, quantization, and
hardware, with citation correctness and answer quality checked alongside
TTFT, generation time, and VRAM/RAM. A model file being smaller or
text-only is not by itself evidence of a meaningful research-quality
advantage. Models are never downloaded or removed by VeriScope.
