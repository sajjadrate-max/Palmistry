/**
 * server.js
 *
 * Plain Express server — an alternative to the Vercel serverless function
 * in /api/analyze.js, for local testing or deploying to any Node host
 * (Render, Railway, a VPS, etc.).
 *
 * Usage:
 *   npm install
 *   cp .env.example .env      # then fill in OPENAI_API_KEY
 *   npm start
 *   open http://localhost:3000
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const analyzeHandler = require("./api/analyze.js");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse large-ish JSON bodies since we accept base64 images
app.use(express.json({ limit: "12mb" }));

// Serve the static frontend (index.html and friends)
app.use(express.static(path.join(__dirname)));

// Reuse the exact same handler used by the Vercel serverless function
app.post("/api/analyze", (req, res) => {
  analyzeHandler(req, res);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Palmistry app running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY is not set. Set it in your .env file before analyzing images.");
  }
});
