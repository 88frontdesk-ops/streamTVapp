import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const firebaseConfig = window.FIREBASE_CONFIG;
let db = null;
let auth = null;
let linkRows = window.DEFAULT_LINKS.map((link, index) => ({
    id: `default-${index}`,
    ...link,
    status: 'default'
}));

if (firebaseConfig?.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.apiKey !== 'YOUR_FIREBASE_API_KEY' &&
    firebaseConfig.projectId !== 'YOUR_FIREBASE_PROJECT_ID') {
    try {
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);
        const snapshot = await getDocs(collection(db, 'links'));
        const linksByUrl = new Map(linkRows.map(link => [link.link, link]));
        snapshot.forEach(linkDocument => {
            const data = linkDocument.data();
            if (typeof data.channel !== 'string' ||
                typeof data.link !== 'string' ||
                !['default', 'manual'].includes(data.status)) {
                console.warn(`Ignoring invalid Firestore link document: ${linkDocument.id}`);
                return;
            }
            if (!linksByUrl.has(data.link)) {
                linksByUrl.set(data.link, {
                    id: linkDocument.id,
                    channel: data.channel,
                    link: data.link,
                    status: data.status
                });
            }
        });
        linkRows = [...linksByUrl.values()];
    } catch (error) {
        console.warn('Could not load Firestore links; using the built-in default links.', error);
    }
} else {
    console.warn('Firebase is not configured; using the built-in default links.');
}

const BASE_W = 1280;
const BASE_H = 720;
const LOAD_DELAY = 1500;
const RSS_EMPTY_FEED_RETENTION = 60 * 60 * 1000;
const NEWS_STORY_INTERVAL = 6 * 1000;
const NEWS_REFRESH_SUMMARY_INTERVAL = 2 * 1000;
const RSS_SNAPSHOT_RETRY_INTERVAL = 60 * 1000;
const RSS_SNAPSHOT_POLL_INTERVAL = 5 * 60 * 1000;
const RSS_SNAPSHOT_FOCUS_REFRESH_INTERVAL = 60 * 1000;
const PRESET_STORAGE_PREFIX = 'tv-preset-';
const ACTIVE_PRESET_STORAGE_KEY = 'tv-active-preset';
const EMPTY_PRESET_VALUE = '__empty__';
const DEFAULTS_MIGRATION_KEY = 'tv-preset-3-defaults-migration';
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
        if (url.link && localStorage.getItem(key) === EMPTY_PRESET_VALUE) {
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

    return window.DEFAULT_PRESETS[presetIndex][channelIndex]?.link || '';
}

function getUrlLibrary() {
    return linkRows;
}

