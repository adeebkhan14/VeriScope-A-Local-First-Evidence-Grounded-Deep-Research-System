# VeriScope --- Local-First Evidence-Grounded Deep Research System

VeriScope is a local-first research system that searches the web,
extracts webpage content, retrieves relevant evidence using lexical +
semantic search, and generates a grounded answer using a locally running
Mistral model.

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
   └── Ollama + Mistral → grounded answer
```

Completed research results are stored in the browser's local IndexedDB
database. The research library supports full-text search over saved
questions and answers, saved-result filtering, reopening, copying answer
text, deleting individual entries, and clearing the local library. This
browser storage is not sent to the backend or synchronized across devices.

------------------------------------------------------------------------

# 1. Prerequisites

The same Docker Compose project runs on macOS and Windows with Docker
Desktop. Ollama and Mistral remain native host prerequisites; SearXNG,
the frontend, backend, and MiniLM run in Compose.

You need:

- Docker Desktop
- Ollama installed on the host
- The `mistral` model downloaded in Ollama
- Node.js, npm, and Python 3 only for native/manual development

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

# 6. Install Mistral

VeriScope currently uses the `mistral` model.

Download/run it:

``` bash
ollama run mistral
```

The first run downloads the model. Verify it is installed:

``` bash
ollama list
```

------------------------------------------------------------------------

# 7. Ollama connectivity

Native backend development uses `http://localhost:11434`. A containerized
backend uses `http://host.docker.internal:11434`, which Docker Desktop
resolves to the host on both macOS and Windows.

If `/api/tags` works on the host but the backend container cannot connect,
the Ollama listener may be bound only to loopback. Restart Ollama with
`OLLAMA_HOST=0.0.0.0:11434` (macOS: `OLLAMA_HOST=0.0.0.0:11434 ollama
serve`; Windows PowerShell: `$env:OLLAMA_HOST='0.0.0.0:11434'; ollama
serve`). This listens on all interfaces, so only do this with the host
firewall restricting inbound access to local Docker/host traffic. Do not
create a public or LAN-wide inbound rule, configure router port
forwarding, or expose Ollama to the internet. Verify host firewall and
Docker Desktop networking before changing the listener.

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
Mistral
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

After completing section 4 and setting `SEARXNG_SECRET`, the single
startup command builds and starts the frontend, backend, MiniLM, SearXNG,
and Valkey:

```text
docker compose up --build
```

Open **http://localhost:5173**. The backend API is available at
**http://localhost:5001**. Ollama and Mistral remain native host services.
The backend waits for healthy SearXNG and MiniLM services before starting.

| Service | Host address | Notes |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | React/Vite app served by the frontend container |
| Backend | `http://localhost:5001` | Express API |
| SearXNG | `http://localhost:8080` | Host port configurable with `SEARXNG_PORT`; internal address is `searxng:8080` |
| MiniLM | `embedding:8000` | Compose-only; native development uses `http://127.0.0.1:8000` |
| Ollama | `http://localhost:11434` | Native host service; containers reach `host.docker.internal:11434` |
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

### Mistral

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
upstream services.

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
mean Mistral alone takes 3 minutes.

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
12. Send evidence to Mistral
       ↓
13. Generate final answer
```

Several of these are currently performed sequentially.

The Playwright fallback can also be relatively expensive because the
current scraper opens a browser for each fallback page.

Therefore, before optimizing Mistral, measure where the time is actually
being spent.

------------------------------------------------------------------------

# 17. Will It Be Faster on Another Computer?

Yes.

Local LLM performance depends heavily on the hardware.

Your M2 MacBook Air is capable of running Mistral locally, but a machine
with a significantly faster GPU and/or more memory can generate
responses much faster.

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
Mistral's raw generation speed** because the VeriScope pipeline includes
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
Mistral:          95.4s
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

### Mistral

We can measure:

-   time to first token
-   tokens/second
-   prompt size
-   output length

We can also test another local model later and compare it against
Mistral rather than changing the architecture immediately.

------------------------------------------------------------------------

# 19. Important Project Principle

VeriScope is designed so that Mistral is NOT the search engine and NOT
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
Mistral
   ↓
Grounded answer
```

Mistral should synthesize the evidence supplied by VeriScope rather than
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
ollama run mistral
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
-   Ollama Mistral model

The commands in this README are intended for the current VeriScope
development setup and may need minor adjustments when dependencies or
upstream services change.
