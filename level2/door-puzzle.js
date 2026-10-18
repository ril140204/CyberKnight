/**
 * CYBERKNIGHT — "CỬA CĂN CỨ" (DOOR PUZZLE)
 * Module Mini-game Kéo-Thả Mảnh Ghép Khóa Cửa Dành Cho Trẻ Em
 * Data-driven, Reusable, Touch/Mouse Friendly, Zero External Dependencies
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DoorPuzzleGame = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // 1. DATA-DRIVEN DEFAULT CONFIGURATION CHO LEVEL 2
    // =========================================================================

    const DEFAULT_CONFIG = {
        slotCount: 3,
        onPieceCorrect: null,             // (piece, slotIdx) => void
        onPieceIncorrect: null,           // (piece) => void
        onComplete: null,                 // (stats) => void
        // CSS class overrides — cho phép tích hợp với level2.css hiện có
        classes: {
            arena: 'dp-arena',
            pieceLayer: 'dp-piece-layer',
            piece: 'dp-piece',
            pieceCorrect: 'dp-piece-correct',
            pieceDecoy: 'dp-piece-decoy',
            pieceGlow: 'dp-piece-glow',
            pieceIcon: 'dp-piece-icon',
            pieceText: 'dp-piece-text',
            slot: 'dp-slot',
            slotGlow: 'dp-slot-glow',
            slotOutline: 'dp-slot-outline',
            slotShape: 'dp-slot-shape',
            slotIcon: 'dp-slot-preview-icon',
            slotLabel: 'dp-slot-label',
            slotShapePrefix: 'dp-shape-', // dp-shape-lock, dp-shape-shield, dp-shape-key
            slotLocked: 'locked',
            pieceDragging: 'dragging',
            pieceShaking: 'shaking',
            pieceLocked: 'locked',
            pieceSnap: 'dp-snap',
            slotNear: 'near',
            slotVictory: 'victory',
            completeCard: 'dp-complete-card',
            completeCardHidden: 'hidden',
            completeCardPop: 'dp-card-pop',
            completeAvatar: 'dp-complete-avatar',
            completeTitle: 'dp-complete-title',
            completeDesc: 'dp-complete-desc',
            completeTransitionNote: 'dp-complete-transition-note',
            confettiCanvas: 'dp-confetti-canvas',
            header: 'dp-header',
            wrapper: 'door-puzzle-wrapper'
        }
    };

    // =========================================================================
    // 2. DOOR PUZZLE ENGINE CLASS
    // =========================================================================

    class DoorPuzzleEngine {
        constructor(container, config = {}) {
            this.container = typeof container === 'string'
                ? document.querySelector(container)
                : container;

            // Shallow-merge DEFAULT_CONFIG với config (cho callbacks, slotCount, …)
            this.config = Object.assign({}, DEFAULT_CONFIG, config);

            // Sau shallow-merge, đảm bảo `classes` lại là deep-merged:
            //    base = DEFAULT_CONFIG.classes, override = config.classes (nếu có)
            this.config.classes = Object.assign(
                {},
                DEFAULT_CONFIG.classes,
                config.classes || {}
            );

            this.cls = this.config.classes;

            // 3 ô khóa trên cửa căn cứ
            this.slots = [
                {
                    id: 0,
                    shape: 'lock',
                    label: 'Ổ khóa riêng tư',
                    icon: '🔒',
                    correctPieceId: 'p1'
                },
                {
                    id: 1,
                    shape: 'shield',
                    label: 'Khiên tin tưởng',
                    icon: '🛡️',
                    correctPieceId: 'p2'
                },
                {
                    id: 2,
                    shape: 'key',
                    label: 'Chìa khóa người lớn',
                    icon: '🔑',
                    correctPieceId: 'p3'
                }
            ];

            // 8 mảnh ghép: 3 đúng + 5 mồi nhử
            this.allPieces = [
                // 3 mảnh ĐÚNG
                { id: 'p1', icon: '🔒', text: 'Mật khẩu riêng tư', correctSlot: 0, type: 'correct' },
                { id: 'p2', icon: '🛡️', text: 'Khiên bảo vệ', correctSlot: 1, type: 'correct' },
                { id: 'p3', icon: '🔑', text: 'Chìa khóa chính', correctSlot: 2, type: 'correct' },
                // 5 mảnh mồi nhử (giống nhưng sai)
                { id: 'm1', icon: '🔓', text: 'Mật khẩu tạm thời', type: 'decoy', decoyReason: 'ổ khóa mở sẵn' },
                { id: 'm2', icon: '🚪', text: 'Cửa không khóa', type: 'decoy', decoyReason: 'cửa không khóa' },
                { id: 'm3', icon: '🪟', text: 'Cửa sổ', type: 'decoy', decoyReason: 'cửa sổ' },
                { id: 'm4', icon: '🔐', text: 'Khóa phụ', type: 'decoy', decoyReason: 'khóa số' },
                { id: 'm5', icon: '👁️', text: 'Con mắt', type: 'decoy', decoyReason: 'con mắt' }
            ];

            // Trạng thái game
            this.isRunning = false;
            this.lockedCount = 0;
            this.pieces = [];          // Các piece đang trên màn hình
            this.arena = null;
            this.pieceLayer = null;

            // DOM elements
            this.scoreTextEl = null;
            this.progressTextEl = null;

            // Animation
            this.animFrameId = null;
            this.lastFrameTime = 0;

            // Drag state
            this.activeDragPiece = null;

            // Bound handlers for cleanup
            this._onMouseMove = this.onGlobalMove.bind(this);
            this._onMouseUp = this.onGlobalEnd.bind(this);

            this.buildDOM();
        }

        // =====================================================================
        // DOM BUILDER
        // =====================================================================

        buildDOM() {
            if (!this.container) return;
            this.container.innerHTML = '';
            this.container.classList.add(this.cls.wrapper);

            // Header
            const header = document.createElement('div');
            header.className = this.cls.header;
            header.innerHTML = `
                <div class="dp-header-left">
                    <div class="dp-badge-title">
                        <span class="dp-badge-icon">🚪</span>
                        <span class="dp-badge-text">CỬA CĂN CỨ</span>
                    </div>
                    <div class="dp-progress-tracker">
                        <span class="dp-progress-label">ĐÃ KHÓA:</span>
                        <span class="dp-progress-val" id="dp-progress-val">0</span>
                        <span class="dp-progress-slash">/</span>
                        <span class="dp-progress-total">3</span>
                    </div>
                </div>

                <div class="dp-header-center">
                    <div class="dp-title-box">
                        <span class="dp-title-icon">🔐</span>
                        <span class="dp-title-text">KÉO MẢNH GHÉP ĐÚNG VÀO KHÓA</span>
                    </div>
                </div>

                <div class="dp-header-right">
                    <div class="dp-hint-box">
                        <span>💡 Mẹo: Nhìn kỹ hình mẫu ở mỗi ô khóa!</span>
                    </div>
                </div>
            `;
            this.container.appendChild(header);

            // Play Arena
            const arena = document.createElement('div');
            arena.className = this.cls.arena;
            arena.id = 'dp-arena';
            arena.innerHTML = `
                <!-- Canvas cho confetti -->
                <canvas class="${this.cls.confettiCanvas}" id="dp-confetti-canvas"></canvas>

                <!-- 3 Ô khóa trên cửa -->
                <div class="dp-door-frame" id="dp-door-frame">
                    ${this.slots.map(slot => `
                        <div class="${this.cls.slot}" id="dp-slot-${slot.id}" data-slot="${slot.id}" data-shape="${slot.shape}">
                            <div class="${this.cls.slotGlow}"></div>
                            <div class="${this.cls.slotOutline}">
                                <div class="${this.cls.slotShape} ${this.cls.slotShapePrefix}${slot.shape}">
                                    <span class="${this.cls.slotIcon}">${slot.icon}</span>
                                </div>
                            </div>
                            <div class="${this.cls.slotLabel}">${slot.label}</div>
                            <div class="dp-slot-status"></div>
                        </div>
                    `).join('')}
                </div>

                <!-- Vùng chứa các mảnh ghép có thể kéo -->
                <div class="${this.cls.pieceLayer}" id="dp-piece-layer"></div>

                <!-- Card hoàn thành -->
                <div class="${this.cls.completeCard} ${this.cls.completeCardHidden}" id="dp-complete-card">
                    <div class="${this.cls.completeAvatar}">🎉</div>
                    <h3 class="${this.cls.completeTitle}">CỬA ĐÃ MỞ!</h3>
                    <p class="${this.cls.completeDesc}">Con đã khóa cửa căn cứ thành công bằng 3 mảnh ghép đúng!</p>
                    <div class="${this.cls.completeTransitionNote}">
                        <span>Đang chuyển sang màn tiếp theo...</span>
                    </div>
                </div>
            `;
            this.container.appendChild(arena);

            // Lưu DOM
            this.arena = arena;
            this.pieceLayer = arena.querySelector('#dp-piece-layer');
            this.progressTextEl = header.querySelector('#dp-progress-val');
            this.completeCardEl = arena.querySelector('#dp-complete-card');
            this.confettiCanvas = arena.querySelector('#dp-confetti-canvas');

            // Canvas confetti
            if (this.confettiCanvas) {
                this.confettiCtx = this.confettiCanvas.getContext('2d');
                this.resizeConfettiCanvas();
                window.addEventListener('resize', () => this.resizeConfettiCanvas());
            }

            // Global mouse/touch events
            window.addEventListener('mousemove', this._onMouseMove);
            window.addEventListener('mouseup', this._onMouseUp);
            window.addEventListener('touchmove', this._onMouseMove, { passive: false });
            window.addEventListener('touchend', this._onMouseUp);
        }

        resizeConfettiCanvas() {
            if (!this.confettiCanvas || !this.arena) return;
            const rect = this.arena.getBoundingClientRect();
            this.confettiCanvas.width = rect.width;
            this.confettiCanvas.height = rect.height;
        }

        // =====================================================================
        // GAME LIFECYCLE
        // =====================================================================

        start() {
            this.reset();
            this.isRunning = true;
            this.lastFrameTime = performance.now();
            this.confettiParticles = [];
            this.animFrameId = requestAnimationFrame(this.update.bind(this));
        }

        reset() {
            this.isRunning = false;
            this.lockedCount = 0;

            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }

            // Xóa tất cả pieces
            if (this.pieceLayer) {
                this.pieceLayer.innerHTML = '';
            }
            this.pieces = [];
            this.activeDragPiece = null;

            // Reset slot states
            this.slots.forEach(slot => {
                const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                if (slotEl) {
                    slotEl.classList.remove(this.cls.slotLocked, this.cls.slotNear, this.cls.slotVictory);
                }
            });

            // Ẩn card hoàn thành
            if (this.completeCardEl) {
                this.completeCardEl.classList.add(this.cls.completeCardHidden);
                this.completeCardEl.classList.remove(this.cls.completeCardPop);
            }

            this.updateProgressUI();

            // Shuffle và spawn pieces
            this.spawnAllPieces();
        }

        spawnAllPieces() {
            // Shuffle pieces ngẫu nhiên
            const shuffled = [...this.allPieces];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            shuffled.forEach((pieceData, index) => {
                this.spawnPiece(pieceData, index);
            });
        }

        spawnPiece(pieceData, index) {
            if (!this.pieceLayer || !this.arena) return;

            const el = document.createElement('div');
            // Base class + type class (để CSS có thể target correct vs decoy)
            const typeClass = pieceData.type === 'correct'
                ? this.cls.pieceCorrect
                : this.cls.pieceDecoy;
            el.className = `${this.cls.piece} ${typeClass}`;
            el.setAttribute('data-id', pieceData.id);
            el.setAttribute('tabindex', '0');
            el.innerHTML = `
                <div class="${this.cls.pieceGlow}"></div>
                <div class="${this.cls.pieceIcon}">${pieceData.icon}</div>
                ${pieceData.text ? `<div class="${this.cls.pieceText}">${pieceData.text}</div>` : ''}
            `;

            // Vị trí ngẫu nhiên trong arena
            const arenaRect = this.arena.getBoundingClientRect();
            const arenaW = arenaRect.width || 800;
            const arenaH = arenaRect.height || 500;

            // Sinh wave phase ngẫu nhiên cho bobbing
            const bobPhase = Math.random() * Math.PI * 2;
            const bobSpeed = 0.02 + Math.random() * 0.015;

            // Random x: 2 hàng trên cùng của arena (phía trên door frame)
            const minX = 40;
            const maxX = arenaW - 100;
            const x = minX + Math.random() * (maxX - minX);

            // Random y: vùng trên cùng (nơi các mảnh ghép bay lơ lửng)
            const minY = 30;
            const maxY = Math.min(arenaH * 0.35, 180);
            const y = minY + Math.random() * (maxY - minY);

            // Lưu trữ dữ liệu piece
            const pieceObj = {
                id: pieceData.id,
                data: pieceData,
                el: el,
                x: x,
                y: y,
                originalX: x,
                originalY: y,
                bobPhase: bobPhase,
                bobSpeed: bobSpeed,
                locked: false,
                dragging: false
            };

            // Setup vị trí ban đầu
            el.style.left = x + 'px';
            el.style.top = y + 'px';

            // Setup drag listeners
            this.setupPieceDrag(el, pieceObj);

            this.pieceLayer.appendChild(el);
            this.pieces.push(pieceObj);
        }

        // =====================================================================
        // DRAG & TOUCH INTERACTIONS
        // =====================================================================

        setupPieceDrag(pieceEl, pieceData) {
            // Lưu drag offset ở trên pieceData để onGlobalMove() dùng lại qua
            // nhiều frame — CHỈ tính MỘT LẦN tại thời điểm onStart, không
            // gọi lại getBoundingClientRect() của piece trong onGlobalMove()
            // (vì piece đang bị set left/top mỗi frame nên rect sẽ tự triệt
            // tiêu về vị trí cũ — đây chính là bug toán học đã sửa).
            pieceData.dragOffsetX = 0;
            pieceData.dragOffsetY = 0;

            const onStart = (clientX, clientY, e) => {
                if (pieceData.locked || !this.isRunning) return;
                this.activeDragPiece = pieceData;
                pieceData.dragging = true;

                // Tính offset MỘT LẦN duy nhất từ vị trí thực của piece
                // trước khi kéo (lúc này piece vẫn ở vị trí gốc, chưa bị
                // set left/top bởi frame nào trước đó).
                const rect = pieceEl.getBoundingClientRect();
                pieceData.dragOffsetX = clientX - rect.left;
                pieceData.dragOffsetY = clientY - rect.top;

                pieceEl.classList.add(this.cls.pieceDragging);
                // Tạm dừng bobbing animation bằng cách override transform
                pieceEl.style.animation = 'none';
                pieceEl.style.zIndex = '30';

                e.preventDefault();
            };

            // Mouse events
            pieceEl.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY, e));
            // Touch events
            pieceEl.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                onStart(t.clientX, t.clientY, e);
            }, { passive: false });
        }

        onGlobalMove(e) {
            if (!this.activeDragPiece || !this.isRunning) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const arenaRect = this.arena.getBoundingClientRect();
            const pieceData = this.activeDragPiece;
            const el = pieceData.el;

            if (!el) return;

            // Dùng dragOffset đã được tính MỘT LẦN ở onStart (lưu trên
            // pieceData), KHÔNG gọi lại getBoundingClientRect() của piece
            // tại đây — vì piece đang bị set left/top mỗi frame bởi code
            // bên dưới, nên rect.left/top sẽ thay đổi theo, khiến offset
            // tính sai và mảnh ghép không bám chuột.
            const offsetX = pieceData.dragOffsetX || 0;
            const offsetY = pieceData.dragOffsetY || 0;

            const newX = clientX - arenaRect.left - offsetX;
            const newY = clientY - arenaRect.top - offsetY;

            pieceData.x = Math.max(0, Math.min(arenaRect.width - 80, newX));
            pieceData.y = Math.max(0, Math.min(arenaRect.height - 80, newY));

            el.style.left = pieceData.x + 'px';
            el.style.top = pieceData.y + 'px';

            // Magnetic effect: nếu gần slot đúng, kéo về
            this.applyMagneticEffect(pieceData);

            // Highlight slot gần nhất
            this.highlightNearestSlot(pieceData);

            if (e.cancelable) e.preventDefault();
        }

        onGlobalEnd(e) {
            if (!this.activeDragPiece) return;
            const pieceData = this.activeDragPiece;
            const el = pieceData.el;

            pieceData.dragging = false;
            if (el) {
                el.classList.remove(this.cls.pieceDragging);
                el.style.zIndex = '';
            }

            this.tryDrop(pieceData, el);
            this.activeDragPiece = null;
        }

        // =====================================================================
        // SLOT HIGHLIGHT & MAGNETIC EFFECT
        // =====================================================================

        highlightNearestSlot(pieceData) {
            if (!this.arena) return;

            const pieceCenterX = pieceData.x + 40;
            const pieceCenterY = pieceData.y + 40;
            const threshold = 60; // px

            let nearestSlot = null;
            let nearestDist = Infinity;

            this.slots.forEach(slot => {
                const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                if (!slotEl) return;

                // Skip nếu slot đã locked
                if (slotEl.classList.contains(this.cls.slotLocked)) {
                    slotEl.classList.remove(this.cls.slotNear);
                    return;
                }

                const slotRect = slotEl.getBoundingClientRect();
                const arenaRect = this.arena.getBoundingClientRect();

                const slotCenterX = slotRect.left - arenaRect.left + slotRect.width / 2;
                const slotCenterY = slotRect.top - arenaRect.top + slotRect.height / 2;

                const dist = Math.sqrt(
                    Math.pow(pieceCenterX - slotCenterX, 2) +
                    Math.pow(pieceCenterY - slotCenterY, 2)
                );

                if (dist < threshold && dist < nearestDist) {
                    nearestDist = dist;
                    nearestSlot = slot;
                }

                // Xóa class near của tất cả slot
                slotEl.classList.remove(this.cls.slotNear);
            });

            // Thêm class near cho slot gần nhất
            if (nearestSlot) {
                const slotEl = document.getElementById(`dp-slot-${nearestSlot.id}`);
                if (slotEl) slotEl.classList.add(this.cls.slotNear);
            }
        }

        applyMagneticEffect(pieceData) {
            if (!this.arena) return;

            const pieceCenterX = pieceData.x + 40;
            const pieceCenterY = pieceData.y + 40;
            const magnetRange = 50;

            this.slots.forEach(slot => {
                const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                if (!slotEl || slotEl.classList.contains(this.cls.slotLocked)) return;

                const slotRect = slotEl.getBoundingClientRect();
                const arenaRect = this.arena.getBoundingClientRect();

                const slotCenterX = slotRect.left - arenaRect.left + slotRect.width / 2;
                const slotCenterY = slotRect.top - arenaRect.top + slotRect.height / 2;

                const dist = Math.sqrt(
                    Math.pow(pieceCenterX - slotCenterX, 2) +
                    Math.pow(pieceCenterY - slotCenterY, 2)
                );

                // Nếu trong tầm magnet và đúng piece cho slot này
                if (dist < magnetRange && pieceData.data.correctSlot === slot.id) {
                    // Kéo piece về tâm slot
                    const pullStrength = (magnetRange - dist) / magnetRange * 0.3;
                    pieceData.x += (slotCenterX - 40 - pieceData.x) * pullStrength;
                    pieceData.y += (slotCenterY - 40 - pieceData.y) * pullStrength;
                    pieceData.el.style.left = pieceData.x + 'px';
                    pieceData.el.style.top = pieceData.y + 'px';
                }
            });
        }

        // =====================================================================
        // DROP LOGIC
        // =====================================================================

        tryDrop(pieceData, pieceEl) {
            // Xóa tất cả highlight
            this.slots.forEach(slot => {
                const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                if (slotEl) slotEl.classList.remove(this.cls.slotNear);
            });

            if (!pieceData || pieceData.locked || !pieceEl) return;

            // Tìm slot gần nhất trong ngưỡng
            const pieceCenterX = pieceData.x + 40;
            const pieceCenterY = pieceData.y + 40;
            const dropThreshold = 55;

            let targetSlot = null;
            let nearestDist = Infinity;

            this.slots.forEach(slot => {
                const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                if (!slotEl || slotEl.classList.contains(this.cls.slotLocked)) return;

                const slotRect = slotEl.getBoundingClientRect();
                const arenaRect = this.arena.getBoundingClientRect();

                const slotCenterX = slotRect.left - arenaRect.left + slotRect.width / 2;
                const slotCenterY = slotRect.top - arenaRect.top + slotRect.height / 2;

                const dist = Math.sqrt(
                    Math.pow(pieceCenterX - slotCenterX, 2) +
                    Math.pow(pieceCenterY - slotCenterY, 2)
                );

                if (dist < dropThreshold && dist < nearestDist) {
                    nearestDist = dist;
                    targetSlot = slot;
                }
            });

            if (targetSlot) {
                // Kiểm tra đúng/sai
                if (pieceData.data.correctSlot === targetSlot.id) {
                    this.handleCorrect(pieceData, targetSlot, pieceEl);
                } else {
                    this.handleIncorrect(pieceData, pieceEl);
                }
            }
            // Nếu không có slot trong tầm, piece giữ nguyên vị trí
        }

        // =====================================================================
        // CORRECT / INCORRECT HANDLERS
        // =====================================================================

        handleCorrect(pieceData, slot, pieceEl) {
            pieceData.locked = true;
            const slotEl = document.getElementById(`dp-slot-${slot.id}`);

            // Snap piece về tâm slot
            if (slotEl) {
                const slotRect = slotEl.getBoundingClientRect();
                const arenaRect = this.arena.getBoundingClientRect();
                const snapX = slotRect.left - arenaRect.left + slotRect.width / 2 - 40;
                const snapY = slotRect.top - arenaRect.top + slotRect.height / 2 - 40;

                pieceEl.style.left = snapX + 'px';
                pieceEl.style.top = snapY + 'px';
            }

            // Lock animations
            pieceEl.classList.add(this.cls.pieceLocked);
            pieceEl.classList.remove(this.cls.pieceDragging);

            if (slotEl) {
                slotEl.classList.add(this.cls.slotLocked);
            }

            // Cập nhật progress
            this.lockedCount++;
            this.updateProgressUI();

            // Callbacks
            if (typeof this.config.onPieceCorrect === 'function') {
                this.config.onPieceCorrect(pieceData.data, slot.id);
            }

            // Kiểm tra hoàn thành
            this.checkComplete();
        }

        handleIncorrect(pieceData, pieceEl) {
            // Shake animation
            pieceEl.classList.add(this.cls.pieceShaking);

            // Callback
            if (typeof this.config.onPieceIncorrect === 'function') {
                this.config.onPieceIncorrect(pieceData.data);
            }

            // Sau shake, animate về vị trí ban đầu
            setTimeout(() => {
                pieceEl.classList.remove(this.cls.pieceShaking);

                // Animate về original position
                const startX = pieceData.x;
                const startY = pieceData.y;
                const targetX = pieceData.originalX;
                const targetY = pieceData.originalY;
                const duration = 600;
                const startTime = performance.now();

                const animateBack = (now) => {
                    const elapsed = now - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    // Ease out cubic
                    const ease = 1 - Math.pow(1 - progress, 3);

                    pieceData.x = startX + (targetX - startX) * ease;
                    pieceData.y = startY + (targetY - startY) * ease;
                    pieceEl.style.left = pieceData.x + 'px';
                    pieceEl.style.top = pieceData.y + 'px';

                    if (progress < 1) {
                        requestAnimationFrame(animateBack);
                    }
                };

                requestAnimationFrame(animateBack);
            }, 400);
        }

        // =====================================================================
        // COMPLETION
        // =====================================================================

        checkComplete() {
            if (this.lockedCount >= 3) {
                this.isRunning = false;

                // Play victory chime (visual feedback)
                this.slots.forEach(slot => {
                    const slotEl = document.getElementById(`dp-slot-${slot.id}`);
                    if (slotEl) slotEl.classList.add(this.cls.slotVictory);
                });

                // Trigger confetti
                this.triggerConfetti();

                // Show complete card
                if (this.completeCardEl) {
                    this.completeCardEl.classList.remove(this.cls.completeCardHidden);
                    this.completeCardEl.classList.add(this.cls.completeCardPop);
                }

                // Callback
                if (typeof this.config.onComplete === 'function') {
                    this.config.onComplete({
                        lockedCount: this.lockedCount,
                        total: 3
                    });
                }
            }
        }

        triggerConfetti() {
            if (!this.confettiCanvas || !this.confettiCtx) return;

            this.confettiParticles = [];
            const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];

            for (let i = 0; i < 80; i++) {
                this.confettiParticles.push({
                    x: this.confettiCanvas.width / 2,
                    y: this.confettiCanvas.height / 2,
                    vx: (Math.random() - 0.5) * 18,
                    vy: (Math.random() - 0.8) * 16,
                    size: Math.random() * 10 + 5,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    rotation: Math.random() * 360,
                    rotationSpeed: (Math.random() - 0.5) * 10,
                    shape: Math.random() > 0.5 ? 'rect' : 'circle'
                });
            }
        }

        // =====================================================================
        // ANIMATION LOOP
        // =====================================================================

        update(now) {
            const dt = Math.min(32, now - (this.lastFrameTime || now));
            this.lastFrameTime = now;

            // Bobbing animation cho các piece chưa locked
            this.pieces.forEach(piece => {
                if (piece.locked || piece.dragging) return;

                piece.bobPhase += piece.bobSpeed * (dt / 16.6);
                const bobY = Math.sin(piece.bobPhase) * 8;

                if (piece.el) {
                    piece.el.style.transform = `translateY(${bobY}px)`;
                }
            });

            // Render confetti
            this.renderConfetti();

            if (this.isRunning) {
                this.animFrameId = requestAnimationFrame(this.update.bind(this));
            }
        }

        renderConfetti() {
            if (!this.confettiCtx || !this.confettiCanvas || this.confettiParticles.length === 0) return;

            this.confettiCtx.clearRect(0, 0, this.confettiCanvas.width, this.confettiCanvas.height);

            for (let i = this.confettiParticles.length - 1; i >= 0; i--) {
                const p = this.confettiParticles[i];

                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.4; // Gravity
                p.rotation += p.rotationSpeed;
                p.vx *= 0.99; // Air resistance

                // Fade out khi ra khỏi canvas
                if (p.y > this.confettiCanvas.height + 50) {
                    this.confettiParticles.splice(i, 1);
                    continue;
                }

                this.confettiCtx.save();
                this.confettiCtx.translate(p.x, p.y);
                this.confettiCtx.rotate(p.rotation * Math.PI / 180);
                this.confettiCtx.fillStyle = p.color;

                if (p.shape === 'rect') {
                    this.confettiCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                } else {
                    this.confettiCtx.beginPath();
                    this.confettiCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    this.confettiCtx.fill();
                }

                this.confettiCtx.restore();
            }
        }

        // =====================================================================
        // UI UPDATERS
        // =====================================================================

        updateProgressUI() {
            if (this.progressTextEl) {
                this.progressTextEl.textContent = this.lockedCount;
            }
        }

        // =====================================================================
        // CLEANUP
        // =====================================================================

        destroy() {
            this.isRunning = false;

            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }

            window.removeEventListener('mousemove', this._onMouseMove);
            window.removeEventListener('mouseup', this._onMouseUp);
            window.removeEventListener('touchmove', this._onMouseMove);
            window.removeEventListener('touchend', this._onMouseUp);

            if (this.container) {
                this.container.innerHTML = '';
            }

            this.pieces = [];
            this.slots = [];
        }
    }

    return DoorPuzzleEngine;
}));
