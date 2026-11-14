'use strict';

/* =========================================================
 * 定数・設定
 * ======================================================= */

const FONTS = {
    gothic: { family: '"Noto Sans JP"', weight: 900 },
    maru: { family: '"M PLUS Rounded 1c"', weight: 800 },
    mincho: { family: '"Noto Serif JP"', weight: 900 },
};
const FALLBACK_FAMILIES = 'sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

const COLOR_PRESETS = [
    { id: 'wb', fg: '#ffffff', bg: '#000000', name: '白・黒' },
    { id: 'yb', fg: '#ffe600', bg: '#000000', name: '黄・黒' },
    { id: 'by', fg: '#000000', bg: '#ffe600', name: '黒・黄' },
    { id: 'bw', fg: '#000000', bg: '#ffffff', name: '黒・白' },
    { id: 'gb', fg: '#39ff14', bg: '#000000', name: '緑・黒' },
    { id: 'rb', fg: '#ff3b30', bg: '#000000', name: '赤・黒' },
    { id: 'wr', fg: '#ffffff', bg: '#d70015', name: '白・赤' },
    { id: 'wbl', fg: '#ffffff', bg: '#0040dd', name: '白・青' },
];

const DEFAULT_SETTINGS = {
    preset: 'wb',
    basePreset: 'wb', // カスタムにする前に選んでいたプリセット（「プリセットの色に戻す」で使う）
    fg: '#ffffff',
    bg: '#000000',
    font: 'gothic',
    mode: 'static',   // static | blink | scroll
    speed: 'normal',  // slow | normal | fast
    orient: 'auto',   // auto | landscape | portrait
    vertical: false,
    mirror: false,
    speakOnShow: false,
    // ブラウザで全画面 API を使うと終了方法の案内が必ず出るため、初期値はオフ
    browserFullscreen: false,
};

// ホーム画面から起動したアプリとして動いているか（このときは最初から全画面）
const isInstalledApp = () =>
    matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    navigator.standalone === true;

const DEFAULT_FAVORITES = [
    'ありがとうございます',
    '少々お待ちください',
    'すみません',
    'お先にどうぞ',
];

const HISTORY_LIMIT = 30;
const RECENT_COLOR_LIMIT = 8;
const LINE_HEIGHT = 1.15;   // 横書きの行送り（em）
const COLUMN_GAP = 1.15;    // 縦書きの列送り（em）
const PADDING_RATIO = 0.04; // 画面端の余白
const CONTROLS_HIDE_MS = 3000;
const DOUBLE_TAP_MS = 320;
const SWIPE_PX = 50;

/* =========================================================
 * 保存（localStorage は使えない環境もあるので必ず try/catch）
 * ======================================================= */

// arata-a3.github.io 上の他のアプリと localStorage を共有するため、名前に接頭辞を付ける
const STORE_PREFIX = 'largeText:';

const store = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem(STORE_PREFIX + key);
            return v === null ? fallback : JSON.parse(v);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
        } catch { /* 保存できなくても動作は続ける */ }
    },
};

// 接頭辞なしで保存していた v1.2.4 以前のデータを引き継ぐ（1回だけ）。
// 同じ名前を他のアプリが使っている可能性があるので、形が合うものだけ取り込み、元のデータは消さない。
(function migrateOldStorage() {
    try {
        if (localStorage.getItem(STORE_PREFIX + 'migrated')) return;
        const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
        const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
        const settings = read('settings');
        if (settings && typeof settings === 'object' && ('font' in settings || 'mode' in settings || 'preset' in settings)) {
            store.set('settings', settings);
        }
        for (const k of ['favorites', 'history']) {
            const v = read(k);
            if (isStringArray(v)) store.set(k, v);
        }
        const lastText = read('lastText');
        if (typeof lastText === 'string') store.set('lastText', lastText);
        localStorage.setItem(STORE_PREFIX + 'migrated', '1');
    } catch { /* 使えない環境では何もしない */ }
})();

// 色は #rrggbb の小文字にそろえる（形が違えば null）
function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().toLowerCase().match(/^#([0-9a-f]{6})$/);
    return m ? `#${m[1]}` : null;
}

function loadSettings() {
    const s = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
    s.fg = normalizeHex(s.fg) ?? DEFAULT_SETTINGS.fg;
    s.bg = normalizeHex(s.bg) ?? DEFAULT_SETTINGS.bg;
    const isPreset = (id) => COLOR_PRESETS.some((p) => p.id === id);
    if (!isPreset(s.basePreset)) s.basePreset = isPreset(s.preset) ? s.preset : DEFAULT_SETTINGS.basePreset;
    return s;
}

function loadRecentColors() {
    const list = store.get('recentColors', []);
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(normalizeHex).filter(Boolean))].slice(0, RECENT_COLOR_LIMIT);
}

const state = {
    settings: loadSettings(),
    recentColors: loadRecentColors(),
    favorites: store.get('favorites', null) ?? [...DEFAULT_FAVORITES],
    history: store.get('history', []),
    // 表示中の状態
    displayActive: false,
    displayList: [],
    displayIndex: 0,
    rotated: false,
    enteredFullscreen: false,
    wakeLock: null,
};

/* =========================================================
 * DOM
 * ======================================================= */

const $ = (id) => document.getElementById(id);
const el = {
    inputScreen: $('input-screen'),
    displayScreen: $('display-screen'),
    textInput: $('text-input'),
    showButton: $('show-button'),
    shareButton: $('share-button'),
    clearButton: $('clear-button'),
    micButton: $('mic-button'),
    favAddButton: $('fav-add-button'),
    preview: $('preview'),
    previewStage: document.querySelector('#preview .stage'),
    colorPresets: $('color-presets'),
    customColors: $('custom-colors'),
    colorDialog: $('color-dialog'),
    cdTitle: $('cd-title'),
    cdClose: $('cd-close'),
    cdPreview: $('cd-preview'),
    cdHex: $('cd-hex'),
    cdRecentSection: $('cd-recent-section'),
    cdRecent: $('cd-recent'),
    cdSame: $('cd-same'),
    cdTheme: $('cd-theme'),
    cdAdjust: $('cd-adjust'),
    cdPicker: $('cd-picker'),
    cdRevert: $('cd-revert'),
    cdReset: $('cd-reset'),
    speedField: $('speed-field'),
    favoritesList: $('favorites-list'),
    historyList: $('history-list'),
    clearHistoryButton: $('clear-history-button'),
    displayArea: $('display-area'),
    displayStage: document.querySelector('#display-area .stage'),
    controls: $('display-controls'),
    displayHint: $('display-hint'),
    closeButton: $('close-button'),
    rotateButton: $('rotate-button'),
    speakButton: $('speak-button'),
    prevButton: $('prev-button'),
    nextButton: $('next-button'),
    position: $('position-indicator'),
    toast: $('toast'),
};