function getLinkByUrl(url) {
    return linkRows.find(link => link.link === url);
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
    let selectedChannel = '';
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
    addButton.setAttribute('aria-label', 'Add link to shared list');
    addButton.title = 'Add this URL to the shared Firestore list';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'url-list-button';
    deleteButton.textContent = 'x';
    deleteButton.setAttribute('aria-label', 'Delete link from shared list');
    deleteButton.title = 'Remove this manual URL from the shared Firestore list and presets';
    deleteButton.disabled = !getLinkByUrl(input.value.trim());

    const loadButton = document.createElement('button');
    loadButton.className = 'load-button';
    loadButton.textContent = 'Load';

    function renderUrlOptions(filter = '') {
        const normalizedFilter = filter.toLocaleLowerCase();
        const links = getUrlLibrary().filter(item =>
            `${item.channel} ${item.link}`.toLocaleLowerCase().includes(normalizedFilter)
        );
        urlOptions.replaceChildren();
        links.forEach(item => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'url-option';
            option.setAttribute('role', 'option');
            option.textContent = `${item.channel} — ${item.link}`;
            option.addEventListener('pointerdown', event => event.preventDefault());
            option.addEventListener('click', () => {
                input.value = item.link;
                selectedUrl = item.link;
                selectedChannel = item.channel;
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
        urlOptions.hidden = !urlOptionsOpen || links.length === 0;
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
        const selectedLink = getLinkByUrl(value);
        if (selectedLink) {
            selectedUrl = value;
            selectedChannel = selectedLink.channel;
        } else if (!value) {
            selectedUrl = '';
            selectedChannel = '';
        }
        deleteButton.disabled = !selectedLink;
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

    addButton.onclick = () => { void addUrlToLibrary(controller); };
    deleteButton.onclick = () => { void deleteUrlFromLibrary(controller); };

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
        set selectedUrl(value) { selectedUrl = value; },
        get selectedChannel() { return selectedChannel; },
        set selectedChannel(value) { selectedChannel = value; }
    };
    return controller;
}

function refreshUrlLibrary() {
    controllers.forEach(controller => {
        controller.deleteButton.disabled = !getLinkByUrl(controller.input.value.trim());
        controller.renderUrlOptions(controller.input.value.trim());
    });
}

let adminPasswordDialog;
let resolveAdminPassword;

function promptForAdminPassword() {
    if (adminPasswordDialog?.open) return Promise.resolve(null);

    if (!adminPasswordDialog) {
        adminPasswordDialog = document.createElement('dialog');
        adminPasswordDialog.className = 'password-dialog';
        adminPasswordDialog.setAttribute('aria-labelledby', 'password-dialog-title');

        const form = document.createElement('form');
        form.className = 'password-dialog-form';
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!passwordInput.value.trim()) {
                passwordInput.focus();
                return;
            }
            adminPasswordDialog.close('submit');
        });

        const title = document.createElement('h2');
        title.id = 'password-dialog-title';
        title.textContent = 'Admin password';

        const label = document.createElement('label');
        label.htmlFor = 'admin-password-input';
        label.textContent = 'Enter admin password to proceed:';

        const passwordInput = document.createElement('input');
        passwordInput.id = 'admin-password-input';
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'current-password';
        passwordInput.required = true;

        const buttons = document.createElement('div');
        buttons.className = 'password-dialog-actions';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => adminPasswordDialog.close('cancel'));

        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.textContent = 'Continue';

        buttons.append(cancelButton, submitButton);
        form.append(title, label, passwordInput, buttons);
        adminPasswordDialog.append(form);
        document.body.append(adminPasswordDialog);
        adminPasswordDialog.addEventListener('close', () => {
            const password = passwordInput.value;
            passwordInput.value = '';
            resolveAdminPassword?.(
                adminPasswordDialog.returnValue === 'submit' && password.trim()
                    ? password
                    : null
            );
            resolveAdminPassword = null;
        });
    }

    return new Promise(resolve => {
        resolveAdminPassword = resolve;
        adminPasswordDialog.showModal();
        adminPasswordDialog.querySelector('input').focus();
    });
}

async function verifyAdminPassword(password) {
    if (!db) throw new Error('Firebase is not configured. Update firebase-config.js first.');
    const adminDocument = await getDoc(doc(db, 'config', 'admin'));
    if (!adminDocument.exists() || typeof adminDocument.data().passwordHash !== 'string') {
        throw new Error('Firestore config/admin must contain a passwordHash string.');
    }
    const passwordBytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-256', passwordBytes);
    const enteredHash = [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    if (enteredHash !== adminDocument.data().passwordHash.toLowerCase()) {
        window.alert('Incorrect password!');
        return false;
    }
    return true;
}

async function authenticateWrite() {
    if (!auth) throw new Error('Firebase Auth is not configured.');
    await signInAnonymously(auth);
}

function showLinkOperationError(error) {
    console.error('Firestore link operation failed.', error);
    window.alert(`Could not update the shared links: ${error.message}`);
}

async function addUrlToLibrary(controller) {
    const password = await promptForAdminPassword();
    if (!password) return;

    const value = controller.input.value.trim();
    if (!value) return;

    try {
        if (!await verifyAdminPassword(password)) return;
        if (getLinkByUrl(value)) {
            window.alert('This link is already in the shared list.');
            return;
        }
        const parsedLink = new URL(value);
        if (!['http:', 'https:'].includes(parsedLink.protocol)) {
            throw new Error('Enter a link that starts with http:// or https://.');
        }
        const channel = controller.selectedUrl === value && controller.selectedChannel
            ? controller.selectedChannel
            : parsedLink.hostname.replace(/^www\./i, '') || 'Link';
        await authenticateWrite();
        const linkDocument = await addDoc(collection(db, 'links'), {
            channel,
            link: value,
            status: 'manual'
        });
        linkRows.push({ id: linkDocument.id, channel, link: value, status: 'manual' });
        controller.selectedUrl = value;
        controller.selectedChannel = channel;
        refreshUrlLibrary();
    } catch (error) {
        showLinkOperationError(error);
    }
}

async function deleteUrlFromLibrary(controller) {
    const password = await promptForAdminPassword();
    if (!password) return;

    const url = controller.input.value.trim();
    if (!url) return;

    try {
        if (!await verifyAdminPassword(password)) return;
        const link = getLinkByUrl(url);
        if (!link) return;
        if (link.status === 'default') {
            window.alert('This is a permanent default row and cannot be deleted.');
            return;
        }
        await authenticateWrite();
        await deleteDoc(doc(db, 'links', link.id));
        linkRows = linkRows.filter(item => item.id !== link.id);

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

        controllers.forEach(current => {
            if (current.input.value.trim() === url) {
                current.input.value = '';
                current.unload();
            }
            if (current.selectedUrl === url) {
                current.selectedUrl = '';
                current.selectedChannel = '';
            }
        });
        refreshUrlLibrary();
    } catch (error) {
        showLinkOperationError(error);
    }
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
const newsSnapshotUpdated = document.querySelector('.news-snapshot-updated');
const feedStories = new Map();
const emptyFeedSince = new Map();
let newsStories = [];
let currentStoryIndex = -1;
let currentStory = null;
let newsStoryTimer;
let newsRefreshInProgress = false;
let newsRefreshQueued = false;
let newsRefreshQueuedWithSummary = false;
let lastSnapshotFetchStartedAt = 0;

function formatLocalDateTime(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';
    const dateText = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium'
    }).format(date);
    const timeText = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(date);
    return `${dateText}, ${timeText}`;
}

