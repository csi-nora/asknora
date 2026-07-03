import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Public-domain scraper for Singtel CSI + aligned public programme pages.
 *
 * Targets (via explicit seeds + focused link expansion):
 * - Cyber Elevate, Cyber Range / CSI, IT & OT training, TTX, consulting, C-suite style readiness content on Singtel
 * - SkillsFuture Queen Bee (Singtel CSI) on GoBusiness
 * - SSS: TRAQOM / training quality / surveys & outcomes pages
 * - MySkillsFuture: public job-skills insights (e.g. cybersecurity landscape)
 * - SIM Academy: AI.dea + joint Singtel–SIM cyber programmes (public course pages)
 *
 * Design goals:
 * - Only configured public hosts; polite rate limit; bounded crawl
 * - Extract readable text (strip chrome)
 * - Output `public/public-kb.json` for CSI Nora runtime RAG
 */

const DEFAULTS = {
  /** Entry URLs — expand here as new public pages are published */
  seeds: [
    // ── Singtel business cyber / CSI / Elevate / OT / consulting ──
    'https://www.singtel.com/business/cyber-security',
    'https://www.singtel.com/business/solutions/cybersecurity-solutions/elevate-programme',
    'https://www.singtel.com/business/products-services/cybersecurity/cyber-education/elevate-programme',
    'https://www.singtel.com/business/products-services/cybersecurity/consulting-and-professional-services',
    'https://www.singtel.com/business/products-services/cybersecurity/threat-management/ot-iot-security/singtel-one',
    'https://www.singtel.com/business/info/csa',
    'https://www.singtel.com/about-us/media-centre/news-releases/singtel-launches-first-of-its-kind-cyber-security-institute-in-asia-pacific-t',
    'https://www.singtel.com/about-us/media-centre/news-releases/singtel-launches-one-stop-cyber-security-resilience-programme-fo',
    'https://www.singtel.com/business/articles/a-leading-aviation-and-gateway-services-provider-improves-cyber-resiliency-with-singtels-cyber-security-institute',
    'https://www.singtel.com/business/articles/cyber-risk-and-solutions-day',
    // ── SkillsFuture / GoBusiness — Singtel CSI Queen Bee network ──
    'https://skillsfuture.gobusiness.gov.sg/support-and-programmes/skillsfuture-queen-bee-networks/sfqb-singtel-cyber-security-institute',
    // ── SSG — training quality, outcomes, surveys (TRAQOM) ──
    'https://www.ssg.gov.sg/training-and-adult-education/training-quality-and-outcomes-measurement',
    // ── MySkillsFuture — public career / job-skills knowledge (incl. cyber) ──
    'https://www.myskillsfuture.gov.sg/content/portal/en/career-resources/career-resources/job-skills-insights/Cybersecurity_JobSkills_Insights_into_the_Singapore_Landscape.html',
    // ── SIM Academy — AI.dea + cyber resilience (joint Singtel–SIM public offerings) ──
    'https://www.sim.edu.sg/professional-development/courses/course-listing/ai-dea-phase-1',
    'https://www.sim.edu.sg/professional-development/courses/course-listing/cyber-resilience-detect-defend-deter',
  ],
  allowedHostSuffixes: [
    'singtel.com',
    'ssg.gov.sg',
    'myskillsfuture.gov.sg',
    'skillsfuture.gobusiness.gov.sg',
    'sim.edu.sg',
  ],
  /** Stop after this many HTML pages stored (across all hosts) */
  maxPages: 150,
  maxDepth: 3,
  delayMs: 750,
  timeoutMs: 15000,
  userAgent: 'CSI-Nora-KB-Scraper/1.1 (+public-RAG; polite)',
  outputFile: path.join(__dirname, '..', 'public', 'public-kb.json'),
  /**
   * Soft caps per host family so one domain cannot consume the whole budget.
   * Keys match `hostFamily()` below.
   */
  maxPagesPerHost: {
    singtel: 85,
    ssg: 30,
    msf: 12,
    gobusiness: 15,
    sim: 25,
    other: 0,
  },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    // Normalize trailing slash
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function isAllowedHost(url, allowedHostSuffixes) {
  const host = url.hostname.toLowerCase();
  return allowedHostSuffixes.some(sfx => host === sfx || host.endsWith('.' + sfx));
}

/** Group hostnames into crawl budget buckets */
function hostFamily(hostname) {
  const h = hostname.toLowerCase();
  if (h.endsWith('singtel.com')) return 'singtel';
  if (h.endsWith('ssg.gov.sg')) return 'ssg';
  if (h.endsWith('myskillsfuture.gov.sg')) return 'msf';
  if (h.endsWith('skillsfuture.gobusiness.gov.sg')) return 'gobusiness';
  if (h.endsWith('sim.edu.sg')) return 'sim';
  return 'other';
}

/**
 * Whether to follow a discovered link (keeps expansion relevant to CSI / Elevate / training / SSG surveys).
 * Seed URLs are always fetched regardless of this rule.
 */
function linkAllowed(cfg, urlObj) {
  const path = urlObj.pathname.toLowerCase();
  const fam = hostFamily(urlObj.hostname);

  if (fam === 'singtel') {
    return /cyber|security|elevate|elevate-programme|forensic|incident|ot-|iot|consulting-and-professional|singtel-one|threat-management|products-services\/cybersecurity|solutions\/cybersecurity|info\/csa|media-centre\/news-releases|business\/articles|executive|leadership|c-suite|board|crisis|range|training|education|tabletop|ttx|fireeye|soc|operations-centre/i.test(path);
  }
  if (fam === 'ssg') {
    return /training|traqom|adult-education|quality|outcome|survey|newsroom|skills|feedback|job-skills|cet/i.test(path);
  }
  if (fam === 'msf') {
    return /career-resources|job-skills|cyber|training|skillsfuture/i.test(path);
  }
  if (fam === 'gobusiness') {
    return /skillsfuture|singtel|cyber|queen-bee|support-and-programmes/i.test(path);
  }
  if (fam === 'sim') {
    return /professional-development|ai-dea|cyber|resilience|scam|singtel|course-listing/i.test(path);
  }
  return false;
}

function pickCanonical($, fallbackUrl) {
  const canon = $('link[rel="canonical"]').attr('href');
  return normalizeUrl(canon) ?? fallbackUrl;
}

function extractText($) {
  $('script, style, noscript, svg, iframe').remove();
  // Remove common chrome
  $('header, footer, nav, form, aside').remove();

  const main = $('main');
  const root = main.length ? main : $('body');

  // Collapse whitespace
  const text = root
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return text;
}

function extractTitle($) {
  const og = $('meta[property="og:title"]').attr('content');
  const title = og || $('title').text();
  return (title || '').trim();
}

function extractLinks($, baseUrl) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl).toString();
      const norm = normalizeUrl(abs);
      if (norm) links.add(norm);
    } catch {
      // ignore
    }
  });
  return [...links];
}