/* =========================================================
 * 文字の分割（書記素・禁則処理）
 * ======================================================= */

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
    : null;

function graphemes(str) {
    if (segmenter) return Array.from(segmenter.segment(str), (s) => s.segment);
    return Array.from(str);
}

// 行頭に来てはいけない文字（前の文字にくっつける）
const NO_LINE_START = new Set(Array.from('、。，．,.!?！？)）」』】〕〉》］｝ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ・：；:;…‥〜～'));
// 行末に来てはいけない文字（次の文字にくっつける）
const NO_LINE_END = new Set(Array.from('(（「『【〔〈《［｛'));
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;
const WORD_RE = /^[\p{L}\p{N}'’\-]$/u;
const KATAKANA_RE = /^\p{Script=Katakana}$/u; // 長音「ー」は含まない（直前がカタカナのときだけ語に含める）
const SMALL_KANA_CHARS = 'ァィゥェォッャュョヮヵヶ';

/**
 * 1段落を「途中で改行しない単位」に分ける。
 * 英単語はまとめ、日本語は1文字ずつ。禁則文字は前後にくっつける。
 * 返り値: { text, space } の配列（space=true は空白トークン）
 */
function tokenize(paragraph) {
    const raw = [];
    let word = '';
    let wordType = '';
    const flushWord = () => {
        if (word) raw.push({ text: word, space: false });
        word = '';
        wordType = '';
    };
    const addToWord = (g, type) => {
        if (wordType && wordType !== type) flushWord();
        word += g;
        wordType = type;
    };
    for (const g of graphemes(paragraph)) {
        if (/^\s$/u.test(g)) {
            flushWord();
            raw.push({ text: ' ', space: true });
        } else if (KATAKANA_RE.test(g) && (wordType === 'kata' || !SMALL_KANA_CHARS.includes(g))) {
            // カタカナ語はひとまとまりにする（長すぎる場合は折り返し時に分割）
            addToWord(g, 'kata');
        } else if (g === 'ー' && wordType === 'kata') {
            addToWord(g, 'kata');
        } else if (WORD_RE.test(g) && !CJK_RE.test(g) && g !== 'ー') {
            addToWord(g, 'latin');
        } else {
            flushWord();
            raw.push({ text: g, space: false });
        }
    }
    flushWord();

    // 禁則処理
    const tokens = [];
    let pendingOpen = '';
    for (const t of raw) {
        if (t.space) {
            if (pendingOpen) { tokens.push({ text: pendingOpen, space: false }); pendingOpen = ''; }
            tokens.push(t);
            continue;
        }
        const first = graphemes(t.text)[0];
        const prev = tokens[tokens.length - 1];
        if (!pendingOpen && prev && !prev.space && NO_LINE_START.has(first)) {
            prev.text += t.text;
            continue;
        }
        const text = pendingOpen + t.text;
        pendingOpen = '';
        if (NO_LINE_END.has(graphemes(text).at(-1))) {
            pendingOpen = text;
            continue;
        }
        tokens.push({ text, space: false });
    }
    if (pendingOpen) tokens.push({ text: pendingOpen, space: false });
    return tokens;
}

/* =========================================================
 * 寸法計測（canvas の measureText で、SVG と同じフォントを使う）
 * ======================================================= */

const measureCtx = document.createElement('canvas').getContext('2d');
const FONT_PX = 100; // 計測・描画の基準サイズ（viewBox で拡大縮小される）

function fontFamily(settings) {
    return `${FONTS[settings.font].family}, ${FALLBACK_FAMILIES}`;
}
function cssFont(settings) {
    return `${FONTS[settings.font].weight} ${FONT_PX}px ${fontFamily(settings)}`;
}

function measure(text) {
    return measureCtx.measureText(text).width;
}

// フォントを読み込んでから計測する（読み込み前に測ると寸法がずれるため）
async function ensureFont(settings, text) {
    if (!document.fonts || !document.fonts.load) return;
    try {
        await Promise.race([
            document.fonts.load(`${FONTS[settings.font].weight} ${FONT_PX}px ${FONTS[settings.font].family}`, text || 'あA'),
            new Promise((resolve) => setTimeout(resolve, 3000)), // オフライン等で読めない場合は諦めて代替フォント
        ]);
    } catch { /* 代替フォントで続行 */ }
}

/* =========================================================
 * レイアウト計算
 * ======================================================= */

/** 横書き: 指定幅 limit で折り返した行の配列を返す */
function wrapHorizontal(tokens, limit) {
    const lines = [];
    let line = '';
    let width = 0;
    const push = () => { lines.push(line.trimEnd()); line = ''; width = 0; };

    for (const t of tokens) {
        if (t.space) {
            if (line) { line += ' '; width += measure(' '); }
            continue;
        }
        const w = measure(t.text);
        if (line && width + w > limit && line.trim()) push();
        if (w > limit) {
            // 1単位が幅を超える長い単語は文字単位で分割
            for (const g of graphemes(t.text)) {
                const gw = measure(g);
                if (line && width + gw > limit) push();
                line += g;
                width += gw;
            }
        } else {
            line += t.text;
            width += w;
        }
    }
    if (line || lines.length === 0) push();
    return lines;
}

/** 画面の縦横比に対して最も大きく表示できる横書きレイアウトを探す */
function layoutHorizontal(text, boxW, boxH) {
    const paragraphs = text.split('\n').map((p) => p.trim());
    const tokenized = paragraphs.map(tokenize);

    let maxTokenW = 1;
    let maxParaW = 1;
    for (const tokens of tokenized) {
        let sum = 0;
        for (const t of tokens) {
            const w = measure(t.text);
            sum += w;
            if (!t.space) maxTokenW = Math.max(maxTokenW, Math.min(w, FONT_PX * 1.2));
        }
        maxParaW = Math.max(maxParaW, sum);
    }

    const candidates = new Set([maxParaW + 1]);
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
        candidates.add(maxTokenW + ((maxParaW - maxTokenW) * i) / steps);
    }

    const results = [];
    for (const limit of candidates) {
        const lines = tokenized.flatMap((tokens) => wrapHorizontal(tokens, limit));
        const width = Math.max(1, ...lines.map((l) => measure(l)));
        const height = lines.length * FONT_PX * LINE_HEIGHT;
        results.push({ lines, width, height, scale: Math.min(boxW / width, boxH / height) });
    }
    return pickLayout(results, (r) => r.lines.length);
}