function updateSnapshotUpdatedTime(snapshot) {
    const generatedAt = Date.parse(snapshot?.generatedAt || '');
    if (!Number.isFinite(generatedAt)) return;

    const generatedDate = new Date(generatedAt);
    newsSnapshotUpdated.dateTime = generatedDate.toISOString();
    newsSnapshotUpdated.textContent = `Snapshot ${formatLocalDateTime(generatedDate)}`;
    newsSnapshotUpdated.setAttribute('aria-label', `RSS snapshot ${formatLocalDateTime(generatedDate)}`);
    newsSnapshotUpdated.hidden = false;
}

async function fetchFeedSnapshot() {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 15 * 1000);
    try {
        const snapshotUrl = new URL('feeds.json', document.baseURI);
        snapshotUrl.searchParams.set('updated', String(Date.now()));
        const response = await fetch(snapshotUrl, {
            signal: abortController.signal,
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`Feed snapshot request failed with status ${response.status}.`);
        }
        const snapshot = await response.json();
        if (!snapshot || !Array.isArray(snapshot.feeds)) {
            throw new Error('The feed snapshot has an invalid format.');
        }
        return snapshot;
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
        newsPosted.textContent = `Posted ${formatLocalDateTime(publishedDate)}`;
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

function showNewsStatus(message) {
    newsSource.textContent = 'News sources';
    newsHeadline.removeAttribute('href');
    newsHeadline.removeAttribute('target');
    newsHeadline.removeAttribute('rel');
    newsHeadline.textContent = message;
    newsSummary.textContent = '';
    newsSummary.hidden = true;
    newsPosted.textContent = '';
    newsPosted.removeAttribute('datetime');
    newsPosted.removeAttribute('aria-label');
    newsPosted.hidden = true;

    const storyElement = newsHeadline.parentElement;
    storyElement.classList.remove('headline-enter');
    void storyElement.offsetWidth;
    storyElement.classList.add('headline-enter');
}

function showNextNewsStory() {
    if (newsStories.length === 0) return;
    if (currentStory) {
        const preservedIndex = newsStories.findIndex(story =>
            story.category === currentStory.category &&
            story.source === currentStory.source &&
            story.link === currentStory.link
        );
        const lastShownIndex = preservedIndex >= 0
            ? preservedIndex
            : Math.min(currentStoryIndex, newsStories.length - 1);
        if (lastShownIndex === newsStories.length - 1) {
            currentStory = null;
            currentStoryIndex = -1;
            showNewsStatus('Refreshing feeds…');
            refreshNewsFeeds(true);
            return;
        }
        currentStoryIndex = lastShownIndex;
    }
    currentStoryIndex = (currentStoryIndex + 1) % newsStories.length;
    currentStory = newsStories[currentStoryIndex];
    renderNewsStory(currentStory);
}

function rebuildNewsStories() {
    newsStories = [];
    window.DEFAULT_RSS_FEEDS.forEach(feed => {
        newsStories.push(...(feedStories.get(feed.url) || []));
    });
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

async function refreshNewsFeeds(showSummary = false) {
    if (newsRefreshInProgress) {
        newsRefreshQueued = true;
        newsRefreshQueuedWithSummary = newsRefreshQueuedWithSummary || showSummary;
        return;
    }

    newsRefreshInProgress = true;
    lastSnapshotFetchStartedAt = Date.now();

    try {
        let snapshot;
        try {
            snapshot = await fetchFeedSnapshot();
        } catch (error) {
            console.error('Unable to load the RSS feed snapshot.', error);
            showNewsStatus(newsStories.length > 0
                ? 'Feed refresh unavailable; retrying shortly.'
                : 'Headlines could not be loaded. Check your connection and try again shortly.');
            newsStoryTimer = setTimeout(() => {
                if (newsStories.length > 0) {
                    currentStory = null;
                    currentStoryIndex = -1;
                    showNextNewsStory();
                } else {
                    refreshNewsFeeds();
                }
            }, showSummary ? NEWS_REFRESH_SUMMARY_INTERVAL : RSS_SNAPSHOT_RETRY_INTERVAL);
            return;
        }

        updateSnapshotUpdatedTime(snapshot);
        const refreshedAt = Date.now();
        const newPostUrls = new Set();
        const refreshedUrls = new Set();
        const resultsByUrl = new Map(snapshot.feeds
            .filter(result => result && typeof result.url === 'string')
            .map(result => [result.url, result]));
        window.DEFAULT_RSS_FEEDS.forEach(feed => {
            const result = resultsByUrl.get(feed.url);
            if (!result) {
                console.warn(`Feed snapshot is missing "${feed.name}".`);
                return;
            }
            if (result.error) {
                console.warn(`Unable to refresh RSS feed "${feed.name}": ${result.error}`);
                return;
            }
            if (!Array.isArray(result.stories)) {
                console.warn(`RSS feed snapshot for "${feed.name}" has no stories list.`);
                return;
            }

            const fetchedStories = result.stories.filter(story =>
                story &&
                typeof story.title === 'string' &&
                typeof story.link === 'string' &&
                /^https?:\/\//i.test(story.link)
            ).map(story => ({
                title: story.title,
                link: story.link,
                summary: typeof story.summary === 'string' ? story.summary : '',
                published: Number.isFinite(story.published) ? story.published : 0,
                source: feed.name,
                category: feed.category
            }));
            refreshedUrls.add(feed.url);
            const existingLinks = new Set(
                (feedStories.get(feed.url) || []).map(story => story.link)
            );
            if (fetchedStories.some(story => !existingLinks.has(story.link))) {
                newPostUrls.add(feed.url);
            }
            updateFeedStories(feed.url, fetchedStories, refreshedAt);
        });
        rebuildNewsStories();

        if (showSummary) {
            const count = newPostUrls.size;
            showNewsStatus(
                `${count} feed URL${count === 1 ? '' : 's'} returned new posts; ` +
                `${refreshedUrls.size} of ${window.DEFAULT_RSS_FEEDS.length} feeds refreshed.`
            );
            newsStoryTimer = setTimeout(() => {
                if (newsStories.length > 0) {
                    showNextNewsStory();
                    return;
                }
                showNewsStatus('Headlines could not be loaded. Check your connection and try again later.');
            }, NEWS_REFRESH_SUMMARY_INTERVAL);
            return;
        }

        if (newsStories.length === 0 && !currentStory) {
            showNewsStatus('Headlines could not be loaded. Check your connection and try again later.');
            newsStoryTimer = setTimeout(() => refreshNewsFeeds(), RSS_SNAPSHOT_RETRY_INTERVAL);
            return;
        }

        if (newsStories.length > 0 && !currentStory) showNextNewsStory();
    } finally {
        newsRefreshInProgress = false;
        if (newsRefreshQueued) {
            const queuedShowSummary = newsRefreshQueuedWithSummary;
            newsRefreshQueued = false;
            newsRefreshQueuedWithSummary = false;
            setTimeout(() => refreshNewsFeeds(queuedShowSummary), 0);
        }
    }
}

refreshNewsFeeds();
setInterval(() => {
    if (!document.hidden) refreshNewsFeeds();
}, RSS_SNAPSHOT_POLL_INTERVAL);

function refreshSnapshotWhenVisible() {
    if (!document.hidden &&
        Date.now() - lastSnapshotFetchStartedAt >= RSS_SNAPSHOT_FOCUS_REFRESH_INTERVAL) {
        refreshNewsFeeds();
    }
}

document.addEventListener('visibilitychange', refreshSnapshotWhenVisible);
window.addEventListener('focus', refreshSnapshotWhenVisible);
