#!/usr/bin/env node
/**
 * @file YouTube transcript acquisition adapter for Media Crawler.
 * @version 1.0.0
 * @license MIT-0
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const VERSION = "1.0.0";
const SUPADATA_ENDPOINT = "https://api.supadata.ai/v1/youtube/transcript";

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseYoutubeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new Error("invalid YouTube URL");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    throw new Error("URL is not a supported YouTube host");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let id = null;
  let kind = "youtube_video";

  if (host === "youtu.be") {
    id = parts[0] || null;
  } else if (url.searchParams.get("v")) {
    id = url.searchParams.get("v");
  } else if (["shorts", "live", "embed"].includes(parts[0]) && parts[1]) {
    id = parts[1];
    if (parts[0] === "shorts") kind = "youtube_short";
  }

  if (!id) throw new Error("unable to resolve YouTube video ID");

  return {
    id,
    kind,
    inputUrl: url.toString(),
    canonicalUrl: kind === "youtube_short"
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`,
  };
}

function textFromTranscriptPayload(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === "string" ? entry : entry?.text)
      .filter((entry) => typeof entry === "string" && entry.trim())
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  return textFromTranscriptPayload(value.content ?? value.transcript ?? value.text ?? value.data);
}

async function fetchJson(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    let parsed = null;
    if (body) {
      try { parsed = JSON.parse(body); } catch {}
    }
    return { response, body, parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function acquireSupadata(identity, lang) {
  const apiKey = String(process.env.SUPADATA_API_KEY || "").trim();
  if (!apiKey) return { ok: false, skipped: true, source: "supadata", error: "SUPADATA_API_KEY not configured" };

  const endpoint = new URL(SUPADATA_ENDPOINT);
  endpoint.searchParams.set("url", identity.inputUrl);
  endpoint.searchParams.set("text", "true");
  if (lang) endpoint.searchParams.set("lang", lang);

  try {
    const { response, parsed, body } = await fetchJson(endpoint, {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
        "user-agent": `media-crawler/${VERSION}`,
      },
    });

    if (!response.ok) {
      const message = parsed?.message || parsed?.error || body || `HTTP ${response.status}`;
      return { ok: false, source: "supadata", error: `HTTP ${response.status}: ${String(message).slice(0, 300)}` };
    }

    const transcript = textFromTranscriptPayload(parsed);
    if (!transcript) return { ok: false, source: "supadata", error: "empty transcript" };

    return {
      ok: true,
      source: "supadata",
      transcript,
      language: parsed?.lang || lang || null,
    };
  } catch (error) {
    return {
      ok: false,
      source: "supadata",
      error: error?.name === "AbortError" ? "request timed out" : (error?.message || String(error)),
    };
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    cwd: options.cwd,
  });
}

function ytDlpAvailable() {
  const result = run("yt-dlp", ["--version"], { timeoutMs: 15000 });
  return !result.error && result.status === 0;
}

function parseUploadDate(raw) {
  const value = String(raw || "");
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : null;
}

function preferredLanguage(info, requested) {
  const manual = Object.keys(info?.subtitles || {}).filter((key) => key !== "live_chat");
  const automatic = Object.keys(info?.automatic_captions || {}).filter((key) => key !== "live_chat");
  const languages = [...new Set([...manual, ...automatic])];
  if (!languages.length) return null;

  if (requested) {
    const exact = languages.find((lang) => lang === requested);
    if (exact) return exact;
    const base = requested.split("-")[0];
    const related = languages.find((lang) => lang === base || lang.startsWith(`${base}-`));
    if (related) return related;
  }

  return languages.find((lang) => lang === "en")
    || languages.find((lang) => lang.startsWith("en-"))
    || languages[0];
}

function stripVtt(input) {
  const lines = String(input || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const out = [];
  let previous = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (/^\d+$/.test(line)) continue;
    if (/\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+/.test(line)) continue;

    line = line
      .replace(/<\/?c(?:\.[^>]*)?>/g, "")
      .replace(/<\/?v(?:\s+[^>]*)?>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    if (!line || line === previous) continue;
    out.push(line);
    previous = line;
  }

  return out.join("\n").trim();
}

function acquireYtDlp(identity, lang) {
  if (!ytDlpAvailable()) {
    return { ok: false, skipped: true, source: "yt-dlp", error: "yt-dlp not installed" };
  }

  const meta = run("yt-dlp", [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    identity.inputUrl,
  ], { timeoutMs: 120000 });

  if (meta.error || meta.status !== 0) {
    return {
      ok: false,
      source: "yt-dlp",
      error: String(meta.stderr || meta.error?.message || "metadata request failed").trim().slice(0, 500),
    };
  }

  let info;
  try {
    info = JSON.parse(meta.stdout);
  } catch {
    return { ok: false, source: "yt-dlp", error: "invalid metadata JSON" };
  }

  const selectedLang = preferredLanguage(info, lang);
  if (!selectedLang) return { ok: false, source: "yt-dlp", error: "no subtitles or automatic captions available" };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "media-crawler-youtube-"));
  try {
    const outputTemplate = path.join(tempRoot, "transcript.%(ext)s");
    const transcriptRun = run("yt-dlp", [
      "--skip-download",
      "--no-warnings",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", selectedLang,
      "--sub-format", "vtt",
      "-o", outputTemplate,
      identity.inputUrl,
    ], { timeoutMs: 120000, cwd: tempRoot });

    if (transcriptRun.error || transcriptRun.status !== 0) {
      return {
        ok: false,
        source: "yt-dlp",
        error: String(transcriptRun.stderr || transcriptRun.error?.message || "subtitle request failed").trim().slice(0, 500),
      };
    }

    const vtt = fs.readdirSync(tempRoot).find((name) => name.endsWith(".vtt"));
    if (!vtt) return { ok: false, source: "yt-dlp", error: "subtitle file not produced" };

    const transcript = stripVtt(fs.readFileSync(path.join(tempRoot, vtt), "utf8"));
    if (!transcript) return { ok: false, source: "yt-dlp", error: "empty transcript" };

    return {
      ok: true,
      source: "yt-dlp",
      transcript,
      language: selectedLang,
      metadata: {
        id: info.id || identity.id,
        title: info.title || null,
        channel: info.channel || info.uploader || null,
        publishedAt: parseUploadDate(info.upload_date),
        canonicalUrl: info.webpage_url || identity.canonicalUrl,
      },
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeJsonAtomic(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

function normalizedResult(identity, acquired, attempts) {
  const meta = acquired.metadata || {};
  return {
    schemaVersion: 1,
    source: "youtube",
    kind: identity.kind,
    id: meta.id || identity.id,
    url: meta.canonicalUrl || identity.canonicalUrl,
    title: meta.title || null,
    channel: meta.channel || null,
    publishedAt: meta.publishedAt || null,
    language: acquired.language || null,
    transcript: acquired.transcript,
    acquisition: {
      method: acquired.source,
      attempts,
    },
  };
}

async function main() {
  if (hasFlag("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const url = argValue("--url");
  const output = argValue("--output");
  const lang = argValue("--lang", null);
  if (!url || !output) {
    die("usage: youtube-transcript.js --url <youtube-url> --output <json-file> [--lang <code>]", 64);
  }

  let identity;
  try {
    identity = parseYoutubeUrl(url);
  } catch (error) {
    die(error?.message || String(error), 64);
  }

  const attempts = [];

  const primary = await acquireSupadata(identity, lang);
  attempts.push({ source: primary.source, ok: primary.ok, skipped: Boolean(primary.skipped), error: primary.ok ? null : primary.error });
  if (primary.ok) {
    writeJsonAtomic(output, normalizedResult(identity, primary, attempts));
    return;
  }

  const fallback = acquireYtDlp(identity, lang);
  attempts.push({ source: fallback.source, ok: fallback.ok, skipped: Boolean(fallback.skipped), error: fallback.ok ? null : fallback.error });
  if (fallback.ok) {
    writeJsonAtomic(output, normalizedResult(identity, fallback, attempts));
    return;
  }

  writeJsonAtomic(output, {
    schemaVersion: 1,
    source: "youtube",
    kind: identity.kind,
    id: identity.id,
    url: identity.canonicalUrl,
    error: "transcript acquisition failed",
    attempts,
  });
  process.exitCode = 1;
}

main().catch((error) => die(error?.message || String(error)));