/**
 * 最も大きく表示できる候補を選ぶ。ただし大きさの差がわずかなら、
 * 区切りが少ない（＝読みやすい）候補を優先する。
 */
const PREFER_FEWER_TOLERANCE = 0.92;
function pickLayout(results, countOf) {
    const maxScale = Math.max(...results.map((r) => r.scale));
    return results
        .filter((r) => r.scale >= maxScale * PREFER_FEWER_TOLERANCE)
        .reduce((best, r) => (
            !best || countOf(r) < countOf(best) || (countOf(r) === countOf(best) && r.scale > best.scale) ? r : best
        ), null);
}

/** 縦書き: 1列あたり perCol 文字で列に分ける */
function wrapVertical(units, perCol) {
    const cols = [];
    let col = [];
    const place = (u) => {
        if (col.length && col.length + u.length > perCol) {
            cols.push(col);
            col = [];
        }
        col.push(...u);
    };
    for (const u of units) {
        // 1列に収まらない長い単語は1文字ずつに分ける
        if (u.length > perCol) u.forEach((ch) => place([ch]));
        else place(u);
    }
    cols.push(col);
    return cols;
}

function layoutVertical(text, boxW, boxH) {
    const paragraphs = text.split('\n').map((p) => p.trim());
    // 縦書きは1文字ずつ並べるが、禁則でくっついた単位は分けない
    const unitsList = paragraphs.map((p) =>
        tokenize(p).map((t) => (t.space ? ['　'] : graphemes(t.text)))
    );
    const maxLen = Math.max(1, ...unitsList.map((units) => units.reduce((n, u) => n + u.length, 0)));

    const results = [];
    for (let perCol = 1; perCol <= maxLen; perCol++) {
        const cols = unitsList.flatMap((units) => wrapVertical(units, perCol));
        const height = Math.max(1, ...cols.map((c) => c.length)) * FONT_PX;
        const width = cols.length * FONT_PX * COLUMN_GAP;
        results.push({ cols, width, height, scale: Math.min(boxW / width, boxH / height) });
    }
    return pickLayout(results, (r) => r.cols.length);
}

/* =========================================================
 * 描画
 * ======================================================= */

const SVG_NS = 'http://www.w3.org/2000/svg';
// 縦書きで90度回転させる文字
const ROTATE_IN_VERTICAL = new Set(Array.from('ー〜～…‥―－-—–_=＝()（）[]［］{}｛｝「」『』【】〔〕〈〉《》<>＜＞→←:：;；|｜'));
// 縦書きで右上に寄せる文字
const PUNCT_IN_VERTICAL = new Set(Array.from('、。，．,.'));
const SMALL_KANA = new Set(Array.from('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ'));

function svgEl(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

function applyStageStyle(container, stage, settings, { rotated = false } = {}) {
    container.style.backgroundColor = settings.bg;
    stage.style.color = settings.fg;
    stage.classList.toggle('blink', settings.mode === 'blink');
    const transforms = [];
    if (rotated) transforms.push('rotate(180deg)');
    if (settings.mirror) transforms.push('scaleX(-1)');
    stage.style.transform = transforms.join(' ');
}

function renderStatic(stage, text, settings, boxW, boxH) {
    const padW = boxW * (1 - PADDING_RATIO * 2);
    const padH = boxH * (1 - PADDING_RATIO * 2);
    const svg = svgEl('svg', { width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    const g = svgEl('g', {
        fill: 'currentColor',
        'font-family': fontFamily(settings),
        'font-weight': String(FONTS[settings.font].weight),
        'font-size': String(FONT_PX),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
    });

    let vbW;
    let vbH;
    if (settings.vertical) {
        const layout = layoutVertical(text, padW, padH);
        vbW = layout.width;
        vbH = layout.height;
        const colW = FONT_PX * COLUMN_GAP;
        layout.cols.forEach((col, ci) => {
            const x = vbW - colW * (ci + 0.5);
            col.forEach((ch, ri) => {
                const y = FONT_PX * (ri + 0.5);
                const t = svgEl('text', { x, y });
                t.textContent = ch;
                if (ROTATE_IN_VERTICAL.has(ch)) {
                    t.setAttribute('transform', `rotate(90 ${x} ${y})`);
                } else if (PUNCT_IN_VERTICAL.has(ch)) {
                    t.setAttribute('transform', `translate(${FONT_PX * 0.6} ${-FONT_PX * 0.6})`);
                } else if (SMALL_KANA.has(ch)) {
                    t.setAttribute('transform', `translate(${FONT_PX * 0.1} ${-FONT_PX * 0.1})`);
                }
                g.appendChild(t);
            });
        });
    } else {
        const layout = layoutHorizontal(text, padW, padH);
        vbW = layout.width;
        vbH = layout.height;
        const lh = FONT_PX * LINE_HEIGHT;
        layout.lines.forEach((line, i) => {
            const t = svgEl('text', { x: vbW / 2, y: lh * (i + 0.5) });
            t.setAttribute('xml:space', 'preserve');
            t.textContent = line;
            g.appendChild(t);
        });
    }

    // 余白分を viewBox に足して中央に配置
    const scale = Math.min(padW / vbW, padH / vbH);
    const fullW = boxW / scale;
    const fullH = boxH / scale;
    svg.setAttribute('viewBox', `${-(fullW - vbW) / 2} ${-(fullH - vbH) / 2} ${fullW} ${fullH}`);
    svg.appendChild(g);
    stage.replaceChildren(svg);
}

const SPEEDS = { slow: 0.6, normal: 1.1, fast: 2 }; // 1秒あたりに「画面の高さ（短辺）」の何倍進むか

function renderScroll(stage, text, settings, boxW, boxH) {
    const oneLine = text.split('\n').map((s) => s.trim()).filter(Boolean).join('　');
    const span = document.createElement('span');
    span.className = 'marquee-text' + (settings.vertical ? ' vertical' : '');
    span.textContent = oneLine;
    span.style.fontFamily = fontFamily(settings);
    span.style.fontWeight = String(FONTS[settings.font].weight);
    const cross = settings.vertical ? boxW : boxH;
    const travel = settings.vertical ? boxH : boxW;
    // 流れる方向の長さに対して文字が大きすぎると読めないので上限を付ける
    span.style.fontSize = `${Math.min(cross * 0.78, travel * 0.6)}px`;
    stage.replaceChildren(span);

    const length = settings.vertical ? span.offsetHeight : span.offsetWidth;
    const pxPerSec = Math.min(boxW, boxH) * SPEEDS[settings.speed];
    const axis = settings.vertical ? 'translateY' : 'translateX';
    const anim = span.animate(
        [{ transform: `${axis}(${travel}px)` }, { transform: `${axis}(${-length}px)` }],
        { duration: ((travel + length) / pxPerSec) * 1000, iterations: Infinity, easing: 'linear' }
    );
    return () => anim.cancel();
}

/** container に text を描画する。古い描画要求は無視する */
const renderTokens = new WeakMap();
const renderCleanups = new WeakMap();

async function renderInto(container, stage, text, settings, opts = {}) {
    const token = Symbol('render');
    renderTokens.set(container, token);
    await ensureFont(settings, text);
    if (renderTokens.get(container) !== token) return;

    renderCleanups.get(container)?.();
    renderCleanups.delete(container);

    measureCtx.font = cssFont(settings);
    applyStageStyle(container, stage, settings, opts);

    const boxW = container.clientWidth || window.innerWidth;
    const boxH = container.clientHeight || window.innerHeight;
    if (!text) {
        stage.replaceChildren();
        return;
    }
    if (settings.mode === 'scroll') {
        renderCleanups.set(container, renderScroll(stage, text, settings, boxW, boxH));
    } else {
        renderStatic(stage, text, settings, boxW, boxH);
    }
}

/* =========================================================
 * 入力画面
 * ======================================================= */

function currentText() {
    // 前後の空行は除くが、途中の空行は残す
    const v = el.textInput.value.replace(/\r\n?/g, '\n');
    if (!v.trim()) return '';
    return v.replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '');
}

let previewTimer = null;
function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        const text = currentText() || el.textInput.placeholder.replace('...', '');
        el.preview.classList.toggle('placeholder', !currentText());
        renderInto(el.preview, el.previewStage, text, state.settings);
    }, 120);
}