async function fetchHtml(url, { timeoutMs, userAgent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok) return { ok: false, status: r.status, html: null, contentType: ct };
    if (!ct.includes('text/html')) return { ok: false, status: r.status, html: null, contentType: ct };
    const html = await r.text();
    return { ok: true, status: r.status, html, contentType: ct };
  } catch (e) {
    return { ok: false, status: 0, html: null, contentType: '', error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function loadExisting(outputFile) {
  try {
    const raw = await fs.readFile(outputFile, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.pages)) return data;
  } catch {
    // ignore
  }
  return { source: 'CSI Nora public KB (Singtel CSI + SSG + partners)', generatedAt: null, pages: [] };
}

async function main() {
  const cfg = DEFAULTS;

  await fs.mkdir(path.dirname(cfg.outputFile), { recursive: true });
  const out = await loadExisting(cfg.outputFile);

  const seedSet = new Set(cfg.seeds.map(s => normalizeUrl(s)).filter(Boolean));
  const seen = new Set(out.pages.map(p => p.url));
  const queue = [];

  for (const s of cfg.seeds) {
    const u = normalizeUrl(s);
    if (u) queue.push({ url: u, depth: 0 });
  }

  const pages = [];
  const hostCounts = Object.fromEntries(Object.keys(cfg.maxPagesPerHost).map(k => [k, 0]));

  while (queue.length && pages.length < cfg.maxPages) {
    const { url, depth } = queue.shift();
    if (!url || seen.has(url)) continue;

    const u = new URL(url);
    if (!isAllowedHost(u, cfg.allowedHostSuffixes)) continue;

    seen.add(url);
    const res = await fetchHtml(url, cfg);
    if (!res.ok || !res.html) {
      // Skip non-HTML or error pages
      await sleep(cfg.delayMs);
      continue;
    }

    const $ = cheerio.load(res.html);
    const title = extractTitle($);
    const canonical = pickCanonical($, url);
    const text = extractText($);

    const fam = hostFamily(u.hostname);
    const perHostCap = cfg.maxPagesPerHost[fam] ?? 9999;

    // Minimal quality gates + per-host crawl budget
    if (text.length >= 300 && hostCounts[fam] < perHostCap) {
      pages.push({
        url: canonical,
        fetchedFrom: url,
        title,
        text,
        tags: [fam, ...(seedSet.has(url) ? ['seed'] : [])],
      });
      hostCounts[fam] += 1;
    }

    // Crawl further if depth allows
    if (depth < cfg.maxDepth) {
      for (const link of extractLinks($, url)) {
        const nu = normalizeUrl(link);
        if (!nu) continue;
        const lu = new URL(nu);
        if (!isAllowedHost(lu, cfg.allowedHostSuffixes)) continue;
        if (seen.has(nu)) continue;
        if (!linkAllowed(cfg, lu)) continue;
        // Avoid obvious non-content paths
        if (/\.(pdf|png|jpg|jpeg|gif|webp|zip)$/i.test(lu.pathname)) continue;
        queue.push({ url: nu, depth: depth + 1 });
      }
    }

    await sleep(cfg.delayMs);
  }

  // Deduplicate by URL
  const dedup = new Map();
  for (const p of pages) {
    if (!dedup.has(p.url)) dedup.set(p.url, p);
  }

  const finalPages = [...dedup.values()].sort((a, b) => a.url.localeCompare(b.url));

  const finalOut = {
    source: 'CSI Nora public KB — Singtel CSI (Elevate, range, IT/OT, TTX, training) + SSG TRAQOM/surveys + MySkillsFuture + GoBusiness SFQB + SIM Academy (AI.dea / cyber)',
    generatedAt: new Date().toISOString(),
    pages: finalPages,
  };

  await fs.writeFile(cfg.outputFile, JSON.stringify(finalOut, null, 2), 'utf-8');
  process.stdout.write(`Saved ${finalPages.length} page(s) to ${cfg.outputFile}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

