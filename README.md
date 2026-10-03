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

------------------------------------------------------------------------

# 1. Prerequisites

This guide assumes macOS, including Apple Silicon Macs such as
M1/M2/M3/M4/M5.

You need:

-   macOS
-   Node.js
-   npm
-   Python 3
-   Docker Desktop
-   Git
-   Ollama

Check the basic tools:

``` bash
node --version
npm --version
python3 --version
git --version
docker --version
```

------------------------------------------------------------------------

# 2. Project Structure

The project currently looks like:

``` text
VeriScope/
├── backend/
│   ├── embedding-service/
│   │   ├── app.py
│   │   ├── requirements.txt
│   │   └── venv/
│   │
│   └── src/
│       ├── server.js
│       ├── research.js
│       ├── testResearch.js
│       │
│       ├── routes/
│       │   └── search.js
│       │
│       ├── scraper/
│       │   ├── searchEngine.js
│       │   └── scraper.js
│       │
│       ├── retrieval/
│       │   ├── chunker.js
│       │   ├── bm25.js
│       │   ├── embeddings.js
│       │   ├── semanticSearch.js
│       │   ├── normalize.js
│       │   └── evidence.js
│       │
│       └── llm/
│           └── mistral.js
│
└── frontend/
    └── ...
```

If your React folder has a different name, use that directory instead of
`frontend`.

------------------------------------------------------------------------

# 3. Install Docker Desktop

Download and install Docker Desktop for Mac.

For Apple Silicon, install the Apple Silicon version.

After installation, open Docker Desktop and wait until Docker is
running.

Verify:

``` bash
docker --version
```

Then:

``` bash
docker info
```

If `docker info` prints Docker server information, Docker is working.

You can also check:

``` bash
docker ps
```

Docker Desktop is required because SearXNG is running inside a Docker
container.

------------------------------------------------------------------------

# 4. Install and Setup SearXNG

SearXNG is used by VeriScope for web search/discovery.

It is NOT the final retrieval system. It gives VeriScope URLs that can
then be scraped and processed locally.

## 4.1 Create the SearXNG directory

From your home directory or another location where you keep development
projects:

``` bash
mkdir -p ~/veriscope-searxng
cd ~/veriscope-searxng
```

Create the configuration directory:

``` bash
mkdir -p searxng/core-config
```

Download the official Docker Compose configuration:

``` bash
curl -fsSL \
  -O https://raw.githubusercontent.com/searxng/searxng/master/container/docker-compose.yml \
  -O https://raw.githubusercontent.com/searxng/searxng/master/container/.env.example
```

Create the environment file:

``` bash
cp .env.example .env
```

The official SearXNG documentation recommends Docker Compose for
container deployment.

## 4.2 Start SearXNG

Run:

``` bash
docker compose up -d
```

Check the containers:

``` bash
docker compose ps
```

You should see the SearXNG services running.

Check all Docker containers:

``` bash
docker ps
```

## 4.3 Test SearXNG

Open:

``` text
http://localhost:8080
```

Or test from the terminal:

``` bash
curl "http://localhost:8080/search?q=kubernetes&format=json"
```

If you receive JSON containing search results, SearXNG is working.

## 4.4 Stop SearXNG

When finished:

``` bash
cd ~/veriscope-searxng
docker compose down
```

Start it again later:

``` bash
cd ~/veriscope-searxng
docker compose up -d
```

## 4.5 Check SearXNG logs

If something goes wrong:

``` bash
docker compose logs -f
```

Or:

``` bash
docker compose logs -f core
```

------------------------------------------------------------------------

# 5. Install Ollama

Ollama runs the local language model used by VeriScope.

Install Ollama for macOS.

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

The first run downloads the model.

After it finishes downloading, you can exit the interactive model with:

``` text
/bye
```

Verify:

``` bash
ollama list
```

You should see something similar to:

``` text
mistral
```

The current Ollama Mistral model is a 7B model and the default model is
roughly 4.4 GB.

------------------------------------------------------------------------

# 7. Ollama Server

Ollama normally exposes its local API on:

``` text
http://localhost:11434
```

Check whether Ollama is already running:

``` bash
lsof -i :11434
```

If you see:

``` text
ollama ... TCP localhost:11434 (LISTEN)
```

the Ollama server is already running.

You do NOT need to run another `ollama serve`.

If Ollama is not running, start it:

``` bash
ollama serve
```

You can also test the model directly:

``` bash
ollama run mistral
```

------------------------------------------------------------------------

# 8. Install Backend Dependencies

Go to the backend:

``` bash
cd ~/path/to/VeriScope/backend
```

If you have not initialized npm yet:

``` bash
npm init -y
```

Install Express and CORS:

``` bash
npm install express cors
```

Install Axios and Cheerio:

``` bash
npm install axios cheerio
```

Install Playwright:

``` bash
npm install playwright
```

Install Chromium for Playwright:

``` bash
npx playwright install chromium
```

Install BM25:

``` bash
npm install wink-bm25-text-search
```