function onTextChanged() {
    store.set('lastText', el.textInput.value);
    updatePreview();
}

function saveSettings() {
    store.set('settings', state.settings);
}

function setSetting(key, value) {
    state.settings[key] = value;
    saveSettings();
    syncSettingsUI();
    updatePreview();
}

function buildColorPresets() {
    const frag = document.createDocumentFragment();
    for (const p of [...COLOR_PRESETS, { id: 'custom', name: 'カスタム' }]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.dataset.preset = p.id;
        b.title = p.name;
        b.setAttribute('aria-label', p.name);
        if (p.id === 'custom') {
            b.classList.add('swatch-custom');
            b.textContent = '＋';
        } else {
            b.textContent = 'あ';
            b.style.color = p.fg;
            b.style.backgroundColor = p.bg;
        }
        b.addEventListener('click', () => {
            if (p.id === 'custom') {
                state.settings.preset = 'custom';
            } else {
                Object.assign(state.settings, { preset: p.id, basePreset: p.id, fg: p.fg, bg: p.bg });
            }
            saveSettings();
            syncSettingsUI();
            updatePreview();
        });
        frag.appendChild(b);
    }
    el.colorPresets.replaceChildren(frag);
}

function syncSettingsUI() {
    const s = state.settings;
    for (const b of el.colorPresets.querySelectorAll('.swatch')) {
        b.setAttribute('aria-pressed', String(b.dataset.preset === s.preset));
    }
    const custom = el.colorPresets.querySelector('.swatch-custom');
    custom.style.color = s.fg;
    custom.style.backgroundColor = s.preset === 'custom' ? s.bg : '';
    el.customColors.hidden = s.preset !== 'custom';
    for (const chip of el.customColors.querySelectorAll('.color-chip')) {
        chip.querySelector('.chip-dot').style.backgroundColor = s[chip.dataset.target];
    }

    for (const group of document.querySelectorAll('.segmented')) {
        const key = group.dataset.setting;
        for (const b of group.querySelectorAll('button')) {
            b.setAttribute('aria-pressed', String(b.dataset.value === s[key]));
        }
    }
    for (const input of document.querySelectorAll('input[type=checkbox][data-setting]')) {
        input.checked = Boolean(s[input.dataset.setting]);
    }
    el.speedField.hidden = s.mode !== 'scroll';
}

function bindSettingsUI() {
    buildColorPresets();
    for (const group of document.querySelectorAll('.segmented')) {
        group.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (b) setSetting(group.dataset.setting, b.dataset.value);
        });
    }
    for (const input of document.querySelectorAll('input[type=checkbox][data-setting]')) {
        input.addEventListener('change', () => setSetting(input.dataset.setting, input.checked));
    }
    bindColorDialog();
    syncSettingsUI();
}

/* ---------- 色選びパネル ---------- */

const COLOR_TARGETS = {
    fg: { name: '文字', title: '文字の色' },
    bg: { name: '背景', title: '背景の色' },
};
// テーマの色 = プリセットに出てくる色（重複は除く）
const THEME_COLORS = [...new Set(COLOR_PRESETS.flatMap((p) => [p.fg, p.bg]))];

const ADJUST_DEFS = [
    { key: 'h', name: '色合い', max: 359, unit: '°', wrap: true },
    { key: 's', name: '鮮やかさ', max: 100, unit: '%' },
    { key: 'l', name: '明るさ', max: 100, unit: '%' },
];

const colorPanel = {
    target: 'fg',
    opened: null,   // 開いたときの { preset, fg, bg }
    hsl: { h: 0, s: 0, l: 0 },
    tuned: false,   // 微調整で色を変えたか（閉じたときに「最近使った色」に足す）
    rows: {},
};

// スライダーで作った色と数値の組。開き直したときに数値が 1 ずれないようにする
const hslMemo = new Map();

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function hexToHslFloat(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
}

