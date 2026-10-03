import axios from "axios";

const SEARXNG_URL = "http://localhost:8080";
const MAX_SEARCH_RESULTS = 5;

export async function discoverUrls(query) {
  const response = await axios.get(`${SEARXNG_URL}/search`, {
    timeout: 10000,
    params: {
      q: query,
      format: "json",
    },
  });

  return response.data.results.slice(0, MAX_SEARCH_RESULTS).map((result) => ({
    title: result.title,
    url: result.url,
    content: result.content,
  }));
}