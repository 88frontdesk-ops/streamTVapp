const BASE_W = 1280;
const BASE_H = 720;
const LOAD_DELAY = 1500;
const RSS_JSON_API_URL = 'https://api.rss2json.com/v1/api.json?rss_url=';
const RSS_REFRESH_INTERVAL = 3 * 60 * 1000;
const RSS_EMPTY_FEED_RETENTION = 60 * 60 * 1000;
const NEWS_STORY_INTERVAL = 6 * 1000;
const RSS_FETCH_TIMEOUT = 15 * 1000;
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

// ----- Live RSS headlines -----
const newsSource = document.querySelector('.news-source');
const newsHeadline = document.querySelector('.news-headline');
const newsSummary = document.querySelector('.news-summary');
const newsPosted = document.querySelector('.news-posted');
const feedStories = new Map();
const emptyFeedSince = new Map();
let newsStories = [];
let currentStoryIndex = -1;
let currentStory = null;
let newsStoryTimer;

function getFeedItemLink(item) {
    const atomLink = item.querySelector('link[rel="alternate"], link:not([rel])');
    const rawLink = atomLink?.getAttribute('href') || item.querySelector('link')?.textContent.trim();
    if (!rawLink) return '';
    try {
        const url = new URL(rawLink);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
        return '';
    }
}

function cleanFeedSummary(rawSummary) {
    if (!rawSummary) return '';
    const text = new DOMParser()
        .parseFromString(rawSummary, 'text/html')
        .body.textContent.replace(/\s+/g, ' ')
        .trim();
    return text.length > 320 ? `${text.slice(0, 317).trimEnd()}…` : text;
}

function parseFeed(xmlText, feed) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) {
        throw new Error('The feed returned invalid XML.');
    }

    return [...xml.querySelectorAll('item, entry')]
        .map(item => {
            const title = item.querySelector('title')?.textContent.trim();
            const link = getFeedItemLink(item);
            const summaryNode = item.querySelector('description, summary, content') ||
                item.getElementsByTagNameNS('*', 'encoded')[0];
            const published = item.querySelector('pubDate, published, updated, date')?.textContent.trim();
            const publishedAt = published ? Date.parse(published) : 0;
            return {
                title,
                link,
                summary: cleanFeedSummary(summaryNode?.textContent),
                published: Number.isFinite(publishedAt) ? publishedAt : 0,
                source: feed.name,
                category: feed.category
            };
        })
        .filter(story => story.title && story.link)
        .sort((a, b) => b.published - a.published)
        .slice(0, 4);
}

async function fetchFeed(feed) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), RSS_FETCH_TIMEOUT);
    try {
        try {
            const response = await fetch(feed.url, { signal: abortController.signal });
            if (!response.ok) {
                throw new Error(`Feed request failed with status ${response.status}.`);
            }
            return { feed, stories: parseFeed(await response.text(), feed) };
        } catch (error) {
            if (!feed.rss2jsonFallback) throw error;

            const response = await fetch(
                RSS_JSON_API_URL + encodeURIComponent(feed.url),
                { signal: abortController.signal }
            );
            if (!response.ok) {
                throw new Error(`RSS fallback failed with status ${response.status}.`);
            }
            const data = await response.json();
            if (data.status !== 'ok') {
                throw new Error(data.message || 'The RSS fallback could not read this feed.');
            }
            const stories = data.items
                .map(item => ({
                    title: item.title?.trim(),
                    link: item.link,
                    summary: cleanFeedSummary(item.description || item.content),
                    published: item.pubDate ? Date.parse(item.pubDate) : 0,
                    source: feed.name,
                    category: feed.category
                }))
                .filter(story => story.title && story.link &&
                    (story.link.startsWith('http://') || story.link.startsWith('https://')))
                .sort((a, b) => b.published - a.published)
                .slice(0, 4);
            return { feed, stories };
        }
    } finally {
        clearTimeout(timeout);
    }
}