// 色から整数の HSL を求める。戻すと同じ色になる整数の組を、計算値の近くから探す
function hslFor(hex) {
    if (hslMemo.has(hex)) return { ...hslMemo.get(hex) };
    const f = hexToHslFloat(hex);
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    const search = (sFrom, sTo) => {
        let best = null, bestDist = Infinity;
        for (let dh = -2; dh <= 2; dh++) {
            const h = (Math.round(f.h) + dh + 360) % 360;
            for (let s = sFrom; s <= sTo; s++) {
                for (let dl = -2; dl <= 2; dl++) {
                    const l = Math.round(f.l) + dl;
                    if (l < 0 || l > 100) continue;
                    if (hslToHex(h, s, l) !== hex) continue;
                    const hd = Math.min(Math.abs(h - f.h), 360 - Math.abs(h - f.h));
                    const dist = hd * hd + (s - f.s) ** 2 + (l - f.l) ** 2;
                    if (dist < bestDist) { best = { h, s, l }; bestDist = dist; }
                }
            }
        }
        return best;
    };
    const sr = Math.round(f.s);
    // ほぼ黒・ほぼ白では鮮やかさが大きくずれるので、見つからなければ全体を探す
    const found = search(clamp(sr - 2, 100), clamp(sr + 2, 100)) ?? search(0, 100);
    return found ?? { h: Math.round(f.h) % 360, s: clamp(sr, 100), l: clamp(Math.round(f.l), 100) };
}

function addRecentColor(hex) {
    state.recentColors = [hex, ...state.recentColors.filter((c) => c !== hex)].slice(0, RECENT_COLOR_LIMIT);
    store.set('recentColors', state.recentColors);
}

function basePreset() {
    return COLOR_PRESETS.find((p) => p.id === state.settings.basePreset) ?? COLOR_PRESETS[0];
}

// パネルで選んだ色を反映する。save が false のときは画面だけ変える（スライダーを動かしている間など）
function applyPanelColor(hex, { save = true, fromAdjust = false } = {}) {
    const s = state.settings;
    s[colorPanel.target] = hex;
    s.preset = 'custom';
    if (!fromAdjust) colorPanel.hsl = hslFor(hex);
    if (save) saveSettings();
    syncSettingsUI();
    updatePreview();
    renderColorPanel();
}

function colorButton(hex, label, onPick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cd-swatch';
    b.style.backgroundColor = hex;
    b.dataset.color = hex;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => onPick(hex));
    return b;
}

function buildColorPanelLists() {
    const s = state.settings;
    const target = colorPanel.target;

    el.cdRecentSection.hidden = state.recentColors.length === 0;
    el.cdRecent.replaceChildren(...state.recentColors.map((c) => colorButton(c, `最近使った色 ${c}`, (hex) => {
        addRecentColor(hex);
        applyPanelColor(hex);
        buildColorPanelLists();
        renderColorPanel();
    })));

    // ほかの項目と同じ色: 色の点と項目の名前を並べる
    const others = Object.keys(COLOR_TARGETS).filter((k) => k !== target);
    el.cdSame.replaceChildren(...others.map((k) => {
        const b = colorButton(s[k], `${COLOR_TARGETS[k].name}と同じ色 ${s[k]}`, (hex) => applyPanelColor(hex));
        b.className = 'cd-same-item';
        b.style.backgroundColor = '';
        const dot = document.createElement('span');
        dot.className = 'cd-dot';
        dot.style.backgroundColor = s[k];
        const name = document.createElement('span');
        name.textContent = COLOR_TARGETS[k].name;
        b.append(dot, name);
        return b;
    }));

    el.cdTheme.replaceChildren(...THEME_COLORS.map((c) => colorButton(c, `テーマの色 ${c}`, (hex) => applyPanelColor(hex))));
}

function buildAdjustRows() {
    const frag = document.createDocumentFragment();
    for (const def of ADJUST_DEFS) {
        const row = document.createElement('div');
        row.className = 'cd-row';
        row.innerHTML = `
            <div class="cd-row-head">
                <span class="cd-name">${def.name}</span>
                <span class="cd-stepper">
                    <button type="button" class="cd-step" data-delta="-1" aria-label="${def.name}を下げる">−</button>
                    <span class="cd-num-wrap"><input type="text" class="cd-num" inputmode="numeric" aria-label="${def.name}（0〜${def.max}）"><span class="cd-unit">${def.unit}</span></span>
                    <button type="button" class="cd-step" data-delta="1" aria-label="${def.name}を上げる">＋</button>
                </span>
            </div>
            <div class="cd-slider"><input type="range" min="0" max="${def.max}" step="1" aria-label="${def.name}"></div>`;
        const range = row.querySelector('input[type=range]');
        const num = row.querySelector('.cd-num');

        // スライダーの値から色を作る（色から読み直さない。灰色のとき色合いが 0 に飛ぶため）
        const setValue = (v, save) => {
            colorPanel.hsl[def.key] = v;
            colorPanel.tuned = true;
            const { h, s, l } = colorPanel.hsl;
            const hex = hslToHex(h, s, l);
            hslMemo.set(hex, { h, s, l });
            applyPanelColor(hex, { save, fromAdjust: true });
        };
        const stepBy = (delta) => {
            let v = colorPanel.hsl[def.key] + delta;
            v = def.wrap ? (v + def.max + 1) % (def.max + 1) : Math.max(0, Math.min(def.max, v));
            setValue(v, true);
        };

        range.addEventListener('input', () => setValue(Number(range.value), false));
        range.addEventListener('change', () => setValue(Number(range.value), true));

        num.addEventListener('focus', () => num.select());
        num.addEventListener('input', () => {
            const t = num.value.trim();
            if (!/^\d+$/.test(t)) return;
            const v = Number(t);
            if (v <= def.max) setValue(v, false);
        });
        const commitNum = () => {
            const v = parseInt(num.value, 10);
            const fixed = Number.isNaN(v) ? colorPanel.hsl[def.key] : Math.max(0, Math.min(def.max, v));
            num.value = String(fixed);
            setValue(fixed, true);
        };
        num.addEventListener('change', commitNum);
        num.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitNum(); num.select(); }
        });

        for (const b of row.querySelectorAll('.cd-step')) bindRepeatButton(b, () => stepBy(Number(b.dataset.delta)));

        colorPanel.rows[def.key] = { range, num, slider: row.querySelector('.cd-slider') };
        frag.appendChild(row);
    }
    el.cdAdjust.replaceChildren(frag);
}

