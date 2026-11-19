const BASE_W = 1280;
const BASE_H = 720;
const LOAD_DELAY = 1500;
const PRESET_STORAGE_PREFIX = 'tv-preset-';
const ACTIVE_PRESET_STORAGE_KEY = 'tv-active-preset';
const EMPTY_PRESET_VALUE = '__empty__';
const DEFAULTS_MIGRATION_KEY = 'tv-preset-3-defaults-migration';
const URL_LIBRARY_STORAGE_KEY = 'tv-url-library';
const URL_LIBRARY_REMOVED_KEY = 'tv-url-library-removed';
const URL_LIBRARY_MIGRATION_KEY = 'tv-url-library-migration';
const REMOVED_PRESET_URLS = new Set([
    'https://www.youtube.com/watch?v=gCNeDWCI0vo',
    'https://www.youtube.com/watch?v=h3MuIUNCCzI',
    'https://www.youtube.com/watch?v=LuKwFajn37U',
    'https://www.youtube.com/watch?v=bNyUyrR0PHo',
    'https://www.euronews.com/live',
    'https://www.youtube.com/watch?v=9NyxcX3rhQs',
    'https://www.cbsnews.com/newyork/live/',
    'https://www.cbsnews.com/losangeles/live/',
    'https://www.cbsnews.com/chicago/live/',
    'https://www.cbsnews.com/texas/live/',
    'https://www.cbsnews.com/miami/live/',
    'https://www.cbsnews.com/live/'
]);

const presetSelect = document.querySelector('#preset-select');
if (localStorage.getItem(DEFAULTS_MIGRATION_KEY) !== 'v1') {
    window.DEFAULT_PRESETS[2].forEach((url, index) => {
        const key = `${PRESET_STORAGE_PREFIX}2-${index}`;
        if (url && localStorage.getItem(key) === EMPTY_PRESET_VALUE) {
            localStorage.removeItem(key);
        }
    });
    localStorage.setItem(DEFAULTS_MIGRATION_KEY, 'v1');
}

const storedPresetIndex = Number(localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY));
let activePresetIndex = Number.isInteger(storedPresetIndex) &&
    storedPresetIndex >= 0 &&
    storedPresetIndex < window.DEFAULT_PRESETS.length
    ? storedPresetIndex
    : 0;
const channelCount = Math.max(6, ...window.DEFAULT_PRESETS.map(preset => preset.length));

function getPresetUrl(presetIndex, channelIndex) {
    const key = `${PRESET_STORAGE_PREFIX}${presetIndex}-${channelIndex}`;
    const saved = localStorage.getItem(key);
    if (saved === EMPTY_PRESET_VALUE) return '';
    if (saved !== null && saved !== '') {
        if (REMOVED_PRESET_URLS.has(saved)) {
            localStorage.setItem(key, EMPTY_PRESET_VALUE);
            return '';
        }
        return saved;
    }

    if (presetIndex === 0) {
        const legacySaved = localStorage.getItem('tv' + channelIndex);
        if (legacySaved) {
            localStorage.setItem(key, legacySaved);
            return legacySaved;
        }
    }

    return window.DEFAULT_PRESETS[presetIndex][channelIndex] || '';
}

function readStoredUrlList(key) {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const urls = JSON.parse(stored);
    if (!Array.isArray(urls) || !urls.every(url => typeof url === 'string')) {
        throw new Error(`Stored URL list "${key}" is invalid.`);
    }
    return urls;
}

function getRemovedUrls() {
    return new Set(readStoredUrlList(URL_LIBRARY_REMOVED_KEY));
}

function writeUrlLibrary(urls, removedUrls) {
    localStorage.setItem(URL_LIBRARY_STORAGE_KEY, JSON.stringify([...new Set(urls)]));
    localStorage.setItem(URL_LIBRARY_REMOVED_KEY, JSON.stringify([...removedUrls]));
}

function getUrlLibrary() {
    const removedUrls = getRemovedUrls();
    return [...new Set([
        ...window.DEFAULT_PRESETS.flat().filter(Boolean),
        ...readStoredUrlList(URL_LIBRARY_STORAGE_KEY)
    ])].filter(url => !removedUrls.has(url));
}