function renderNewsStory(story) {
    newsSource.textContent = `${story.category} · ${story.source}`;
    newsHeadline.textContent = story.title;
    newsHeadline.href = story.link;
    newsHeadline.target = '_blank';
    newsHeadline.rel = 'noopener noreferrer';
    newsSummary.textContent = story.summary;
    newsSummary.hidden = !story.summary;
    if (story.published > 0) {
        const publishedDate = new Date(story.published);
        newsPosted.dateTime = publishedDate.toISOString();
        newsPosted.textContent = `Posted ${new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(publishedDate)}`;
        newsPosted.setAttribute('aria-label', newsPosted.textContent);
        newsPosted.hidden = false;
    } else {
        newsPosted.textContent = '';
        newsPosted.removeAttribute('datetime');
        newsPosted.removeAttribute('aria-label');
        newsPosted.hidden = true;
    }
    const storyElement = newsHeadline.parentElement;
    storyElement.classList.remove('headline-enter');
    void storyElement.offsetWidth;
    storyElement.classList.add('headline-enter');
    clearTimeout(newsStoryTimer);
    newsStoryTimer = setTimeout(showNextNewsStory, NEWS_STORY_INTERVAL);
}

function showNextNewsStory() {
    if (newsStories.length === 0) return;
    if (currentStory) {
        const preservedIndex = newsStories.findIndex(story =>
            story.category === currentStory.category &&
            story.source === currentStory.source &&
            story.link === currentStory.link
        );
        currentStoryIndex = preservedIndex >= 0
            ? preservedIndex
            : Math.min(currentStoryIndex, newsStories.length - 1);
    }
    currentStoryIndex = (currentStoryIndex + 1) % newsStories.length;
    currentStory = newsStories[currentStoryIndex];
    renderNewsStory(currentStory);
}

function rebuildNewsStories() {
    newsStories = [];
    const categories = new Map();
    window.DEFAULT_RSS_FEEDS.forEach(feed => {
        if (!categories.has(feed.category)) categories.set(feed.category, []);
        categories.get(feed.category).push(feed);
    });
    const feedsByCategory = [...categories.values()];
    const maxFeedCount = Math.max(0, ...feedsByCategory.map(feeds => feeds.length));
    for (let feedIndex = 0; feedIndex < maxFeedCount; feedIndex++) {
        feedsByCategory.forEach(feeds => {
            const feed = feeds[feedIndex];
            if (!feed) return;
            newsStories.push(...(feedStories.get(feed.url) || []));
        });
    }
}

function mergeFeedStories(existingStories, fetchedStories) {
    const mergedStories = new Map();
    [...fetchedStories, ...existingStories].forEach(story => {
        if (!mergedStories.has(story.link)) mergedStories.set(story.link, story);
    });
    return [...mergedStories.values()].slice(0, 4);
}

function updateFeedStories(url, fetchedStories, refreshedAt) {
    const existingStories = feedStories.get(url) || [];
    if (fetchedStories.length === 0) {
        if (existingStories.length === 0) return;

        const emptySince = emptyFeedSince.get(url) ?? refreshedAt;
        if (refreshedAt - emptySince >= RSS_EMPTY_FEED_RETENTION) {
            feedStories.delete(url);
            emptyFeedSince.delete(url);
        } else {
            emptyFeedSince.set(url, emptySince);
        }
        return;
    }

    emptyFeedSince.delete(url);
    feedStories.set(url, mergeFeedStories(existingStories, fetchedStories));
}

async function refreshNewsFeeds() {
    const results = await Promise.all(window.DEFAULT_RSS_FEEDS.map(async feed => {
        try {
            return await fetchFeed(feed);
        } catch (error) {
            console.warn(`Unable to refresh RSS feed "${feed.name}".`, error);
            return { feed, error };
        }
    }));

    const refreshedAt = Date.now();
    results.forEach(result => {
        if (!result.stories) return;
        updateFeedStories(result.feed.url, result.stories, refreshedAt);
    });
    rebuildNewsStories();

    if (newsStories.length === 0 && !currentStory) {
        newsSource.textContent = 'News sources';
        newsHeadline.removeAttribute('href');
        newsHeadline.textContent = 'Headlines could not be loaded. Check your connection and try again later.';
        newsPosted.hidden = true;
        return;
    }

    if (newsStories.length > 0 && !currentStory) showNextNewsStory();
}

refreshNewsFeeds();
setInterval(refreshNewsFeeds, RSS_REFRESH_INTERVAL);
