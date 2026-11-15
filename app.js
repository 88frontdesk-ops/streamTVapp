const BASE_W = 1280;
const BASE_H = 720;
const LOAD_DELAY = 1500;
const PRESET_STORAGE_PREFIX = 'tv-preset-';
const ACTIVE_PRESET_STORAGE_KEY = 'tv-active-preset';

const presetSelect = document.querySelector('#preset-select');
const storedPresetIndex = Number(localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY));
let activePresetIndex = Number.isInteger(storedPresetIndex) &&
    storedPresetIndex >= 0 &&
    storedPresetIndex < window.DEFAULT_PRESETS.length
    ? storedPresetIndex
    : 0;

function getPresetUrl(presetIndex, channelIndex) {
    const key = `${PRESET_STORAGE_PREFIX}${presetIndex}-${channelIndex}`;
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved;

    if (presetIndex === 0) {
        const legacySaved = localStorage.getItem('tv' + channelIndex);
        if (legacySaved !== null) {
            localStorage.setItem(key, legacySaved);
            return legacySaved;
        }
    }

    return window.DEFAULT_PRESETS[presetIndex][channelIndex] || '';
}

presetSelect.value = String(activePresetIndex);

// ----- Detect if device is TV / large fullscreen -----
function detectMode() {
    const isFullscreen = window.innerWidth >= 1920 && window.innerHeight >= 1080;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    return (isFullscreen || coarsePointer) ? 'tv' : 'desktop';
}

const mode = detectMode();

// ----- Embed URL converter -----
function toEmbed(url) {
    try {
        const maybe = url.startsWith('http') ? url : 'https://' + url;
        const u = new URL(maybe);
        if (u.hostname.includes('youtube.com')) {
            const v = u.searchParams.get('v');
            if (v) return 'https://www.youtube.com/embed/' + v;
        }
        if (u.hostname === 'youtu.be') {
            const id = u.pathname.slice(1);
            if (id) return 'https://www.youtube.com/embed/' + id;
        }
        if (u.hostname.includes('twitch.tv') || u.hostname === 'clips.twitch.tv') {
            const parent = window.location.hostname || 'localhost';
            const parts = u.pathname.split('/').filter(Boolean);
            const channel = parts[0] || '';
            if (channel) return 'https://player.twitch.tv/?channel=' + channel + '&parent=' + parent + '&autoplay=true';
        }
        return url;
    } catch {
        return url;
    }
}

// ----- GPU Scaling -----
function updateScale(card) {
    const wrapper = card.querySelector('.scaled-wrapper');
    const viewport = card.querySelector('.scaled-viewport');
    if (!wrapper || !viewport) return;
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    const scale = Math.min(cw / BASE_W, ch / BASE_H, 1);
    viewport.style.transform = `translate3d(0,0,0) scale(${scale})`;
    viewport.style.width = BASE_W + 'px';
    viewport.style.height = BASE_H + 'px';
    viewport.style.top = Math.max(0, (ch - BASE_H * scale) / 2) + 'px';
    viewport.style.left = Math.max(0, (cw - BASE_W * scale) / 2) + 'px';
}

// ----- Card creation -----
function createCard(card, index) {
    const urlBar = document.createElement('div');
    urlBar.className = 'url-bar';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = getPresetUrl(activePresetIndex, index);

    const btn = document.createElement('button');
    btn.textContent = 'Load';

    urlBar.append(input, btn);

    const wrapper = document.createElement('div');
    wrapper.className = 'scaled-wrapper';
    const viewport = document.createElement('div');
    viewport.className = 'scaled-viewport';
    wrapper.append(viewport);

    card.append(wrapper);
    if (mode === 'desktop') {
        card.append(urlBar); // show URL bars only on desktop
    }

    function unload() { viewport.innerHTML = ''; }

    function load(url) {
        const value = url.trim();
        localStorage.setItem(`${PRESET_STORAGE_PREFIX}${activePresetIndex}-${index}`, value);
        if (!value) {
            unload();
            return;
        }
        const safe = toEmbed(value);
        const iframe = document.createElement('iframe');
        iframe.src = safe;
        iframe.width = BASE_W;
        iframe.height = BASE_H;
        iframe.loading = 'lazy';
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('allow', 'autoplay;fullscreen;encrypted-media');
        viewport.innerHTML = '';
        viewport.append(iframe);
        requestAnimationFrame(() => updateScale(card));
    }

    btn.onclick = () => load(input.value.trim());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') load(input.value.trim());
    });

    return { card, input, load, unload };
}

// ----- Initialize cards -----
const cards = document.querySelectorAll('.tv');
const controllers = [];
cards.forEach((card, i) => {
    controllers.push(createCard(card, i));
});

function saveCurrentPreset() {
    controllers.forEach((controller, index) => {
        localStorage.setItem(
            `${PRESET_STORAGE_PREFIX}${activePresetIndex}-${index}`,
            controller.input.value.trim()
        );
    });
}

// ----- Sequential load for performance -----
let loadTimers = [];
function loadSequentially() {
    loadTimers.forEach(clearTimeout);
    loadTimers = [];
    controllers.forEach((c, i) => {
        const url = c.input.value.trim();
        if (!url) {
            c.unload();
            return;
        }
        loadTimers.push(setTimeout(() => { c.load(url); }, i * LOAD_DELAY));
    });
}

presetSelect.addEventListener('change', () => {
    const nextPresetIndex = Number(presetSelect.value);
    if (!Number.isInteger(nextPresetIndex) ||
        nextPresetIndex < 0 ||
        nextPresetIndex >= window.DEFAULT_PRESETS.length) {
        return;
    }

    saveCurrentPreset();
    activePresetIndex = nextPresetIndex;
    localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, String(activePresetIndex));

    controllers.forEach((controller, index) => {
        controller.input.value = getPresetUrl(activePresetIndex, index);
        controller.unload();
    });
    loadSequentially();
});

// ----- Start -----
window.addEventListener('load', () => {
    loadSequentially();
}, { passive: true });

// ----- Resize throttling -----
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { cards.forEach(updateScale); }, 120);
}, { passive: true });
