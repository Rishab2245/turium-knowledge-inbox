import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { config } from '../config/index.js';
import { UnprocessableError, ValidationError } from '../domain/errors.js';
import { loggerFor } from '../lib/logger.js';

const log = loggerFor('ingestion.url');

export interface FetchedPage {
  title: string;
  text: string;
  finalUrl: string;
  contentType: string;
}

const BLOCKED_TAGS = 'script, style, noscript, svg, iframe, nav, footer, header, aside, form, button, template';

/**
 * Fetches a URL server-side and extracts its readable text.
 *
 * The extraction is intentionally heuristic rather than a full Readability
 * port: pick the densest of the usual content containers, strip chrome, and
 * collapse whitespace. It is ~40 lines instead of a jsdom dependency, and for
 * articles and docs pages it produces text that chunks cleanly.
 */
export async function fetchPageContent(rawUrl: string): Promise<FetchedPage> {
  const url = assertSafeUrl(rawUrl);
  await assertNotInternalAddress(url.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.URL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some sites serve an empty shell to unknown agents. Identify honestly
        // but recognisably rather than spoofing a browser.
        'user-agent': 'KnowledgeInboxBot/1.0 (+https://github.com/rishab2245/turium-knowledge-inbox)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'accept-language': 'en',
      },
    });

    if (!response.ok) {
      throw new UnprocessableError(`Fetching the URL returned HTTP ${response.status}`, {
        url: url.toString(),
        status: response.status,
      });
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new UnprocessableError(`Unsupported content type '${contentType}' - only HTML and plain text are read`, {
        url: url.toString(),
        contentType,
      });
    }

    const body = await readCapped(response, config.MAX_URL_BYTES);
    const extracted = /text\/plain/i.test(contentType)
      ? { title: url.hostname + url.pathname, text: body }
      : extractReadableText(body, url);

    if (extracted.text.trim().length < 40) {
      throw new UnprocessableError(
        'The page yielded almost no readable text. It is probably rendered client-side or behind a login wall.',
        { url: url.toString(), extractedChars: extracted.text.trim().length },
      );
    }

    log.debug({ url: url.toString(), chars: extracted.text.length }, 'extracted page text');
    return { ...extracted, finalUrl: response.url || url.toString(), contentType };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UnprocessableError(`Fetching the URL timed out after ${config.URL_FETCH_TIMEOUT_MS}ms`, {
        url: url.toString(),
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractReadableText(html: string, url: URL): { title: string; text: string } {
  const $ = cheerio.load(html);
  $(BLOCKED_TAGS).remove();

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    `${url.hostname}${url.pathname}`;

  // Score the usual content wrappers by text length and take the best one.
  // A <main> that lost its body to an ad wrapper scores low and is skipped.
  const candidates = ['article', 'main', '[role="main"]', '#content', '.content', '.post', 'body'];
  let best = '';
  for (const selector of candidates) {
    const text = $(selector).first().text();
    if (text.length > best.length) best = text;
  }

  return { title: collapse(title).slice(0, 300), text: collapse(best) };
}

/**
 * Streams the response and aborts once the byte cap is exceeded, so a huge or
 * endless body cannot exhaust memory. Content-Length is checked first but is
 * not trusted on its own - chunked responses do not send it.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new UnprocessableError(`Page is larger than the ${maxBytes} byte limit`, { declaredBytes: declared });
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnprocessableError(`Page exceeded the ${maxBytes} byte limit while downloading`, { readBytes: total });
    }
    parts.push(value);
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(parts));
}

function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError(`'${rawUrl}' is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError(`Only http and https URLs can be ingested, got '${url.protocol}'`);
  }
  return url;
}

/**
 * Minimal SSRF guard. The server fetches arbitrary user-supplied URLs, so it
 * must refuse to be used as a proxy into the private network or cloud metadata
 * endpoints. This resolves the hostname and rejects private ranges.
 *
 * Honest limitation: it does not close the DNS-rebinding window between this
 * check and the socket connect. A production deployment should pin the
 * resolved address at connect time or route egress through a filtering proxy.
 */
async function assertNotInternalAddress(hostname: string): Promise<void> {
  const literal = net.isIP(hostname) ? [hostname] : null;
  let addresses: string[];

  if (literal) {
    addresses = literal;
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
      throw new UnprocessableError(`Could not resolve host '${hostname}'`);
    }
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new ValidationError(`Refusing to fetch '${hostname}' - it resolves to a private address (${address})`);
    }
  }
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const normalised = address.toLowerCase();
  if (normalised === '::1' || normalised === '::') return true;
  if (normalised.startsWith('fe80') || normalised.startsWith('fc') || normalised.startsWith('fd')) return true;
  if (normalised.startsWith('::ffff:')) return isPrivateAddress(normalised.slice(7));
  return false;
}

const collapse = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
