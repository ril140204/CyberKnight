/**
 * CYBERKNIGHT — "LƯỚI LỌC AN TOÀN" (SAFETY CATCH)
 * Module Mini-game Tương Tác Phân Loại Vật Phẩm Rơi Dành Cho Trẻ Em
 * Data-driven, Reusable, Touch/Mouse/Keyboard Friendly, Zero External Dependencies
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SafetyCatchGame = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // 1. DATA-DRIVEN DEFAULT CONFIGURATION CHO LEVEL 1
    // =========================================================================

    const DEFAULT_CONFIG = {
        durationSeconds: 28,
        maxActiveItems: 2,         // Tối đa 2-3 item cùng lúc trên màn hình
        spawnIntervalMin: 1800,    // Khoảng thời gian xuất hiện giữa các item (ms)
        spawnIntervalMax: 2600,
        baseSpeed: 1.15,           // Tốc độ rơi cơ bản (px / frame ở 60fps)
        speedIncrement: 0.08,      // Gia tốc tăng dần nhẹ theo thời gian
        basketLeft: {
            id: 'left',
            label: 'AN TOÀN – GIỮ LẠI',
            icon: '🛡️',
            color: '#22C55E',      // var(--cyber-good)
            bg: '#E8FFE8'
        },
        basketRight: {
            id: 'right',
            label: 'DỪNG LẠI – KHÔNG LÀM',
            icon: '🛑',
            color: '#FF3366',      // var(--cyber-bad)
            bg: '#FFF0F0'
        },
        items: [
            { id: 1, icon: '🔗', text: 'Link quà tặng lạ, chưa rõ nguồn', correctBasket: 'right' },
            { id: 2, icon: '📚', text: 'Tin nhắn hỏi bài tập từ bạn cùng lớp', correctBasket: 'left' },
            { id: 3, icon: '🏠', text: 'Yêu cầu điền địa chỉ nhà để nhận quà', correctBasket: 'right' },
            { id: 4, icon: '📷', text: 'Ảnh cả lớp chụp buổi dã ngoại', correctBasket: 'left' },
            { id: 5, icon: '⏰', text: 'Tin nhắn thúc giục "Nhanh lên, chỉ hôm nay thôi!"', correctBasket: 'right' },
            { id: 6, icon: '👩‍🏫', text: 'Thông báo bài tập về nhà từ cô giáo', correctBasket: 'left' },
            { id: 7, icon: '🌐', text: 'Trang web lạ không phải của trường', correctBasket: 'right' },
            { id: 8, icon: '🎮', text: 'Lời mời chơi game cùng nhóm lớp', correctBasket: 'left' }
        ],
        onCorrect: null,           // Callback (item, combo) => {}
        onIncorrect: null,         // Callback (item) => {}
        onMissed: null,            // Callback (item) => {}
        onComplete: null           // Callback (stats) => {}
    };

    // =========================================================================
    // 2. SAFETY CATCH ENGINE CLASS
    // =========================================================================

    class SafetyCatchEngine {
        constructor(containerEl, customConfig = {}) {
            this.container = typeof containerEl === 'string'
                ? document.querySelector(containerEl)
                : containerEl;

            this.config = Object.assign({}, DEFAULT_CONFIG, customConfig);
            if (customConfig.basketLeft) {
                this.config.basketLeft = Object.assign({}, DEFAULT_CONFIG.basketLeft, customConfig.basketLeft);
            }
            if (customConfig.basketRight) {
                this.config.basketRight = Object.assign({}, DEFAULT_CONFIG.basketRight, customConfig.basketRight);
            }

            this.isRunning = false;
            this.remainingSeconds = this.config.durationSeconds;
            this.timerInterval = null;
            this.animFrameId = null;
            this.spawnTimeout = null;

            // Stats
            this.stats = {
                correctCount: 0,
                incorrectCount: 0,
                missedCount: 0,
                currentCombo: 0,
                maxCombo: 0,
                totalCaught: 0
            };

            // Active items on screen
            this.activeItems = [];
            this.itemPool = [];
            this.nextItemId = 0;

            // DOM References inside container
            this.arenaEl = null;
            this.basketLeftEl = null;
            this.basketRightEl = null;
            this.timerTextEl = null;
            this.timerCircleEl = null;
            this.scoreTextEl = null;
            this.comboBadgeEl = null;
            this.encouragementCardEl = null;

            // Drag / Touch Tracking State
            this.dragState = {
                item: null,
                startX: 0,
                startY: 0,
                currentX: 0,
                currentY: 0,
                offsetX: 0,
                offsetY: 0,
                isDragging: false
            };

            // Bound event handlers for cleanup
            this._onPointerMove = this.onPointerMove.bind(this);
            this._onPointerUp = this.onPointerUp.bind(this);
            this._onKeyDown = this.onKeyDown.bind(this);

            this.buildDOM();
        }

        // =====================================================================
        // DOM BUILDER
        // =====================================================================

        buildDOM() {
            if (!this.container) return;
            this.container.innerHTML = '';
            this.container.classList.add('safety-catch-wrapper');

            // 1. Header: Score, Combo & Timer
            const header = document.createElement('div');
            header.className = 'sc-header';
            header.innerHTML = `
                <div class="sc-header-left">
                    <div class="sc-badge-title">
                        <span class="sc-badge-icon">🛡️</span>
                        <span class="sc-badge-text">LƯỚI LỌC AN TOÀN</span>
                    </div>
                    <div class="sc-score-tracker">
                        <span class="sc-score-label">ĐÃ BẮT:</span>
                        <span class="sc-score-val" id="sc-score-val">0</span>
                        <span class="sc-combo-chip hidden" id="sc-combo-chip">🔥 Combo x2</span>
                    </div>
                </div>

                <div class="sc-header-center">
                    <div class="sc-timer-box" title="Thời gian còn lại">
                        <svg class="sc-timer-svg" viewBox="0 0 54 54">
                            <circle class="sc-timer-bg" cx="27" cy="27" r="23"></circle>
                            <circle class="sc-timer-progress" id="sc-timer-progress" cx="27" cy="27" r="23"></circle>
                        </svg>
                        <span class="sc-timer-text" id="sc-timer-text">${this.config.durationSeconds}</span>
                    </div>
                </div>

                <div class="sc-header-right">
                    <button type="button" class="sc-btn-skip-game" id="sc-btn-skip-game" title="Tự quyết định ngay">
                        <span>⚖️ TÔI QUYẾT ĐỊNH RỒI →</span>
                    </button>
                </div>
            `;
            this.container.appendChild(header);

            // 2. Play Arena (Khu vực đồ rơi & Giỏ hứng)
            const arena = document.createElement('div');
            arena.className = 'sc-arena';
            arena.id = 'sc-arena';
            arena.innerHTML = `
                <!-- Hướng dẫn cử chỉ trực quan -->
                <div class="sc-gesture-hint" id="sc-gesture-hint">
                    <span>👈 KÉO VẬT PHẨM VÀO GIỎ PHÙ HỢP 👉</span>
                </div>

                <!-- Particle canvas for bursts -->
                <canvas class="sc-particle-canvas" id="sc-particle-canvas"></canvas>

                <!-- Giỏ Trái: An Toàn -->
                <div class="sc-basket sc-basket-left" id="sc-basket-left" data-basket="left">
                    <div class="sc-basket-glow"></div>
                    <div class="sc-basket-icon">${this.config.basketLeft.icon}</div>
                    <div class="sc-basket-label">${this.config.basketLeft.label}</div>
                    <div class="sc-basket-sublabel">Vuốt trái ⬅️</div>
                </div>

                <!-- Giỏ Phải: Nguy Hiểm / Dừng Lại -->
                <div class="sc-basket sc-basket-right" id="sc-basket-right" data-basket="right">
                    <div class="sc-basket-glow"></div>
                    <div class="sc-basket-icon">${this.config.basketRight.icon}</div>
                    <div class="sc-basket-label">${this.config.basketRight.label}</div>
                    <div class="sc-basket-sublabel">Vuốt phải ➡️</div>
                </div>

                <!-- Container chứa các item đang rơi -->
                <div class="sc-falling-layer" id="sc-falling-layer"></div>

                <!-- Modal / Card khích lệ cuối trận -->
                <div class="sc-encouragement-card hidden" id="sc-encouragement-card">
                    <div class="sc-card-avatar">🏆</div>
                    <h3 class="sc-card-title">HOÀN THÀNH LƯỚI LỌC!</h3>
                    <p class="sc-card-desc">Con đã phân loại rất nhanh như một Hiệp Sĩ Mạng nhí!</p>
                    <div class="sc-card-stats">
                        <div class="sc-stat-pill">
                            <span class="sc-stat-icon">✅</span>
                            <span>Bắt đúng: <b id="sc-stat-correct">0</b></span>
                        </div>
                        <div class="sc-stat-pill">
                            <span class="sc-stat-icon">🔥</span>
                            <span>Combo đỉnh: <b id="sc-stat-combo">0</b></span>
                        </div>
                    </div>
                    <div class="sc-card-transition-note">
                        <span>Đang chuyển sang màn quyết định...</span>
                    </div>
                </div>
            `;
            this.container.appendChild(arena);

            // Lưu tham chiếu DOM
            this.arenaEl = arena;
            this.basketLeftEl = arena.querySelector('#sc-basket-left');
            this.basketRightEl = arena.querySelector('#sc-basket-right');
            this.fallingLayerEl = arena.querySelector('#sc-falling-layer');
            this.timerTextEl = header.querySelector('#sc-timer-text');
            this.timerCircleEl = header.querySelector('#sc-timer-progress');
            this.scoreTextEl = header.querySelector('#sc-score-val');
            this.comboBadgeEl = header.querySelector('#sc-combo-chip');
            this.encouragementCardEl = arena.querySelector('#sc-encouragement-card');
            this.btnSkipGame = header.querySelector('#sc-btn-skip-game');

            // Nút "Tôi quyết định rồi"
            if (this.btnSkipGame) {
                this.btnSkipGame.addEventListener('click', () => {
                    this.endGame(true);
                });
            }

            // Canvas hạt nảy
            this.canvas = arena.querySelector('#sc-particle-canvas');
            if (this.canvas) {
                this.ctx = this.canvas.getContext('2d');
                this.resizeCanvas();
                window.addEventListener('resize', () => this.resizeCanvas());
            }

            // Gán pointer events toàn cục cho Drag & Drop
            window.addEventListener('mousemove', this._onPointerMove);
            window.addEventListener('mouseup', this._onPointerUp);
            window.addEventListener('touchmove', this._onPointerMove, { passive: false });
            window.addEventListener('touchend', this._onPointerUp);
            window.addEventListener('keydown', this._onKeyDown);
        }

        resizeCanvas() {
            if (!this.canvas || !this.arenaEl) return;
            const rect = this.arenaEl.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
        }

        // =====================================================================
        // GAME LIFECYCLE
        // =====================================================================

        start() {
            this.reset();
            this.isRunning = true;
            this.remainingSeconds = this.config.durationSeconds;
            this.updateHeaderUI();

            // Shuffle pool vật phẩm
            this.refillItemPool();

            // Khởi động đồng hồ đếm ngược 28s
            this.startTimer();

            // Lập lịch spawn item đầu tiên ngay lập tức
            this.spawnNextItem();

            // Bắt đầu vòng lặp chuyển động 60fps
            this.lastFrameTime = performance.now();
            this.particles = [];
            this.animFrameId = requestAnimationFrame(this.gameLoop.bind(this));
        }

        reset() {
            this.isRunning = false;
            clearInterval(this.timerInterval);
            clearTimeout(this.spawnTimeout);
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }

            // Dọn dẹp DOM các item đang rơi
            if (this.fallingLayerEl) {
                this.fallingLayerEl.innerHTML = '';
            }
            this.activeItems = [];
            this.dragState.item = null;
            this.dragState.isDragging = false;

            // Reset stats
            this.stats = {
                correctCount: 0,
                incorrectCount: 0,
                missedCount: 0,
                currentCombo: 0,
                maxCombo: 0,
                totalCaught: 0
            };

            if (this.encouragementCardEl) {
                this.encouragementCardEl.classList.add('hidden');
            }

            const hint = document.getElementById('sc-gesture-hint');
            if (hint) {
                hint.style.opacity = '1';
            }
        }

        refillItemPool() {
            // Nhân bản và xáo trộn ngẫu nhiên danh sách 8 items
            const source = [...this.config.items];
            for (let i = source.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [source[i], source[j]] = [source[j], source[i]];
            }
            this.itemPool = source;
        }

        getNextItemData() {
            if (this.itemPool.length === 0) {
                this.refillItemPool();
            }
            return this.itemPool.pop();
        }

        // =====================================================================
        // TIMER & SPAWN LOGIC
        // =====================================================================

        startTimer() {
            const total = this.config.durationSeconds;
            const perimeter = 2 * Math.PI * 23; // r = 23 => ~144.5

            if (this.timerCircleEl) {
                this.timerCircleEl.style.strokeDasharray = `${perimeter}`;
                this.timerCircleEl.style.strokeDashoffset = '0';
            }

            this.timerInterval = setInterval(() => {
                if (!this.isRunning) return;
                this.remainingSeconds--;

                if (this.timerTextEl) {
                    this.timerTextEl.textContent = this.remainingSeconds;
                }

                if (this.timerCircleEl) {
                    const offset = perimeter - (this.remainingSeconds / total) * perimeter;
                    this.timerCircleEl.style.strokeDashoffset = `${offset}`;
                    if (this.remainingSeconds <= 5) {
                        this.timerCircleEl.classList.add('danger');
                    }
                }

                if (this.remainingSeconds <= 0) {
                    clearInterval(this.timerInterval);
                    this.endGame(false);
                }
            }, 1000);
        }

        scheduleNextSpawn() {
            if (!this.isRunning || this.remainingSeconds <= 1) return;

            // Giới hạn tối đa 2-3 items cùng xuất hiện trên màn hình
            if (this.activeItems.length >= this.config.maxActiveItems) {
                this.spawnTimeout = setTimeout(() => {
                    this.scheduleNextSpawn();
                }, 400);
                return;
            }

            const min = this.config.spawnIntervalMin;
            const max = this.config.spawnIntervalMax;
            const delay = Math.random() * (max - min) + min;

            this.spawnTimeout = setTimeout(() => {
                this.spawnNextItem();
                this.scheduleNextSpawn();
            }, delay);
        }

        spawnNextItem() {
            if (!this.isRunning || !this.arenaEl || !this.fallingLayerEl) return;
            if (this.activeItems.length >= this.config.maxActiveItems) return;

            const itemData = this.getNextItemData();
            const arenaRect = this.arenaEl.getBoundingClientRect();
            const arenaWidth = arenaRect.width || 600;

            // Vị trí ngang ban đầu: dao động trong khoảng giữa (30% đến 70%)
            const spawnMargin = 120;
            const minX = spawnMargin;
            const maxX = Math.max(minX + 80, arenaWidth - spawnMargin);
            const initialX = Math.random() * (maxX - minX) + minX;

            const itemObj = {
                id: ++this.nextItemId,
                data: itemData,
                x: initialX,
                y: -60,
                baseX: initialX,
                swayAmplitude: Math.random() * 14 + 18,    // Sin wave dao động 18 - 32px
                swaySpeed: Math.random() * 0.035 + 0.025,
                swayPhase: Math.random() * Math.PI * 2,
                speedY: this.config.baseSpeed + (1 - this.remainingSeconds / this.config.durationSeconds) * this.config.speedIncrement * 4,
                isDragged: false,
                isResolving: false,
                el: null
            };

            // Tạo phần tử DOM đại diện cho item
            const el = document.createElement('div');
            el.className = 'sc-item';
            el.setAttribute('data-id', itemObj.id);
            el.setAttribute('tabindex', '0');
            el.innerHTML = `
                <div class="sc-item-glow"></div>
                <div class="sc-item-icon">${itemData.icon}</div>
                <div class="sc-item-text">${itemData.text}</div>
                <div class="sc-item-arrows">
                    <span class="sc-arrow-left">◀ AN TOÀN</span>
                    <span class="sc-arrow-right">NGUY HIỂM ▶</span>
                </div>
            `;

            // Gán pointerdown trên item để drag
            el.addEventListener('mousedown', (e) => this.onItemPointerDown(e, itemObj));
            el.addEventListener('touchstart', (e) => this.onItemPointerDown(e, itemObj), { passive: false });

            this.fallingLayerEl.appendChild(el);
            itemObj.el = el;
            this.activeItems.push(itemObj);

            // Cập nhật vị trí tức thời
            this.renderItemTransform(itemObj);
        }

        // =====================================================================
        // PHYSICS & GAME LOOP (60 FPS)
        // =====================================================================

        gameLoop(now) {
            if (!this.isRunning) return;

            const dt = Math.min(32, now - (this.lastFrameTime || now));
            this.lastFrameTime = now;

            const arenaHeight = this.arenaEl ? this.arenaEl.clientHeight : 500;

            for (let i = this.activeItems.length - 1; i >= 0; i--) {
                const item = this.activeItems[i];

                if (item.isResolving) continue;

                // Nếu người chơi đang kéo thả, vị trí do con trỏ chuột quyết định
                if (item.isDragged) {
                    continue;
                }

                // Cập nhật toạ độ rơi và dao động ngang hình sin
                item.y += item.speedY * (dt / 16.6);
                item.swayPhase += item.swaySpeed * (dt / 16.6);
                item.x = item.baseX + Math.sin(item.swayPhase) * item.swayAmplitude;

                this.renderItemTransform(item);

                // Kiểm tra rơi chạm đáy màn hình (Missed trung lập - không phạt)
                if (item.y > arenaHeight - 70) {
                    this.handleItemMissed(item, i);
                }
            }

            // Render hạt particle nổ
            this.renderParticles();

            this.animFrameId = requestAnimationFrame(this.gameLoop.bind(this));
        }

        renderItemTransform(item) {
            if (!item.el) return;
            const tilt = Math.sin(item.swayPhase || 0) * 4; // Nghiêng nhẹ theo sóng sin
            item.el.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) rotate(${tilt}deg)`;
        }

        // =====================================================================
        // DRAG & TOUCH INTERACTIONS
        // =====================================================================

        onItemPointerDown(e, item) {
            if (!this.isRunning || item.isResolving) return;

            // Ẩn hướng dẫn cử chỉ khi người chơi tương tác lần đầu
            const hint = document.getElementById('sc-gesture-hint');
            if (hint) hint.style.opacity = '0';

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const arenaRect = this.arenaEl.getBoundingClientRect();
            const arenaX = clientX - arenaRect.left;
            const arenaY = clientY - arenaRect.top;

            this.dragState.item = item;
            this.dragState.isDragging = true;
            this.dragState.startX = arenaX;
            this.dragState.startY = arenaY;
            this.dragState.offsetX = arenaX - item.x;
            this.dragState.offsetY = arenaY - item.y;

            item.isDragged = true;
            item.el.classList.add('sc-item-dragging');

            if (e.cancelable) e.preventDefault();
        }

        onPointerMove(e) {
            if (!this.dragState.isDragging || !this.dragState.item || !this.arenaEl) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const arenaRect = this.arenaEl.getBoundingClientRect();
            const arenaX = clientX - arenaRect.left;
            const arenaY = clientY - arenaRect.top;

            const item = this.dragState.item;
            item.x = arenaX - this.dragState.offsetX;
            item.y = arenaY - this.dragState.offsetY;

            // Giữ item nằm trong khung arena
            item.x = Math.max(10, Math.min(arenaRect.width - 150, item.x));
            item.y = Math.max(10, Math.min(arenaRect.height - 80, item.y));

            // Góc nghiêng theo hướng kéo
            const dragDiffX = arenaX - this.dragState.startX;
            const dragTilt = Math.max(-18, Math.min(18, dragDiffX * 0.1));

            item.el.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) scale(1.08) rotate(${dragTilt}deg)`;

            // Highlight giỏ khi item được kéo lại gần
            this.highlightNearestBasket(item, arenaRect);

            if (e.cancelable) e.preventDefault();
        }

        onPointerUp(e) {
            if (!this.dragState.isDragging || !this.dragState.item) return;

            const item = this.dragState.item;
            this.dragState.isDragging = false;
            this.dragState.item = null;
            item.isDragged = false;

            if (item.el) {
                item.el.classList.remove('sc-item-dragging');
            }

            // Bỏ highlight giỏ
            this.clearBasketHighlights();

            // Kiểm tra thả vào giỏ nào
            const arenaRect = this.arenaEl.getBoundingClientRect();
            const targetBasket = this.detectBasketDrop(item, arenaRect);

            if (targetBasket) {
                this.resolveItemCatch(item, targetBasket);
            } else {
                // Thả ở giữa: cập nhật lại baseX để tiếp tục rơi từ vị trí mới
                item.baseX = item.x;
            }
        }

        highlightNearestBasket(item, arenaRect) {
            const itemCenterX = item.x + 70;
            const width = arenaRect.width;

            if (itemCenterX < width * 0.38) {
                this.basketLeftEl?.classList.add('sc-basket-hover');
                this.basketRightEl?.classList.remove('sc-basket-hover');
            } else if (itemCenterX > width * 0.62) {
                this.basketRightEl?.classList.add('sc-basket-hover');
                this.basketLeftEl?.classList.remove('sc-basket-hover');
            } else {
                this.clearBasketHighlights();
            }
        }

        clearBasketHighlights() {
            this.basketLeftEl?.classList.remove('sc-basket-hover');
            this.basketRightEl?.classList.remove('sc-basket-hover');
        }

        detectBasketDrop(item, arenaRect) {
            const itemCenterX = item.x + 70;
            const itemBottomY = item.y + 70;
            const width = arenaRect.width;
            const height = arenaRect.height;

            // Thả vào vùng bên trái (An toàn)
            if (itemCenterX < width * 0.42 || (itemCenterX < width * 0.48 && itemBottomY > height * 0.55)) {
                return 'left';
            }

            // Thả vào vùng bên phải (Nguy hiểm / Dừng lại)
            if (itemCenterX > width * 0.58 || (itemCenterX > width * 0.52 && itemBottomY > height * 0.55)) {
                return 'right';
            }

            return null;
        }

        // =====================================================================
        // ACCESSIBILITY: KEYBOARD CONTROLS (⬅️ / ➡️ hoặc A / D)
        // =====================================================================

        onKeyDown(e) {
            if (!this.isRunning || this.activeItems.length === 0) return;

            // Lấy item thấp nhất (gần đáy nhất) để ưu tiên xử lý bằng phím
            const lowestItem = this.activeItems.reduce((lowest, current) => {
                return current.y > (lowest ? lowest.y : -999) ? current : lowest;
            }, null);

            if (!lowestItem || lowestItem.isResolving) return;

            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                this.resolveItemCatch(lowestItem, 'left');
                e.preventDefault();
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                this.resolveItemCatch(lowestItem, 'right');
                e.preventDefault();
            }
        }

        // =====================================================================
        // RESOLUTION: CORRECT / INCORRECT / MISSED
        // =====================================================================

        resolveItemCatch(item, chosenBasket) {
            if (item.isResolving) return;
            item.isResolving = true;

            const isCorrect = item.data.correctBasket === chosenBasket;
            const basketEl = chosenBasket === 'left' ? this.basketLeftEl : this.basketRightEl;

            if (isCorrect) {
                // ĐÚNG:
                this.stats.correctCount++;
                this.stats.totalCaught++;
                this.stats.currentCombo++;
                if (this.stats.currentCombo > this.stats.maxCombo) {
                    this.stats.maxCombo = this.stats.currentCombo;
                }

                // Giỏ nảy nhẹ
                if (basketEl) {
                    basketEl.classList.remove('sc-basket-bounce');
                    void basketEl.offsetWidth; // Force reflow
                    basketEl.classList.add('sc-basket-bounce');
                }

                // Nổ particle burst chúc mừng
                this.spawnParticleBurst(item.x + 70, item.y + 40, chosenBasket === 'left' ? '#22C55E' : '#FF3366');

                // Hiệu ứng item thu nhỏ bay vào giỏ
                if (item.el) {
                    item.el.classList.add('sc-item-caught-correct');
                }

                // Phát âm thanh ting tăng cao độ
                if (typeof this.config.onCorrect === 'function') {
                    this.config.onCorrect(item.data, this.stats.currentCombo);
                }
            } else {
                // SAI:
                this.stats.incorrectCount++;
                this.stats.currentCombo = 0; // Combo reset về 0, KHÔNG trừ mạng, KHÔNG game over

                // Screen shake nhẹ trên arena
                if (this.arenaEl) {
                    this.arenaEl.classList.remove('sc-screen-shake');
                    void this.arenaEl.offsetWidth;
                    this.arenaEl.classList.add('sc-screen-shake');
                }

                // Giỏ chớp đỏ 2 lần
                if (basketEl) {
                    basketEl.classList.remove('sc-basket-flash-wrong');
                    void basketEl.offsetWidth;
                    basketEl.classList.add('sc-basket-flash-wrong');
                }

                // Hiệu ứng item rơi tụt xuống và mờ dần
                if (item.el) {
                    item.el.classList.add('sc-item-caught-wrong');
                }

                // Phát âm thanh bụp nhẹ
                if (typeof this.config.onIncorrect === 'function') {
                    this.config.onIncorrect(item.data);
                }
            }

            this.updateHeaderUI();

            // Xóa item sau animation (320ms)
            setTimeout(() => {
                this.removeItemFromList(item);
                // Sau khi hoàn thành, kiểm tra lập lịch item tiếp theo
                this.scheduleNextSpawn();
            }, 320);
        }

        handleItemMissed(item, index) {
            item.isResolving = true;
            this.stats.missedCount++;

            // Fade out nhẹ nhàng, coi là bỏ lỡ trung lập, không phạt điểm
            if (item.el) {
                item.el.classList.add('sc-item-missed-fade');
            }

            if (typeof this.config.onMissed === 'function') {
                this.config.onMissed(item.data);
            }

            setTimeout(() => {
                this.removeItemFromList(item);
                this.scheduleNextSpawn();
            }, 300);
        }

        removeItemFromList(item) {
            if (item.el && item.el.parentNode) {
                item.el.parentNode.removeChild(item.el);
            }
            const idx = this.activeItems.indexOf(item);
            if (idx > -1) {
                this.activeItems.splice(idx, 1);
            }
        }

        // =====================================================================
        // PARTICLES SYSTEM (In-game Burst)
        // =====================================================================

        spawnParticleBurst(x, y, color) {
            if (!this.canvas) return;
            const count = 18;
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 6 + 3;
                this.particles.push({
                    x: x,
                    y: y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: Math.random() * 6 + 4,
                    alpha: 1,
                    color: color,
                    shape: Math.random() > 0.4 ? 'circle' : 'star'
                });
            }
        }

        renderParticles() {
            if (!this.ctx || !this.canvas || this.particles.length === 0) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.2; // Gravity nhẹ
                p.alpha -= 0.035;

                if (p.alpha <= 0) {
                    this.particles.splice(i, 1);
                    continue;
                }

                this.ctx.save();
                this.ctx.globalAlpha = p.alpha;
                this.ctx.fillStyle = p.color;

                if (p.shape === 'star') {
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
                    this.ctx.fill();
                } else {
                    this.ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                }
                this.ctx.restore();
            }
        }

        // =====================================================================
        // UI & HUD UPDATER
        // =====================================================================

        updateHeaderUI() {
            if (this.scoreTextEl) {
                this.scoreTextEl.textContent = this.stats.correctCount;
            }

            if (this.comboBadgeEl) {
                if (this.stats.currentCombo >= 2) {
                    this.comboBadgeEl.textContent = `🔥 Combo x${this.stats.currentCombo}`;
                    this.comboBadgeEl.classList.remove('hidden');
                } else {
                    this.comboBadgeEl.classList.add('hidden');
                }
            }
        }

        // =====================================================================
        // COMPLETION & TRANSITION TO DECISION STAGE
        // =====================================================================

        endGame(isSkipped = false) {
            if (!this.isRunning) return;
            this.isRunning = false;

            clearInterval(this.timerInterval);
            clearTimeout(this.spawnTimeout);

            // Dừng các item đang rơi
            this.activeItems.forEach(item => {
                if (item.el) item.el.style.pointerEvents = 'none';
            });

            if (isSkipped) {
                // Nếu bấm nút "Tôi quyết định rồi", chuyển thẳng không chờ card khích lệ
                if (typeof this.config.onComplete === 'function') {
                    this.config.onComplete(this.stats);
                }
                return;
            }

            // Hiện card khích lệ ngắn (1.8s) cho trẻ em
            if (this.encouragementCardEl) {
                const statCorrect = document.getElementById('sc-stat-correct');
                const statCombo = document.getElementById('sc-stat-combo');
                if (statCorrect) statCorrect.textContent = this.stats.correctCount;
                if (statCombo) statCombo.textContent = `x${this.stats.maxCombo}`;

                this.encouragementCardEl.classList.remove('hidden');
                this.encouragementCardEl.classList.add('sc-card-pop');
            }

            // Tự động Freeze-Frame Crossfade sang màn hình 3 quyết định A / B / C sau 1.8s
            setTimeout(() => {
                if (typeof this.config.onComplete === 'function') {
                    this.config.onComplete(this.stats);
                }
            }, 1800);
        }

        destroy() {
            this.reset();
            window.removeEventListener('mousemove', this._onPointerMove);
            window.removeEventListener('mouseup', this._onPointerUp);
            window.removeEventListener('touchmove', this._onPointerMove);
            window.removeEventListener('touchend', this._onPointerUp);
            window.removeEventListener('keydown', this._onKeyDown);
        }
    }

    return SafetyCatchEngine;
}));