if (localStorage.getItem(URL_LIBRARY_MIGRATION_KEY) !== 'v1') {
    const existingUrls = readStoredUrlList(URL_LIBRARY_STORAGE_KEY);
    window.DEFAULT_PRESETS.forEach((preset, presetIndex) => {
        for (let index = 0; index < channelCount; index++) {
            const url = getPresetUrl(presetIndex, index);
            if (url) existingUrls.push(url);
        }
    });
    writeUrlLibrary(existingUrls, getRemovedUrls());
    localStorage.setItem(URL_LIBRARY_MIGRATION_KEY, 'v1');
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
    input.setAttribute('aria-label', `URL for channel ${index + 1}`);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', `url-options-${index}`);
    input.setAttribute('aria-expanded', 'false');

    let selectedUrl = '';
    let urlOptionsOpen = false;
    const urlOptions = document.createElement('div');
    urlOptions.className = 'url-options';
    urlOptions.id = `url-options-${index}`;
    urlOptions.setAttribute('role', 'listbox');
    urlOptions.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'url-actions';

    const addButton = document.createElement('button');
    addButton.className = 'url-list-button';
    addButton.textContent = '+';
    addButton.setAttribute('aria-label', 'Add URL to shared list');
    addButton.title = 'Add this URL to the shared list, or update the selected URL everywhere';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'url-list-button';
    deleteButton.textContent = 'x';
    deleteButton.setAttribute('aria-label', 'Remove URL from shared list');
    deleteButton.title = 'Remove this URL from the shared list and all presets';
    deleteButton.disabled = !getUrlLibrary().includes(input.value.trim());

    const loadButton = document.createElement('button');
    loadButton.className = 'load-button';
    loadButton.textContent = 'Load';

    function renderUrlOptions(filter = '') {
        const normalizedFilter = filter.toLocaleLowerCase();
        const urls = getUrlLibrary().filter(url =>
            url.toLocaleLowerCase().includes(normalizedFilter)
        );
        urlOptions.replaceChildren();
        urls.forEach(url => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'url-option';
            option.setAttribute('role', 'option');
            option.textContent = url;
            option.addEventListener('pointerdown', event => event.preventDefault());
            option.addEventListener('click', () => {
                input.value = url;
                selectedUrl = url;
                deleteButton.disabled = false;
                urlOptionsOpen = false;
                urlOptions.hidden = true;
                input.setAttribute('aria-expanded', 'false');
                input.focus();
            });
            option.addEventListener('keydown', event => {
                const options = [...urlOptions.querySelectorAll('.url-option')];
                const optionIndex = options.indexOf(option);
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    options[optionIndex + 1]?.focus();
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (optionIndex === 0) input.focus();
                    else options[optionIndex - 1]?.focus();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    urlOptionsOpen = false;
                    urlOptions.hidden = true;
                    input.setAttribute('aria-expanded', 'false');
                    input.focus();
                }
            });
            urlOptions.append(option);
        });
        urlOptions.hidden = !urlOptionsOpen || urls.length === 0;
        input.setAttribute('aria-expanded', String(!urlOptions.hidden));
    }

    function closeUrlOptions() {
        urlOptionsOpen = false;
        urlOptions.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    }

    urlBar.append(urlOptions);

    input.addEventListener('input', () => {
        const value = input.value.trim();
        if (getUrlLibrary().includes(value)) selectedUrl = value;
        else if (!value) selectedUrl = '';
        deleteButton.disabled = !getUrlLibrary().includes(value);
        urlOptionsOpen = true;
        renderUrlOptions(value);
    });
    input.addEventListener('focus', () => {
        urlOptionsOpen = true;
        renderUrlOptions();
    });
    input.addEventListener('click', () => {
        urlOptionsOpen = true;
        renderUrlOptions();
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement === input || urlOptions.contains(document.activeElement)) return;
            closeUrlOptions();
        }, 0);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!urlOptionsOpen) {
                urlOptionsOpen = true;
                renderUrlOptions();
            }
            urlOptions.querySelector('.url-option')?.focus();
        } else if (event.key === 'Escape' && urlOptionsOpen) {
            event.preventDefault();
            closeUrlOptions();
        }
    });

    actions.append(addButton, deleteButton, loadButton);
    urlBar.insertBefore(input, urlOptions);
    urlBar.append(actions);

    const wrapper = document.createElement('div');
    wrapper.className = 'scaled-wrapper';
    const viewport = document.createElement('div');
    viewport.className = 'scaled-viewport';
    wrapper.append(viewport);

    card.append(wrapper);
    if (mode === 'desktop') {
        card.append(urlBar);
    }

    function unload() { viewport.innerHTML = ''; }

    function load(url) {
        const value = url.trim();
        localStorage.setItem(
            `${PRESET_STORAGE_PREFIX}${activePresetIndex}-${index}`,
            value || EMPTY_PRESET_VALUE
        );
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

    loadButton.onclick = () => load(input.value.trim());
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') load(input.value.trim());
    });

    addButton.onclick = () => addUrlToLibrary(controller);
    deleteButton.onclick = () => deleteUrlFromLibrary(controller);

    const controller = {
        card,
        input,
        addButton,
        deleteButton,
        renderUrlOptions,
        closeUrlOptions,
        load,
        unload,
        get selectedUrl() { return selectedUrl; },
        set selectedUrl(value) { selectedUrl = value; }
    };
    return controller;
}

