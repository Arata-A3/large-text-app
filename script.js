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

    // SVGの場合はリサイズ時のJS計算は不要（CSSとviewBoxで自動調整される）
    // ただし、回転時に再描画が必要な場合のために監視は残す
    window.addEventListener('resize', () => {
        // 必要ならここで何かするが、SVGなら基本不要
    });
}

// テキスト表示モードへ
async function showText() {
    const text = textInput.value.trim();
    if (!text) return;

    inputScreen.classList.remove('active');
    displayScreen.classList.add('active');

    // SVGで文字を描画する
    renderTextAsSVG(text);

    // フルスクリーン化
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            await document.documentElement.webkitRequestFullscreen(); // iOS Safari
        }
    } catch (e) {
        console.log('Fullscreen failed:', e);
    }

    // 画面常時点灯
    requestWakeLock();
}

// テキストをSVGとして描画する関数
// これにより、JSでの複雑なフォントサイズ計算なしに、画面いっぱいに文字を表示できる
function renderTextAsSVG(text) {
    displayText.innerHTML = '';

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.width = "100%";
    svg.style.height = "100%";

    const textNode = document.createElementNS(svgNS, "text");
    textNode.setAttribute("fill", "#ffffff");
    textNode.setAttribute("text-anchor", "middle"); // 横方向の中央揃え
    textNode.setAttribute("dominant-baseline", "central"); // 縦方向の中央揃え
    textNode.setAttribute("font-weight", "900"); // 太字
    // SVG内でのフォントサイズはviewBox計算用なので仮の値で良い
    textNode.setAttribute("font-size", "100");

    // 改行処理（単純な改行コードでの分割）
    const lines = text.split('\n');

    // 改行がない場合でも、文字数が多ければ自動折り返しをしたいが、
    // SVGで自動折り返しは複雑。
    // そのため、「短い単語は1行」「長い文章はユーザーが改行入れるか、簡易的に文字数で割る」アプローチにするか、
    // あるいは「行数」だけはユーザー入力通りにするのが最も直感的。
    // 今回は「ユーザー入力通り」を基本としつつ、
    // 余りにも長い1行は画面からはみ出ることはないが（縮小されるため）、縦に細長くなる。
    // それを防ぐための「自動改行ロジック」は、SVG化すると逆に難しくなるため、
    // まずは「入力通り」で実装する。

    lines.forEach((line, index) => {
        const tspan = document.createElementNS(svgNS, "tspan");
        tspan.textContent = line;
        tspan.setAttribute("x", "0"); // 中央揃え(text-anchor=middleなので0が中心になるようviewBox調整する)

        // 行間調整: 1行目は0、それ以降は行の高さ分ずらす
        // font-size 100 に対して、行間 100〜120 くらい
        tspan.setAttribute("dy", index === 0 ? "0" : "1.1em");

        textNode.appendChild(tspan);
    });

    svg.appendChild(textNode);
    displayText.appendChild(svg);

    // レンダリング後にバウンディングボックスを取得してviewBoxを設定
    // これが「画面いっぱいに表示」のキモ
    requestAnimationFrame(() => {
        try {
            const bbox = textNode.getBBox();
            // 少し余白を持たせる（文字が画面端にくっつきすぎないように）
            const paddingX = bbox.width * 0.05; // 左右5%
            const paddingY = bbox.height * 0.05; // 上下5%

            const viewBoxX = bbox.x - paddingX;
            const viewBoxY = bbox.y - paddingY;
            const viewBoxW = bbox.width + paddingX * 2;
            const viewBoxH = bbox.height + paddingY * 2;

            svg.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`);
        } catch (e) {
            console.error("SVG BBox error:", e);
        }
    });
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

// Wake Lock API
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released');
            });
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

document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
    }
});

init();
