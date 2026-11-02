# Cloudstream to Nuvio port notes

| Supplied Cloudstream implementation | Nuvio implementation |
|---|---|
| `search()` + advanced-search URL | `searchOnlyKdrama()` |
| `parseSearch()` and title selection | Search result parsing and TMDB title scoring |
| `load()` movie detail parsing | `parseMovieLinks()` |
| `parseEpisodes()` | `parseSeriesLinks()` for the requested season/episode |
| `loadLinks()` + `loadExtractor()` | `resolveDirectStream()` + Nuvio stream objects |
| Kotlin/Jsoup/Cloudstream models | JavaScript/Cheerio/Nuvio `getStreams()` |

The original `OnlyKdramaWebView`, `OnlyKdramaVerification`, and cookie/session Kotlin classes are Android UI and Cloudstream-specific. They cannot be called from a Nuvio local scraper sandbox. The Nuvio scraper can detect a Cloudflare challenge, but it cannot open the Cloudstream verification popup or share its cookie jar.

Cloudstream's `loadExtractor()` has host-specific extractors. This port includes generic redirect and embedded MP4/M3U8/MPD detection, not the full Cloudstream extractor library. Some file-host links will need dedicated JavaScript resolver code before they can play.
