import express from "express";
import cors from "cors";

import searchRouter from "./routes/search.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "VeriScope API",
    status: "running",
  });
});

app.use("/api/search", searchRouter);

const PORT = 5001;

app.listen(PORT, () => {
  console.log(`VeriScope backend running on port ${PORT}`);
});