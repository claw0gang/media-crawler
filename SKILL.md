---
name: media-crawler
description: Acquire and normalize media-source content for research, monitoring, summarization, and editorial workflows.
version: 1.0.1
metadata:
  openclaw:
    emoji: "📡"
    homepage: https://github.com/claw0gang/media-crawler
    requires:
      bins:
        - node
    envVars:
      - name: SUPADATA_API_KEY
        required: false
        description: Optional credential used by the YouTube transcript adapter before its local fallback.
---

# Media Crawler

Acquire and normalize source material for downstream research, monitoring, summarization, or publishing workflows.

## Contract

- Keep acquisition and normalization separate from selection, reduction, editorial synthesis, publication, and durable history.
- Preserve canonical source identity, URLs, timestamps, authors/channels, media URLs, and acquisition provenance when available.
- Do not invent source metadata or outside facts.
- Keep credentials out of prompts, files, logs, and command output.
- Treat watchlists, time windows, dedupe policy, credentials, inference routing, model selection, quotas, publishing format, and durable state as caller-owned concerns.
- Default to ephemeral working files; do not create accumulating caches, run trees, outboxes, provider logs, or history stores.

Browser usage is explicitly not included due to current inefficiencies for LLM models.

## YouTube

Use `scripts/youtube-transcript.js` to acquire transcript text and provenance.

Content kinds are explicit:

- `youtube_video` — standard YouTube video content.
- `youtube_short` — YouTube Shorts content.

The adapter can acquire either kind. The consuming workflow decides which kinds are in scope.

Raw transcripts can be large. Return them as source data; reduction or compaction belongs to the consuming workflow.

## X

Use native `x_search` when the caller exposes it. Acquisition must be rate-limit safe:

- Never dispatch multiple independent `x_search` calls concurrently or in parallel.
- When one semantic query can cover several accounts without weakening the caller's coverage requirement, prefer one bounded call using `allowed_x_handles` rather than one call per handle.
- When independent per-handle coverage or targeted follow-up is required, issue calls strictly serially: fully consume the result or error from one call before dispatching the next.
- A failure or rate limit for one query must not implicitly cancel unrelated remaining acquisition. Continue only through later serialized calls allowed by the caller and provider state.
- Do not add extra `x_search` calls merely to compact or rewrite already-acquired ordinary posts.

Distinguish ordinary posts from long-form articles:

- `x_post` — preserve the post directly; ordinary X posts are already compact and should not be compacted merely because they are X content.
- `x_article` — acquire and normalize the full available article content; consuming workflows may apply their long-form reduction path when needed.

Preserve canonical X URLs and real source-supplied media URLs. Never manufacture media URLs.

## Future adapters

Add RSS/Atom, article, news, podcast, or other source adapters as independent modules. Source-specific retrieval logic belongs with each adapter; workflow-specific policy does not belong in this skill.

## Normalized output

Return the smallest useful structured source object, including when available:

- source/platform and content kind;
- canonical URL and stable source identifier;
- title and author/channel;
- publication timestamp;
- acquired text/content;
- source-supplied media URLs;
- acquisition method/provenance;
- compact warnings for degraded or missing fields.

Use `{baseDir}` when addressing files shipped with this skill.