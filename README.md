# OnlyKDrama for Nuvio

A JavaScript local scraper ported from the supplied Cloudstream `OnlyKdrama` Kotlin provider.

## Install
Add the repository root URL after publishing this folder to a public GitHub repository:
`https://raw.githubusercontent.com/USERNAME/REPOSITORY/refs/heads/main/`

Nuvio local scrapers expect a repository manifest with a `scrapers` array and a provider file exporting `getStreams(tmdbId, mediaType, seasonNum, episodeNum)`.

## What was ported
- TMDB ID to title lookup
- OnlyKDrama advanced search
- Best-title matching
- Movie download accordion parsing
- Nested episode/provider accordion parsing
- Direct MP4/M3U8/MPD link detection and basic embedded-player resolution
- Nuvio stream object output

## Important compatibility limits
Cloudstream's `loadExtractor()` supports many host-specific extractors. Nuvio local scrapers do not automatically inherit those Kotlin extractors. This port therefore resolves direct media URLs and common embedded media references only. Links hosted on services that require a dedicated extractor may not resolve yet.

The original Cloudstream plugin also opens an Android WebView for Cloudflare verification and stores site cookies. A Nuvio local scraper runs in a sandbox and cannot open that Android WebView or reuse the Cloudstream plugin's cookie session. If OnlyKDrama returns a Cloudflare challenge, the scraper will return no streams until the site is accessible to Nuvio's fetch runtime.

The supplied source targets `https://onlykdrama.shop`. If the site changes domains or page markup, update `BASE_URL` and selectors in `providers/onlykdrama.js`.

## Files
- `manifest.json`
- `providers/onlykdrama.js`