// 押すと 1 回、長押しで続けて動く − / ＋
function bindRepeatButton(button, action) {
    let delayTimer = null, repeatTimer = null, fromPointer = false;
    const stop = () => {
        clearTimeout(delayTimer);
        clearInterval(repeatTimer);
        delayTimer = repeatTimer = null;
    };
    button.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        fromPointer = true;
        action();
        delayTimer = setTimeout(() => { repeatTimer = setInterval(action, 60); }, 400);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
    // キーボード（Enter・Space）で押されたとき
    button.addEventListener('click', () => {
        if (fromPointer) { fromPointer = false; return; }
        action();
    });
}

function renderColorPanel() {
    if (!el.colorDialog.open) return;
    const s = state.settings;
    const target = colorPanel.target;
    const hex = s[target];
    const { h, s: sat, l } = colorPanel.hsl;

    el.cdPreview.style.color = s.fg;
    el.cdPreview.style.backgroundColor = s.bg;
    el.cdHex.textContent = hex;

    // 選ばれている色に印（プリセットのままのときはどれにも付けない）
    const chosen = s.preset === 'custom' ? hex : null;
    for (const b of el.colorDialog.querySelectorAll('[data-color]')) {
        b.setAttribute('aria-pressed', String(b.dataset.color === chosen));
    }
    el.cdPicker.value = hex;

    const vals = { h, s: sat, l };
    const tracks = {
        h: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x}, ${sat}%, ${l}%)`).join(', ')})`,
        s: `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`,
        l: `linear-gradient(to right, hsl(${h}, ${sat}%, 0%), hsl(${h}, ${sat}%, 50%), hsl(${h}, ${sat}%, 100%))`,
    };
    for (const def of ADJUST_DEFS) {
        const row = colorPanel.rows[def.key];
        row.range.value = String(vals[def.key]);
        // 入力中の欄は書き換えない
        if (document.activeElement !== row.num) row.num.value = String(vals[def.key]);
        row.slider.style.setProperty('--track', tracks[def.key]);
        row.slider.style.setProperty('--cur', hex);
    }

    const o = colorPanel.opened;
    el.cdRevert.disabled = o.preset === s.preset && o.fg === s.fg && o.bg === s.bg;
    const base = basePreset();
    el.cdReset.textContent = `プリセット（${base.name}）の色に戻す`;
    el.cdReset.disabled = hex === base[target];
}

function openColorPanel(target) {
    const s = state.settings;
    // <dialog> の無い古いブラウザでは、端末の色選びを直接開く
    if (typeof el.colorDialog.showModal !== 'function') {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = s[target];
        input.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0;';
        document.body.appendChild(input);
        input.addEventListener('input', () => {
            const hex = normalizeHex(input.value);
            if (hex) setSetting(target, hex);
        });
        input.addEventListener('change', () => {
            const hex = normalizeHex(input.value);
            if (hex) addRecentColor(hex);
            input.remove();
        });
        input.click();
        return;
    }
    colorPanel.target = target;
    colorPanel.opened = { preset: s.preset, fg: s.fg, bg: s.bg };
    colorPanel.hsl = hslFor(s[target]);
    colorPanel.tuned = false;
    el.cdTitle.textContent = COLOR_TARGETS[target].title;
    el.colorDialog.showModal();
    buildColorPanelLists();
    renderColorPanel();
}

function refreshAfterPanelChange() {
    saveSettings();
    syncSettingsUI();
    updatePreview();
    buildColorPanelLists();
    renderColorPanel();
}

function bindColorDialog() {
    buildAdjustRows();
    for (const chip of el.customColors.querySelectorAll('.color-chip')) {
        chip.addEventListener('click', () => openColorPanel(chip.dataset.target));
    }
    el.cdClose.addEventListener('click', () => el.colorDialog.close());
    // 外側（暗い部分）を押したら閉じる
    el.colorDialog.addEventListener('click', (e) => {
        if (e.target === el.colorDialog) el.colorDialog.close();
    });
    // Esc・閉じるボタン・外側のどれで閉じても通る
    el.colorDialog.addEventListener('close', () => {
        const hex = state.settings[colorPanel.target];
        if (colorPanel.tuned && hex !== colorPanel.opened?.[colorPanel.target]) addRecentColor(hex);
        colorPanel.tuned = false;
        saveSettings();
    });

    el.cdPicker.addEventListener('input', () => {
        const hex = normalizeHex(el.cdPicker.value);
        if (hex) applyPanelColor(hex, { save: false });
    });
    el.cdPicker.addEventListener('change', () => {
        const hex = normalizeHex(el.cdPicker.value);
        if (!hex) return;
        addRecentColor(hex);
        applyPanelColor(hex);
        buildColorPanelLists();
        renderColorPanel();
    });

    el.cdRevert.addEventListener('click', () => {
        const o = colorPanel.opened;
        Object.assign(state.settings, { preset: o.preset, fg: o.fg, bg: o.bg });
        colorPanel.hsl = hslFor(o[colorPanel.target]);
        colorPanel.tuned = false;
        refreshAfterPanelChange();
    });

    el.cdReset.addEventListener('click', () => {
        const base = basePreset();
        const s = state.settings;
        s[colorPanel.target] = base[colorPanel.target];
        colorPanel.hsl = hslFor(s[colorPanel.target]);
        colorPanel.tuned = false;
        // 文字も背景もプリセットと同じになったら、そのプリセットを選んだ状態に戻す
        if (s.fg === base.fg && s.bg === base.bg) s.preset = base.id;
        refreshAfterPanelChange();
    });
}

/* ---------- お気に入り・履歴 ---------- */

function addHistory(text) {
    state.history = [text, ...state.history.filter((t) => t !== text)].slice(0, HISTORY_LIMIT);
    store.set('history', state.history);
    renderLists();
}

function toggleFavorite(text) {
    if (!text) return;
    if (state.favorites.includes(text)) {
        state.favorites = state.favorites.filter((t) => t !== text);
        toast('お気に入りから外しました');
    } else {
        state.favorites = [text, ...state.favorites];
        toast('お気に入りに追加しました');
    }
    store.set('favorites', state.favorites);
    renderLists();
}

