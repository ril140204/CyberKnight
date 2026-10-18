/**
 * CYBERKNIGHT — LEVEL 3: "CHO PHÉP HAY KHÔNG?" MINI-GAME
 * Permission quiz: 5 rounds, mock phone dialogs, no red/green pre-tint.
 * All JS-created classes use "pg-" prefix with matching CSS rules.
 */

(function () {
    'use strict';

    // =========================================================================
    // ROUNDS DATA
    // =========================================================================

    const ROUNDS = [
        {
            id: 'camera',
            icon: '📸',
            app: 'Máy Ảnh',
            doing: 'Chụp ảnh cho con',
            perm: '📷 Máy ảnh',
            options: [
                { id: 'allow', label: 'Cho phép' },
                { id: 'deny',  label: 'Không cho phép' }
            ],
            correct: 'allow',
            explain: 'Máy ảnh cần quyền Máy ảnh để chụp ảnh, nên cho phép là hợp lý.'
        },
        {
            id: 'puzzle',
            icon: '🧩',
            app: 'Game Xếp Hình',
            doing: 'Xếp hình',
            perm: '🎤 Micro',
            options: [
                { id: 'allow', label: 'Cho phép' },
                { id: 'deny',  label: 'Không cho phép' }
            ],
            correct: 'deny',
            explain: 'Xếp hình đâu cần nghe giọng của con. Quyền không liên quan thì đừng cho.'
        },
        {
            id: 'torch',
            icon: '🔦',
            app: 'Đèn Pin',
            doing: 'Bật đèn sáng',
            perm: '📍 Vị trí',
            options: [
                { id: 'allow', label: 'Cho phép' },
                { id: 'deny',  label: 'Không cho phép' }
            ],
            correct: 'deny',
            explain: 'Đèn pin vẫn sáng mà không cần biết con đang ở đâu.'
        },
        {
            id: 'map',
            icon: '🗺️',
            app: 'Bản Đồ',
            doing: 'Chỉ đường cho con',
            perm: '📍 Vị trí',
            options: [
                { id: 'while',  label: 'Chỉ khi đang dùng ứng dụng' },
                { id: 'always', label: 'Luôn cho phép' },
                { id: 'deny',   label: 'Không cho phép' }
            ],
            correct: 'while',
            explain: 'Bản Đồ cần vị trí để chỉ đường, nhưng chỉ lúc đang dùng thôi — đừng chọn "Luôn cho phép".',
            wrongNotes: {
                deny: 'An toàn đấy, nhưng Bản Đồ sẽ không chỉ đường được. Cách tốt nhất là "Chỉ khi đang dùng".'
            }
        },
        {
            id: 'call',
            icon: '📹',
            app: 'Gọi Video Với Bà',
            doing: 'Gọi video với bà',
            perm: '📷 Máy ảnh + 🎤 Micro',
            options: [
                { id: 'ask',  label: 'Nhờ bố/mẹ xem rồi cho phép' },
                { id: 'self', label: 'Tự bấm Cho phép' },
                { id: 'deny', label: 'Không cho phép' }
            ],
            correct: 'ask',
            explain: 'Máy ảnh và Micro rất riêng tư. Cần gọi bà thì cho phép, nhưng hãy nhờ bố/mẹ xem cùng.',
            wrongNotes: {
                deny: 'An toàn đấy, nhưng con sẽ không gọi được cho bà. Nhờ bố/mẹ xem cùng là được nhé.'
            }
        }
    ];

    // =========================================================================
    // AUDIO SYNTH EXTENSIONS (same pattern as key-audit.js _extendAudioSynth)
    // =========================================================================

    function _extendAudioSynth() {
        try {
            // Support both standalone (window.sound) and iframe-embedded (window.parent.sound)
            const synth = (window.parent && window.parent !== window && window.parent.sound)
                || window.sound;
            if (!synth) return;
            if (typeof synth.playTick !== 'function') return;

            if (!synth.permRight) {
                // Soft bell — right answer
                synth.permRight = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    [523.25, 659.25, 783.99].forEach((freq, idx) => {
                        const osc = synth.ctx.createOscillator();
                        const gain = synth.ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
                        gain.gain.setValueAtTime(0.14, now + idx * 0.1);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.25);
                        osc.connect(gain); gain.connect(synth.ctx.destination);
                        osc.start(now + idx * 0.1); osc.stop(now + idx * 0.1 + 0.25);
                    });
                };
            }

            if (!synth.permWrong) {
                // Soft low tone — wrong answer (NOT harsh)
                synth.permWrong = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(220, now);
                    osc.frequency.exponentialRampToValueAtTime(165, now + 0.3);
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.35);
                };
            }
        } catch (e) { /* AudioSynth not available */ }
    }

    _extendAudioSynth();

    // =========================================================================
    // PermissionGame CLASS
    // =========================================================================

    class PermissionGame {
        constructor(containerSelector, options = {}) {
            this.container = typeof containerSelector === 'string'
                ? document.querySelector(containerSelector)
                : containerSelector;

            if (!this.container) {
                console.error('[PermissionGame] Container not found:', containerSelector);
                return;
            }

            this.onComplete = options.onComplete || (() => {});

            // Game state
            this.roundIndex = 0;           // 0..4
            this.mistakes = 0;
            this.rounds = [];             // [{ id, chosen, correct }]

            // DOM references for cleanup
            this._btnRefs = [];

            // Reduced-motion flag
            this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            this._init();
        }

        // =====================================================================
        // INIT & ENTRY POINT
        // =====================================================================

        _init() {
            this._renderIntro();
        }

        // =====================================================================
        // INTRO CARD
        // =====================================================================

        _renderIntro() {
            this.container.innerHTML = `
                <div class="pg-intro-card">
                    <div class="pg-intro-badge">🔑 THỬ THÁCH CUỐI</div>
                    <h2 class="pg-intro-title">CHO PHÉP HAY KHÔNG?</h2>
                    <div class="pg-intro-bip">
                        <span class="pg-bip-icon">🤖</span>
                        <span class="pg-bip-text">Sắp có 5 ứng dụng hỏi xin quyền. Con hãy chọn Cho phép hay Không cho phép nhé!</span>
                    </div>
                    <button class="pg-start-btn" id="pg-start-btn" type="button" aria-label="Bắt đầu thử thách">
                        ▶ Bắt đầu
                    </button>
                </div>
            `;

            const btn = document.getElementById('pg-start-btn');
            if (btn) {
                const handler = () => this._startGame();
                btn.addEventListener('click', handler);
                this._btnRefs.push({ el: btn, event: 'click', handler });
            }
        }

        _startGame() {
            this.roundIndex = 0;
            this.mistakes = 0;
            this.rounds = [];
            this._transition(() => this._renderRound());
        }

        // =====================================================================
        // ROUND RENDER
        // =====================================================================

        _renderRound() {
            const round = ROUNDS[this.roundIndex];
            const progress = `${this.roundIndex + 1}/5`;

            // Shuffle options so correct answer isn't always first.
            // BUT: all buttons are styled identically (neutral color, same size).
            // This ensures NO button is pre-tinted before the child clicks.
            const shuffledOptions = this._shuffleArray([...round.options]);

            const optionsHtml = shuffledOptions.map(opt => `
                <button class="pg-perm-btn"
                        data-option-id="${opt.id}"
                        type="button"
                        aria-label="${opt.label}">
                    ${opt.label}
                </button>
            `).join('');

            this.container.innerHTML = `
                <div class="pg-round-card">
                    <div class="pg-hud">
                        <div class="pg-hud-progress">Lượt ${progress}</div>
                    </div>

                    <div class="pg-app-card">
                        <div class="pg-app-icon">${round.icon}</div>
                        <div class="pg-app-name">${round.app}</div>
                        <div class="pg-app-task">Đang làm: <strong>${round.doing}</strong></div>
                    </div>

                    <!-- Mock phone permission dialog -->
                    <div class="pg-dialog">
                        <div class="pg-dialog-header">
                            <span class="pg-dialog-icon">${round.icon}</span>
                            <div class="pg-dialog-text">
                                <div class="pg-dialog-app">${round.app}</div>
                                <div class="pg-dialog-perm">muốn dùng ${round.perm}</div>
                            </div>
                        </div>
                    </div>

                    <div class="pg-options">
                        ${optionsHtml}
                    </div>
                </div>
            `;

            this._bindRoundButtons();
        }

        _bindRoundButtons() {
            const btns = this.container.querySelectorAll('.pg-perm-btn');
            btns.forEach(btn => {
                const handler = () => {
                    // Lock all buttons immediately — no double-tap
                    btns.forEach(b => b.disabled = true);
                    this._handleChoice(btn.dataset.optionId);
                };
                btn.addEventListener('click', handler);
                this._btnRefs.push({ el: btn, event: 'click', handler });
            });
        }

        // =====================================================================
        // CHOICE HANDLING
        // =====================================================================

        _handleChoice(chosenId) {
            const round = ROUNDS[this.roundIndex];
            const correct = chosenId === round.correct;

            if (!correct) this.mistakes++;

            this.rounds.push({
                id: round.id,
                chosen: chosenId,
                correct: correct
            });

            this._playSound(correct ? 'permRight' : 'permWrong');

            // Build feedback content
            if (correct) {
                this._showFeedback(true, round.explain);
            } else {
                // Check for round-specific wrongNotes
                const note = (round.wrongNotes && round.wrongNotes[chosenId])
                    ? round.wrongNotes[chosenId]
                    : round.explain + ` <strong>Cách làm tốt hơn: ${round.options.find(o => o.id === round.correct)?.label}</strong>`;
                this._showFeedback(false, note);
            }
        }

        _showFeedback(isCorrect, message) {
            const container = this.container.querySelector('.pg-round-card');
            if (!container) return;

            const frameClass = isCorrect ? 'pg-feedback-correct' : 'pg-feedback-wrong';
            const title = isCorrect ? '✅ Đúng rồi!' : 'Chưa đúng lắm';
            const titleIcon = isCorrect ? '✅' : '💡';

            container.innerHTML = `
                <div class="pg-feedback-frame ${frameClass}">
                    <div class="pg-feedback-title">${title}</div>
                    <div class="pg-feedback-message">${message}</div>
                </div>
                <button class="pg-continue-btn" id="pg-continue-btn" type="button">
                    ${this.roundIndex < ROUNDS.length - 1 ? 'Tiếp ▶' : 'Xong ▶'}
                </button>
            `;

            const btn = document.getElementById('pg-continue-btn');
            if (btn) {
                const handler = () => this._advanceRound();
                btn.addEventListener('click', handler);
                this._btnRefs.push({ el: btn, event: 'click', handler });
            }
        }

        _advanceRound() {
            if (this.roundIndex < ROUNDS.length - 1) {
                this.roundIndex++;
                this._transition(() => this._renderRound());
            } else {
                this._transition(() => this._renderCelebration());
            }
        }

        // =====================================================================
        // CELEBRATION
        // =====================================================================

        _renderCelebration() {
            const score = ROUNDS.length - this.mistakes;

            this.container.innerHTML = `
                <div class="pg-complete-card">
                    <div class="pg-complete-icon">🎉</div>
                    <h2 class="pg-complete-title">Hoàn thành thử thách!</h2>
                    <div class="pg-complete-score">Con đúng ${score}/${ROUNDS.length}</div>
                </div>
            `;

            // Confetti burst (~1.5s per spec)
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 100,
                    spread: 80,
                    origin: { y: 0.5 },
                    colors: ['#22C55E', '#5BA8FF', '#FFD700']
                });
            }

            // Auto-call onComplete after celebration
            setTimeout(() => {
                this.onComplete({
                    success: true,
                    mistakes: this.mistakes,
                    rounds: this.rounds
                });
            }, 1500);
        }

        // =====================================================================
        // TRANSITIONS
        // =====================================================================

        _transition(callback) {
            if (this._reduced) {
                // No animation: just render
                this.container.style.opacity = '0';
                requestAnimationFrame(() => {
                    callback();
                    this.container.style.opacity = '1';
                });
            } else {
                // Crossfade
                this.container.style.transition = 'opacity 0.3s ease';
                this.container.style.opacity = '0';
                setTimeout(() => {
                    callback();
                    requestAnimationFrame(() => {
                        this.container.style.opacity = '1';
                        setTimeout(() => {
                            this.container.style.transition = '';
                        }, 300);
                    });
                }, 300);
            }
        }

        // =====================================================================
        // SOUND
        // =====================================================================

        _playSound(method) {
            try {
                const synth = (window.parent && window.parent !== window && window.parent.sound)
                    || window.sound;
                if (!synth) return;
                if (synth[method]) synth[method]();
            } catch (e) { /* no sound */ }
        }

        // =====================================================================
        // HELPERS
        // =====================================================================

        /**
         * Fisher-Yates shuffle — correct answer position changes each round.
         * All buttons remain visually identical (no red/green tint pre-applied).
         */
        _shuffleArray(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        // =====================================================================
        // PUBLIC API
        // =====================================================================

        /**
         * Remove all DOM and listeners.
         */
        destroy() {
            this._btnRefs.forEach(({ el, event, handler }) => {
                try { el.removeEventListener(event, handler); } catch (e) { /* gone */ }
            });
            this._btnRefs = [];
            if (this.container) this.container.innerHTML = '';
        }

        /**
         * Back to intro card, mistakes=0.
         */
        reset() {
            this.destroy();
            this.roundIndex = 0;
            this.mistakes = 0;
            this.rounds = [];
            this._init();
        }
    }

    // Expose to window
    window.PermissionGame = PermissionGame;

})();
