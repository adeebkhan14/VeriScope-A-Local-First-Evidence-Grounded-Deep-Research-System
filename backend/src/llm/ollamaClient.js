import { Ollama } from "ollama";

export const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434";

const ollama = new Ollama({ host: OLLAMA_URL });

export default ollama;
