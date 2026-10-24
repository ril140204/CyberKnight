/**
 * CYBERKNIGHT — LEVEL 6: "CHẶN ĐỨNG BẮT NẠT MẠNG"
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth, Mini-game dọn tin nhắn.
 *
 * Kiến trúc kế thừa từ Level 5:
 * - Asset base probing (ResourceSource.baseIdx + videoExt) — KHÔNG derive từ URL
 * - 1 video element / scene, preload="auto", playsinline, CÓ TIẾNG (không muted)
 * - Freeze-frame crossfade (canvas capture + opacity fade)
 * - AudioSynth (WebAudio, không dùng file âm thanh)
 * - Class-based stage switcher + z-index CSS scale
 * - THOÁT (ESC) + postMessage fallback
 * - Video error panel (retry / skip scene)
 * - Debug flags trong URL
 *
 * Khác Level 5:
 * - SCENE_FLOW table (không parseInt + 1)
 * - 3 câu trả lời A/B/C trung tính, chọn sai → phản hồi tại chỗ, chọn lại không giới hạn
 * - Mini-game "Dọn dẹp tin nhắn xấu xí" (bấm hoặc kéo-thả, Pointer Events)
 * - Summary RÚT GỌN: 1 tiêu đề + đúng 3 ý (Level 5 có 6 khối)
 */
