import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalServerProvider } from '../../src/provider/local.provider';

describe('createLocalServerProvider', () => {
  it('put writes file under root with nested key dirs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-assets-'));
    const provider = createLocalServerProvider({
      root,
      publicBaseUrl: 'http://localhost:3000/assets',
    });

    await provider.put('images/a/b.webp', Buffer.from('hello'), 'image/webp');

    expect(fs.readFileSync(path.join(root, 'images/a/b.webp')).toString()).toBe('hello');
  });

  it('publicUrl strips trailing slash from publicBaseUrl', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-assets-'));
    const provider = createLocalServerProvider({
      root,
      publicBaseUrl: 'http://localhost:3000/assets/',
    });

    expect(provider.publicUrl('images/x.webp')).toBe('http://localhost:3000/assets/images/x.webp');
  });

  it('delete removes file and ignores missing key', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-assets-'));
    const provider = createLocalServerProvider({
      root,
      publicBaseUrl: 'http://localhost:3000/assets',
    });
    const filePath = path.join(root, 'gone.webp');
    fs.writeFileSync(filePath, 'x');

    await provider.delete('gone.webp');
    expect(fs.existsSync(filePath)).toBe(false);

    await expect(provider.delete('never-existed.webp')).resolves.toBeUndefined();
  });

  it('exposes kind local', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-assets-'));
    const provider = createLocalServerProvider({ root, publicBaseUrl: 'http://x/' });
    expect(provider.kind).toBe('local');
  });
});