function iconButton(label, svgPath, onClick, extraClass = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mini-button ${extraClass}`;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
}

const ICON_STAR = '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>';
const ICON_X = '<path d="M18 6L6 18M6 6l12 12"/>';
const ICON_EDIT = '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';

function renderList(ul, items, kind) {
    ul.replaceChildren();
    if (items.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = kind === 'favorites' ? '☆ボタンで、よく使う文を登録できます' : 'まだ履歴はありません';
        ul.appendChild(li);
        return;
    }
    items.forEach((text, i) => {
        const li = document.createElement('li');
        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'item-text';
        main.textContent = text;
        main.title = 'タップで表示';
        main.addEventListener('click', () => showDisplay(items, i));
        li.appendChild(main);
        li.appendChild(iconButton('入力欄に入れる', ICON_EDIT, () => {
            el.textInput.value = text;
            onTextChanged();
            el.textInput.focus();
        }));
        if (kind === 'history') {
            const fav = iconButton('お気に入り', ICON_STAR, () => toggleFavorite(text),
                state.favorites.includes(text) ? 'on' : '');
            li.appendChild(fav);
            li.appendChild(iconButton('履歴から消す', ICON_X, () => {
                state.history = state.history.filter((t) => t !== text);
                store.set('history', state.history);
                renderLists();
            }));
        } else {
            li.appendChild(iconButton('お気に入りから消す', ICON_X, () => toggleFavorite(text)));
        }
        ul.appendChild(li);
    });
}

function renderLists() {
    renderList(el.favoritesList, state.favorites, 'favorites');
    renderList(el.historyList, state.history, 'history');
    el.clearHistoryButton.hidden = el.historyList.hidden || state.history.length === 0;
    const text = currentText();
    el.favAddButton.classList.toggle('on', Boolean(text) && state.favorites.includes(text));
}

function bindLists() {
    for (const tab of document.querySelectorAll('.tab')) {
        tab.addEventListener('click', () => {
            for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
            el.favoritesList.hidden = tab.dataset.tab !== 'favorites';
            el.historyList.hidden = tab.dataset.tab !== 'history';
            renderLists();
        });
    }
    el.clearHistoryButton.addEventListener('click', () => {
        if (!confirm('履歴をすべて消しますか？')) return;
        state.history = [];
        store.set('history', state.history);
        renderLists();
    });
    renderLists();
}

/* ---------- 音声入力 ---------- */

function bindVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    el.micButton.hidden = false;
    let rec = null;
    el.micButton.addEventListener('click', () => {
        if (rec) { rec.stop(); return; }
        rec = new Recognition();
        rec.lang = 'ja-JP';
        rec.interimResults = false;
        rec.onresult = (e) => {
            const said = Array.from(e.results, (r) => r[0].transcript).join('');
            const cur = el.textInput.value;
            el.textInput.value = cur && !cur.endsWith('\n') ? `${cur}${said}` : cur + said;
            onTextChanged();
        };
        rec.onerror = (e) => {
            if (e.error === 'not-allowed') toast('マイクの使用が許可されていません');
            else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('音声入力に失敗しました');
        };
        rec.onend = () => {
            rec = null;
            el.micButton.classList.remove('listening');
        };
        el.micButton.classList.add('listening');
        toast('話してください');
        rec.start();
    });
}

/* ---------- 共有 ---------- */

function shareUrlFor(text) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('t', text);
    return url.toString();
}

async function share() {
    const text = currentText();
    if (!text) { toast('先に文字を入力してください'); return; }
    const url = shareUrlFor(text);
    if (navigator.share) {
        try {
            await navigator.share({ title: '大文字表示', url });
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        toast('共有用のURLをコピーしました');
    } catch {
        prompt('このURLをコピーしてください', url);
    }
}

/* ---------- トースト ---------- */

let toastTimer = null;
function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.toast.classList.remove('show');
        setTimeout(() => { el.toast.hidden = true; }, 300);
    }, 2000);
}

/* =========================================================
 * 表示画面
 * ======================================================= */

function renderDisplay() {
    const text = state.displayList[state.displayIndex] ?? '';
    renderInto(el.displayArea, el.displayStage, text, state.settings, { rotated: state.rotated });
    const many = state.displayList.length > 1;
    el.prevButton.hidden = !many;
    el.nextButton.hidden = !many;
    el.position.hidden = !many;
    el.position.textContent = `${state.displayIndex + 1} / ${state.displayList.length}`;
    el.displayHint.textContent = many
        ? 'ダブルタップで閉じる・左右スワイプで切り替え'
        : 'ダブルタップで閉じる';
}

/** list[index] を表示する。list を渡すとスワイプで前後に切り替えられる */
async function showDisplay(list, index = 0) {
    const text = list[index];
    if (!text) return;
    const fromHistory = list === state.history;
    addHistory(text);
    // 履歴から開いたときは、更新後の履歴の並び（選んだ文が先頭）に合わせる
    state.displayList = fromHistory ? state.history.slice() : list.slice();
    state.displayIndex = fromHistory ? 0 : index;
    state.rotated = false;
    state.displayActive = true;
    el.speakButton.hidden = !('speechSynthesis' in window);

    el.inputScreen.classList.remove('active');
    el.displayScreen.classList.add('active');
    el.textInput.blur();
    history.pushState({ display: true }, '');

    showControls();
    el.displayHint.classList.add('show');
    setTimeout(() => el.displayHint.classList.remove('show'), 2500);

    await enterFullscreen();
    renderDisplay();
    requestWakeLock();
    if (state.settings.speakOnShow) speak();
}

function showFromInput() {
    const text = currentText();
    if (!text) {
        el.textInput.focus();
        toast('文字を入力してください');
        return;
    }
    showDisplay([text], 0);
}

/** 「閉じる」操作。ブラウザ履歴を1つ戻し、popstate で実際に閉じる */
function requestClose() {
    if (!state.displayActive) return;
    if (history.state && history.state.display) {
        history.back();
    } else {
        closeDisplay();
    }
}

async function closeDisplay() {
    if (!state.displayActive) return;
    state.displayActive = false;
    el.displayScreen.classList.remove('active');
    el.inputScreen.classList.add('active');
    renderCleanups.get(el.displayArea)?.();
    renderCleanups.delete(el.displayArea);
    stopSpeaking();
    releaseWakeLock();
    await exitFullscreen();
    if (pendingReload) { location.reload(); return; }
    renderLists();
    if (matchMedia('(pointer: fine)').matches) el.textInput.focus();
}

function step(delta) {
    const n = state.displayList.length;
    if (n < 2) return;
    state.displayIndex = (state.displayIndex + delta + n) % n;
    stopSpeaking();
    renderDisplay();
    showControls();
    if (state.settings.speakOnShow) speak();
}

/* ---------- 操作ボタンの自動非表示 ---------- */

let controlsTimer = null;
function showControls() {
    el.controls.classList.add('show');
    el.displayScreen.classList.remove('hide-cursor');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
        el.controls.classList.remove('show');
        el.displayScreen.classList.add('hide-cursor');
    }, CONTROLS_HIDE_MS);
}

/* ---------- タップ・スワイプ・キー操作 ---------- */

function bindDisplayGestures() {
    let start = null;
    let lastTap = 0;

    el.displayArea.addEventListener('pointerdown', (e) => {
        start = { x: e.clientX, y: e.clientY };
    });
    el.displayArea.addEventListener('pointerup', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        start = null;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
            // 180度回転中は見ている人から見た向きに合わせて逆にする
            const dir = dx < 0 ? 1 : -1;
            step(state.rotated ? -dir : dir);
            lastTap = 0;
            return;
        }
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
            lastTap = 0;
            requestClose();
        } else {
            lastTap = now;
            showControls();
        }
    });
    el.displayArea.addEventListener('pointercancel', () => { start = null; });
    el.displayScreen.addEventListener('mousemove', showControls);

    el.controls.addEventListener('click', showControls);
    el.closeButton.addEventListener('click', requestClose);
    el.rotateButton.addEventListener('click', () => {
        state.rotated = !state.rotated;
        applyStageStyle(el.displayArea, el.displayStage, state.settings, { rotated: state.rotated });
    });
    el.speakButton.addEventListener('click', speak);
    el.prevButton.addEventListener('click', () => step(-1));
    el.nextButton.addEventListener('click', () => step(1));

    document.addEventListener('keydown', (e) => {
        if (!state.displayActive) return;
        if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
        else showControls();
    });

    // Android の戻るボタン・ブラウザの戻る操作
    window.addEventListener('popstate', () => {
        if (state.displayActive) closeDisplay();
    });

    // システム操作で全画面が解除されたら表示画面も閉じる
    const onFsChange = () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (!fs && state.enteredFullscreen) {
            state.enteredFullscreen = false;
            requestClose();
        }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    // 回転・サイズ変更時は折り返しを計算し直す
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (state.displayActive) renderDisplay();
            updatePreview();
        }, 120);
    });
}

/* ---------- 全画面・画面の向き ---------- */

async function enterFullscreen() {
    const root = document.documentElement;
    state.enteredFullscreen = false;
    // ホーム画面のアプリは最初から全画面なので不要。ブラウザでは設定がオンのときだけ
    if (state.settings.browserFullscreen && !isInstalledApp()) {
        try {
            if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
            else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
            state.enteredFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
        } catch { /* iOS Safari など全画面非対応 */ }
    }
    const orient = state.settings.orient;
    if (orient !== 'auto' && screen.orientation && screen.orientation.lock) {
        try {
            await screen.orientation.lock(orient);
        } catch { /* 対応していない端末では無視 */ }
    }
}

async function exitFullscreen() {
    try { screen.orientation?.unlock?.(); } catch { /* 無視 */ }
    state.enteredFullscreen = false;
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch { /* 無視 */ }
}

/* ---------- 画面の常時点灯 ---------- */

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 省電力モードなどで失敗することがある */ }
}

function releaseWakeLock() {
    state.wakeLock?.release().catch(() => {});
    state.wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
    // 別アプリから戻ってきたときに取り直す
    if (state.displayActive && document.visibilityState === 'visible') requestWakeLock();
});

/* ---------- 読み上げ ---------- */

function speak() {
    if (!('speechSynthesis' in window)) return;
    const text = state.displayList[state.displayIndex];
    if (!text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    speechSynthesis.speak(u);
}

function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/* =========================================================
 * 初期化
 * ======================================================= */

function init() {
    // 前回の入力を復元
    el.textInput.value = store.get('lastText', '');

    document.getElementById('app-version').textContent = `v${self.APP_VERSION || '?'}`;

    // ホーム画面のアプリでは常に全画面なので、全画面の設定は出さない
    document.getElementById('fullscreen-toggle').hidden = isInstalledApp();
    bindSettingsUI();
    bindLists();
    bindVoiceInput();
    bindDisplayGestures();

    el.textInput.addEventListener('input', () => { onTextChanged(); renderLists(); });
    el.textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            showFromInput();
        }
    });
    el.showButton.addEventListener('click', showFromInput);
    el.shareButton.addEventListener('click', share);
    el.clearButton.addEventListener('click', () => {
        el.textInput.value = '';
        onTextChanged();
        renderLists();
        el.textInput.focus();
    });
    el.favAddButton.addEventListener('click', () => {
        const text = currentText();
        if (!text) { toast('先に文字を入力してください'); return; }
        toggleFavorite(text);
    });

    // 共有URL（?t=...）で開かれたらすぐ表示
    const params = new URLSearchParams(location.search);
    const shared = params.get('t');
    if (shared) {
        el.textInput.value = shared;
        store.set('lastText', shared);
        history.replaceState(null, '', location.pathname);
        updatePreview();
        showDisplay([shared], 0);
    } else {
        updatePreview();
        if (matchMedia('(pointer: fine)').matches) el.textInput.focus();
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        // updateViaCache: 'none' … sw.js と、その中で読む version.js の更新確認でHTTPキャッシュを使わない
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    }

    // 起動時と、別アプリから戻ってきたときに新しい版がないか確認する
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
    });
}

/* ---------- 自動更新 ---------- */

async function checkForUpdate() {
    if (!/^https?:$/.test(location.protocol) || !navigator.onLine) return;
    try {
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
        const res = await fetch(`version.js?check=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const latest = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
        if (!latest || latest === self.APP_VERSION) return;

        // 同じ版への再読み込みは1回だけ（何らかの理由で更新できなくても無限ループしない）
        let tried = null;
        try { tried = sessionStorage.getItem(STORE_PREFIX + 'reloadedFor'); } catch { /* 無視 */ }
        if (tried === latest) return;
        try { sessionStorage.setItem(STORE_PREFIX + 'reloadedFor', latest); } catch { /* 無視 */ }

        if (state.displayActive) {
            // 表示中は邪魔しない。入力画面に戻ったときに更新する
            pendingReload = true;
        } else {
            location.reload();
        }
    } catch { /* オフラインなど */ }
}

let pendingReload = false;

init();
