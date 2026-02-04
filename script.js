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

    // spanリセット等はadjustFontSizeで行うため、ここでは単純にテキストセット...はしない
    // adjustFontSizeがテキストを入力から取得する仕様に変更したため、ここはクラス切り替えだけでOKだが
    // 念のためテキストが存在することを確認済み

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

    // 文字サイズ調整（念のため複数回実行して、キーボード閉鎖後のレイアウト変更に追従）
    adjustFontSize();
    setTimeout(adjustFontSize, 100);
    setTimeout(adjustFontSize, 500);
    setTimeout(adjustFontSize, 1000);
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
function adjustFontSize() {
    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;

    // パディングは極小に
    const availableWidth = containerWidth;
    const availableHeight = containerHeight;

    // テキスト測定用のSpanを作成（既存のコンテンツを一旦クリアして再構築）
    // これにより、コンテナ自体のサイズ制限に影響されずに純粋なテキストサイズを測れる
    const text = textInput.value.trim();
    // もし空なら何もしない
    if (!text) return;

    displayText.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    // 計測中レイアウトが崩れないようにとりあえずspan追加
    displayText.appendChild(span);

    // 1. 改行なし（nowrap）での最大サイズを計算
    span.style.whiteSpace = 'nowrap';
    const sizeNoWrap = calculateMaxFontSize(span, availableWidth, availableHeight);

    // 2. 改行あり（pre-wrap + break-all）での最大サイズを計算
    span.style.whiteSpace = 'pre-wrap';
    span.style.wordBreak = 'break-all';
    const sizeWrap = calculateMaxFontSize(span, availableWidth, availableHeight);

    // 判定ロジック
    // 改行なしのサイズが、改行ありのサイズの 90% 以上あれば、改行なしを採用する。
    const hasLineBreaks = text.includes('\n');

    if (!hasLineBreaks && sizeNoWrap > sizeWrap * 0.9) {
        // 改行なしを採用
        span.style.whiteSpace = 'nowrap';
        span.style.fontSize = `${sizeNoWrap}px`;
    } else {
        // 改行ありを採用
        span.style.whiteSpace = 'pre-wrap';
        span.style.wordBreak = 'break-all';
        span.style.fontSize = `${sizeWrap}px`;
    }
}

// 指定された条件での最大フォントサイズを計算するヘルパー関数
function calculateMaxFontSize(element, maxWidth, maxHeight) {
    let low = 10;
    let high = 5000;
    let optimum = 10;

    for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        element.style.fontSize = `${mid}px`;

        // getBoundingClientRect().width/height はより正確
        const rect = element.getBoundingClientRect();

        // 許容誤差を少し持たせる（<=）
        if (rect.width <= maxWidth && rect.height <= maxHeight) {
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
