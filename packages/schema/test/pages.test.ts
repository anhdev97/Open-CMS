import { describe, expect, it } from 'vitest';
import { collectBlockNames, PAGE_API_ID, slugToPath, validatePagePath, type StoredPageContent } from '../src';

describe('validatePagePath', () => {
  it.each(['/', '/about', '/a/b-c', '/adminx', '/oauth2x'])('accepts %s', (p) => {
    expect(validatePagePath(p)).toEqual({ ok: true });
  });
  it.each(['/About', '/a/', 'a', '/a//b', '/a_b', ''])('rejects %s as invalid_path', (p) => {
    expect(validatePagePath(p)).toMatchObject({ ok: false, code: 'invalid_path' });
  });
  it.each(['/admin', '/Admin/x', '/api', '/__opencloudcms/x', '/_next/x', '/oauth2', '/OAuth2/x'])('rejects %s as path_reserved', (p) => {
    expect(validatePagePath(p)).toMatchObject({ ok: false, code: 'path_reserved' });
  });
});

describe('slugToPath', () => {
  it('strips diacritics', () => expect(slugToPath('Giới thiệu')).toBe('/gioi-thieu'));
  it('drops punctuation', () => expect(slugToPath('  Hello, World! ')).toBe('/hello-world'));
  it('maps empty to /', () => expect(slugToPath('')).toBe('/'));
  it('handles đ', () => expect(slugToPath('Đẹp')).toBe('/dep'));
});

describe('collectBlockNames', () => {
  it('counts root, zone and slot occurrences', () => {
    const c: StoredPageContent = {
      format: 'puck',
      formatVersion: 1,
      data: {
        root: {},
        content: [
          { type: 'Heading', props: { id: 'a' } },
          { type: 'Heading', props: { id: 'b' } },
          { type: 'Section', props: { id: 'c', items: [{ type: 'Heading', props: { id: 'd' } }] } },
        ],
      },
    };
    expect([...collectBlockNames(c)]).toEqual(expect.arrayContaining([['Heading', 3], ['Section', 1]]));
    expect(collectBlockNames(c).size).toBe(2);
  });
  it('walks zones', () => {
    const c: StoredPageContent = {
      format: 'puck',
      formatVersion: 1,
      data: { root: {}, content: [], zones: { 'x:main': [{ type: 'Text', props: {} }] } },
    };
    expect(collectBlockNames(c).get('Text')).toBe(1);
  });
  it('counts blocks in root slot props (data.root.props)', () => {
    const c: StoredPageContent = {
      format: 'puck',
      formatVersion: 1,
      data: { root: { props: { header: [{ type: 'Nav', props: { links: [{ type: 'Link', props: {} }] } }] } }, content: [] },
    };
    expect(collectBlockNames(c).get('Nav')).toBe(1);
    expect(collectBlockNames(c).get('Link')).toBe(1);
  });
  it('counts slots nested inside array-field rows', () => {
    const c: StoredPageContent = {
      format: 'puck',
      formatVersion: 1,
      data: { root: {}, content: [{ type: 'Tabs', props: { tabs: [{ label: 'a', body: [{ type: 'Text', props: {} }] }] } }] },
    };
    expect(collectBlockNames(c).get('Text')).toBe(1);
  });
  it('does not count a plain JSON object shaped like an item that is not in an array', () => {
    const c: StoredPageContent = {
      format: 'puck',
      formatVersion: 1,
      data: {
        root: { props: { meta: { type: 'x', props: {} } } },
        content: [{ type: 'Embed', props: { config: { type: 'Ghost', props: { a: 1 }, nested: { type: 'Ghost2', props: {} } } } }],
      },
    };
    const names = collectBlockNames(c);
    expect([...names.keys()]).toEqual(['Embed']);
  });
  it('is empty for null', () => {
    expect(collectBlockNames(null).size).toBe(0);
    expect(collectBlockNames(undefined).size).toBe(0);
  });
  it('exports the api id', () => expect(PAGE_API_ID).toBe('opencloudcmsPage'));
});
