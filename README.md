# Media Crawler

**Version:** 1.0.1  
**Status:** Production  
**License:** MIT-0

Reusable OpenClaw skill for acquiring and normalizing media-source content without mixing acquisition with editorial or inference policy.

## Current surface

- YouTube transcript acquisition with normalized JSON output.
- Explicit `youtube_video` and `youtube_short` content kinds.
- Rate-limit-safe native X acquisition: multi-account searches may use `allowed_x_handles`; independent X calls are serialized rather than parallelized.
- Ordinary X posts treated as already-compact source material.
- Long-form X articles treated as long-form content suitable for downstream reduction when needed.
- Modular boundary for future RSS, article, news, podcast, and other source adapters.

Browser usage is explicitly not included due to current inefficiencies for LLM models.

## YouTube adapter

```bash
node scripts/youtube-transcript.js \
  --url 'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output /tmp/transcript.json
```

Optional:

- `SUPADATA_API_KEY` enables the API acquisition path.
- `yt-dlp` is used as the local fallback when available.
- `--lang <code>` requests a preferred transcript language.

The adapter writes one structured JSON result and removes its own temporary files.

## X acquisition discipline

Use native `x_search` when it is available to the consuming workflow. Do not burst independent X searches concurrently. When one query can safely cover multiple accounts, use `allowed_x_handles`; when the caller requires independent per-handle coverage or targeted follow-up, issue those calls strictly serially and consume each result or error before dispatching the next.

## Boundary

This repository does **not** define watchlists, schedules, model/provider routing, inference quotas, summarization policy, publishing format, or durable workflow state. Those belong to the consuming automation.

For ClawHub, `SKILL.md` is the canonical skill contract.