(function () {
    'use strict';

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    const CONFIG = {
        // Thứ tự ưu tiên thư mục asset (thư mục thật có KHOẢNG TRẮNG: "level 6")
        BASES: [
            '../video/level 6/',
            '../video/level6/',
            'video/level6/',
            './'
        ],
        VIDEO_EXTS: ['.mp4', '.webm', '.mov'],
        VIDEO_SCENES: ['scene1', 'scene2', 'scene3', 'complete', 'badge'],
        // Nhãn thân thiện cho từng scene (dùng trong panel lỗi video)
        SCENE_LABELS: {
            scene1: 'Cảnh 1',
            scene2: 'Cảnh 2',
            scene3: 'Cảnh 3',
            complete: 'Cảnh hoàn thành',
            badge: 'Cảnh nhận huy hiệu'
        },
        BADGE_NAME: 'HIỆP SĨ BẢO VỆ BẠN BÈ',
        LOADING_TIMEOUT_MS: 8000,
        IDLE_HINT_MS: 15000,
        CORRECT_EFFECT_MS: 800,
        WRONG_EFFECT_MS: 600,
        // Ngưỡng phân biệt "chạm" và "kéo" (px). Ngón tay luôn rung vài px
        // khi chạm → dưới ngưỡng này coi như chạm, không phải kéo.
        DRAG_THRESHOLD_PX: 8,
        // Mini-game: 3 bong bóng chat — dùng ĐÚNG 3 câu này, không cho nhập chữ tự do
        BUBBLE_TEXTS: [
            'Đồ ngốc nghếch!',
            'Trông cậu thật xấu xí',
            'Hahaha, lêu lêu'
        ],
        BUBBLE_TOTAL: 3,
        // Lưới an toàn cho nút BỎ QUA (seek chưa xong)
        SKIP_FALLBACK_MS: 1500
    };

    /**
     * Bảng luồng tường minh — thay cho parseInt + 1.
     * scene1 → câu hỏi · scene2 → scene3 · scene3 → mini-game dọn tin
     * complete → badge → summary
     */
    const SCENE_FLOW = {
        scene1: { question: 'decide' },
        scene2: { next: 'scene3' },
        scene3: { question: 'cleanup' },
        complete: { next: 'badge' },
        badge: { next: 'summary' }
    };

    const ALL_STAGES = [
        'scene1', 'q1', 'scene2', 'scene3', 'cleanup', 'complete', 'badge', 'summary'
    ];

    /** Cờ chống kết thúc scene trùng lặp (xem _triggerSceneEnd) */
    const _sceneEnded = {
        scene1: false, scene2: false, scene3: false, complete: false, badge: false
    };

    /** Đáp án đúng của Câu hỏi 1 */
    const CORRECT_CHOICE = 'c';

    /**
     * ResourceSource: dò thư mục + đuôi file, cache lại dùng chung cho
     * mọi video (Level 6 không có ảnh).
     */
    const ResourceSource = {
        baseIdx: null,
        videoExt: null,

        base() {
            return (this.baseIdx === null) ? '' : CONFIG.BASES[this.baseIdx];
        },

        videoUrl(sceneName) {
            if (this.baseIdx === null || !this.videoExt) return null;
            return encodeURI(this.base() + sceneName + this.videoExt);
        }
    };

    /**
     * Runtime state.
     */
    const level6State = {
        currentScene: null,
        question: {
            firstChoice: null,
            attempts: 0,
            correct: false,
            locked: false,        // khoá 3 nút sau lần chạm đầu (tránh double-fire)
            history: []           // mảng 'a' | 'b' | 'c' theo thứ tự con chọn
        },
        cleanup: {
            resolved: [],         // danh sách index bong bóng đã dọn
            activeBubble: null,   // bong bóng đang được kéo
            finished: false
        }
    };

    // =========================================================================
    // 2. ASSET PROBING
    // =========================================================================

    let _probePromise = null;

    /**
     * Dò sự tồn tại của file video.
     * Dùng <video preload="metadata"> + kiểm `videoWidth > 0` để tránh
     * false-positive (server có SPA fallback trả 200 + text/html cho URL lạ).
     */
    function _probeVideo(url) {
        return new Promise(resolve => {
            const v = document.createElement('video');
            v.preload = 'metadata';   // chỉ lấy header — nhẹ hơn nhiều so với tải cả video
            v.muted = true;           // chỉ dùng để dò tồn tại, KHÔNG ảnh hưởng video thật
            v.playsInline = true;
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                v.onloadedmetadata = null;
                v.onerror = null;
                try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
                resolve(ok);
            };
            const timer = setTimeout(() => finish(false), 8000);
            v.onloadedmetadata = () => {
                // Log TRƯỚC finish() vì finish() gỡ src → videoWidth bị reset về 0
                finish(v.videoWidth > 0 && v.videoHeight > 0);
            };
            v.onerror = () => {
                finish(false);
            };
            v.src = encodeURI(url);
            v.load();
        });
    }

    async function _probeVideoExts(base) {
        for (const ext of CONFIG.VIDEO_EXTS) {
            // Dò bằng tên file chuẩn của Level 6 — nếu tên khác vẫn thử tên scene1
            if (await _probeVideo(base + 'scene1' + ext)) return ext;
        }
        return null;
    }

    /**
     * Kiểm tra (chỉ khi ?debug) rằng TẤT CẢ scene đều có file tương ứng.
     * Không chặn game — chỉ cảnh báo trong console để dễ phát hiện thiếu asset.
     */
    async function _warnMissingScenes(base, ext) {
        if (!_isDebugMode()) return;
        const missing = [];
        for (const scene of CONFIG.VIDEO_SCENES) {
            const ok = await _probeVideo(base + scene + ext);
            if (!ok) missing.push(`${scene} (${_sceneLabel(scene)})`);
        }
        if (missing.length) {
            console.warn(
                `[Level6] ⚠️ Thiếu file video trong "${base}" với đuôi "${ext}": ${missing.join(', ')}`
            );
        } else {
            console.log(`[Level6] Đủ ${CONFIG.VIDEO_SCENES.length} file video trong "${base}" (${ext})`);
        }
    }

    /**
     * Dò tất cả: ưu tiên thư mục, sau đó ưu tiên đuôi file.
     */
    async function _probeAll() {
        for (let b = 0; b < CONFIG.BASES.length; b++) {
            const base = CONFIG.BASES[b];
            const vidExt = await _probeVideoExts(base);

            if (vidExt) {
                ResourceSource.baseIdx = b;
                ResourceSource.videoExt = vidExt;
                if (_isDebugMode()) {
                    console.log(`[Level6] Assets OK → base[${b}]=${base} video=${vidExt}`);
                }
                // Cảnh báo (chỉ ?debug) nếu thiếu file của scene nào đó
                _warnMissingScenes(base, vidExt);
                return true;
            }
        }

        if (_isDebugMode()) console.error('[Level6] Không tìm thấy video nào');
        return false;
    }

    function ensureAssets() {
        if (!_probePromise) _probePromise = _probeAll();
        return _probePromise;
    }

    // =========================================================================
    // 3. AUDIO SYNTH
    // =========================================================================

    class AudioSynth {
        constructor() { this.ctx = null; }

        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.ctx = new AudioCtx();
            }
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        }

        playTick() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + 0.05);
        }

        playCorrectCatch() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.18);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.28);
        }

        playIncorrectCatch() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(110, now + 0.16);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.16);
        }

        playVictoryChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.18, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.4);
            });
        }

        playSoftBip() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.12);
        }

        /** Tiếng "bùm" — bong bóng tin nhắn xấu vỡ */
        playBubblePop() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(140, now + 0.14);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.16);
        }

        /** Âm "ting" — chặn tin xấu thành công */
        playBlockChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [880, 1174.66].forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.09);
                gain.gain.setValueAtTime(0.16, now + idx * 0.09);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.09); osc.stop(now + idx * 0.09 + 0.35);
            });
        }

        /** Âm "ting" sáng — bong bóng 3 làm màn hình sáng bừng */
        playBullyVanish() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1046.50, now);
            osc.frequency.exponentialRampToValueAtTime(2093, now + 0.22);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.5);
        }
    }

    const sound = new AudioSynth();
    try { window.sound = sound; } catch (e) {}

    // =========================================================================
    // 4. FREEZE-FRAME CROSSFADE
    // =========================================================================

    const FreezeFrame = {
        canvas: null,
        ctx: null,

        init() {
            this.canvas = document.getElementById('freeze-canvas');
            if (this.canvas) {
                this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
                this.resize();
                window.addEventListener('resize', () => this.resize());
            }
        },

        resize() {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        captureFromVideo(videoEl) {
            if (!this.ctx || !videoEl || videoEl.readyState < 2) return false;
            try {
                const vw = videoEl.videoWidth || 1280;
                const vh = videoEl.videoHeight || 720;
                const cw = this.canvas.width;
                const ch = this.canvas.height;
                const vAspect = vw / vh;
                const cAspect = cw / ch;

                let drawW, drawH, drawX, drawY;
                if (vAspect > cAspect) {
                    drawW = cw;
                    drawH = cw / vAspect;
                    drawX = 0;
                    drawY = (ch - drawH) / 2;
                } else {
                    drawH = ch;
                    drawW = ch * vAspect;
                    drawX = (cw - drawW) / 2;
                    drawY = 0;
                }

                this.ctx.clearRect(0, 0, cw, ch);
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, cw, ch);
                this.ctx.drawImage(videoEl, drawX, drawY, drawW, drawH);
                return true;
            } catch (err) {
                if (_isDebugMode()) console.warn('Freeze frame capture failed:', err.message);
                return false;
            }
        },

        async crossfade(prepareNewStageCallback) {
            if (!this.canvas) {
                if (prepareNewStageCallback) prepareNewStageCallback();
                return;
            }
            this.canvas.style.opacity = '1';
            this.canvas.style.transition = 'opacity 0.25s ease-in-out';
            if (prepareNewStageCallback) {
                requestAnimationFrame(prepareNewStageCallback);
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.canvas.style.opacity = '0';
                });
            });
        }
    };

    // =========================================================================
    // 5. TOP BAR
    // =========================================================================

    const TopBar = {
        skipBtn: null,
        exitBtn: null,

        init() {
            this.skipBtn = document.getElementById('btn-skip-video');
            this.exitBtn = document.getElementById('btn-exit-level');

            if (this.skipBtn) {
                this.skipBtn.addEventListener('click', () => {
                    sound.init();
                    sound.playTick();
                    this._skipCurrent();
                });
            }

            if (this.exitBtn) {
                this.exitBtn.addEventListener('click', () => {
                    sound.init();
                    sound.playTick();
                    this.exitLevel();
                });
            }

            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.exitLevel();
            });
        },

        _skipCurrent() {
            const scene = level6State.currentScene;
            if (!scene) return;
            const videoEl = document.getElementById(`video-${scene}`);
            if (videoEl && !videoEl.ended) {
                if (videoEl.duration && videoEl.readyState >= 1) {
                    videoEl.currentTime = videoEl.duration - 0.05;
                    // Mạng chậm có thể chưa seek xong → đặt lưới an toàn.
                    // triggerEnd() có cờ endedTriggered nên không sợ gọi trùng.
                    clearTimeout(this._skipFallbackTimer);
                    this._skipFallbackTimer = setTimeout(() => {
                        this._skipFallbackTimer = null;
                        const v = document.getElementById(`video-${scene}`);
                        if (v && !v.ended && v.currentTime < (v.duration || Infinity) - 0.5) {
                            _triggerSceneEnd(scene);
                        }
                    }, CONFIG.SKIP_FALLBACK_MS);
                } else {
                    _triggerSceneEnd(scene);
                }
            } else {
                _triggerSceneEnd(scene);
            }
        },

        updateVisibility(stage) {
            if (!this.skipBtn) return;
            // BỎ QUA chỉ hiện ở các stage VIDEO
            const showSkip = CONFIG.VIDEO_SCENES.includes(stage);
            this.skipBtn.classList.toggle('hidden', !showSkip);
        },

        exitLevel() {
            // Dừng mọi timer của mini-game & màn hỏi để không có tác vụ nào
            // chạy ngầm sau khi rời level (tránh nhảy màn sai).
            CleanupGame._clearTimers();
            _clearTimers();
            stopAllVideos();
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) { if (_isDebugMode()) console.warn('postMessage error:', err); }
            window.location.href = '../index.html';
        }
    };

    // =========================================================================
    // 6. VIDEO / SCENE MANAGEMENT
    // =========================================================================

    function stopAllVideos() {
        document.querySelectorAll('video').forEach(v => {
            try { v.pause(); } catch (e) {}
        });
    }

    function resetAllVideos() {
        document.querySelectorAll('video').forEach(v => {
            try { v.pause(); v.currentTime = 0; } catch (e) {}
        });
    }

    function _isDebugMode() {
        return new URLSearchParams(window.location.search).has('debug');
    }

    /** Nhãn thân thiện của scene (dùng cho panel lỗi video) */
    function _sceneLabel(sceneName) {
        return CONFIG.SCENE_LABELS[sceneName] || sceneName;
    }

    function _showVideoErrorPanel(stageId, sceneLabel, triedUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

        // QUAN TRỌNG: nếu scene lỗi phát sinh TRƯỚC khi stage được kích hoạt,
        // error panel sẽ nằm trong một stage không có class 'active' → NGƯỜI DÙNG KHÔNG
        // THẤY GÌ. Ép kích hoạt stage + hiện nút BỎ QUA trước khi vẽ panel.
        if (!stage.classList.contains('active')) {
            switchStage(stageId);
            TopBar.updateVisibility(stageId);
        }

        const existing = stage.querySelector('.video-error-panel');
        if (existing) existing.remove();

        const debugHtml = _isDebugMode()
            ? `<div class="video-error-urls">Đã thử:<br>${triedUrls.map(u => new URL(u, location.href).href).join('<br>')}</div>`
            : '';

        const panel = document.createElement('div');
        panel.className = 'video-error-panel';
        panel.innerHTML = `
            <div class="video-error-inner">
                <div class="video-error-icon">😢</div>
                <div class="video-error-title">Không tải được video cảnh ${sceneLabel} 😢</div>
                ${debugHtml}
                <div class="video-error-buttons">
                    <button class="video-error-btn video-error-retry" type="button" aria-label="Thử tải lại video">🔄 Thử lại</button>
                    <button class="video-error-btn video-error-skip" type="button" aria-label="Bỏ qua cảnh">⏭️ Bỏ qua cảnh</button>
                </div>
            </div>
        `;

        stage.querySelector('.video-container')?.appendChild(panel);

        panel.querySelector('.video-error-retry')?.addEventListener('click', () => {
            panel.remove();
            _playScene(stageId, { forceReload: true });
        });

        panel.querySelector('.video-error-skip')?.addEventListener('click', () => {
            panel.remove();
            _handleSkipScene(stageId);
        });
    }

    /**
     * "Bỏ qua cảnh" — đi theo SCENE_FLOW.
     */
    function _handleSkipScene(stageId) {
        const flow = SCENE_FLOW[stageId];
        if (!flow) {
            _advanceToScene('summary');
            return;
        }
        if (flow.next) {
            _advanceToScene(flow.next);
        } else if (flow.question) {
            _handleQuestion(flow.question);
        }
    }

    /**
     * Play một scene video.
     * @param {string} sceneName - 'scene1' | 'scene2' | 'scene3' | 'complete' | 'badge'
     */
    async function _playScene(sceneName, options = {}) {
        const { onEnded, forceReload } = options;
        level6State.currentScene = sceneName;

        // Huỷ lưới an toàn của lần BỎ QUA trước đó (nếu có)
        if (TopBar._skipFallbackTimer) {
            clearTimeout(TopBar._skipFallbackTimer);
            TopBar._skipFallbackTimer = null;
        }

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (!videoEl) {
            if (_isDebugMode()) console.error(`[Level6] Không tìm thấy #video-${sceneName}`);
            if (onEnded) onEnded();
            return;
        }

        // DỪNG mọi video khác đang phát. Nếu không, handler 'ended' của video
        // cũ có thể bắn lại sau khi đã chuyển sang cảnh khác và làm luồng nhảy sai.
        document.querySelectorAll('video').forEach(v => {
            if (v === videoEl) return;
            try {
                v.pause();
                v.onended = null;
                v.ontimeupdate = null;
            } catch (e) {}
        });

        // Cho phép scene này kết thúc lại (dùng lại khi chơi lại)
        if (_sceneEnded.hasOwnProperty(sceneName)) _sceneEnded[sceneName] = false;

        await ensureAssets();

        const url = ResourceSource.videoUrl(sceneName);
        if (!url) {
            _showVideoErrorPanel(sceneName, _sceneLabel(sceneName), _allTriedVideoUrls(sceneName));
            return;
        }

        // ---- Loading helpers ----
        let slowLoadingTimer = null;

        function showLoading() {
            const container = videoEl.closest('.video-container');
            const spinner = container?.querySelector('.video-loading-spinner');
            if (spinner) spinner.classList.remove('hidden');
        }

        function hideLoading() {
            const container = videoEl.closest('.video-container');
            if (container) {
                container.querySelector('.video-loading-spinner')?.classList.add('hidden');
                container.querySelector('.video-loading-slow')?.classList.add('hidden');
            }
            clearTimeout(slowLoadingTimer);
        }

        showLoading();
        slowLoadingTimer = setTimeout(() => {
            const container = videoEl.closest('.video-container');
            const slow = container?.querySelector('.video-loading-slow');
            if (slow) slow.classList.remove('hidden');
        }, CONFIG.LOADING_TIMEOUT_MS);

        const currentSrc = videoEl.getAttribute('src') || '';
        if (currentSrc !== url || forceReload) {
            videoEl.removeAttribute('src');
            videoEl.load();
            // KHÔNG set muted — video Level 6 CÓ TIẾNG.
            videoEl.src = url;
        }
        videoEl.preload = 'auto';

        if (_isDebugMode()) {
            console.log(`[Level6] Scene ${sceneName} → ${new URL(url, location.href).href}`);
        }

        let errorHandled = false;
        function onError() {
            if (errorHandled) return;
            errorHandled = true;
            hideLoading();
            cleanupListeners();
            if (_isDebugMode()) console.error('[Level6] Video lỗi:', sceneName, url);
            _showVideoErrorPanel(sceneName, _sceneLabel(sceneName), _allTriedVideoUrls(sceneName));
        }

        function onCanPlay() {
            hideLoading();
        }

        function cleanupListeners() {
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.removeEventListener('error', onError);
        }

        videoEl.addEventListener('canplay', onCanPlay, { once: true });
        videoEl.addEventListener('error', onError);

        let endedTriggered = false;
        function triggerEnd() {
            if (endedTriggered) return;
            endedTriggered = true;
            cleanupListeners();
            hideLoading();
            _triggerSceneEnd(sceneName, onEnded);
        }
        videoEl.onended = triggerEnd;
        videoEl.ontimeupdate = () => {
            if (videoEl.duration && !endedTriggered) {
                if (videoEl.duration - videoEl.currentTime <= 0.15) triggerEnd();
            }
        };

        if (videoEl.currentTime !== 0) {
            try { videoEl.currentTime = 0; } catch (e) {}
        }

        const startPlayback = () => {
            const p = videoEl.play();
            if (p !== undefined) {
                p.catch((err) => {
                    if (err.name === 'NotAllowedError') {
                        // Autoplay bị chặn (video có tiếng) → hiện nút "BẤM ĐỂ XEM TIẾP"
                        hideLoading();
                        _showPlayButtonOverlay(videoEl, sceneName);
                    } else if (err.name === 'NotSupportedError' || err.name === 'AbortError') {
                        onError();
                    }
                });
            }
        };

        Promise.resolve().then(() => {
            if (videoEl.readyState >= 3 && videoEl.paused) {
                startPlayback();
            } else {
                videoEl.addEventListener('canplay', function once() {
                    videoEl.removeEventListener('canplay', once);
                    startPlayback();
                }, { once: true });
            }
        });

        switchStage(sceneName);
        TopBar.updateVisibility(sceneName);
    }

    function _allTriedVideoUrls(sceneName) {
        const urls = [];
        CONFIG.BASES.forEach(b => CONFIG.VIDEO_EXTS.forEach(e => urls.push(b + sceneName + e)));
        return urls;
    }

    function _showPlayButtonOverlay(videoEl, sceneName) {
        const container = videoEl.closest('.video-container');
        if (!container) return;
        const existing = container.querySelector('.video-play-overlay');
        if (existing) return;

        const overlay = document.createElement('div');
        overlay.className = 'video-play-overlay';
        overlay.innerHTML = `
            <button class="video-play-btn" type="button" aria-label="Bấm để xem tiếp">▶ BẤM ĐỂ XEM TIẾP</button>
        `;

        overlay.querySelector('.video-play-btn')?.addEventListener('click', () => {
            overlay.remove();
            videoEl.play();
        });

        container.appendChild(overlay);
    }

    /**
     * Kết thúc scene — capture freeze-frame rồi chuyển tiếp.
     *
     * Cờ `_sceneEnded` chống gọi trùng: nếu không có nó, khi người dùng bấm
     * "BỎ QUA" trước khi video kịp seek (duration chưa sẵn sàng) và sau đó video
     * thật sự phát hết, handler 'ended' sẽ bắn LẦN NỮA → chạy lại luồng →
     * tính sai sao/XP.
     */
    function _triggerSceneEnd(sceneName, onEnded) {
        if (_sceneEnded[sceneName]) return;
        _sceneEnded[sceneName] = true;

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (videoEl) {
            videoEl.pause();
            videoEl.onended = null;
            videoEl.ontimeupdate = null;
            requestAnimationFrame(() => FreezeFrame.captureFromVideo(videoEl));
        }

        FreezeFrame.crossfade(() => {
            if (onEnded) {
                onEnded();
                return;
            }
            _advanceAfterSceneEnd(sceneName);
        });
    }

    function _advanceAfterSceneEnd(sceneName) {
        const flow = SCENE_FLOW[sceneName];
        if (!flow) {
            _advanceToScene('summary');
            return;
        }
        if (flow.next) {
            _advanceToScene(flow.next);
        } else if (flow.question) {
            _handleQuestion(flow.question);
        }
    }

    function _advanceToScene(sceneName) {
        sound.init();
        if (sceneName === 'summary') {
            _showSummary();
            return;
        }
        _playScene(sceneName);
    }

    /**
     * Điểm vào của "câu hỏi" theo SCENE_FLOW.
     *  - 'decide'  : màn câu hỏi 3 lựa chọn A/B/C
     *  - 'cleanup' : mini-game dọn tin nhắn xấu xí
     */
    function _handleQuestion(kind) {
        if (kind === 'decide') {
            _showQuestionStage({ fresh: true });
        } else if (kind === 'cleanup') {
            _showCleanupStage();
        }
    }

    // =========================================================================
    // 7. QUESTION STAGE (stage-q1) — 3 lựa chọn A/B/C
    // =========================================================================

    let _idleHintTimer = null;
    let _flowTimer = null;

    function _clearTimers() {
        if (_idleHintTimer) { clearTimeout(_idleHintTimer); _idleHintTimer = null; }
        if (_flowTimer) { clearTimeout(_flowTimer); _flowTimer = null; }
    }

    /** Phản hồi Bíp cho từng lựa chọn sai — KHÔNG bao giờ nói thẳng đáp án đúng */
    const WRONG_FEEDBACK = {
        a: 'Ôi không, làm vậy bạn kia sẽ tổn thương lắm!',
        b: 'Mình có thể giúp bạn ấy cơ mà, thử cách khác xem! Chọn lại nhé con.'
    };

    function _showQuestionStage(options = {}) {
        const { fresh = true } = options;
        sound.init();

        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        FreezeFrame.crossfade(() => {
            switchStage('q1');
            TopBar.updateVisibility('q1');

            _resetQuestionStageUI(fresh);
            _resetIdleHint();
        });
    }

    /**
     * Reset UI màn câu hỏi.
     * Giữ lại màu cam của nút con đã chọn sai trước đó (để con nhớ),
     * nhưng mở khoá cả 3 nút → con được chọn lại không giới hạn.
     */
    function _resetQuestionStageUI(fresh) {
        const btns = ['a', 'b', 'c'].map(k => document.getElementById(`btn-answer-${k}`));

        if (fresh) {
            level6State.question.history = [];
            level6State.question.firstChoice = null;
            level6State.question.attempts = 0;
            level6State.question.correct = false;
        }

        // Mở khoá 3 nút đáp án (con được chọn lại)
        level6State.question.locked = false;

        btns.forEach(btn => {
            if (!btn) return;
            btn.classList.remove('bl-selected-correct', 'bl-selected-wrong');
            btn.disabled = false;
        });

        // Giữ lại màu cam nạt của nút con đã chọn sai
        btns.forEach(btn => {
            if (!btn) return;
            const choice = btn.dataset.choice;
            if (choice !== CORRECT_CHOICE && level6State.question.history.includes(choice)) {
                btn.classList.add('bl-selected-wrong');
            }
        });

        _setBip('Bíp đây! Mình nghe bạn kể rồi. Cùng suy nghĩ xem cách nào giúp người bị bắt nạt tốt nhất nhé!');
        const bip = document.getElementById('bl-bip');
        if (bip) bip.classList.remove('bl-bip-hint');
    }

    function _setBip(text) {
        const el = document.getElementById('bl-bip-text');
        if (el) el.textContent = text;
    }

    function _showHint(playSound = true) {
        _setBip('Gợi ý nè: Cách nào vừa giúp bạn kia vừa khiến kẻ xấu không dám làm nữa?');
        const bip = document.getElementById('bl-bip');
        if (bip) bip.classList.add('bl-bip-hint');
        if (playSound) sound.playSoftBip();
    }

    function _resetIdleHint() {
        if (_idleHintTimer) clearTimeout(_idleHintTimer);
        _idleHintTimer = setTimeout(() => {
            if (level6State.question.correct) return;
            _showHint();
        }, CONFIG.IDLE_HINT_MS);
    }

    function _wireAnswerButtons() {
        ['a', 'b', 'c'].forEach(key => {
            const btn = document.getElementById(`btn-answer-${key}`);
            if (!btn) return;
            btn.addEventListener('click', () => {
                _handleAnswer(key, btn);
            });
        });
    }

    function _handleAnswer(choice, btnEl) {
        const q = level6State.question;
        if (q.locked) return;   // khoá sau lần chạm đầu (tránh double-fire)

        q.locked = true;
        q.attempts++;
        q.history.push(choice);
        if (q.firstChoice === null) q.firstChoice = choice;

        const isCorrect = (choice === CORRECT_CHOICE);

        sound.init();
        if (isCorrect) sound.playCorrectCatch();
        else sound.playIncorrectCatch();

        // Chỉ nút ĐÃ CHỌN được tô màu — KHÔNG bao giờ lộ đáp án đúng
        ['a', 'b', 'c'].forEach(k => {
            const b = document.getElementById(`btn-answer-${k}`);
            if (b) b.disabled = true;
        });
        if (btnEl) {
            btnEl.classList.remove('bl-selected-correct', 'bl-selected-wrong');
            btnEl.classList.add(isCorrect ? 'bl-selected-correct' : 'bl-selected-wrong');
        }

        _resetIdleHint();

        if (isCorrect) {
            q.correct = true;
            _setBip('Chuẩn rồi con! Đây mới là cách bảo vệ bạn ấy tốt nhất!');
            // Pháo giấy ăn mừng
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 120,
                    spread: 80,
                    origin: { y: 0.6 },
                    colors: ['#00B8A9', '#22C55E', '#5BA8FF']
                });
            }
            _flowTimer = setTimeout(() => {
                _flowTimer = null;
                _playScene('scene2');
            }, CONFIG.CORRECT_EFFECT_MS);
        } else {
            // Phản hồi TẠI CHỖ — không phát video riêng, cho chọn lại không giới hạn
            _setBip(WRONG_FEEDBACK[choice] || 'Thử cách khác xem nhé con!');
            const bip = document.getElementById('bl-bip');
            if (bip) bip.classList.add('bl-bip-hint');

            // Mở khoá lại 3 nút sau một nhịp ngắn để con chọn tiếp
            _flowTimer = setTimeout(() => {
                _flowTimer = null;
                level6State.question.locked = false;
                ['a', 'b', 'c'].forEach(k => {
                    const b = document.getElementById(`btn-answer-${k}`);
                    if (b) b.disabled = false;
                });
                // Giữ nguyên màu cam của nút vừa chọn sai để con nhớ
                _resetIdleHint();
            }, CONFIG.WRONG_EFFECT_MS);
        }
    }

    // =========================================================================
    // 8. MINI-GAME (stage-cleanup) — Dọn dẹp tin nhắn xấu xí
    // =========================================================================

    const CleanupGame = {
        field: null,
        trash: null,
        bubbles: [],       // { el, text, index, resolved }
        dragState: null,   // { bubble, offsetX, offsetY, pointerId, moved, startX, startY }
        _listenersBound: false,
        _suppressClick: false,
        _timers: [],       // mọi setTimeout của mini-game (để clear khi reset/thoát)
        _idleTimer: null,  // timer gợi ý Bíp khi con im lặng quá lâu

        init() {
            this.field = document.getElementById('bl-bubble-field');
            this.trash = document.getElementById('bl-trash');
            if (!this.field || !this.trash) return;

            this._buildBubbles();
            this._wireDrag();
            this._wireTrashKeyboard();
            this._startIdleHint();
        },

        /** Đăng ký 1 timer của mini-game để clear được khi reset/thoát */
        _setTimer(fn, ms) {
            const id = setTimeout(() => {
                this._timers = this._timers.filter(t => t !== id);
                fn();
            }, ms);
            this._timers.push(id);
            return id;
        },

        /** Xoá toàn bộ timer đang chạy của mini-game */
        _clearTimers() {
            this._timers.forEach(id => clearTimeout(id));
            this._timers = [];
            if (this._idleTimer) {
                clearTimeout(this._idleTimer);
                this._idleTimer = null;
            }
        },

        /**
         * Gợi ý Bíp khi con không thao tác trong IDLE_HINT_MS giây.
         * Timer được reset mỗi lần con chạm/kéo bong bóng.
         */
        _startIdleHint() {
            if (this._idleTimer) clearTimeout(this._idleTimer);
            this._idleTimer = setTimeout(() => {
                this._idleTimer = null;
                if (level6State.cleanup.finished) return;
                if (level6State.cleanup.resolved.length > 0 && level6State.cleanup.resolved.length < CONFIG.BUBBLE_TOTAL) {
                    _setCleanupBip('Còn mấy tin xấu nữa đấy! Chạm vào một bong bóng xấu nhé con!');
                } else if (level6State.cleanup.resolved.length === 0) {
                    _setCleanupBip('Thử chạm vào một bong bóng xấu nhé con!');
                }
                sound.playSoftBip();
            }, CONFIG.IDLE_HINT_MS);
        },

        /** Tạo 3 bong bóng chat với vị trí ngẫu nhiên (không trùng lặp) */
        _buildBubbles() {
            this.field.innerHTML = '';
            this.bubbles = [];

            // Vị trí tương đối (%) để responsive
            const spots = [
                { x: 0.10, y: 0.18, delay: 0 },
                { x: 0.42, y: 0.52, delay: 1.1 },
                { x: 0.16, y: 0.66, delay: 2.2 }
            ];

            CONFIG.BUBBLE_TEXTS.forEach((text, idx) => {
                const el = document.createElement('div');
                el.className = 'bl-chat-bubble';
                el.dataset.index = String(idx);
                el.setAttribute('role', 'button');
                el.setAttribute('tabindex', '0');
                el.setAttribute('aria-label', `Tin nhắn xấu: ${text}. Bấm hoặc kéo vào thùng Chặn để dọn.`);
                el.textContent = text;
                el.style.left = `${spots[idx].x * 100}%`;
                el.style.top = `${spots[idx].y * 100}%`;
                el.style.animationDelay = `${spots[idx].delay}s`;

                // Bấm / chạm (cách chính — touch-first) và bàn phím
                el.addEventListener('click', (e) => {
                    // Bỏ qua click phát sinh từ thao tác kéo-thả
                    if (this._suppressClick) {
                        this._suppressClick = false;
                        return;
                    }
                    e.preventDefault();
                    this._startIdleHint();
                    this.resolveBubble(idx);
                });
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                        e.preventDefault();
                        this.resolveBubble(idx);
                    }
                });

                this.field.appendChild(el);
                this.bubbles.push({ el, text, index: idx, resolved: false });
            });
        },

        /** Kéo-thả bằng Pointer Events (tham khảo level2/door-puzzle.js) */
        _wireDrag() {
            this.bubbles.forEach(b => {
                b.el.addEventListener('pointerdown', (e) => this._onDragStart(e, b));
            });

            // Move/End gắn trên window để kéo ra ngoài vùng bong bóng vẫn hoạt động.
            // Dùng cờ _listenersBound để KHÔNG đăng ký trùng mỗi lần vào mini-game.
            if (this._listenersBound) return;
            this._listenersBound = true;

            window.addEventListener('pointermove', (e) => this._onDragMove(e));
            window.addEventListener('pointerup', (e) => this._onDragEnd(e));
            window.addEventListener('pointercancel', (e) => this._onDragEnd(e));
        },

        _onDragStart(e, bubble) {
            if (bubble.resolved) return;
            if (level6State.cleanup.finished) return;

            e.preventDefault();

            const rect = bubble.el.getBoundingClientRect();
            // Tính offset MỘT LẦN duy nhất tại thời điểm bắt đầu.
            // (Tính lại trong move sẽ bị lệch vì rect thay đổi mỗi frame.)
            this.dragState = {
                bubble,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
                moved: false,
                pointerId: e.pointerId,
                // Toạ độ bắt đầu — dùng để đo quãng dịch chuyển thực tế.
                // Ngón tay luôn "rung" vài px khi chạm → phải có NGƯỠNG
                // mới phân biệt được "chạm" với "kéo".
                startX: e.clientX,
                startY: e.clientY
            };

            bubble.el.classList.add('bl-dragging');
            try { bubble.el.setPointerCapture(e.pointerId); } catch (err) {}
            level6State.cleanup.activeBubble = bubble.index;
        },

        _onDragMove(e) {
            const ds = this.dragState;
            if (!ds || ds.bubble.resolved) return;
            if (e.pointerId !== undefined && ds.pointerId !== undefined && e.pointerId !== ds.pointerId) return;

            // Đo quãng dịch chuyển từ điểm BẤM ĐẦU (không phải từ frame trước).
            // Dưới ngưỡng → coi như "chạm có rung", CHƯA phải kéo.
            const dx = e.clientX - ds.startX;
            const dy = e.clientY - ds.startY;
            const dist = Math.hypot(dx, dy);

            if (!ds.moved && dist < CONFIG.DRAG_THRESHOLD_PX) {
                // Vẫn trong vùng "rung" → không di chuyển bong bóng, không đánh dấu kéo.
                return;
            }

            if (!ds.moved) {
                // Chính thức là kéo → reset timer gợi ý, cho phép hiệu ứng kéo.
                ds.moved = true;
                this._startIdleHint();
            }

            const fieldRect = this.field.getBoundingClientRect();
            const bRect = ds.bubble.el.getBoundingClientRect();

            // Tính toạ độ tương đối so với vùng field
            let x = e.clientX - fieldRect.left - ds.offsetX;
            let y = e.clientY - fieldRect.top - ds.offsetY;

            // Giới hạn trong vùng field
            x = Math.max(0, Math.min(fieldRect.width - bRect.width, x));
            y = Math.max(0, Math.min(fieldRect.height - bRect.height, y));

            ds.bubble.el.style.left = `${(x / fieldRect.width) * 100}%`;
            ds.bubble.el.style.top = `${(y / fieldRect.height) * 100}%`;

            // Highlight thùng Chặn khi bong bóng ở gần
            const trashRect = this.trash.getBoundingClientRect();
            const cx = e.clientX, cy = e.clientY;
            const near = cx >= trashRect.left - 40 && cx <= trashRect.right + 40 &&
                         cy >= trashRect.top - 40 && cy <= trashRect.bottom + 40;
            this.trash.classList.toggle('bl-trash-hover', near);
        },

        _onDragEnd(e) {
            const ds = this.dragState;
            if (!ds) return;
            this.dragState = null;
            level6State.cleanup.activeBubble = null;
            this.trash.classList.remove('bl-trash-hover');

            const el = ds.bubble.el;
            el.classList.remove('bl-dragging');

            // ĐÃ kéo (vượt ngưỡng) → chặn click sinh ra ngay sau khi thả.
            // Nếu không chặn, thả bong bóng ngoài thùng sẽ bị tính nhầm là "bấm".
            // Cờ tự tắt sau 50ms để KHÔNG BAO GIỜ "kẹt" nuốt cú chạm hợp lệ sau đó.
            if (ds.moved) {
                this._suppressClick = true;
                this._setTimer(() => { this._suppressClick = false; }, 50);
            } else {
                // Chạm đứng yên (hoặc rung dưới ngưỡng) → coi như chạm thường.
                this._suppressClick = false;
            }

            // Kiểm tra thả vào thùng Chặn
            const trashRect = this.trash.getBoundingClientRect();
            const cx = e.clientX, cy = e.clientY;
            const inTrash = cx >= trashRect.left && cx <= trashRect.right &&
                            cy >= trashRect.top && cy <= trashRect.bottom;

            if (inTrash && !ds.bubble.resolved) {
                this.resolveBubble(ds.bubble.index);
            }
        },

        /** Bàn phím: Tab tới thùng Chặn rồi Enter → dọn bong bóng đang chọn */
        _wireTrashKeyboard() {
            this.trash.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                e.preventDefault();
                // Dọn bong bóng đầu tiên còn lại
                const next = this.bubbles.find(b => !b.resolved);
                if (next) this.resolveBubble(next.index);
            });
        },

        /**
         * Dọn 1 bong bóng — hiệu ứng theo kịch bản:
         * bong bóng 1 nổ "bùm" + Quái nhăn nhó
         * bong bóng 2 biến mất
         * bong bóng 3 màn hình sáng bừng + Quái tan biến
         */
        resolveBubble(index) {
            const bubble = this.bubbles.find(b => b.index === index);
            if (!bubble || bubble.resolved) return;
            if (level6State.cleanup.finished) return;

            bubble.resolved = true;
            bubble.el.classList.add('bl-resolved');
            level6State.cleanup.resolved.push(index);

            sound.init();

            const order = level6State.cleanup.resolved.length; // 1, 2, 3

            if (order === 1) {
                sound.playBubblePop();
                bubble.el.classList.add('bl-pop');
                // Quái Bắt Nạt nhăn nhó
                const bully = document.getElementById('bl-bully');
                if (bully) {
                    bully.classList.add('bl-bully-grumpy');
                    this._setTimer(() => bully.classList.remove('bl-bully-grumpy'), 1600);
                }
                _setCleanupBip('Bùm! Dọn được tin xấu đầu tiên rồi con! Nhưng kẻ xấu vẫn còn đó...');
            } else if (order === 2) {
                sound.playBlockChime();
                bubble.el.classList.add('bl-vanish');
                _setCleanupBip('Tin xấu thứ hai cũng đi mất! Con làm tốt lắm!');
            } else if (order === 3) {
                sound.playBullyVanish();
                bubble.el.classList.add('bl-flash');
                // Vùng sáng bừng
                const flash = document.createElement('div');
                flash.className = 'bl-flash-overlay';
                this.field.appendChild(flash);
                this._setTimer(() => flash.remove(), 800);
                // Quái Bắt Nạt tan biến
                const bully = document.getElementById('bl-bully');
                if (bully) {
                    bully.classList.add('bl-bully-vanish');
                }
                _setCleanupBip('Ánh sáng xé tan kẻ xấu! Bạn ấy an toàn rồi! ✨');
            }

            _updateProgress();

            // Hoàn thành mini-game khi dọn đủ 3 bong bóng
            if (order >= CONFIG.BUBBLE_TOTAL) {
                level6State.cleanup.finished = true;
                // Dừng timer gợi ý (không gợi ý nữa khi đã xong)
                if (this._idleTimer) {
                    clearTimeout(this._idleTimer);
                    this._idleTimer = null;
                }
                this._setTimer(() => {
                    _advanceToScene('complete');
                }, 1400);
            }
        },

        /**
         * Reset mini-game về trạng thái ban đầu:
         * - gỡ hết class hiệu ứng của Quái Bắt Nạt
         * - xoá mọi vùng sáng bừng còn sót
         * - xoá 3 bong bóng cũ
         * - thanh tiến độ về 0/3
         * - xoá toàn bộ timer đang chạy (kể cả timer chuyển sang 'complete')
         */
        reset() {
            this._clearTimers();

            this.dragState = null;
            this._suppressClick = false;

            // Gỡ hiệu ứng Quái Bắt Nạt
            const bully = document.getElementById('bl-bully');
            if (bully) {
                bully.classList.remove('bl-bully-grumpy', 'bl-bully-vanish');
            }

            // Xoá vùng sáng bừng còn sót
            document.querySelectorAll('.bl-flash-overlay').forEach(el => el.remove());

            // Xoá bong bóng cũ
            if (this.field) this.field.innerHTML = '';
            this.bubbles = [];

            level6State.cleanup.resolved = [];
            level6State.cleanup.activeBubble = null;
            level6State.cleanup.finished = false;

            _updateProgress();
        }
    };

    function _setCleanupBip(text) {
        const el = document.getElementById('bl-bip-text-cleanup');
        if (el) el.textContent = text;
    }

    function _updateProgress() {
        const count = level6State.cleanup.resolved.length;
        const fill = document.getElementById('bl-progress-fill');
        const text = document.getElementById('bl-progress-text');
        if (fill) fill.style.width = `${(count / CONFIG.BUBBLE_TOTAL) * 100}%`;
        if (text) text.textContent = `${count}/${CONFIG.BUBBLE_TOTAL}`;
    }

    function _showCleanupStage() {
        sound.init();

        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        FreezeFrame.crossfade(() => {
            switchStage('cleanup');
            TopBar.updateVisibility('cleanup');

            // Bỏ qua mọi timer của mini-game cũ trước khi dựng lại
            CleanupGame.reset();

            try {
                CleanupGame.init();
            } catch (err) {
                // Không được để con bị kẹt ở màn này: log + hiện nút "Bỏ qua màn này"
                console.error('[Level6] Lỗi khởi tạo mini-game:', err);
                if (_isDebugMode()) console.error('[Level6] CleanupGame.init() lỗi:', err);
                _showCleanupFallback();
                return;
            }

            _setCleanupBip('Bíp đây! Bấm vào bong bóng xấu, hoặc kéo nó vào thùng Chặn ở bên cạnh nhé!');
        });
    }

    /**
     * Fallback khi mini-game không khởi tạo được: hiện nút "Bỏ qua màn này"
     * để người chơi không bị kẹt và vẫn đi tiếp được vào cảnh hoàn thành.
     */
    function _showCleanupFallback() {
        const field = document.getElementById('bl-bubble-field');
        if (!field) return;
        field.innerHTML = `
            <div class="bl-fallback">
                <div class="bl-fallback-icon">🛠️</div>
                <div class="bl-fallback-text">Màn này hơi lỗi, con bỏ qua nhé!</div>
                <button id="btn-cleanup-skip" class="btn-cleanup-skip" type="button">⏭️ Bỏ qua màn này</button>
            </div>
        `;
        document.getElementById('btn-cleanup-skip')?.addEventListener('click', () => {
            CleanupGame.reset();
            _advanceToScene('complete');
        });
    }

    // =========================================================================
    // 9. SUMMARY (RÚT GỌN — 1 tiêu đề + đúng 3 ý)
    // =========================================================================

    function _computeStats() {
        const hist = level6State.question.history;
        const slips = hist.filter(h => h !== CORRECT_CHOICE).length;

        let stars = 1;
        if (slips === 0) stars = 3;
        else if (slips === 1) stars = 2;

        let xp = 10;
        if (slips === 0) xp = 30;
        else if (slips === 1) xp = 20;

        return { stars, xp, slips };
    }

    /** 3 ý tóm tắt — mỗi ý ≤ 10 từ, 1 emoji */
    const SUMMARY_POINTS = [
        { icon: '🛑', text: 'Không hùa theo lời chê bai' },
        { icon: '🚫', text: 'Chặn và báo cáo tin xấu' },
        { icon: '🧑‍🏫', text: 'Kể ngay với người lớn tin cậy' }
    ];

    function _showSummary() {
        sound.init();
        sound.playVictoryChime();

        FreezeFrame.crossfade(() => {
            switchStage('summary');
            TopBar.updateVisibility('summary');

            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 120,
                    spread: 80,
                    origin: { y: 0.6 },
                    colors: ['#00B8A9', '#22C55E', '#5BA8FF', '#FFD700']
                });
            }

            _renderSummary();
        });
    }

    function _renderSummary() {
        const card = document.getElementById('summary-card-container');
        if (!card) return;

        const stats = _computeStats();
        const starsHtml = '⭐'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars);

        const pointsHtml = SUMMARY_POINTS.map(p => `
            <div class="bl-summary-point">
                <span class="bl-summary-point-icon">${p.icon}</span>
                <span>${p.text}</span>
            </div>
        `).join('');

        card.innerHTML = `
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png"
                 alt="CyberKnight" class="summary-logo">
            <div class="summary-icon-badge">🛡️</div>
            <h2 class="summary-title">LEVEL 6 COMPLETED!</h2>
            <div class="summary-stars">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${CONFIG.BADGE_NAME}</span>
            </div>

            <h3 class="bl-summary-heading">3 ĐIỀU CON NHỚ</h3>

            <div class="bl-summary-points">
                ${pointsHtml}
            </div>

            <!-- Actions -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay" type="button" aria-label="Chơi lại level 6">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue" type="button" aria-label="Tiếp tục hành trình">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', _replay);
        document.getElementById('btn-summary-continue')?.addEventListener('click', _continue);

        window.dispatchEvent(new CustomEvent('level6:complete', {
            detail: {
                answers: level6State.question,
                stars: stats.stars,
                xp: stats.xp,
                badge: CONFIG.BADGE_NAME
            }
        }));
    }

    function _replay() {
        sound.init();
        sound.playTick();

        _clearTimers();

        // Dừng & reset mini-game (bong bóng, Quái Bắt Nạt, tiến độ, timer)
        CleanupGame.reset();
        level6State.cleanup = { resolved: [], activeBubble: null, finished: false };

        level6State.question = {
            firstChoice: null,
            attempts: 0,
            correct: false,
            locked: false,
            history: []
        };
        level6State.currentScene = null;

        // Cho phép 5 video phát lại từ đầu
        Object.keys(_sceneEnded).forEach(k => { _sceneEnded[k] = false; });

        resetAllVideos();

        if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';

        // Reset lại UI màn câu hỏi cho lượt chơi mới
        _resetQuestionStageUI(true);

        FreezeFrame.crossfade(() => {
            switchStage('scene1');
            _playScene('scene1');
        });
    }

    function _continue() {
        sound.init();
        sound.playTick();
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'closeGameModal' }, '*');
                return;
            }
        } catch (err) { if (_isDebugMode()) console.warn('postMessage error:', err); }
        window.location.href = '../index.html';
    }

    // =========================================================================
    // 10. STAGE SWITCHER
    // =========================================================================

    function switchStage(targetStage) {
        ALL_STAGES.forEach(s => {
            const el = document.getElementById(`stage-${s}`);
            if (!el) return;
            if (s === targetStage) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        const topBar = document.getElementById('level6-top-bar');
        const skipBtn = document.getElementById('btn-skip-video');
        const isSummary = targetStage === 'summary';
        if (topBar) topBar.style.display = isSummary ? 'none' : '';
        if (skipBtn) skipBtn.classList.toggle('hidden', isSummary);

        const pc = document.getElementById('particle-canvas');
        if (pc) pc.style.display = isSummary ? 'none' : '';
        const fc = document.getElementById('freeze-canvas');
        if (fc) {
            if (isSummary) {
                fc.style.display = 'none';
            } else {
                fc.style.display = '';
                fc.style.opacity = '0';
            }
        }
    }

    // =========================================================================
    // 11. DEBUG FLAGS
    // =========================================================================

    function handleDebugFlags() {
        const params = new URLSearchParams(window.location.search);
        const skip = params.get('skip');

        if (!skip) return false;

        document.getElementById('start-overlay')?.classList.add('hidden');

        // ?skip=scene1|scene2|scene3|complete|badge → nhảy thẳng tới stage video
        if (CONFIG.VIDEO_SCENES.includes(skip)) {
            _resetForDebug();
            _advanceToScene(skip);
            return true;
        }

        // ?skip=q1 → nhảy thẳng tới màn câu hỏi
        if (skip === 'q1') {
            _resetForDebug();
            _showQuestionStage({ fresh: true });
            return true;
        }

        // ?skip=cleanup → nhảy thẳng tới mini-game dọn tin nhắn
        if (skip === 'cleanup') {
            _resetForDebug();
            _showCleanupStage();
            return true;
        }

        // ?skip=summary-first (hoặc ?skip=summary) → 3⭐, 30 XP
        if (skip === 'summary-first' || skip === 'summary') {
            level6State.question = { firstChoice: CORRECT_CHOICE, attempts: 1, correct: true, history: [CORRECT_CHOICE] };
            _showSummary();
            return true;
        }

        // ?skip=summary-retry → 2⭐, 20 XP (chọn sai 1 lần rồi chọn đúng)
        if (skip === 'summary-retry') {
            level6State.question = { firstChoice: 'a', attempts: 2, correct: true, history: ['a', CORRECT_CHOICE] };
            _showSummary();
            return true;
        }

        return false;
    }

    function _resetForDebug() {
        level6State.question = { firstChoice: null, attempts: 0, correct: false, locked: false, history: [] };
        level6State.cleanup.resolved = [];
        level6State.cleanup.activeBubble = null;
        level6State.cleanup.finished = false;
    }

    // =========================================================================
    // 12. INIT
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();

        _wireAnswerButtons();

        // Bắt đầu dò asset sớm để sẵn sàng khi vào màn câu hỏi
        ensureAssets();

        const isSkipped = handleDebugFlags();
        if (isSkipped) return;

        const btnStart = document.getElementById('btn-start-level');
        const startOverlay = document.getElementById('start-overlay');

        if (btnStart && startOverlay) {
            btnStart.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                startOverlay.classList.add('hidden');
                _advanceToScene('scene1');
            });
        }
    });

})();
