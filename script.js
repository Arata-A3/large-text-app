// DOM要素
const inputScreen = document.getElementById('input-screen');
const displayScreen = document.getElementById('display-screen');
const textInput = document.getElementById('text-input');
const showButton = document.getElementById('show-button');
const closeButton = document.getElementById('close-button');
const displayText = document.getElementById('display-text');

let wakeLock = null;

// アプリの初期化
function init() {
    showButton.addEventListener('click', showText);
    closeButton.addEventListener('click', hideText);

    // リサイズ時に文字サイズを再調整
    window.addEventListener('resize', () => {
        if (displayScreen.classList.contains('active')) {
            requestAnimationFrame(adjustFontSize);
        }
    });

    // 画面回転時も調整
    window.addEventListener('orientationchange', () => {
        if (displayScreen.classList.contains('active')) {
            // 回転直後はサイズが正しく取得できないことがあるため少し待つ
            setTimeout(adjustFontSize, 100);
            setTimeout(adjustFontSize, 500);
        }
    });
}

// テキスト表示モードへ
async function showText() {
    const text = textInput.value.trim();
    if (!text) return;

    displayText.textContent = text;

    inputScreen.classList.remove('active');
    displayScreen.classList.add('active');

    // フルスクリーン化（ユーザーアクション起点）
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            await document.documentElement.webkitRequestFullscreen(); // iOS Safari
        }
    } catch (e) {
        console.log('Fullscreen failed:', e);
    }

    // 画面常時点灯 (Wake Lock)
    requestWakeLock();

    // 文字サイズ調整
    adjustFontSize();
}

// 入力モードへ戻る
async function hideText() {
    displayScreen.classList.remove('active');
    inputScreen.classList.add('active');

    // フルスクリーン解除
    try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            }
        }
    } catch (e) {
        console.log('Exit fullscreen failed:', e);
    }

    // Wake Lock 解除
    releaseWakeLock();
}

// 文字サイズを画面に合わせて最大化するロジック
// 文字サイズを画面に合わせて最大化するロジック
function adjustFontSize() {
    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;

    // パディングは極小に
    const availableWidth = containerWidth;
    const availableHeight = containerHeight;

    // 1. 改行なし（nowrap）での最大サイズを計算
    displayText.style.whiteSpace = 'nowrap';
    const sizeNoWrap = calculateMaxFontSize(availableWidth, availableHeight, true);

    // 2. 改行あり（pre-wrap + break-all）での最大サイズを計算
    displayText.style.whiteSpace = 'pre-wrap';
    displayText.style.wordBreak = 'break-all';
    const sizeWrap = calculateMaxFontSize(availableWidth, availableHeight, false);

    // 判定ロジック：
    // 改行なしのサイズが、改行ありのサイズの 40% 以上あれば、改行なしを採用する。
    // （一行で表示できるなら、多少小さくても一行の方が綺麗に見えることが多いため）
    // ただし、ユーザーが明示的に改行コードを入力している場合はそれに従うため、
    // 入力テキストに改行が含まれているかは考慮済み（pre-wrapなら改行される）

    // 入力テキスト自体に改行が含まれている場合の考慮
    const hasLineBreaks = textInput.value.includes('\n');

    if (!hasLineBreaks && sizeNoWrap > sizeWrap * 0.4) {
        // 改行なしを採用
        displayText.style.whiteSpace = 'nowrap';
        // word-breakはnowrap時は関係ないが念のため
        displayText.style.fontSize = `${sizeNoWrap}px`;
    } else {
        // 改行ありを採用
        displayText.style.whiteSpace = 'pre-wrap';
        displayText.style.wordBreak = 'break-all';
        displayText.style.fontSize = `${sizeWrap}px`;
    }
}

// 指定された条件での最大フォントサイズを計算するヘルパー関数
function calculateMaxFontSize(maxWidth, maxHeight, isNoWrap) {
    let low = 10;
    let high = 5000;
    let optimum = 10;

    // 現在のスタイル設定（whiteSpaces等）のまま計算するので、
    // 呼び出し元でスタイルをセットしてから呼ぶこと。

    for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        displayText.style.fontSize = `${mid}px`;

        // scrollWidth/Height は内容の実際のサイズ
        // わずかな誤差許容のため -1 しておくなどの調整も可
        if (displayText.scrollWidth <= maxWidth && displayText.scrollHeight <= maxHeight) {
            optimum = mid;
            low = mid;
        } else {
            high = mid;
        }
    }
    return optimum;
}

// Wake Lock API (画面消灯防止)
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released');
            });
            console.log('Wake Lock active');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release()
            .then(() => {
                wakeLock = null;
            });
    }
}

// OSによってWake Lockが解除された場合（タブ切り替えなど）、再取得を試みる
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
    }
});

init();
