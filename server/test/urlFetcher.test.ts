import { describe, expect, it } from 'vitest';
import { extractReadableText, isPrivateAddress } from '../src/ingestion/urlFetcher.js';

const url = new URL('https://example.com/article');

describe('extractReadableText', () => {
  it('prefers the article element over surrounding chrome', () => {
    const { text } = extractReadableText(
      `<html><body>
         <div id="site-header">Site name</div>
         <article><p>The retriever scans every stored chunk and ranks them by cosine similarity.</p></article>
         <div class="footer-links">Privacy Terms</div>
       </body></html>`,
      url,
    );

    expect(text).toContain('cosine similarity');
    expect(text).not.toContain('Privacy Terms');
  });

  it('strips navigation, category and reference boilerplate', () => {
    const { text } = extractReadableText(
      `<html><body><main>
         <div class="mw-navigation">Jump to content</div>
         <p>Retrieval augmented generation grounds a model in retrieved documents.</p>
         <div id="catlinks">Categories: Machine learning Natural language processing</div>
         <ol class="references"><li>Some citation, 2023.</li></ol>
         <div class="navbox">See also In architecture In education In fiction</div>
       </main></body></html>`,
      url,
    );

    expect(text).toContain('grounds a model in retrieved documents');
    expect(text).not.toMatch(/Categories:/);
    expect(text).not.toMatch(/In architecture/);
    expect(text).not.toMatch(/Some citation/);
  });

  it('removes landmark roles that mark page furniture', () => {
    const { text } = extractReadableText(
      `<html><body><main>
         <div role="navigation">Home About Contact</div>
         <p>Only this sentence is real content.</p>
         <div role="contentinfo">Copyright 2026</div>
       </main></body></html>`,
      url,
    );

    expect(text).toBe('Only this sentence is real content.');
  });

  it('takes the title from og:title, then title, then h1', () => {
    expect(
      extractReadableText('<html><head><meta property="og:title" content="Open Graph"><title>Tag</title></head><body><h1>Heading</h1></body></html>', url)
        .title,
    ).toBe('Open Graph');

    expect(extractReadableText('<html><head><title>Tag</title></head><body><h1>Heading</h1></body></html>', url).title).toBe(
      'Tag',
    );

    expect(extractReadableText('<html><body><h1>Heading</h1><p>body</p></body></html>', url).title).toBe('Heading');
  });

  it('falls back to the URL path when the page has no title at all', () => {
    expect(extractReadableText('<html><body><p>text</p></body></html>', url).title).toBe('example.com/article');
  });

  it('ignores a boilerplate-looking class on a structural ancestor', () => {
    // Wikipedia puts feature flags such as `vector-feature-language-in-main-menu`
    // on <html>. Matching that once deleted the entire page.
    const { text } = extractReadableText(
      `<html class="client-nojs vector-feature-language-in-main-menu"><body class="mw-body-menu-open">
         <main><p>Retrieval augmented generation grounds a model in retrieved documents.</p></main>
       </body></html>`,
      url,
    );

    expect(text).toContain('grounds a model in retrieved documents');
  });

  it('keeps an element that holds most of the page even when its class looks like furniture', () => {
    const body = 'This paragraph carries essentially the whole article. '.repeat(40);
    const { text } = extractReadableText(
      `<html><body><div class="content-related"><p>${body}</p></div><div class="navbox">Nav junk</div></body></html>`,
      url,
    );

    expect(text).toContain('carries essentially the whole article');
    expect(text).not.toContain('Nav junk');
  });

  it('does not remove content whose class merely contains a blocked word inside another word', () => {
    const { text } = extractReadableText(
      '<html><body><main><div class="navigation-theory">Navigation theory is a real topic.</div></main></body></html>',
      url,
    );
    expect(text).toContain('Navigation theory is a real topic.');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.0.1', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true], // cloud instance metadata
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['2606:4700::1111', false],
  ])('classifies %s as private=%s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});
