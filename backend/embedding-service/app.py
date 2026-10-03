from fastapi import FastAPI
from sentence_transformers import SentenceTransformer

app = FastAPI()

model = SentenceTransformer("all-MiniLM-L6-v2")


@app.get("/")
def root():
    return {
        "status": "Embedding service running"
    }


@app.post("/embed")
def embed(data: dict):
    texts = data.get("texts", [])

    if not texts:
        return {
            "embeddings": []
        }

    embeddings = model.encode(
        texts,
        normalize_embeddings=True
    )

    return {
        "embeddings": embeddings.tolist()
    }