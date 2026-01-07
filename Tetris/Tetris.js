(function() {
    'use strict';

    // 定数定義
    const CONSTANTS = {
        COLS: 10,
        ROWS: 20,
        BLOCK_SIZE: 30,
        INITIAL_DROP_INTERVAL: 1000,
        MIN_DROP_INTERVAL: 100,
        LEVEL_SPEED_DECREASE: 100,
        LINES_PER_LEVEL: 10,
        POINTS_PER_LINE: 100,
        PREVIEW_BLOCK_SIZE: 20,
        STORAGE_KEY: 'tetrisHighScore'
    };

    // キャンバス要素
    const canvas = document.getElementById('tetris');
    const ctx = canvas.getContext('2d');
    const nextCanvas = document.getElementById('nextCanvas');
    const nextCtx = nextCanvas.getContext('2d');
    const holdCanvas = document.getElementById('holdCanvas');
    const holdCtx = holdCanvas.getContext('2d');

    // ゲーム状態
    let score = 0;
    let highScore = loadHighScore();
    let level = 1;
    let lines = 0;
    let gameOver = false;
    let isPaused = false;
    let dropCounter = 0;
    let dropInterval = CONSTANTS.INITIAL_DROP_INTERVAL;
    let lastTime = 0;
    let canHold = true;
    let holdPiece = null;
    let nextPiece = null;

    // 色定義
    const colors = [
        null,
        '#ff006e', // T - ネオンピンク
        '#00f0ff', // I - ネオンシアン
        '#39ff14', // O - ネオングリーン
        '#7000ff', // L - ネオンパープル
        '#ff9500', // J - ネオンオレンジ
        '#fffc00', // Z - ネオンイエロー
        '#ff073a', // S - ネオンレッド
    ];

    // テトロミノ形状
    const shapes = [
        [],
        [[0,1,0], [1,1,1], [0,0,0]], // T
        [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]], // I
        [[1,1], [1,1]], // O
        [[0,0,1], [1,1,1], [0,0,0]], // L
        [[1,0,0], [1,1,1], [0,0,0]], // J
        [[1,1,0], [0,1,1], [0,0,0]], // Z
        [[0,1,1], [1,1,0], [0,0,0]], // S
    ];

    const arena = createMatrix(CONSTANTS.COLS, CONSTANTS.ROWS);

    const player = {
        pos: {x: 0, y: 0},
        matrix: null,
        color: 0
    };

    // グラデーションキャッシュ（パフォーマンス最適化）
    const gradientCache = new Map();

    // Web Audio API（効果音）
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();

    function playSound(frequency, duration, type = 'sine') {
        try {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = type;

            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + duration);
        } catch (e) {
            // 効果音の再生に失敗しても続行
            console.warn('Sound playback failed:', e);
        }
    }

    function playSoundMove() {
        playSound(200, 0.05, 'square');
    }

    function playSoundRotate() {
        playSound(300, 0.08, 'square');
    }

    function playSoundDrop() {
        playSound(150, 0.1, 'sine');
    }

    function playSoundLineClear() {
        playSound(500, 0.2, 'triangle');
        setTimeout(() => playSound(700, 0.2, 'triangle'), 100);
    }

    function playSoundGameOver() {
        playSound(200, 0.3, 'sawtooth');
        setTimeout(() => playSound(150, 0.3, 'sawtooth'), 150);
        setTimeout(() => playSound(100, 0.5, 'sawtooth'), 300);
    }

    // ハイスコア管理
    function loadHighScore() {
        try {
            const saved = localStorage.getItem(CONSTANTS.STORAGE_KEY);
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            console.warn('Failed to load high score:', e);
            return 0;
        }
    }

    function saveHighScore(newScore) {
        try {
            if (newScore > highScore) {
                highScore = newScore;
                localStorage.setItem(CONSTANTS.STORAGE_KEY, highScore.toString());
                return true;
            }
        } catch (e) {
            console.warn('Failed to save high score:', e);
        }
        return false;
    }

    // マトリックス作成
    function createMatrix(w, h) {
        const matrix = [];
        while (h--) {
            matrix.push(new Array(w).fill(0));
        }
        return matrix;
    }

    // ピース作成
    function createPiece(type) {
        return shapes[type].map(row => [...row]);
    }

    // ランダムなピースタイプを生成
    function getRandomPieceType() {
        const pieces = 'TIJLOZS';
        return pieces.indexOf(pieces[Math.floor(Math.random() * pieces.length)]) + 1;
    }

    // グラデーション取得（キャッシュ使用）
    function getGradient(posX, posY, color) {
        const key = `${posX},${posY},${color}`;
        if (!gradientCache.has(key)) {
            const gradient = ctx.createLinearGradient(
                posX, posY,
                posX + CONSTANTS.BLOCK_SIZE,
                posY + CONSTANTS.BLOCK_SIZE
            );
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
            gradientCache.set(key, gradient);
        }
        return gradientCache.get(key);
    }

    // マトリックス描画（最適化版）
    function drawMatrix(matrix, offset, color, context = ctx, blockSize = CONSTANTS.BLOCK_SIZE) {
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    const blockColor = color || colors[value];
                    const posX = (x + offset.x) * blockSize;
                    const posY = (y + offset.y) * blockSize;

                    // グロー効果
                    context.shadowBlur = 10;
                    context.shadowColor = blockColor;

                    // メインブロック
                    context.fillStyle = blockColor;
                    context.fillRect(posX, posY, blockSize, blockSize);

                    // 内側のハイライト
                    if (context === ctx) {
                        context.fillStyle = getGradient(posX, posY, blockColor);
                    } else {
                        const gradient = context.createLinearGradient(
                            posX, posY,
                            posX + blockSize,
                            posY + blockSize
                        );
                        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
                        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
                        context.fillStyle = gradient;
                    }
                    context.fillRect(posX, posY, blockSize, blockSize);

                    // ボーダー
                    context.shadowBlur = 0;
                    context.strokeStyle = blockColor;
                    context.lineWidth = 2;
                    context.strokeRect(posX, posY, blockSize, blockSize);
                }
            });
        });
    }

    // プレビュー描画
    function drawPreview(matrix, color, context, canvasWidth, canvasHeight) {
        context.shadowBlur = 0;
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fillRect(0, 0, canvasWidth, canvasHeight);

        if (matrix) {
            const offsetX = (canvasWidth / CONSTANTS.PREVIEW_BLOCK_SIZE - matrix[0].length) / 2;
            const offsetY = (canvasHeight / CONSTANTS.PREVIEW_BLOCK_SIZE - matrix.length) / 2;
            drawMatrix(matrix, {x: offsetX, y: offsetY}, color, context, CONSTANTS.PREVIEW_BLOCK_SIZE);
        }
        context.shadowBlur = 0;
    }

    // メイン描画
    function draw() {
        // メインキャンバス（ポーズ中は再描画しない）
        if (!isPaused) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            drawMatrix(arena, {x: 0, y: 0});
            if (player.matrix) {
                drawMatrix(player.matrix, player.pos, colors[player.color]);
            }
            ctx.shadowBlur = 0;
        }

        // Next プレビュー
        if (nextPiece) {
            drawPreview(
                shapes[nextPiece],
                colors[nextPiece],
                nextCtx,
                nextCanvas.width,
                nextCanvas.height
            );
        }

        // Hold プレビュー
        if (holdPiece) {
            drawPreview(
                shapes[holdPiece],
                colors[holdPiece],
                holdCtx,
                holdCanvas.width,
                holdCanvas.height
            );
        } else {
            holdCtx.shadowBlur = 0;
            holdCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
        }
    }

    // マージ
    function merge(arena, player) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    const arenaY = y + player.pos.y;
                    const arenaX = x + player.pos.x;
                    if (arena[arenaY] && arena[arenaY][arenaX] !== undefined) {
                        arena[arenaY][arenaX] = player.color;
                    }
                }
            });
        });
    }

    // 衝突判定
    function collide(arena, player) {
        const [m, o] = [player.matrix, player.pos];
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < m[y].length; ++x) {
                if (m[y][x] !== 0 &&
                    (arena[y + o.y] &&
                    arena[y + o.y][x + o.x]) !== 0) {
                    return true;
                }
            }
        }
        return false;
    }

    // 回転
    function rotate(matrix, dir) {
        const result = matrix.map((_, index) =>
            matrix.map(row => row[index])
        );
        if (dir > 0) {
            result.forEach(row => row.reverse());
        } else {
            result.reverse();
        }
        return result;
    }

    // プレイヤー回転
    function playerRotate(dir) {
        const pos = player.pos.x;
        let offset = 1;
        player.matrix = rotate(player.matrix, dir);
        while (collide(arena, player)) {
            player.pos.x += offset;
            offset = -(offset + (offset > 0 ? 1 : -1));
            if (offset > player.matrix[0].length) {
                player.matrix = rotate(player.matrix, -dir);
                player.pos.x = pos;
                return;
            }
        }
        playSoundRotate();
    }

    // プレイヤードロップ
    function playerDrop() {
        player.pos.y++;
        if (collide(arena, player)) {
            player.pos.y--;
            merge(arena, player);
            playSoundDrop();
            playerReset();
            arenaSweep();
            updateScore();
        }
        dropCounter = 0;
    }

    // ハードドロップ
    function playerHardDrop() {
        while (!collide(arena, player)) {
            player.pos.y++;
            score += 2; // ハードドロップボーナス
        }
        player.pos.y--;
        merge(arena, player);
        playSoundDrop();
        playerReset();
        arenaSweep();
        updateScore();
        dropCounter = 0;
    }

    // プレイヤー移動
    function playerMove(dir) {
        player.pos.x += dir;
        if (collide(arena, player)) {
            player.pos.x -= dir;
        } else {
            playSoundMove();
        }
    }

    // プレイヤーリセット
    function playerReset() {
        if (nextPiece === null) {
            nextPiece = getRandomPieceType();
        }

        player.color = nextPiece;
        player.matrix = createPiece(nextPiece);
        nextPiece = getRandomPieceType();

        player.pos.y = 0;
        player.pos.x = (CONSTANTS.COLS / 2 | 0) - (player.matrix[0].length / 2 | 0);

        canHold = true;

        if (collide(arena, player)) {
            endGame();
        }
    }

    // ホールド機能
    function playerHold() {
        if (!canHold) return;

        if (holdPiece === null) {
            holdPiece = player.color;
            playerReset();
        } else {
            const temp = holdPiece;
            holdPiece = player.color;
            player.color = temp;
            player.matrix = createPiece(temp);
            player.pos.y = 0;
            player.pos.x = (CONSTANTS.COLS / 2 | 0) - (player.matrix[0].length / 2 | 0);
        }

        canHold = false;
        playSoundRotate();
    }

    // ライン消去
    function arenaSweep() {
        let rowCount = 0;
        outer: for (let y = arena.length - 1; y >= 0; --y) {
            for (let x = 0; x < arena[y].length; ++x) {
                if (arena[y][x] === 0) {
                    continue outer;
                }
            }
            const row = arena.splice(y, 1)[0].fill(0);
            arena.unshift(row);
            ++y;
            rowCount++;
        }

        if (rowCount > 0) {
            lines += rowCount;
            score += rowCount * CONSTANTS.POINTS_PER_LINE * level;
            level = Math.floor(lines / CONSTANTS.LINES_PER_LEVEL) + 1;
            dropInterval = Math.max(
                CONSTANTS.MIN_DROP_INTERVAL,
                CONSTANTS.INITIAL_DROP_INTERVAL - (level - 1) * CONSTANTS.LEVEL_SPEED_DECREASE
            );
            playSoundLineClear();
        }
    }

    // スコア更新
    function updateScore() {
        document.getElementById('score').textContent = score;
        document.getElementById('level').textContent = level;
        document.getElementById('lines').textContent = lines;
        document.getElementById('highScore').textContent = highScore;

        saveHighScore(score);
    }

    // ゲーム終了
    function endGame() {
        gameOver = true;
        const isNewHighScore = saveHighScore(score);
        document.getElementById('finalScore').textContent = score + (isNewHighScore ? ' (NEW!)' : '');
        document.getElementById('gameOver').style.display = 'flex';
        playSoundGameOver();
    }

    // ゲーム再開
    function restartGame() {
        arena.forEach(row => row.fill(0));
        score = 0;
        level = 1;
        lines = 0;
        dropInterval = CONSTANTS.INITIAL_DROP_INTERVAL;
        gameOver = false;
        isPaused = false;
        canHold = true;
        holdPiece = null;
        nextPiece = null;
        updateScore();
        playerReset();
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('pauseOverlay').style.display = 'none';
    }

    // ポーズ切り替え
    function togglePause() {
        if (gameOver) return;
        isPaused = !isPaused;
        document.getElementById('pauseOverlay').style.display = isPaused ? 'flex' : 'none';
    }

    // メインループ
    function update(time = 0) {
        if (gameOver) {
            requestAnimationFrame(update);
            return;
        }

        if (isPaused) {
            requestAnimationFrame(update);
            return;
        }

        const deltaTime = time - lastTime;
        lastTime = time;

        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            playerDrop();
        }

        draw();
        requestAnimationFrame(update);
    }

    // キーボードイベント
    document.addEventListener('keydown', event => {
        if (gameOver) return;

        if (event.key === 'p' || event.key === 'P') {
            togglePause();
            return;
        }

        if (isPaused) return;

        switch(event.key) {
            case 'ArrowLeft':
                playerMove(-1);
                break;
            case 'ArrowRight':
                playerMove(1);
                break;
            case 'ArrowDown':
                playerDrop();
                break;
            case 'ArrowUp':
                event.preventDefault();
                playerRotate(1);
                break;
            case ' ':
                event.preventDefault();
                playerHardDrop();
                break;
            case 'c':
            case 'C':
                playerHold();
                break;
        }
    });

    // タッチ操作（モバイル対応）
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (gameOver || isPaused) return;

        const touch = e.changedTouches[0];
        const touchEndX = touch.clientX;
        const touchEndY = touch.clientY;
        const touchDuration = Date.now() - touchStartTime;

        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        // タップ（回転）
        if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10 && touchDuration < 200) {
            playerRotate(1);
            return;
        }

        // スワイプ
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // 横スワイプ
            if (deltaX > 30) {
                playerMove(1);
            } else if (deltaX < -30) {
                playerMove(-1);
            }
        } else {
            // 縦スワイプ
            if (deltaY > 30) {
                playerDrop();
            } else if (deltaY < -30) {
                playerHardDrop();
            }
        }
    });

    // グローバル関数として公開（HTMLから呼び出すため）
    window.restartGame = restartGame;

    // 初期化
    playerReset();
    updateScore();
    draw(); // 初期描画
    update();
})();