function refreshUrlLibrary() {
    controllers.forEach(controller => {
        controller.deleteButton.disabled =
            !getUrlLibrary().includes(controller.input.value.trim());
        controller.renderUrlOptions(controller.input.value.trim());
    });
}

function addUrlToLibrary(controller) {
    const value = controller.input.value.trim();
    if (!value) return;

    if (controller.selectedUrl && controller.selectedUrl !== value) {
        updateUrlInLibrary(controller);
        return;
    }

    const urls = readStoredUrlList(URL_LIBRARY_STORAGE_KEY);
    const removedUrls = getRemovedUrls();
    removedUrls.delete(value);
    urls.push(value);
    writeUrlLibrary(urls, removedUrls);

    controller.selectedUrl = value;
    refreshUrlLibrary();
}

function updateUrlInLibrary(controller) {
    const value = controller.input.value.trim();
    const originalUrl = controller.selectedUrl;
    if (!originalUrl || !value || originalUrl === value) return;

    const urls = readStoredUrlList(URL_LIBRARY_STORAGE_KEY);
    const removedUrls = getRemovedUrls();
    const updatedChannels = new Set();

    for (let presetIndex = 0; presetIndex < window.DEFAULT_PRESETS.length; presetIndex++) {
        for (let index = 0; index < channelCount; index++) {
            if (getPresetUrl(presetIndex, index) === originalUrl) {
                localStorage.setItem(`${PRESET_STORAGE_PREFIX}${presetIndex}-${index}`, value);
                if (presetIndex === activePresetIndex) updatedChannels.add(index);
            }
        }
    }

    removedUrls.add(originalUrl);
    removedUrls.delete(value);
    const updatedUrls = urls.map(url => url === originalUrl ? value : url);
    updatedUrls.push(value);
    writeUrlLibrary(updatedUrls, removedUrls);

    controllers.forEach((current, index) => {
        if (current.input.value.trim() === originalUrl || updatedChannels.has(index)) {
            current.input.value = value;
            if (!current.card.hidden) current.load(value);
        }
        if (current.selectedUrl === originalUrl) current.selectedUrl = value;
    });

    controller.input.value = value;
    controller.selectedUrl = value;
    refreshUrlLibrary();
}

function deleteUrlFromLibrary(controller) {
    const url = controller.input.value.trim();
    if (!url || !getUrlLibrary().includes(url)) return;

    for (let presetIndex = 0; presetIndex < window.DEFAULT_PRESETS.length; presetIndex++) {
        for (let index = 0; index < channelCount; index++) {
            if (getPresetUrl(presetIndex, index) === url) {
                localStorage.setItem(
                    `${PRESET_STORAGE_PREFIX}${presetIndex}-${index}`,
                    EMPTY_PRESET_VALUE
                );
            }
        }
    }

    const urls = readStoredUrlList(URL_LIBRARY_STORAGE_KEY).filter(savedUrl => savedUrl !== url);
    const removedUrls = getRemovedUrls();
    removedUrls.add(url);
    writeUrlLibrary(urls, removedUrls);

    controllers.forEach(current => {
        if (current.input.value.trim() === url) {
            current.input.value = '';
            current.unload();
        }
        if (current.selectedUrl === url) current.selectedUrl = '';
    });
    refreshUrlLibrary();
}

// ----- Initialize cards -----
const grid = document.querySelector('.grid');
const controllers = [];
for (let i = 0; i < channelCount; i++) {
    const card = document.createElement('div');
    card.className = 'tv';
    grid.append(card);
    controllers.push(createCard(card, i));
}

refreshUrlLibrary();

const cards = grid.querySelectorAll('.tv');

function updateGridLayout() {
    const visibleChannelCount = Math.max(6, window.DEFAULT_PRESETS[activePresetIndex].length);
    grid.dataset.channelCount = String(visibleChannelCount);
    controllers.forEach((controller, index) => {
        controller.card.hidden = index >= visibleChannelCount;
    });
}

updateGridLayout();

function saveCurrentPreset() {
    controllers.forEach((controller, index) => {
        const value = controller.input.value.trim();
        localStorage.setItem(
            `${PRESET_STORAGE_PREFIX}${activePresetIndex}-${index}`,
            value || EMPTY_PRESET_VALUE
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
    updateGridLayout();

    controllers.forEach((controller, index) => {
        controller.input.value = getPresetUrl(activePresetIndex, index);
        controller.selectedUrl = '';
        controller.closeUrlOptions();
        controller.unload();
    });
    refreshUrlLibrary();
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
