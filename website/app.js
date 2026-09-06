import { selectAsset, formatBytes, proxyUrl, repository } from './downloads.mjs';

const $ = selector => document.querySelector(selector);
const platform = $('#platform');
const direct = $('#direct-download');
const proxy = $('#proxy-download');
const status = $('#download-status');
const copyButton = $('#copy-link');
const refresh = $('#refresh-release');
let currentRelease = null;
let currentAsset = null;
let source = '';
let loading = false;
let snapshotDate = '';
let errorMessage = '';
let generation = 0;

const platformNotes = {
  windows: '适用于 64 位 Windows 10 / 11，包含标准文档转换引擎。安装包当前未签名。',
  win7: '仅适用于 Windows 7 SP1 x64。旧版运行环境，不含标准文档引擎；真实 Win7 设备待验收。',
  'mac-arm64': '适用于 Apple Silicon 芯片的 Mac（M 系列），macOS 11 或更新。未签名、未公证；真机验收状态以发行说明为准。',
  'mac-x64': '适用于 Intel 芯片的 Mac，macOS 11 或更新。未签名、未公证；真机验收状态以发行说明为准。'
};

function setDownload(anchor, href) {
  anchor.setAttribute('aria-disabled', String(!href));
  anchor.tabIndex = href ? 0 : -1;
  if (href) {
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  } else { anchor.removeAttribute('href'); }
}

function renderDownloads() {
  $('#platform-note').textContent = platformNotes[platform.value];
  $('#platform-icon').src = platform.value.startsWith('mac') ? 'assets/icons/apple-logo.svg' : 'assets/icons/windows-logo.svg';
  currentAsset = selectAsset(currentRelease, platform.value);
  setDownload(direct, currentAsset?.browser_download_url);
  setDownload(proxy, proxyUrl(currentAsset));
  copyButton.disabled = !currentAsset;
  $('#asset-name').textContent = currentAsset?.name || (loading ? '正在获取安装包信息' : '此系统暂无可用安装包');
  $('#asset-size').textContent = formatBytes(currentAsset?.size);
  const tag = currentRelease?.tag_name;
  document.querySelectorAll('[data-release-label]').forEach(el => { el.textContent = tag ? `${tag} · 最新发行版` : '查看最新发行与构建'; });
  $('[data-release-summary]').textContent = tag ? `${tag} · ${source === 'live' ? '来自 GitHub' : '已核验的发行信息'}` : '安装包发布后即可下载';
  if (loading) status.textContent = currentRelease ? '正在检查更新；可先下载已核验的版本。' : '正在连接 GitHub 获取最新发行版…';
  else if (currentAsset) status.textContent = source === 'live'
    ? '已与 GitHub 同步。请选择直接下载或加速下载。'
    : `GitHub 暂时无法连接，显示 ${snapshotDate || '最近'} 核验的发行信息。可尝试加速下载，或刷新版本。`;
  else if (currentRelease) status.textContent = `此发行版未提供所选系统的安装包，请更换系统，或前往 GitHub 发行页查看。${errorMessage ? '当前无法刷新发行信息。' : ''}`;
  else status.textContent = errorMessage || '当前仓库尚无已发布的安装包。可通过左侧“GitHub 最新构建”查看构建进度。';
}

async function fetchJson(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (!response.ok) { const error = new Error(String(response.status)); error.status = response.status; throw error; }
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function loadRelease() {
  const run = ++generation;
  loading = true;
  refresh.disabled = true;
  errorMessage = '';
  renderDownloads();
  try {
    const live = await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`);
    if (run !== generation) return;
    if (!live || typeof live.tag_name !== 'string' || !Array.isArray(live.assets) || live.draft || live.prerelease) throw new Error('Invalid release data');
    currentRelease = live;
    source = 'live';
    snapshotDate = new Date().toISOString().slice(0, 10);
  } catch (error) {
    if (run !== generation) return;
    if (error.status === 404) {
      currentRelease = null;
      source = '';
      errorMessage = '当前仓库尚无已发布的安装包，请在 GitHub 发行页或最新构建页面查看进度。';
    } else {
      if (currentRelease) source = 'cache';
      if (!currentRelease) errorMessage = '暂时无法连接 GitHub。请稍后刷新，或通过左侧入口直接查看发行版与最新构建。';
    }
  } finally {
    if (run === generation) { loading = false; refresh.disabled = false; renderDownloads(); }
  }
}

platform.addEventListener('change', () => { $('#copy-link span').textContent = '复制下载链接'; renderDownloads(); });
refresh.addEventListener('click', loadRelease);
copyButton.addEventListener('click', async () => {
  if (!currentAsset) return;
  try { await navigator.clipboard.writeText(currentAsset.browser_download_url); $('#copy-link span').textContent = '已复制'; status.textContent = 'GitHub 原始下载链接已复制。'; }
  catch { status.textContent = '未能复制，请右键或长按“GitHub 直接下载”按钮复制链接。'; }
});

const categories = {
  docs: { input: 'DOCX · XLSX · PPTX · PDF', note: '也支持 Office / WPS 常用格式与 OFD。', uses: ['Office / WPS 文档转 PDF', 'PDF 转 Word、提取 Excel 表格', 'OFD 转 PDF，PDF 拆分、合并与加密'] },
  images: { input: 'JPG · PNG · WEBP · HEIC · RAW', note: '涵盖常见图片格式与部分相机 RAW；实际支持以软件为准。', uses: ['转换为 PNG、JPG、WebP、AVIF 等图片格式', '多张图片排序、合并为 PDF', '通过 OCR（文字识别）提取 TXT'] },
  media: { input: 'MP3 · FLAC · MP4 · MOV · MKV', note: '提供常用音视频转换；实验性音乐容器兼容另有条件。', uses: ['音频转 MP3、WAV、FLAC、M4A 等格式', '视频转 MP4、WebM、MKV、MOV 或 GIF', '为兼容的视频输出选择 H.264 / H.265 / AV1 编码'] },
  more: { input: 'TXT · MD · HTML · EPUB · ZIP', note: '也支持 JSON、CSV、XML、YAML 等文本格式。', uses: ['在兼容的文本、Markdown、HTML 等格式间转换', 'EPUB / MOBI 电子书转 TXT、Markdown 等格式', '图片 ZIP 合并为 PDF，任意文件打包 ZIP'] }
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false) {
  const category = categories[tab.dataset.category];
  tabs.forEach(item => { const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; });
  $('#format-panel').setAttribute('aria-labelledby', tab.id);
  $('#format-input').textContent = category.input;
  $('#format-input-note').textContent = category.note;
  $('#format-uses').replaceChildren(...category.uses.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
  });
});

const menu = $('.menu-toggle');
const mobileNav = $('#mobile-nav');
function closeMenu() { mobileNav.hidden = true; menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', '打开导航'); }
menu.addEventListener('click', () => { const opened = mobileNav.hidden; mobileNav.hidden = !opened; menu.setAttribute('aria-expanded', String(opened)); menu.setAttribute('aria-label', opened ? '关闭导航' : '打开导航'); });
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menu.focus(); } });
const dialog = $('#preview-dialog');
$('#preview-open').addEventListener('click', () => dialog.showModal());
dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });

try {
  const snapshot = await fetchJson('./release-data.json', 3000);
  if (snapshot?.release && Array.isArray(snapshot.release.assets)) { currentRelease = snapshot.release; source = 'snapshot'; snapshotDate = snapshot.checkedAt || ''; }
} catch { /* GitHub is still available when no bundled snapshot exists. */ }
renderDownloads();
loadRelease();
