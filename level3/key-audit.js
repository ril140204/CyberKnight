/**
 * CYBERKNIGHT — LEVEL 3: KEY AUDIT MINI-GAME "KIỂM KÊ CHÌA KHÓA"
 * Touch-first keyhole game: insert/remove keys, detect leaks, 4 rooms.
 * All JS-created classes use "ka-" prefix with matching CSS rules.
 */

(function () {
    'use strict';

    // =========================================================================
    // ROOM DATA (data-driven)
    // =========================================================================

    const ROOMS = [
        {
            id: 'paint',
            app: 'Bút Màu',
            icon: '🖍️',
            task: 'Tô màu con rồng',
            needs: [],           // no keys needed
            locationMode: null,
            initial: { micro: 'on' },  // micro starts ON — wrong
            hints: [
                'Bút Màu chỉ cần tô màu thôi. Con nhìn xem, chìa nào đang cắm mà không cần nhỉ?',
                '(nhấp nháy viền ổ Micro — nhẹ nhàng)',
                'Tô màu không cần nghe giọng nói của con — hãy rút chìa Micro ra nhé!'
            ],
            success: 'Giỏi quá! Bút Màu vẫn tô xong con rồng mà không cần micro.',
            successAnim: 'dragon'
        },
        {
            id: 'torch',
            app: 'Đèn Pin',
            icon: '🔦',
            task: 'Bật đèn sáng',
            needs: [],
            locationMode: null,
            initial: { location: 'always', micro: 'on' }, // both wrong
            hints: [
                'Đèn pin chỉ cần bật sáng. Chìa nào đang cắm nhưng đèn không cần nhỉ?',
                '(nhấp nháy ổ Vị trí và ổ Micro)',
                'Đèn pin đâu cần biết con ở đâu hay nghe con nói? Rút chìa Vị trí và Micro ra nhé!'
            ],
            trapShowMap: true, // if Vị trí still inserted when Xong
            trapMessage: 'Thấy chưa? Đèn pin đang biết con ở đâu dù không cần!',
            success: 'Đèn pin sáng rồi! Không cần quyền nào cả.',
            successAnim: 'torch'
        },
        {
            id: 'map',
            app: 'Bản Đồ',
            icon: '🗺️',
            task: 'Chỉ đường đến phòng kho báu',
            needs: ['location'],
            locationMode: 'whileUsing',
            initial: { location: 'always', photos: 'on' }, // location=always wrong, photos wrong
            hints: [
                'Bản Đồ cần biết con đang ở đâu để chỉ đường. Nhưng cách cho quyền Vị trí có quan trọng không nhỉ?',
                '(nhấp nháy lựa chọn "Mọi lúc" và ổ Thư viện ảnh)',
                'Chọn "Khi đang dùng" cho Vị trí và rút chìa Thư viện ảnh — chỉ đường đâu cần xem ảnh!'
            ],
            success: 'Chuẩn! Bản Đồ chỉ biết vị trí khi đang chỉ đường.',
            successAnim: 'map'
        },
        {
            id: 'call',
            app: 'Gọi Video Với Bà',
            icon: '📹',
            task: 'Nhìn thấy và nghe thấy bà',
            needs: ['camera', 'micro'],
            needsAdult: true,
            locationMode: null,
            initial: { camera: 'on', location: 'always' }, // camera CORRECT, location wrong
            hints: [
                'Gọi video với bà cần nhìn thấy và nghe thấy bà. Chìa nào thiếu, chìa nào thừa nhỉ?',
                '(nhấp nháy ổ Micro và ổ Vị trí; KHÔNG nhấp nháy ổ Máy ảnh)',
                'Giữ chìa Máy ảnh, cắm chìa Micro, rút chìa Vị trí — rồi nhờ bố mẹ cho phép nhé!'
            ],
            success: 'Bà đang nhìn và nghe thấy con rồi! Nhờ có bố/mẹ giúp đỡ.',
            successAnim: 'grandma'
        }
    ];

    // Keyhole definitions
    const KEYHOLES = [
        { id: 'camera',  icon: '📷', label: 'Máy Ảnh' },
        { id: 'micro',   icon: '🎤', label: 'Micro' },
        { id: 'location', icon: '📍', label: 'Vị Trí' },
        { id: 'photos',  icon: '🖼️', label: 'Thư Viện Ảnh' }
    ];

    // =========================================================================
    // AUDIO SYNTH EXTENSIONS (add to parent window's AudioSynth if present)
    // =========================================================================

    function _extendAudioSynth() {
        try {
            // Support both standalone (window.sound) and iframe-embedded (window.parent.sound)
            const synth = (window.parent && window.parent !== window && window.parent.sound)
                || window.sound;
            if (!synth) return;
            if (typeof synth.playTick !== 'function') return;

            if (!synth.keyInsert) {
                synth.keyInsert = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
                    gain.gain.setValueAtTime(0.14, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.1);
                };
            }
            if (!synth.keyRemove) {
                synth.keyRemove = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(660, now);
                    osc.frequency.exponentialRampToValueAtTime(330, now + 0.1);
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.12);
                };
            }
            if (!synth.leakStop) {
                synth.leakStop = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(300, now);
                    osc.frequency.exponentialRampToValueAtTime(600, now + 0.3);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.35);
                };
            }
            if (!synth.roomClear) {
                synth.roomClear = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    [523.25, 659.25, 783.99].forEach((freq, idx) => {
                        const osc = synth.ctx.createOscillator();
                        const gain = synth.ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
                        gain.gain.setValueAtTime(0.16, now + idx * 0.1);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.3);
                        osc.connect(gain); gain.connect(synth.ctx.destination);
                        osc.start(now + idx * 0.1); osc.stop(now + idx * 0.1 + 0.3);
                    });
                };
            }
            if (!synth.softBonk) {
                synth.softBonk = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(200, now);
                    osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.2);
                };
            }
            if (!synth.callRing) {
                synth.callRing = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    [880, 1100, 880].forEach((freq, idx) => {
                        const osc = synth.ctx.createOscillator();
                        const gain = synth.ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, now + idx * 0.25);
                        gain.gain.setValueAtTime(0.14, now + idx * 0.25);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.25 + 0.2);
                        osc.connect(gain); gain.connect(synth.ctx.destination);
                        osc.start(now + idx * 0.25); osc.stop(now + idx * 0.25 + 0.2);
                    });
                };
            }
            // permRight: soft bell (used by PermissionGame when answer is correct)
            if (!synth.permRight) {
                synth.permRight = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    [659.25, 880].forEach((freq, idx) => {
                        const osc = synth.ctx.createOscillator();
                        const gain = synth.ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                        gain.gain.setValueAtTime(0.14, now + idx * 0.08);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);
                        osc.connect(gain); gain.connect(synth.ctx.destination);
                        osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.18);
                    });
                };
            }
            // permWrong: soft low tone (used by PermissionGame when answer is wrong — NOT harsh)
            if (!synth.permWrong) {
                synth.permWrong = function () {
                    if (!synth.ctx) return;
                    const now = synth.ctx.currentTime;
                    const osc = synth.ctx.createOscillator();
                    const gain = synth.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(220, now);
                    osc.frequency.exponentialRampToValueAtTime(110, now + 0.18);
                    gain.gain.setValueAtTime(0.10, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                    osc.connect(gain); gain.connect(synth.ctx.destination);
                    osc.start(now); osc.stop(now + 0.2);
                };
            }
        } catch (e) { /* AudioSynth not available */ }
    }

    _extendAudioSynth();

    // =========================================================================
    // KeyAuditGame CLASS
    // =========================================================================

    class KeyAuditGame {
        constructor(containerSelector, options = {}) {
            this.container = typeof containerSelector === 'string'
                ? document.querySelector(containerSelector)
                : containerSelector;

            if (!this.container) {
                console.error('[KeyAuditGame] Container not found:', containerSelector);
                return;
            }

            this.onComplete = options.onComplete || (() => {});

            // Game state
            this.roomIndex = 0;          // 0..3
            this.roomTries = {};         // roomId -> number of [Xong] clicks
            this.mistakes = 0;
            this.hintsUsed = 0;

            // Per-room state
            this.currentRoom = null;     // ROOMS[this.roomIndex]
            this.keyState = {};          // keyId -> 'off'|'on' | location: 'off'|'whileUsing'|'always'
            this.leakInterval = null;    // interval id for bubble animation
            this.leakActive = false;
            this.bipTimeout = null;
            this.hintLevel = 0;          // 0=none, 1=hints[0], 2=hints[1]+pulse, 3=hints[2]
            this.leakedIcons = [];       // active bubble elements
            this.parentApproved = false; // for room 'call' adult approval
            this.trapShown = false;      // for room 'torch' fake map
            this.grandmaApproved = false; // for room 'call' parent button pressed

            // Event listeners (for cleanup)
            this._listeners = [];

            this._init();
        }

        // =====================================================================
        // INIT & RENDER
        // =====================================================================

        _init() {
            this._renderIntro();
        }

        _renderIntro() {
            this.container.innerHTML = `
                <div class="ka-intro-card">
                    <div class="ka-intro-badge">🔑 NHIỆM VỤ CUỐI</div>
                    <h2 class="ka-intro-title">KIỂM KÊ CHÌA KHÓA</h2>
                    <div class="ka-bip-bubble ka-bip-visible" id="ka-bip-intro">
                        <div class="ka-bip-icon">🤖</div>
                        <div class="ka-bip-text" id="ka-bip-intro-text">
                            Có 4 ứng dụng đang giữ chìa khóa của con. Hãy xem ứng dụng nào đang giữ chìa không cần thiết, rồi rút lại giúp mình nhé!
                        </div>
                    </div>
                    <div class="ka-instruction">Chạm vào ổ chìa để CẮM hoặc RÚT chìa.</div>
                    <button class="ka-start-btn" id="ka-start-btn" type="button">Bắt đầu</button>
                </div>
            `;

            this._bindOnce(document.getElementById('ka-start-btn'), 'click', () => {
                this._startRoom(0);
            });

            // Auto-hide intro bip after 2.5s
            setTimeout(() => {
                const bip = document.getElementById('ka-bip-intro');
                if (bip) {
                    bip.classList.remove('ka-bip-visible');
                    setTimeout(() => { if (bip.parentNode) bip.remove(); }, 350);
                }
            }, 2500);
        }

        _startRoom(index) {
            this.roomIndex = index;
            this.currentRoom = ROOMS[index];
            this.roomTries[this.currentRoom.id] = (this.roomTries[this.currentRoom.id] || 0);
            this.parentApproved = false;
            this.grandmaApproved = false;
            this.trapShown = false;
            this.hintLevel = 0;
            this._stopLeak();
            this._clearLeakedIcons();

            // Init key state from room initial
            this.keyState = {};
            for (const kh of KEYHOLES) {
                if (kh.id === 'location') {
                    this.keyState[kh.id] = this.currentRoom.initial.location || 'off';
                } else {
                    this.keyState[kh.id] = this.currentRoom.initial[kh.id] || 'off';
                }
            }

            this._renderRoom();
        }

        _renderRoom() {
            const room = this.currentRoom;
            const progress = `${this.roomIndex + 1}/4`;

            // Build keyhole buttons
            const keyholesHtml = KEYHOLES.map(kh => {
                const isOn = kh.id === 'location'
                    ? this.keyState[kh.id] !== 'off'
                    : this.keyState[kh.id] === 'on';
                const pressed = isOn ? 'true' : 'false';
                return `
                    <button class="ka-keyhole ${isOn ? 'ka-keyhole-on' : ''}"
                            id="ka-kh-${kh.id}"
                            data-key-id="${kh.id}"
                            aria-pressed="${pressed}"
                            aria-label="${kh.label} — ${isOn ? 'đang cắm, nhấn để rút' : 'nhấn để cắm'}"
                            type="button">
                        <span class="ka-keyhole-icon">${kh.icon}</span>
                        <span class="ka-keyhole-label">${kh.label}</span>
                    </button>
                `;
            }).join('');

            // Location sub-buttons (only shown when location is ON)
            const showLocationSubs = this.keyState.location !== 'off';
            const locMode = this.keyState.location || 'off';
            const locSubsHtml = `
                <div class="ka-loc-subs ${showLocationSubs ? 'ka-loc-subs-visible' : ''}" id="ka-loc-subs">
                    <button class="ka-loc-sub-btn ${locMode === 'whileUsing' ? 'ka-loc-sub-active' : ''}"
                            data-loc-mode="whileUsing" type="button">Khi đang dùng</button>
                    <button class="ka-loc-sub-btn ${locMode === 'always' ? 'ka-loc-sub-active' : ''}"
                            data-loc-mode="always" type="button">Mọi lúc</button>
                </div>
            `;

            // Leak indicator
            const hasLeak = this._computeLeak();
            const leakClass = hasLeak ? 'ka-hud-leak-on' : 'ka-hud-leak-ok';
            const leakLabel = hasLeak ? '⚠️ Có rò rỉ!' : '✅ An toàn';

            // Success overlay (hidden initially)
            const successHtml = `
                <div class="ka-success-overlay hidden" id="ka-success-overlay">
                    <div class="ka-success-card" id="ka-success-card">
                        <div class="ka-success-icon" id="ka-success-icon">🎉</div>
                        <div class="ka-success-text" id="ka-success-text"></div>
                        <div class="ka-success-grandma hidden" id="ka-success-grandma">
                            <div class="ka-grandma-wave" id="ka-grandma-wave">👩‍👧</div>
                        </div>
                    </div>
                </div>
            `;

            // Trap overlay for torch room
            const trapHtml = `
                <div class="ka-trap-overlay hidden" id="ka-trap-overlay">
                    <div class="ka-trap-card">
                        <div class="ka-trap-map" id="ka-trap-map">
                            <div class="ka-trap-map-title">📍 VỊ TRÍ CỦA BẠN</div>
                            <div class="ka-trap-dot ka-trap-dot-pulse"></div>
                            <div class="ka-trap-label">CyberKnight Castle</div>
                        </div>
                        <div class="ka-trap-bip" id="ka-trap-bip"></div>
                        <button class="ka-trap-close" id="ka-trap-close" type="button">OK mình hiểu rồi!</button>
                    </div>
                </div>
            `;

            // Parent approval for room 'call'
            const parentApproveHtml = `
                <div class="ka-parent-approve hidden" id="ka-parent-approve">
                    <div class="ka-parent-approve-card">
                        <div class="ka-parent-approve-icon">👨‍👩‍👧</div>
                        <p class="ka-parent-approve-text">Quyền Máy ảnh và Micro rất riêng tư.<br>Hãy nhờ bố/mẹ xem và cho phép nhé!</p>
                        <button class="ka-parent-approve-btn" id="ka-parent-approve-btn" type="button">
                            👨‍👩‍👧 Bố/mẹ đồng ý
                        </button>
                    </div>
                </div>
            `;

            this.container.innerHTML = `
                <!-- HUD -->
                <div class="ka-hud">
                    <div class="ka-hud-progress">${progress}</div>
                    <div class="ka-hud-leak ${leakClass}" id="ka-hud-leak">
                        <span>🔒 ${leakLabel}</span>
                    </div>
                    <div class="ka-hud-bip" id="ka-hud-bip-icon">🤖</div>
                </div>

                <!-- Room content -->
                <div class="ka-room" id="ka-room">
                    <div class="ka-app-card" id="ka-app-card">
                        <div class="ka-app-icon">${room.icon}</div>
                        <div class="ka-app-name">${room.app}</div>
                        <div class="ka-app-task">Cần quyền để: <strong>${room.task}</strong></div>
                    </div>

                    <div class="ka-keyholes-row">
                        ${keyholesHtml}
                    </div>

                    ${locSubsHtml}

                    <button class="ka-done-btn" id="ka-done-btn" type="button">✔ Xong phòng này</button>
                </div>

                ${successHtml}
                ${trapHtml}
                ${parentApproveHtml}
            `;

            this._bindRoomEvents();
            this._startLeakAnimation();
        }

        _bindRoomEvents() {
            // Keyhole buttons
            KEYHOLES.forEach(kh => {
                const btn = document.getElementById(`ka-kh-${kh.id}`);
                if (!btn) return;
                const handler = () => this._toggleKey(kh.id);
                this._bindOnce(btn, 'click', handler);
                // Touch-specific: use click (works for both)
            });

            // Location sub-buttons
            ['whileUsing', 'always'].forEach(mode => {
                const btn = document.getElementById(`ka-loc-subs`)?.querySelector(`[data-loc-mode="${mode}"]`);
                if (!btn) return;
                this._bindOnce(btn, 'click', () => this._setLocationMode(mode));
            });

            // Done button
            const doneBtn = document.getElementById('ka-done-btn');
            if (doneBtn) {
                this._bindOnce(doneBtn, 'click', () => this._onDonePressed());
            }
        }

        // =====================================================================
        // KEY TOGGLE
        // =====================================================================

        _toggleKey(keyId) {
            const room = this.currentRoom;
            this._playSound('keyToggle', keyId);

            if (keyId === 'location') {
                // Location cycles: off → whileUsing → always → off
                const modes = ['off', 'whileUsing', 'always'];
                const current = this.keyState.location || 'off';
                const idx = modes.indexOf(current);
                const next = modes[(idx + 1) % modes.length];
                this.keyState.location = next;
            } else {
                // Binary: off ↔ on
                this.keyState[keyId] = this.keyState[keyId] === 'on' ? 'off' : 'on';
            }

            this._refreshKeyholes();
            this._updateLeakIndicator();
            this._startLeakAnimation();

            // Clear any hint highlight
            this._clearHintPulse();
        }

        _setLocationMode(mode) {
            this._playSound('keyToggle', 'location');
            this.keyState.location = mode;
            this._refreshKeyholes();
            this._updateLeakIndicator();
            this._startLeakAnimation();
            this._clearHintPulse();
        }

        _refreshKeyholes() {
            KEYHOLES.forEach(kh => {
                const btn = document.getElementById(`ka-kh-${kh.id}`);
                if (!btn) return;
                const isOn = kh.id === 'location'
                    ? this.keyState[kh.id] !== 'off'
                    : this.keyState[kh.id] === 'on';
                btn.classList.toggle('ka-keyhole-on', isOn);
                btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
                btn.setAttribute('aria-label', `${kh.label} — ${isOn ? 'đang cắm, nhấn để rút' : 'nhấn để cắm'}`);
            });

            // Location sub-buttons
            const subsEl = document.getElementById('ka-loc-subs');
            const locMode = this.keyState.location || 'off';
            if (subsEl) {
                subsEl.classList.toggle('ka-loc-subs-visible', locMode !== 'off');
            }
            ['whileUsing', 'always'].forEach(mode => {
                const btn = subsEl?.querySelector(`[data-loc-mode="${mode}"]`);
                if (btn) btn.classList.toggle('ka-loc-sub-active', locMode === mode);
            });
        }

        // =====================================================================
        // LEAK DETECTION & VISUALS
        // =====================================================================

        _computeLeak() {
            const room = this.currentRoom;
            const state = this.keyState;
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            // Helper: is a key "needed"
            function isNeeded(keyId) {
                if (keyId === 'location') {
                    if (!room.needs.includes('location')) return false;
                    return true; // needs location in some mode
                }
                return room.needs.includes(keyId);
            }

            // Helper: is a key "wrong"
            function isWrong(keyId) {
                if (keyId === 'location') {
                    if (room.needs.includes('location')) {
                        // Check locationMode match
                        if (room.locationMode === 'whileUsing') {
                            return state.location !== 'whileUsing';
                        }
                        return false; // if room needs location any mode, location!=off is ok
                    }
                    // Room doesn't need location but it is inserted
                    return state.location !== 'off';
                }
                // Binary keys
                if (isNeeded(keyId)) {
                    return state[keyId] !== 'on';
                }
                return state[keyId] === 'on'; // extra key is wrong
            }

            // Check each ON key
            for (const kh of KEYHOLES) {
                const isOn = kh.id === 'location'
                    ? state.location !== 'off'
                    : state[kh.id] === 'on';
                if (isOn && isWrong(kh.id)) return true;
            }
            return false;
        }

        _updateLeakIndicator() {
            const el = document.getElementById('ka-hud-leak');
            if (!el) return;
            const hasLeak = this._computeLeak();
            el.className = `ka-hud-leak ${hasLeak ? 'ka-hud-leak-on' : 'ka-hud-leak-ok'}`;
            el.querySelector('span').textContent = hasLeak ? '⚠️ Có rò rỉ!' : '🔒 An toàn';
            // #region agent log
            fetch('http://127.0.0.1:7768/ingest/8602fe44-4a08-43e9-a828-2d55bf3cf826',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6ec25f'},body:JSON.stringify({sessionId:'6ec25f',runId:'post-fix-v1',hypothesisId:'A3',location:'key-audit.js:557',message:'leak indicator updated',data:{hasLeak},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
        }

        _startLeakAnimation() {
            this._stopLeak();
            const hasLeak = this._computeLeak();
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!hasLeak) return;

            this.leakActive = true;
            this._updateLeakIndicator();

            if (reduced) {
                // Static icon only
                this._showStaticLeakIcon();
                return;
            }

            // Animated bubbles
            this._spawnLeakBubbles();
            this.leakInterval = setInterval(() => {
                if (this.leakActive && this._computeLeak()) {
                    this._spawnLeakBubbles();
                }
            }, 2000);
        }

        _stopLeak() {
            this.leakActive = false;
            if (this.leakInterval) {
                clearInterval(this.leakInterval);
                this.leakInterval = null;
            }
            this._playSound('leakStop');
            this._clearLeakedIcons();
        }

        _showStaticLeakIcon() {
            const hudBip = document.getElementById('ka-hud-bip-icon');
            if (hudBip) hudBip.textContent = '👤';
        }

        _spawnLeakBubbles() {
            const room = document.getElementById('ka-room');
            if (!room || this.leakActive === false) return;

            // Which icons to leak
            const state = this.keyState;
            const icons = [];
            if (state.camera === 'on' && !this.currentRoom.needs.includes('camera')) icons.push('📷');
            if (state.micro === 'on' && !this.currentRoom.needs.includes('micro')) icons.push('🎤');
            if (state.location !== 'off' && !this.currentRoom.needs.includes('location')) icons.push('📍');
            if (state.location === 'always' && this.currentRoom.needs.includes('location') && this.currentRoom.locationMode === 'whileUsing') icons.push('📍');
            if (state.photos === 'on' && !this.currentRoom.needs.includes('photos')) icons.push('🖼️');
            if (icons.length === 0) return;

            // Target: "Chú Bóng Tò Mò"
            const targetEl = document.querySelector('.ka-hud-bip-icon') || document.getElementById('ka-hud-bip-icon');
            if (!targetEl) return;
            const targetRect = targetEl.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();

            icons.forEach((icon, i) => {
                setTimeout(() => {
                    if (!this.leakActive) return;
                    const bubble = document.createElement('div');
                    bubble.className = 'ka-leak-bubble';
                    bubble.textContent = icon;

                    // Random start position near the keyhole that leaked
                    const keyholeEl = this._getKeyholeElForIcon(icon);
                    if (keyholeEl) {
                        const khRect = keyholeEl.getBoundingClientRect();
                        const startX = khRect.left + khRect.width / 2 - containerRect.left;
                        const startY = khRect.top - containerRect.top;
                        bubble.style.left = startX + 'px';
                        bubble.style.top = startY + 'px';
                    } else {
                        bubble.style.left = (Math.random() * 60 + 20) + '%';
                        bubble.style.top = (Math.random() * 30 + 10) + '%';
                    }

                    this.container.appendChild(bubble);
                    this.leakedIcons.push(bubble);

                    // Animate toward target
                    requestAnimationFrame(() => {
                        const endX = targetRect.left + targetRect.width / 2 - containerRect.left;
                        const endY = targetRect.top + targetRect.height / 2 - containerRect.top;
                        bubble.animate([
                            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                            { transform: `translate(${endX - parseFloat(bubble.style.left)}px, ${endY - parseFloat(bubble.style.top)}px) scale(0.5)`, opacity: 0.5, offset: 0.7 },
                            { transform: `translate(${endX - parseFloat(bubble.style.left)}px, ${endY - parseFloat(bubble.style.top)}px) scale(0)`, opacity: 0 }
                        ], { duration: 1500, easing: 'ease-in' }).onfinish = () => {
                            if (bubble.parentNode) bubble.remove();
                            this.leakedIcons = this.leakedIcons.filter(e => e !== bubble);
                        };
                    });
                }, i * 300);
            });
        }

        _getKeyholeElForIcon(icon) {
            const map = { '📷': 'camera', '🎤': 'micro', '📍': 'location', '🖼️': 'photos' };
            const id = map[icon];
            return id ? document.getElementById(`ka-kh-${id}`) : null;
        }

        _clearLeakedIcons() {
            this.leakedIcons.forEach(el => { if (el.parentNode) el.remove(); });
            this.leakedIcons = [];
        }

        // =====================================================================
        // DONE PRESSED
        // =====================================================================

        _onDonePressed() {
            const room = this.currentRoom;

            // Torch room trap: Vị trí still inserted
            if (room.id === 'torch' && this.keyState.location !== 'off') {
                this.trapShown = true;
                this._showTrapMap();
                this.roomTries[room.id]++;
                return;
            }

            // Call room: prevent camera from being removed
            if (room.id === 'call' && this.keyState.camera !== 'on') {
                this._showBipMessage('Máy ảnh đang đúng mà! Gọi video cần nhìn thấy bà đó.');
                this._playSound('softBonk');
                return;
            }

            // Check correctness
            const correct = this._checkRoomCorrect();
            if (correct) {
                this._onRoomCorrect();
            } else {
                this._onRoomWrong();
            }
        }

        _checkRoomCorrect() {
            const room = this.currentRoom;
            const state = this.keyState;

            // Helper
            function allOn(keys) {
                return keys.every(k => {
                    if (k === 'location') {
                        if (room.locationMode === 'whileUsing') return state.location === 'whileUsing';
                        return state.location !== 'off';
                    }
                    return state[k] === 'on';
                });
            }
            function allOff(keys) {
                return keys.every(k => {
                    if (k === 'location') return state.location === 'off';
                    return state[k] === 'off';
                });
            }

            // Must have all needs ON
            if (room.needs.length > 0 && !allOn(room.needs)) return false;
            // Must have all non-needs OFF
            const notNeeded = KEYHOLES.map(k => k.id).filter(k => !room.needs.includes(k));
            if (!allOff(notNeeded)) return false;
            return true;
        }

        _onRoomCorrect() {
            const room = this.currentRoom;
            this._stopLeak();
            this._playSound('roomClear');
            this._clearHintPulse();

            // Show success animation
            const overlay = document.getElementById('ka-success-overlay');
            const card = document.getElementById('ka-success-card');
            const text = document.getElementById('ka-success-text');
            const icon = document.getElementById('ka-success-icon');

            if (!overlay || !card) return;

            if (room.id === 'call') {
                // Needs parent approval before success
                const parentEl = document.getElementById('ka-parent-approve');
                if (parentEl && !this.parentApproved) {
                    parentEl.classList.remove('hidden');
                    this._bindOnce(document.getElementById('ka-parent-approve-btn'), 'click', () => {
                        this.parentApproved = true;
                        this.grandmaApproved = true;
                        const parentPanel = document.getElementById('ka-parent-approve');
                        if (parentPanel) parentPanel.classList.add('hidden');
                        this._playSound('callRing');
                        this._showCallSuccess();
                    });
                    return;
                }
            }

            if (icon) icon.textContent = this._successIconForAnim(room.successAnim);
            if (text) text.textContent = room.success;
            overlay.classList.remove('hidden');

            // Play success animation
            this._playSuccessAnim(room.successAnim);

            setTimeout(() => {
                overlay.classList.add('hidden');
                this._advanceRoom();
            }, 2000);
        }

        _showCallSuccess() {
            // Hide parent approval overlay if still visible
            const parentEl = document.getElementById('ka-parent-approve');
            if (parentEl) parentEl.classList.add('hidden');

            const overlay = document.getElementById('ka-success-overlay');
            const icon = document.getElementById('ka-success-icon');
            const text = document.getElementById('ka-success-text');
            const grandmaEl = document.getElementById('ka-success-grandma');

            if (overlay) overlay.classList.remove('hidden');
            if (icon) icon.textContent = '📹';
            if (text) text.textContent = this.currentRoom.success;
            if (grandmaEl) grandmaEl.classList.remove('hidden');

            const wave = document.getElementById('ka-grandma-wave');
            if (wave) wave.textContent = '👩‍👧 📞';

            setTimeout(() => {
                overlay?.classList.add('hidden');
                this._advanceRoom();
            }, 2500);
        }

        _successIconForAnim(anim) {
            const map = { dragon: '🐉', torch: '🔦', map: '🗺️', grandma: '👩‍👧' };
            return map[anim] || '✅';
        }

        _playSuccessAnim(anim) {
            // The CSS handles most of this; JS just adds CSS classes
            const room = document.getElementById('ka-room');
            if (!room) return;
            room.classList.add('ka-room-success');
            setTimeout(() => room.classList.remove('ka-room-success'), 2000);
        }

        _showTrapMap() {
            const overlay = document.getElementById('ka-trap-overlay');
            const bip = document.getElementById('ka-trap-bip');
            if (overlay) overlay.classList.remove('hidden');
            if (bip) bip.textContent = `💬 ${this.currentRoom.trapMessage}`;
            this._bindOnce(document.getElementById('ka-trap-close'), 'click', () => {
                const trap = document.getElementById('ka-trap-overlay');
                if (trap) trap.classList.add('hidden');
                this._showBipMessage(this.currentRoom.trapMessage);
                this._playSound('softBonk');
                // Now count it as a mistake and let user fix
                this.mistakes++;
                // Show hint
                this.hintLevel = 1;
                this._showHint();
            });
        }

        _onRoomWrong() {
            const room = this.currentRoom;
            this.roomTries[room.id] = (this.roomTries[room.id] || 0) + 1;
            this.mistakes++;
            this._playSound('softBonk');

            // Increment hint level
            this.hintLevel = Math.min(this.hintLevel + 1, 3);
            this._showHint();
        }

        _showHint() {
            const room = this.currentRoom;
            if (this.hintLevel === 0 || this.hintLevel > room.hints.length) return;
            const hintText = room.hints[this.hintLevel - 1];
            this._showBipMessage(hintText);
            if (this.hintLevel >= 2) {
                this.hintsUsed++;
                this._pulseHintKeyholes();
            }
        }

        _pulseHintKeyholes() {
            const room = this.currentRoom;
            KEYHOLES.forEach(kh => {
                const btn = document.getElementById(`ka-kh-${kh.id}`);
                if (!btn) return;

                // For 'call' room: camera must be KEPT — never pulse it
                if (room.id === 'call' && kh.id === 'camera') return;

                const isOn = kh.id === 'location' ? this.keyState[kh.id] !== 'off' : this.keyState[kh.id] === 'on';
                const isNeeded = room.needs.includes(kh.id);
                const isWrong =
                    (isOn && !isNeeded) ||
                    (!isOn && isNeeded && kh.id !== 'location') ||
                    (kh.id === 'location' && room.locationMode === 'whileUsing' && this.keyState[kh.id] === 'always') ||
                    (kh.id === 'location' && room.locationMode === null && this.keyState[kh.id] !== 'off');

                if (isWrong) {
                    btn.classList.add('ka-keyhole-hint');
                    setTimeout(() => btn.classList.remove('ka-keyhole-hint'), 2000);
                }
            });

            // Highlight "Mọi lúc" option if wrong
            if (room.locationMode === 'whileUsing' && this.keyState.location === 'always') {
                const subBtn = document.querySelector('[data-loc-mode="always"]');
                if (subBtn) {
                    subBtn.classList.add('ka-keyhole-hint');
                    setTimeout(() => subBtn.classList.remove('ka-keyhole-hint'), 2000);
                }
            }
        }

        _clearHintPulse() {
            document.querySelectorAll('.ka-keyhole-hint').forEach(el => el.classList.remove('ka-keyhole-hint'));
        }

        _advanceRoom() {
            if (this.roomIndex < ROOMS.length - 1) {
                this._startRoom(this.roomIndex + 1);
            } else {
                this._onAllRoomsComplete();
            }
        }

        // =====================================================================
        // ALL ROOMS COMPLETE
        // =====================================================================

        _onAllRoomsComplete() {
            // 4 keys fly to center → assemble badge
            this._playSound('roomClear');

            // Confetti
            if (typeof confetti === 'function') {
                confetti({ particleCount: 100, spread: 80, origin: { y: 0.5 }, colors: ['#22C55E', '#FFD700', '#5BA8FF'] });
            }

            // Animate keys assembling
            const room = document.getElementById('ka-room');
            if (room) {
                room.innerHTML = `
                    <div class="ka-badge-assemble">
                        <div class="ka-badge-keys" id="ka-badge-keys">
                            <div class="ka-badge-key ka-badge-key-1">📷</div>
                            <div class="ka-badge-key ka-badge-key-2">🎤</div>
                            <div class="ka-badge-key ka-badge-key-3">📍</div>
                            <div class="ka-badge-key ka-badge-key-4">🖼️</div>
                        </div>
                        <div class="ka-badge-title">🔑🏅 NGƯỜI GIỮ CHÌA KHÓA</div>
                    </div>
                `;
            }

            setTimeout(() => {
                this.onComplete({
                    success: true,
                    mistakes: this.mistakes,
                    hintsUsed: this.hintsUsed,
                    rooms: ROOMS.map(r => ({ id: r.id, tries: this.roomTries[r.id] || 0 }))
                });
            }, 1800);
        }

        // =====================================================================
        // BIP MESSAGES
        // =====================================================================

        _showBipMessage(message) {
            clearTimeout(this.bipTimeout);
            // Try to show in-room HUD bip
            let bipEl = document.getElementById('ka-hud-bip');
            if (!bipEl) {
                // Create a floating bip
                bipEl = document.createElement('div');
                bipEl.className = 'ka-room-bip';
                bipEl.id = 'ka-hud-bip';
                this.container.appendChild(bipEl);
            }
            bipEl.innerHTML = `<div class="ka-bip-icon">🤖</div><div class="ka-bip-text">${message}</div>`;
            bipEl.classList.add('ka-room-bip-visible');

            this.bipTimeout = setTimeout(() => {
                bipEl.classList.remove('ka-room-bip-visible');
                // Check if leak is fixed
                if (!this._computeLeak()) {
                    this._showBipFixedLeak();
                }
            }, 3000);
        }

        _showBipFixedLeak() {
            this._playSound('leakStop');
            clearTimeout(this.bipTimeout);
            const bipEl = document.getElementById('ka-hud-bip');
            if (bipEl) {
                bipEl.innerHTML = `<div class="ka-bip-icon">🤖</div><div class="ka-bip-text">Hết rò rỉ rồi!</div>`;
                bipEl.classList.add('ka-room-bip-visible');
                this.bipTimeout = setTimeout(() => {
                    bipEl.classList.remove('ka-room-bip-visible');
                }, 2500);
            }
        }

        // =====================================================================
        // SOUND
        // =====================================================================

        _playSound(type, keyId) {
            try {
                const synth = window.parent?.sound;
                if (!synth) return;
                if (type === 'keyToggle') {
                    const isOn = keyId === 'location'
                        ? this.keyState.location !== 'off'
                        : this.keyState[keyId] === 'on';
                    if (isOn && synth.keyInsert) synth.keyInsert();
                    else if (!isOn && synth.keyRemove) synth.keyRemove();
                    return;
                }
                const methods = {
                    leakStop: 'leakStop',
                    roomClear: 'roomClear',
                    softBonk: 'softBonk',
                    callRing: 'callRing'
                };
                const method = methods[type];
                if (method && synth[method]) synth[method]();
            } catch (e) { /* no sound */ }
        }

        // =====================================================================
        // HELPERS
        // =====================================================================

        /**
         * Bind an event listener and track it for later cleanup.
         */
        _bindOnce(el, event, handler) {
            if (!el) return;
            el.addEventListener(event, handler);
            this._listeners.push({ el, event, handler });
        }

        // =====================================================================
        // PUBLIC API
        // =====================================================================

        /**
         * Clean up all event listeners. Call when leaving the game.
         */
        destroy() {
            clearTimeout(this.bipTimeout);
            this._stopLeak();
            this._listeners.forEach(({ el, event, handler }) => {
                try { el.removeEventListener(event, handler); } catch (e) {}
            });
            this._listeners = [];
            if (this.container) this.container.innerHTML = '';
        }

        /**
         * Reset the game to initial state.
         */
        reset() {
            this.destroy();
            this.roomIndex = 0;
            this.roomTries = {};
            this.mistakes = 0;
            this.hintsUsed = 0;
            this.currentRoom = null;
            this.parentApproved = false;
            this.grandmaApproved = false;
            this.trapShown = false;
            this.hintLevel = 0;
            this._init();
        }
    }

    // Expose to window
    window.KeyAuditGame = KeyAuditGame;

})();
