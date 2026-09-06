export const repository = 'YKZStudio/MahiroFormat';
export const releasePage = `https://github.com/${repository}/releases`;
export const proxyBase = 'https://gh-proxy.com/';

export function validAssetUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
      && !url.port && url.pathname.startsWith(`/${repository}/releases/download/`)
      && url.pathname.split('/').length >= 7;
  } catch { return false; }
}

export function selectAsset(release, platform) {
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) return null;
  const match = {
    windows: name => /setup.*-x64\.exe$/i.test(name) && !/win7|legacy|mac/i.test(name),
    win7: name => /setup.*-win7-x64\.exe$/i.test(name),
    'mac-arm64': name => /setup.*-mac-arm64\.dmg$/i.test(name),
    'mac-x64': name => /setup.*-mac-x64\.dmg$/i.test(name),
  }[platform];
  if (!match) return null;
  return release.assets.find(asset => typeof asset.name === 'string' && match(asset.name)
    && validAssetUrl(asset.browser_download_url) && asset.state !== 'starter') || null;
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function proxyUrl(asset) {
  return asset && validAssetUrl(asset.browser_download_url) ? proxyBase + asset.browser_download_url : null;
}
