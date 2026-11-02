const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://onlykdrama.shop';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL + '/'
};

function absoluteUrl(value, base) {
  if (!value) return '';
  const raw = String(value).trim().replace(/\\//g, '/').replace(/&amp;/g, '&');
  if (!raw || /^(data:|javascript:|#)/i.test(raw)) return '';
  try { return new URL(raw, base || BASE_URL).href; } catch (_) { return ''; }
}

async function request(url, options) {
  const response = await fetch(url, {
    ...(options || {}),
    headers: { ...HEADERS, ...((options && options.headers) || {}) },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  return response;
}

async function getTmdbInfo(tmdbId, mediaType) {
  const isTv = mediaType === 'tv' || mediaType === 'series' || mediaType === 'show';
  const endpoint = isTv ? 'tv' : 'movie';
  const response = await request(
    'https://api.themoviedb.org/3/' + endpoint + '/' +
    encodeURIComponent(String(tmdbId)) + '?api_key=' + TMDB_API_KEY,
    { headers: { 'Accept': 'application/json', 'Referer': 'https://www.themoviedb.org/' } }
  );
  const data = await response.json();
  const title = isTv ? (data.name || data.original_name) : (data.title || data.original_title);
  if (!title) throw new Error('TMDB title was not found');
  return {
    title: title,
    originalTitle: isTv ? data.original_name : data.original_title,
    year: String((isTv ? data.first_air_date : data.release_date) || '').slice(0, 4),
    isTv: isTv
  };
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(candidate, target) {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.88;
  const aw = a.split(' ').filter(x => x.length > 1);
  const bw = b.split(' ').filter(x => x.length > 1);
  const matched = aw.filter(x => bw.some(y => x === y || x.includes(y) || y.includes(x))).length;
  return matched / Math.max(aw.length, bw.length, 1);
}

function imageUrl($, card) {
  const img = $(card).find('.poster img').first().length
    ? $(card).find('.poster img').first()
    : $(card).find('.image img').first();
  if (!img.length) return '';
  for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-image', 'data-lazy']) {
    const value = img.attr(attr);
    if (value && !value.startsWith('data:')) return absoluteUrl(value);
  }
  return '';
}

async function searchOnlyKdrama(info) {
  const queries = [info.title, info.originalTitle].filter((v, i, a) => v && a.indexOf(v) === i);
  const all = [];
  for (const query of queries) {
    const url = BASE_URL + '/advance-search/?q=' + encodeURIComponent(query) +
      '&type=all&lang=&genre=&year=&min_rating=0&sort=latest';
    const response = await request(url);
    const html = await response.text();
    if (/just a moment|verify you are human|cf-chl-/i.test(html)) {
      throw new Error('OnlyKDrama Cloudflare verification is blocking scraper requests');
    }
    const $ = cheerio.load(html);
    $('.search-page .result-item, article.item').each((_, card) => {
      const link = $(card).find('.details .title a[href], .image a[href], .poster a[href], .data h3 a[href]').first();
      const href = absoluteUrl(link.attr('href'));
      const title = (link.text() || $(card).find('img').first().attr('alt') || '').trim();
      if (href && title && (/onlykdrama\.shop\/(drama|movies)\//i.test(href))) {
        all.push({ title, url: href, poster: imageUrl($, card) });
      }
    });
  }
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    if (!seen.has(item.url)) { seen.add(item.url); unique.push(item); }
  }
  unique.sort((a, b) => titleScore(b.title, info.title) - titleScore(a.title, info.title));
  return unique;
}

function extractAnchorLinks($, root, providerName) {
  const links = [];
  const seen = new Set();
  $(root).find('a[href], [data-href], [data-url]').each((_, element) => {
    const el = $(element);
    const raw = el.attr('href') || el.attr('data-href') || el.attr('data-url');
    const url = absoluteUrl(raw);
    if (!url || !/^https?:/i.test(url) || seen.has(url)) return;
    seen.add(url);
    const name = (el.text() || el.attr('title') || el.attr('aria-label') || providerName || 'Download')
      .trim().replace(/\s+/g, ' ');
    links.push({ name: name || providerName || 'Download', url, provider: providerName || 'OnlyKDrama' });
  });
  return links;
}

function parseMovieLinks($) {
  const root = $('#info .wp-content > .wp-block-ub-content-toggle-block').first();
  if (!root.length) return [];
  const output = [];
  root.children('.wp-block-ub-content-toggle-accordion').each((_, accordion) => {
    const title = $(accordion).find('.wp-block-ub-content-toggle-accordion-title').first().text()
      .replace(/download\s*links/ig, '').trim() || 'Download';
    const content = $(accordion).find('.wp-block-ub-content-toggle-accordion-content-wrap').first();
    output.push(...extractAnchorLinks($, content, title));
  });
  return output;
}

function parseSeriesLinks($, seasonNumber, episodeNumber) {
  const root = $('#info .wp-content').first();
  if (!root.length) return [];
  const topAccordions = root.find('.wp-block-ub-content-toggle-accordion').filter((_, el) =>
    !$(el).parents('.wp-block-ub-content-toggle-accordion').length
  );
  const output = [];
  const nested = topAccordions.toArray().some(el =>
    $(el).find('.wp-block-ub-content-toggle-accordion-content-wrap .wp-block-ub-content-toggle-accordion').length > 0
  );

  if (nested) {
    topAccordions.each((index, episodeAccordion) => {
      const episodeTitle = $(episodeAccordion).find('.wp-block-ub-content-toggle-accordion-title').first().text().trim();
      const sMatch = episodeTitle.match(/\bS(?:eason)?\s*0*(\d+)/i);
      const eMatch = episodeTitle.match(/(?:episode|ep)\s*0*(\d+)/i) || episodeTitle.match(/\b(\d{1,3})\b/);
      const season = sMatch ? Number(sMatch[1]) : 1;
      const episode = eMatch ? Number(eMatch[1]) : index + 1;
      if (season !== Number(seasonNumber || 1) || episode !== Number(episodeNumber || 1)) return;
      const content = $(episodeAccordion).find('.wp-block-ub-content-toggle-accordion-content-wrap').first();
      const providerAccordions = content.find('.wp-block-ub-content-toggle-accordion');
      if (providerAccordions.length) {
        providerAccordions.each((_, providerAccordion) => {
          const provider = $(providerAccordion).find('.wp-block-ub-content-toggle-accordion-title').first().text()
            .replace(/download\s*links/ig, '').trim() || 'Download';
          const providerContent = $(providerAccordion).find('.wp-block-ub-content-toggle-accordion-content-wrap').first();
          output.push(...extractAnchorLinks($, providerContent, provider));
        });
      } else {
        output.push(...extractAnchorLinks($, content, 'Download'));
      }
    });
  } else {
    topAccordions.each((_, accordion) => {
      const provider = $(accordion).find('.wp-block-ub-content-toggle-accordion-title').first().text().trim() || 'Download';
      const content = $(accordion).find('.wp-block-ub-content-toggle-accordion-content-wrap').first();
      content.find('a[href], [data-href], [data-url]').each((_, element) => {
        const el = $(element);
        const text = (el.text() + ' ' + provider).trim();
        const match = text.match(/\bS\s*0*(\d{1,2})\s*E\s*0*(\d{1,3})\b/i);
        if (!match || Number(match[1]) !== Number(seasonNumber || 1) ||
            Number(match[2]) !== Number(episodeNumber || 1)) return;
        const url = absoluteUrl(el.attr('href') || el.attr('data-href') || el.attr('data-url'));
        if (url) output.push({ name: el.text().trim() || provider, url, provider });
      });
    });
  }
  const unique = [];
  const seen = new Set();
  for (const item of output) if (!seen.has(item.url)) { seen.add(item.url); unique.push(item); }
  return unique;
}

function isDirectMediaUrl(url, contentType) {
  return /\.(m3u8|mp4|mkv|webm|mpd)(?:$|[?#])/i.test(url || '') ||
    /^(video\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i.test(contentType || '');
}

function collectEmbeddedMedia($, html, pageUrl) {
  const found = [];
  const add = value => {
    const url = absoluteUrl(value, pageUrl);
    if (url && isDirectMediaUrl(url, '')) found.push(url);
  };
  $('video[src], video source[src], source[src], iframe[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) add(src);
  });
  $('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]').each((_, el) => add($(el).attr('content')));
  const patterns = [
    /(?:file|src|source|hls|playlist)\s*[:=]\s*["'](https?:[^"'\s]+\.(?:m3u8|mp4|mpd)(?:\?[^"'\s]*)?)["']/ig,
    /https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>]*)?/ig
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) add(match[1] || match[0]);
  }
  return Array.from(new Set(found));
}

async function resolveDirectStream(candidate) {
  if (isDirectMediaUrl(candidate, '')) return candidate;
  try {
    const response = await fetch(candidate, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = response.url || candidate;
    const type = (response.headers && response.headers.get('content-type')) || '';
    if (isDirectMediaUrl(finalUrl, type)) return finalUrl;
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) return '';
    const html = await response.text();
    if (/just a moment|verify you are human|cf-chl-/i.test(html)) return '';
    const $ = cheerio.load(html);
    const embedded = collectEmbeddedMedia($, html, finalUrl);
    if (embedded.length) return embedded[0];
    const iframe = $('iframe[src]').map((_, el) => absoluteUrl($(el).attr('src'), finalUrl)).get()
      .find(url => url && url !== finalUrl);
    if (iframe) {
      const nested = await fetch(iframe, { headers: { ...HEADERS, Referer: finalUrl }, redirect: 'follow' });
      const nestedUrl = nested.url || iframe;
      const nestedType = (nested.headers && nested.headers.get('content-type')) || '';
      if (isDirectMediaUrl(nestedUrl, nestedType)) return nestedUrl;
      if (/text\/html|application\/xhtml\+xml/i.test(nestedType)) {
        const nestedHtml = await nested.text();
        const nested$ = cheerio.load(nestedHtml);
        const nestedMedia = collectEmbeddedMedia(nested$, nestedHtml, nestedUrl);
        if (nestedMedia.length) return nestedMedia[0];
      }
    }
  } catch (_) {}
  return '';
}

function qualityFromText(value) {
  const match = String(value || '').match(/(2160p|4k|1440p|1080p|720p|480p|360p)/i);
  return match ? (/4k/i.test(match[1]) ? '4K' : match[1].toLowerCase()) : 'Unknown';
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    const info = await getTmdbInfo(tmdbId, mediaType);
    const matches = await searchOnlyKdrama(info);
    if (!matches.length) return [];

    const best = matches[0];
    const score = Math.max(titleScore(best.title, info.title), titleScore(best.title, info.originalTitle));
    if (score < 0.45) return [];

    const pageResponse = await request(best.url);
    const pageHtml = await pageResponse.text();
    if (/just a moment|verify you are human|cf-chl-/i.test(pageHtml)) {
      throw new Error('OnlyKDrama Cloudflare verification required. Nuvio local scrapers cannot open the Cloudstream Android WebView verification popup.');
    }
    const $ = cheerio.load(pageHtml);
    let candidates;
    if (info.isTv) {
      candidates = parseSeriesLinks($, seasonNum || 1, episodeNum || 1);
    } else {
      candidates = parseMovieLinks($);
    }

    const streams = [];
    const resolved = await Promise.all(candidates.map(async item => ({
      item,
      url: await resolveDirectStream(item.url)
    })));
    for (const entry of resolved) {
      if (!entry.url) continue;
      const quality = qualityFromText(entry.item.name);
      streams.push({
        name: 'OnlyKDrama - ' + entry.item.provider + (quality !== 'Unknown' ? ' - ' + quality : ''),
        title: info.title + (info.year ? ' (' + info.year + ')' : ''),
        url: entry.url,
        quality: quality,
        size: 'Unknown',
        headers: { ...HEADERS, 'Referer': entry.item.url },
        provider: 'onlykdrama'
      });
    }
    return streams;
  } catch (error) {
    console.log('[OnlyKDrama] ' + (error && error.message ? error.message : String(error)));
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