Install the Ollama JavaScript client:

``` bash
npm install ollama
```

Your backend dependencies should now include the packages required by
the current pipeline.

------------------------------------------------------------------------

# 9. Setup the Local MiniLM Embedding Service

VeriScope uses:

``` text
all-MiniLM-L6-v2
```

for local semantic embeddings.

Go to:

``` bash
cd ~/path/to/VeriScope/backend/embedding-service
```

Create a Python virtual environment:

``` bash
python3 -m venv venv
```

Activate it:

``` bash
source venv/bin/activate
```

Install dependencies:

``` bash
pip install -r requirements.txt
```

The `requirements.txt` should contain:

``` text
fastapi
uvicorn
sentence-transformers
```

Start the embedding API:

``` bash
uvicorn app:app --host 127.0.0.1 --port 8000
```

The service should now be available at:

``` text
http://127.0.0.1:8000
```

Test it:

``` bash
curl http://127.0.0.1:8000/
```

Expected response:

``` json
{
  "status": "Embedding service running"
}
```

Keep this terminal running while using VeriScope.

To stop it:

``` text
CTRL + C
```

------------------------------------------------------------------------

# 10. Start the VeriScope Backend

Open a new terminal.

Go to the backend directory:

``` bash
cd ~/path/to/VeriScope/backend
```

Start Express:

``` bash
node src/server.js
```

The backend runs on:

``` text
http://localhost:5001
```

Test it:

``` bash
curl http://localhost:5001/
```

Expected response:

``` json
{
  "name": "VeriScope API",
  "status": "running"
}
```

Keep this terminal running.

------------------------------------------------------------------------

# 11. Test the Backend Research API

You can test the complete research pipeline without React.

From another terminal:

``` bash
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"How does Kubernetes perform service discovery?"}'
```

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

Open another terminal.

Go to your React directory:

``` bash
cd ~/path/to/VeriScope/frontend
```

Install dependencies if necessary:

``` bash
npm install
```

Start Vite:

``` bash
npm run dev
```

React should normally be available at:

``` text
http://localhost:5173
```

Open that address in your browser.

------------------------------------------------------------------------

# 13. Complete Startup Order

For normal development, you need these services:

``` text
┌─────────────────────────────┐
│ Docker                      │
│ SearXNG :8080               │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ Ollama                      │
│ Mistral :11434              │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ MiniLM Embedding API        │
│ :8000                       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ Express Backend             │
│ :5001                       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│ React                       │
│ :5173                       │
└─────────────────────────────┘
```

## Terminal 1 --- SearXNG

``` bash
cd ~/veriscope-searxng
docker compose up -d
```

## Terminal 2 --- MiniLM

``` bash
cd ~/path/to/VeriScope/backend/embedding-service
source venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8000
```

## Terminal 3 --- Backend

``` bash
cd ~/path/to/VeriScope/backend
node src/server.js
```

## Terminal 4 --- React

``` bash
cd ~/path/to/VeriScope/frontend
npm run dev
```

Ollama normally runs as a background service, so you generally don't
need a separate terminal for it.

------------------------------------------------------------------------

# 14. Quick Health Checks

Before searching, check:

### Docker

``` bash
docker ps
```

### SearXNG

``` bash
curl "http://localhost:8080/search?q=test&format=json"
```

### Ollama

``` bash
lsof -i :11434
```

### Mistral

``` bash
ollama list
```

### MiniLM

``` bash
curl http://127.0.0.1:8000/
```

### Backend

``` bash
curl http://localhost:5001/
```

### React

Open:

``` text
http://localhost:5173
```

------------------------------------------------------------------------

# 15. Stopping Everything

## Stop React

In the React terminal:

``` text
CTRL + C
```

## Stop Backend

In the backend terminal:

``` text
CTRL + C
```

## Stop MiniLM

In the embedding-service terminal:

``` text
CTRL + C
```

## Stop SearXNG

``` bash
cd ~/veriscope-searxng
docker compose down
```

## Stop Ollama

You normally don't need to stop Ollama.

If you want to stop it:

``` bash
pkill -f ollama
```

------------------------------------------------------------------------

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

### SearXNG

``` bash
cd ~/veriscope-searxng
docker compose up -d
docker compose ps
docker compose logs -f
docker compose down
```

### Ollama

``` bash
ollama list
ollama run mistral
lsof -i :11434
ollama serve
```

### MiniLM

``` bash
cd backend/embedding-service
source venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8000
```

### Backend

``` bash
cd backend
node src/server.js
```

### React

``` bash
cd frontend
npm run dev
```

### Complete API test

``` bash
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"How does Kubernetes perform service discovery?"}'
```

------------------------------------------------------------------------

# 21. Official Documentation

For installation details and updates, use the official documentation
for:

-   Docker Desktop for Mac
-   SearXNG container installation
-   Ollama
-   Ollama Mistral model

The commands in this README are intended for the current VeriScope
development setup and may need minor adjustments when dependencies or
upstream services change.
