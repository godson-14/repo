#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function options(argv) {
  const result = { file: "schema.json", port: 4000 };
  for (const arg of argv) {
    if (arg.startsWith("--file=")) result.file = arg.slice(7);
    else if (arg.startsWith("--port=")) result.port = Number(arg.slice(7));
    else if (!arg.startsWith("--") && !result.target) result.target = arg;
    else if (arg === "--help" || arg === "-h") result.help = true;
  }
  return result;
}

function usage() {
  console.log(`
MockServer-Quick — instant local REST API

Usage:
  mock-api --file=schema.json --port=4000

Options:
  --file=PATH   JSON data file (default: schema.json)
  --port=PORT   Local port (default: 4000)
  --help        Show this help

A top-level JSON object creates one endpoint per key.
Each key should contain an array of records, for example { "users": [{ "id": "u1", "name": "Ada" }] }.
`);
}

function seedRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { id: randomUUID(), value: record ?? "sample" };
  }
  const seeded = { ...record };
  for (const [key, value] of Object.entries(seeded)) {
    if (value === null || value === "") {
      if (/email/i.test(key)) seeded[key] = `user-${randomUUID().slice(0, 8)}@example.test`;
      else if (/date|time|created/i.test(key)) seeded[key] = new Date().toISOString();
      else if (/name/i.test(key)) seeded[key] = "Sample User";
      else seeded[key] = `sample-${randomUUID().slice(0, 6)}`;
    }
  }
  if (!("id" in seeded)) seeded.id = randomUUID();
  return seeded;
}

function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(data === undefined ? "" : JSON.stringify(data, null, 2));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body exceeds 1 MB");
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function main() {
  const config = options(process.argv.slice(2));
  if (config.help) return usage();
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    console.error("Error: --port must be a number between 1 and 65535.");
    process.exitCode = 1;
    return;
  }

  const file = resolve(config.file);
  let input;
  try {
    input = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    console.error(`Could not load JSON file "${file}": ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    console.error("The JSON file must contain an object whose values are arrays.");
    process.exitCode = 1;
    return;
  }

  const collections = new Map();
  for (const [name, records] of Object.entries(input)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) || !Array.isArray(records)) {
      console.error(`Invalid collection "${name}". Use a simple name and an array of records.`);
      process.exitCode = 1;
      return;
    }
    collections.set(name, records.map(seedRecord));
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://localhost:${config.port}`);
    if (url.pathname === "/health") return send(res, 200, { status: "ok", service: "MockServer-Quick" });

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 1 || parts.length > 2) {
      return send(res, 404, { error: "Route not found", availableCollections: [...collections.keys()] });
    }
    const [name, id] = parts;
    const records = collections.get(name);
    if (!records) return send(res, 404, { error: "Collection not found", availableCollections: [...collections.keys()] });

    try {
      if (!id && req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
        const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
        return send(res, 200, { data: records.slice(offset, offset + limit), total: records.length, limit, offset });
      }
      if (!id && req.method === "POST") {
        const incoming = await body(req);
        if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
          return send(res, 400, { error: "Body must be a JSON object" });
        }
        const created = { ...incoming, id: incoming.id ?? randomUUID() };
        if (records.some((item) => String(item.id) === String(created.id))) {
          return send(res, 409, { error: "An item with this id already exists" });
        }
        records.push(created);
        return send(res, 201, created);
      }
      const index = records.findIndex((item) => String(item.id) === decodeURIComponent(id ?? ""));
      if (index < 0) return send(res, 404, { error: "Record not found" });
      if (req.method === "GET") return send(res, 200, records[index]);
      if (req.method === "PUT" || req.method === "PATCH") {
        const incoming = await body(req);
        if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
          return send(res, 400, { error: "Body must be a JSON object" });
        }
        records[index] = req.method === "PUT"
          ? { ...incoming, id: records[index].id }
          : { ...records[index], ...incoming, id: records[index].id };
        return send(res, 200, records[index]);
      }
      if (req.method === "DELETE") {
        const [removed] = records.splice(index, 1);
        return send(res, 200, { message: "Record deleted", data: removed });
      }
      return send(res, 405, { error: "Method not allowed" });
    } catch (error) {
      return send(res, error instanceof SyntaxError ? 400 : 500, { error: error.message || "Unexpected server error" });
    }
  });

  server.listen(config.port, "127.0.0.1", () => {
    console.log("\n⚡ MockServer-Quick is running");
    console.log(`   Data file: ${file}`);
    console.log(`   Local URL: http://127.0.0.1:${config.port}`);
    console.log("   Health:    /health");
    for (const name of collections.keys()) console.log(`   API:       /${name}`);
    console.log("\nPress Ctrl+C to stop. Data changes stay in memory and reset on restart.\n");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
