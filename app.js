/*
 * Core application logic for TV wall
 * Exported for testing.
 */

const BASE_W = 1280;
const BASE_H = 720;
const STORAGE_KEY = 'tvwall.urls';
let urls = [];
let resizeTimeout = null;

export function toEmbed(url) {
    try {
        const maybe = url.startsWith('http') ? url : 'https://' + url;
        const u = new URL(maybe);

        if (u.hostname.includes('youtube.com')) {
            const v = u.searchParams.get('v');
            if (v) return 'https://www.youtube.com/embed/' + v;
            if (u.pathname.startsWith('/embed/')) return url;
        }

        if (u.hostname === 'youtu.be') {
            const id = u.pathname.slice(1);
            if (id) return 'https://www.youtube.com/embed/' + id;
        }

        if (
            u.hostname.includes('twitch.tv') ||
            u.hostname === 'clips.twitch.tv' ||
            u.hostname === 'm.twitch.tv' ||
            u.hostname === 'www.twitch.tv'
        ) {
            const parent = window.location.hostname || 'localhost';

            if (u.hostname.includes('clips.twitch.tv')) {
                const clip = u.pathname.split('/').filter(Boolean)[0];
                if (clip) return 'https://clips.twitch.tv/embed?clip=' + clip + '&parent=' + parent;
            }

            if (u.hostname.includes('player.twitch.tv')) {
                if (u.searchParams.has('parent')) return url;
                return url + (url.includes('?') ? '&' : '?') + 'parent=' + parent;
            }

            const parts = u.pathname.split('/').filter(Boolean);
            const channel = parts[0] || '';
            if (channel && channel !== 'videos' && channel !== 'directory') {
                return 'https://player.twitch.tv/?channel=' + channel + '&parent=' + parent + '&autoplay=true';
            }
        }

        return url;
    } catch (e) {
        return url;
    }
}

export function sanitizeUrl(raw) {
    try {
        const url = raw.trim();
        if (!url) return '';
        const maybe = url.startsWith('http') ? url : 'https://' + url;
        const u = new URL(maybe);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return url;
    } catch (_e) {
        return '';
    }
}

export function updateScaleForCard(card) {
    const wrapper = card.querySelector('.scaled-wrapper');
    const viewport = card.querySelector('.scaled-viewport');
    if (!wrapper || !viewport) return;
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    const scale = Math.min(cw / BASE_W, ch / BASE_H, 1);
    viewport.style.transform = 'scale(' + scale + ')';
    viewport.style.width = BASE_W + 'px';
    viewport.style.height = BASE_H + 'px';
    const top = Math.max(0, (ch - BASE_H * scale) / 2);
    const left = Math.max(0, (cw - BASE_W * scale) / 2);
    viewport.style.top = top + 'px';
    viewport.style.left = left + 'px';
}

function scheduleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        document.querySelectorAll('.tv').forEach(updateScaleForCard);
    }, 100);
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            urls = JSON.parse(raw);
        } catch (_) {
            urls = [];
        }
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
}

export function createCard(cardElem, initialUrl, index) {
    cardElem.setAttribute('draggable', 'true');
    cardElem.dataset.index = index;
    cardElem.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        e.dataTransfer.effectAllowed = 'move';
    });
    cardElem.addEventListener('dragover', (e) => {
        e.preventDefault();
        cardElem.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    });
    cardElem.addEventListener('dragleave', () => {
        cardElem.classList.remove('drag-over');
    });
    cardElem.addEventListener('drop', (e) => {
        e.preventDefault();
        cardElem.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const to = index;
        if (from !== to) {
            const item = urls.splice(from, 1)[0];
            urls.splice(to, 0, item);
            saveState();
            renderGrid();
        }
    });
    cardElem.addEventListener('dragend', () => {
        cardElem.classList.remove('drag-over');
    });
    const urlBar = document.createElement('div');
    urlBar.className = 'url-bar';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Paste URL and press Enter';
    input.value = initialUrl || '';
    input.setAttribute('aria-label', 'URL for card ' + (index + 1));
    const btn = document.createElement('button');
    btn.textContent = 'Load';
    btn.setAttribute('aria-label', 'Load URL');
    urlBar.append(input, btn);

    const wrapper = document.createElement('div');
    wrapper.className = 'scaled-wrapper';
    const viewport = document.createElement('div');
    viewport.className = 'scaled-viewport';
    wrapper.append(viewport);

    cardElem.innerHTML = '';
    cardElem.append(urlBar, wrapper);

    function load(url) {
        const sanitized = sanitizeUrl(url);
        if (!sanitized) {
            input.classList.add('error');
            return;
        }
        input.classList.remove('error');
        const safeUrl = toEmbed(sanitized);
        const iframe = document.createElement('iframe');
        iframe.src = safeUrl;
        iframe.width = BASE_W;
        iframe.height = BASE_H;
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('title', 'Embedded content');
        viewport.innerHTML = '';
        viewport.append(iframe);
        urls[index] = sanitized;
        saveState();
        requestAnimationFrame(() => updateScaleForCard(cardElem));
    }

    btn.addEventListener('click', () => load(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(input.value.trim()); });

    if (initialUrl) load(initialUrl);
}

export function initialize() {
    const grid = document.querySelector('.grid');
    const toolbar = document.querySelector('.toolbar');

    loadState();
    if (urls.length === 0) {
        urls = [
            'https://www.twitch.tv/topmedia_topnews',
            'https://balkanweb.com/tvplayer-2/?v=5',
            'https://www.oranews.tv/livetv2.php',
            'https://pluto.tv/us/live-tv/63d025db4e83e700086eaa96?msockid=2ec4ca9ed8e56bca02bedc1bd9826a3c',
            'https://pluto.tv/us/live-tv/5421f71da6af422839419cb3?msockid=2ec4ca9ed8e56bca02bedc1bd9826a3c',
            'https://pluto.tv/us/live-tv/5dc9b8223687ff000936ed79?msockid=2ec4ca9ed8e56bca02bedc1bd9826a3c'
        ];
        saveState();
    }

    // grid rendering helper (declared again later so it can be exposed to drag/drop logic)

    document.getElementById('add-card').addEventListener('click', () => {
        urls.push('');
        saveState();
        renderGrid();
    });

    // helper so createCard can call renderGrid
    function renderGrid() {
        grid.innerHTML = '';
        urls.forEach((u, idx) => {
            const card = document.createElement('div');
            card.className = 'tv';
            createCard(card, u, idx);
            grid.append(card);
        });
    }

    // make renderGrid available to closure
    window.renderGrid = renderGrid;

    document.getElementById('reset-cards').addEventListener('click', () => {
        if (confirm('Clear all cards?')) {
            urls = [];
            saveState();
            renderGrid();
        }
    });

    document.getElementById('export-config').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(urls)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tvwall-config.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    const importInput = document.getElementById('import-config');
    document.getElementById('import-config-btn').addEventListener('click', () => {
        importInput.click();
    });

    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const arr = JSON.parse(reader.result);
                if (Array.isArray(arr)) {
                    urls = arr.map(sanitizeUrl).filter(Boolean);
                    saveState();
                    renderGrid();
                }
            } catch (_) {
                alert('Invalid configuration file');
            }
        };
        reader.readAsText(file);
    });

    window.addEventListener('resize', scheduleResize);
}

// If loaded as module in browser, auto-init on DOMContentLoaded
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initialize);
}
