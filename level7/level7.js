/**
 * CYBERKNIGHT — LEVEL 7: "BIỆT ĐỘI CHỐNG BẪY LỪA"
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth, Bubble Trap Smashing.
 *
 * Đồng bộ kiến trúc với Level 5:
 * - ResourceSource dò asset đa tầng (hỗ trợ thư mục có khoảng trắng 'video/level 7/')
 * - 1 video element / scene, preload="auto", playsinline, CÓ TIẾNG (không ép muted)
 * - Freeze-frame crossfade (canvas capture + opacity fade)
 * - AudioSynth (WebAudio API thuần, mọi hàm có guard if (!this.ctx) return;)
 * - SCENE_FLOW table điều khiển luồng kịch bản
 * - TopBar THOÁT (ESC) + BỎ QUA ⏩ (cờ _sceneEnded, lưới an toàn 1.5s)
 * - Panel lỗi video thân thiện (Thử lại / Bỏ qua cảnh)
 * - Result overlay thử lại khi dính bẫy
 * - Tính sao (1-3 ⭐) và XP (10-30 XP)
 * - Summary compact không cần cuộn trên 1280x720 và 390x760
 * - Debug flags (?skip=..., ?debug)
 *
 * Tránh 7 lỗi đã biết từ Level 6:
 * 1. Không gọi `this.` vào hàm độc lập
 * 2. pointerdown trực tiếp không nuốt click khi tay rung <= 8px
 * 3. Reset sạch timer/rAF khi thử lại/chơi lại
 * 4. Responsive màn hình thấp (740x360, 390x760)
 * 5. Summary ngắn gọn không cuộn
 * 6. Chuẩn chính tả tiếng Việt
 * 7. Gợi ý Bíp sau 15 giây
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    const CONFIG = {
        BASES: [
            '../video/level 7/',
            '../video/level7/',
            'video/level7/',
            './'
        ],
        VIDEO_EXTS: ['.mp4', '.webm', '.mov'],
        VIDEO_SCENES: ['intro', 'good', 'bad'],
        BADGE_NAME: 'HIỆP SĨ CHỐNG BẪY LỪA',
        LOADING_TIMEOUT_MS: 8000,
        IDLE_HINT_MS: 15000,
        CORRECT_EFFECT_MS: 800,
        WRONG_EFFECT_MS: 600,
        BUBBLE_FALL_DURATION_MS: 14000 // Rơi chậm vừa tầm trẻ 6-12 tuổi (14s)
    };

    /**
     * Bảng luồng kịch bản State Machine:
     * intro -> game · good -> summary · bad -> result overlay (thử lại game)
     */
    const SCENE_FLOW = {
        intro: { question: 'game' },
        good:  { next: 'summary' },
        bad:   { question: 'retry' }
    };

    const ALL_STAGES = ['intro', 'game', 'good', 'bad', 'summary'];

    /** Cờ chống kết thúc scene video trùng lặp */
    const _sceneEnded = { intro: false, good: false, bad: false };

    /**
     * Dữ liệu 4 cạm bẫy độc hại trôi từ trên xuống
     * Text thuần túy, tuyệt đối KHÔNG chứa thẻ <a> hay <input>
     */
    const TRAP_DATA = [
        {
            id: 'gift',
            lane: 0,
            icon: '🎁',
            text: 'Quà miễn phí! Nhận ngay 1.000 Robux',
            trapType: 'gift',
            spawnDelayMs: 400,
            feedback: 'Chuẩn luôn! "Quà miễn phí" là chiêu lừa kinh điển của kẻ xấu!'
        },
        {
            id: 'link',
            lane: 1,
            icon: '🔗',
            text: 'hack-game-mien-phi.xyz/nhan-qua',
            trapType: 'link',
            spawnDelayMs: 2400,
            feedback: 'Đúng rồi! Tuyệt đối không bấm vào link lạ có đuôi kỳ quặc nhé!'
        },
        {
            id: 'timer',
            lane: 2,
            icon: '⏰',
            text: 'CÒN 30 GIÂY! Tài khoản sắp bị khóa!',
            trapType: 'timer',
            spawnDelayMs: 4400,
            feedback: 'Hay lắm! Đếm ngược dọa dẫm là bẫy tâm lý để con hốt hoảng đấy!'
        },
        {
            id: 'otp',
            lane: 3,
            icon: '🔑',
            text: 'Nhập mật khẩu / mã OTP để nhận quà',
            trapType: 'otp',
            spawnDelayMs: 6400,
            feedback: 'Tuyệt đỉnh! Mật khẩu và OTP là bí mật tuyệt đối, không chia sẻ cho ai!'
        }
    ];

    /**
     * ResourceSource: dò thư mục + đuôi file video, cache lại baseIdx
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
        },

        triedUrls(sceneName) {
            const urls = [];
            CONFIG.BASES.forEach(b => CONFIG.VIDEO_EXTS.forEach(e => urls.push(b + sceneName + e)));
            return urls;
        }
    };

    /**
     * Runtime State của Level 7
     */
    const level7State = {
        currentScene: null,
        game: {
            active: false,
            poppedCount: 0,
            slips: 0,          // số lần bọt chạm đáy (bị dính bẫy)
            history: [],        // lưu lại lịch sử kết quả
            bubbles: []         // danh sách đối tượng bọt đang rơi
        },
        hintGiven: false
    };

    // =========================================================================
    // 2. ASSET PROBING
    // =========================================================================

    let _probePromise = null;

    async function _probeVideo(url) {
        return new Promise(resolve => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                v.onloadedmetadata = null;
                v.onerror = null;
                resolve(ok);
            };
            const timer = setTimeout(() => finish(false), 6000);
            v.onloadedmetadata = () => {
                // Kiểm tra kích thước thực tế để tránh SPA rewrite fallback trả HTML 200
                const ok = (v.videoWidth > 0 && v.videoHeight > 0);
                finish(ok);
            };
            v.onerror = () => finish(false);
            v.src = url;
        });
    }

    async function _probeVideoExts(base) {
        for (const ext of CONFIG.VIDEO_EXTS) {
            const testUrl = encodeURI(base + 'intro' + ext);
            const ok = await _probeVideo(testUrl);
            if (ok) return ext;
        }
        return null;
    }

    async function _probeAll() {
        for (let b = 0; b < CONFIG.BASES.length; b++) {
            const base = CONFIG.BASES[b];
            const vidExt = await _probeVideoExts(base);
            if (vidExt) {
                ResourceSource.baseIdx = b;
                ResourceSource.videoExt = vidExt;
                if (_isDebugMode()) {
                    console.log(`[Level7] Video OK → base[${b}]=${base} ext=${vidExt}`);
                }
                return true;
            }
        }

        // Dự phòng mặc định nếu probing offline
        ResourceSource.baseIdx = 0;
        ResourceSource.videoExt = '.mp4';
        if (_isDebugMode()) {
            console.warn('[Level7] Dùng fallback mặc định: ../video/level 7/intro.mp4');
        }
        return false;
    }

    function ensureAssets() {
        if (!_probePromise) _probePromise = _probeAll();
        return _probePromise;
    }

    // =========================================================================
    // 3. AUDIO SYNTH (WebAudio API thuần — Không cần file âm thanh bên ngoài)
    // =========================================================================

    class AudioSynth {
        constructor() { this.ctx = null; }

        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.ctx = new AudioCtx();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        }

        playTick() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.05);
        }

        /** Tiếng búa an toàn gõ "cốp" */
        playHammer() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(320, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
            gain.gain.setValueAtTime(0.22, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.08);
        }

        /** Tiếng bọt vỡ "bùm/pop" */
        playPop() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(1100, now + 0.12);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.15);
        }

        /** Tiếng dính bẫy chạm đáy (âm trầm cảnh báo) */
        playTrapHit() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.3);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.35);
        }

        /** Tiếng lá chắn / bọt an toàn đóng cửa sổ "ting" */
        playSafeShield() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [587.33, 880, 1174.66].forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.06);
                gain.gain.setValueAtTime(0.18, now + idx * 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.35);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.06); osc.stop(now + idx * 0.06 + 0.35);
            });
        }

        /** Tiếng chúc mừng chiến thắng summary */
        playVictoryChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.2, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.45);
            });
        }

        /** Tiếng Bíp nhắc nhở nhẹ nhàng */
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

        crossfade(prepareNewStageCallback) {
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
    // 5. TOP BAR (THOÁT ESC & BỎ QUA ⏩)
    // =========================================================================

    const TopBar = {
        skipBtn: null,
        exitBtn: null,
        _skipFallbackTimer: null,

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
            const scene = level7State.currentScene;
            if (!scene) return;
            const videoEl = document.getElementById(`video-${scene}`);
            if (videoEl && !videoEl.ended) {
                if (videoEl.duration && videoEl.readyState >= 1) {
                    videoEl.currentTime = videoEl.duration - 0.05;
                    clearTimeout(this._skipFallbackTimer);
                    this._skipFallbackTimer = setTimeout(() => {
                        this._skipFallbackTimer = null;
                        const v = document.getElementById(`video-${scene}`);
                        if (v && !v.ended && v.currentTime < (v.duration || Infinity) - 0.5) {
                            _triggerSceneEnd(scene);
                        }
                    }, 1500);
                } else {
                    _triggerSceneEnd(scene);
                }
            } else {
                _triggerSceneEnd(scene);
            }
        },

        updateVisibility(stage) {
            if (!this.skipBtn) return;
            // BỎ QUA chỉ hiện ở các stage video (intro / good / bad)
            const showSkip = CONFIG.VIDEO_SCENES.includes(stage);
            this.skipBtn.classList.toggle('hidden', !showSkip);
        },

        exitLevel() {
            stopAllVideos();
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) {
                if (_isDebugMode()) console.warn('postMessage error:', err);
            }
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

    function _showVideoErrorPanel(stageId, sceneLabel, triedUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

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

    async function _playScene(sceneName, options = {}) {
        const { onEnded } = options;
        level7State.currentScene = sceneName;

        if (TopBar._skipFallbackTimer) {
            clearTimeout(TopBar._skipFallbackTimer);
            TopBar._skipFallbackTimer = null;
        }

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (!videoEl) {
            if (_isDebugMode()) console.error(`[Level7] Không tìm thấy #video-${sceneName}`);
            if (onEnded) onEnded();
            return;
        }

        document.querySelectorAll('video').forEach(v => {
            if (v === videoEl) return;
            try {
                v.pause();
                v.onended = null;
                v.ontimeupdate = null;
            } catch (e) {}
        });

        if (_sceneEnded.hasOwnProperty(sceneName)) _sceneEnded[sceneName] = false;

        await ensureAssets();

        const url = ResourceSource.videoUrl(sceneName);
        if (!url) {
            _showVideoErrorPanel(sceneName, sceneName, ResourceSource.triedUrls(sceneName));
            return;
        }

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
            if (slowLoadingTimer) {
                clearTimeout(slowLoadingTimer);
                slowLoadingTimer = null;
            }
        }

        showLoading();
        slowLoadingTimer = setTimeout(() => {
            const container = videoEl.closest('.video-container');
            container?.querySelector('.video-loading-slow')?.classList.remove('hidden');
        }, CONFIG.LOADING_TIMEOUT_MS);

        if (!videoEl.src || !videoEl.src.endsWith(url)) {
            videoEl.src = url;
            videoEl.load();
        }

        let endedTriggered = false;

        function cleanupListeners() {
            videoEl.onended = null;
            videoEl.ontimeupdate = null;
            videoEl.onwaiting = null;
            videoEl.onplaying = null;
            videoEl.onerror = null;
        }

        const onError = () => {
            cleanupListeners();
            hideLoading();
            _showVideoErrorPanel(sceneName, sceneName, ResourceSource.triedUrls(sceneName));
        };
        videoEl.onerror = onError;

        videoEl.onwaiting = () => showLoading();
        videoEl.onplaying = () => hideLoading();

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

    function _handleQuestion(kind) {
        if (kind === 'game') {
            _showGameStage({ fresh: true });
        } else if (kind === 'retry') {
            _showWrongResultScreen();
        }
    }

    // =========================================================================
    // 7. GAME STAGE (stage-game) — "Phá Bọt Cạm Bẫy"
    // =========================================================================

    let _idleHintTimer = null;
    let _rAFId = null;
    let _lastTime = null;
    let _gameStartTime = 0;
    let _safeBubbleSpawned = false;

    function _clearTimers() {
        if (_idleHintTimer) {
            clearTimeout(_idleHintTimer);
            _idleHintTimer = null;
        }
        if (_rAFId) {
            cancelAnimationFrame(_rAFId);
            _rAFId = null;
        }
        _lastTime = null;
    }

    function _setBip(text, isHint = false) {
        const bipEl = document.getElementById('tr-bip');
        const textEl = document.getElementById('tr-bip-text');
        if (textEl) textEl.textContent = text;
        if (bipEl) {
            bipEl.classList.toggle('tr-bip-hint', isHint);
        }
    }

    function _resetIdleHint() {
        if (_idleHintTimer) clearTimeout(_idleHintTimer);
        _idleHintTimer = setTimeout(() => {
            if (!level7State.game.active || level7State.game.poppedCount > 0) return;
            sound.playSoftBip();
            _setBip('Bíp đây! Con hãy dùng Búa An Toàn chạm vào cạm bẫy đang rơi để đập vỡ chúng nhé!', true);
        }, CONFIG.IDLE_HINT_MS);
    }

    function _updateProgress(count, total = 4) {
        const countEl = document.getElementById('tr-progress-count');
        const fillEl = document.getElementById('tr-progress-fill');
        const barContainer = document.querySelector('.tr-progress-bar-container');
        if (countEl) countEl.textContent = `${count}/${total}`;
        if (fillEl) {
            const pct = Math.min(Math.round((count / total) * 100), 100);
            fillEl.style.width = `${pct}%`;
        }
        if (barContainer) {
            barContainer.setAttribute('aria-valuenow', count);
        }
    }

    function _showGameStage(options = {}) {
        const { fresh = true } = options;
        _clearTimers();

        if (fresh) {
            level7State.game.poppedCount = 0;
            level7State.game.active = true;
        }

        switchStage('game');
        TopBar.updateVisibility('game');

        _resetGameUI();
        _startGameLoop();
        _resetIdleHint();
    }

    function _resetGameUI() {
        const arena = document.getElementById('tr-bubble-arena');
        if (arena) {
            // Xóa toàn bộ bubble cũ trong các lane và arena
            arena.querySelectorAll('.tr-bubble, .tr-bubble-safe').forEach(b => b.remove());
        }

        const phoneFrame = document.getElementById('tr-phone-frame');
        if (phoneFrame) {
            phoneFrame.classList.remove('tr-shake');
        }

        _updateProgress(0, 4);
        _safeBubbleSpawned = false;
        level7State.game.poppedCount = 0;
        level7State.game.bubbles = [];
        _setBip('Bíp đây! Cạm bẫy đang rơi xuống, con hãy dùng Búa An Toàn đập vỡ chúng nhé!');
    }

    function _startGameLoop() {
        level7State.game.active = true;
        _gameStartTime = performance.now();
        _lastTime = performance.now();

        // Khởi tạo danh sách 4 bọt
        level7State.game.bubbles = TRAP_DATA.map(data => ({
            ...data,
            spawned: false,
            popped: false,
            el: null,
            y: 0,
            speed: 0
        }));

        if (_rAFId) cancelAnimationFrame(_rAFId);
        _rAFId = requestAnimationFrame(_gameTick);
    }

    function _gameTick(now) {
        if (!level7State.game.active) return;

        if (!_lastTime) _lastTime = now;
        const deltaMs = Math.min(now - _lastTime, 100); // Guard chống delta quá lớn khi giật lag
        _lastTime = now;
        const elapsedSinceStart = now - _gameStartTime;

        const arena = document.getElementById('tr-bubble-arena');
        if (!arena) return;

        const arenaHeight = arena.clientHeight || 300;
        const fallSpeedPxPerMs = arenaHeight / CONFIG.BUBBLE_FALL_DURATION_MS;

        // 1. Kiểm tra spawn từng bọt
        level7State.game.bubbles.forEach(b => {
            if (!b.spawned && elapsedSinceStart >= b.spawnDelayMs) {
                _spawnTrapBubble(b, arena);
            }
        });

        // 2. Cập nhật vị trí rơi cho các bọt đang hoạt động
        let trapReachedBottom = false;

        for (const b of level7State.game.bubbles) {
            if (!b.spawned || b.popped || !b.el) continue;

            b.y += fallSpeedPxPerMs * deltaMs;
            b.el.style.transform = `translate3d(0, ${b.y.toFixed(1)}px, 0)`;

            // Kiểm tra chạm đáy (ranh giới nguy hiểm)
            const bubbleHeight = b.el.offsetHeight || 56;
            if (b.y + bubbleHeight >= arenaHeight - 4) {
                trapReachedBottom = true;
                break;
            }
        }

        // 3. Nếu có bọt chạm đáy -> Thua / Dính bẫy
        if (trapReachedBottom) {
            _handleTrapHitBottom();
            return;
        }

        // 4. Tiếp tục vòng lặp
        _rAFId = requestAnimationFrame(_gameTick);
    }

    function _spawnTrapBubble(bubbleObj, arena) {
        const laneEl = arena.querySelector(`.tr-lane[data-lane="${bubbleObj.lane}"]`);
        if (!laneEl) return;

        const bubbleEl = document.createElement('div');
        bubbleEl.className = 'tr-bubble';
        bubbleEl.setAttribute('role', 'button');
        bubbleEl.setAttribute('tabindex', '0');
        bubbleEl.setAttribute('data-trap', bubbleObj.trapType);
        bubbleEl.setAttribute('aria-label', `Cạm bẫy: ${bubbleObj.text}`);

        const iconEl = document.createElement('span');
        iconEl.className = 'tr-bubble-icon';
        iconEl.textContent = bubbleObj.icon;

        const textEl = document.createElement('span');
        textEl.className = 'tr-bubble-text';
        // Luôn dùng textContent để chống XSS/link injection
        textEl.textContent = bubbleObj.text;

        bubbleEl.appendChild(iconEl);
        bubbleEl.appendChild(textEl);

        // Nhận diện tương tác qua pointerdown trực tiếp (chịu rung ngón tay <= 8px)
        bubbleEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            _handlePopTrap(bubbleObj);
        });

        // Hỗ trợ bàn phím (Enter / Space)
        bubbleEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _handlePopTrap(bubbleObj);
            }
        });

        laneEl.appendChild(bubbleEl);
        bubbleObj.el = bubbleEl;
        bubbleObj.spawned = true;
        bubbleObj.y = -60; // Bắt đầu từ phía trên mép
    }

    function _handlePopTrap(bubbleObj) {
        if (!level7State.game.active || bubbleObj.popped || !bubbleObj.el) return;

        bubbleObj.popped = true;
        sound.init();
        sound.playHammer();
        sound.playPop();

        // Hiệu ứng búa gõ
        _triggerHammerSmash(bubbleObj.el);

        // Hiệu ứng vỡ bọt
        bubbleObj.el.classList.add('tr-popped');
        setTimeout(() => {
            if (bubbleObj.el) bubbleObj.el.remove();
        }, 340);

        level7State.game.poppedCount++;
        _updateProgress(level7State.game.poppedCount, 4);
        _resetIdleHint();

        // Phản hồi của Bíp
        _setBip(bubbleObj.feedback);

        // Đã đập vỡ cả 4 bọt bẫy -> Hiện Bọt An Toàn thứ 5!
        if (level7State.game.poppedCount >= 4 && !_safeBubbleSpawned) {
            _spawnSafeBubble();
        }
    }

    function _triggerHammerSmash(targetEl) {
        const hammer = document.getElementById('tr-hammer-cursor');
        const phone = document.getElementById('tr-phone-frame');
        if (!hammer || !phone || !targetEl) return;

        const phoneRect = phone.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        const x = targetRect.left - phoneRect.left + targetRect.width / 2;
        const y = targetRect.top - phoneRect.top + targetRect.height / 2;

        hammer.style.left = `${x}px`;
        hammer.style.top = `${y}px`;
        hammer.style.display = 'block';
        hammer.classList.add('tr-smash');

        setTimeout(() => {
            hammer.classList.remove('tr-smash');
            hammer.style.display = 'none';
        }, 180);
    }

    /**
     * Bọt ✖ An Toàn: chỉ xuất hiện sau khi đập đủ 4 bọt bẫy
     */
    function _spawnSafeBubble() {
        _safeBubbleSpawned = true;
        _clearTimers(); // Dừng rơi bọt

        const arena = document.getElementById('tr-bubble-arena');
        if (!arena) return;

        sound.playSoftBip();
        _setBip('🎉 Tuyệt đỉnh! Giờ hãy bấm nút AN TOÀN này để đóng cửa sổ và báo cho bố mẹ nhé!');

        const safeBubble = document.createElement('div');
        safeBubble.className = 'tr-bubble-safe';
        safeBubble.setAttribute('role', 'button');
        safeBubble.setAttribute('tabindex', '0');
        safeBubble.setAttribute('aria-label', 'Đóng cửa sổ và báo cho bố mẹ');

        const icon = document.createElement('span');
        icon.className = 'tr-safe-icon';
        icon.textContent = '🛡️';

        const text = document.createElement('span');
        text.className = 'tr-safe-text';
        text.textContent = '✖ ĐÓNG CỬA SỔ / BÁO BỐ MẸ';

        safeBubble.appendChild(icon);
        safeBubble.appendChild(text);

        const handleSafeClick = (e) => {
            e.stopPropagation();
            sound.init();
            sound.playSafeShield();
            safeBubble.style.pointerEvents = 'none';
            safeBubble.style.transform = 'translate(-50%, -50%) scale(1.25)';
            safeBubble.style.opacity = '0';
            safeBubble.style.transition = 'all 0.35s ease';

            _triggerGameVictory();
        };

        safeBubble.addEventListener('pointerdown', handleSafeClick);
        safeBubble.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSafeClick(e);
            }
        });

        arena.appendChild(safeBubble);
    }

    function _triggerGameVictory() {
        level7State.game.active = false;
        _clearTimers();

        _setBip('🌟 Tuyệt vời! Con đã bảo vệ an toàn cho thiết bị rồi!');

        setTimeout(() => {
            _advanceToScene('good');
        }, CONFIG.CORRECT_EFFECT_MS);
    }

    function _handleTrapHitBottom() {
        level7State.game.active = false;
        _clearTimers();
        level7State.game.slips++;

        sound.init();
        sound.playTrapHit();

        const phoneFrame = document.getElementById('tr-phone-frame');
        if (phoneFrame) {
            phoneFrame.classList.add('tr-shake');
        }

        _setBip('Ôi không! Cạm bẫy đã chạm vào máy rồi! Xem Sóc Đỏ xử lý thế nào nhé!');

        setTimeout(() => {
            _advanceToScene('bad');
        }, CONFIG.WRONG_EFFECT_MS);
    }

    // =========================================================================
    // 8. WRONG RESULT SCREEN (Sau khi xem video bad)
    // =========================================================================

    function _showWrongResultScreen() {
        sound.init();
        sound.playSoftBip();

        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        const overlay = document.getElementById('result-overlay');
        const card = document.getElementById('tr-result-card');
        if (!overlay || !card) return;

        card.innerHTML = `
            <div class="result-screen">
                <div class="result-icon">⚠️</div>
                <h3 class="result-title">Cạm bẫy nguy hiểm quá!</h3>
                <div class="result-body">
                    Cạm bẫy trên mạng rất tinh vi: chúng dọa khóa tài khoản, hứa tặng quà miễn phí hoặc bắt điền mật khẩu/OTP để đánh cắp nick của con!
                </div>
                <div class="result-bip">
                    🤖 <em>Bíp mách nước: Lần này con hãy nhanh tay dùng Búa An Toàn đập vỡ từng bọt trước khi chúng chạm đáy nhé!</em>
                </div>
                <div class="result-tip">
                    💡 <strong>Mẹo hiệp sĩ:</strong> Bấm trực tiếp vào các cạm bẫy để phá tan chúng!
                </div>
                <div class="result-actions">
                    <button class="result-btn result-btn-retry" type="button" aria-label="Thử lại phá bẫy">🔄 Thử lại ngay</button>
                    <button class="result-btn result-btn-replay" type="button" aria-label="Xem lại cảnh giới thiệu">🎬 Xem lại cảnh giới thiệu</button>
                </div>
            </div>
        `;

        card.querySelector('.result-btn-retry')?.addEventListener('click', () => {
            sound.init();
            sound.playTick();
            overlay.classList.add('hidden');
            _showGameStage({ fresh: true });
        });

        card.querySelector('.result-btn-replay')?.addEventListener('click', () => {
            sound.init();
            sound.playTick();
            overlay.classList.add('hidden');
            _replayIntro();
        });

        overlay.classList.remove('hidden');
    }

    function _replayIntro() {
        const videoEl = document.getElementById('video-intro');
        if (videoEl) {
            try { videoEl.currentTime = 0; } catch (e) {}
        }
        _playScene('intro', {
            onEnded: () => {
                _showGameStage({ fresh: true });
            }
        });
    }

    // =========================================================================
    // 9. SUMMARY (Gọn gàng — Không cuộn trên 1280x720 và 390x760)
    // =========================================================================

    function _computeStats() {
        const slips = level7State.game.slips;
        let stars = 1;
        let xp = 10;

        if (slips === 0) {
            stars = 3;
            xp = 30;
        } else if (slips === 1) {
            stars = 2;
            xp = 20;
        }

        return { stars, xp, slips };
    }

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
                    colors: ['#22C55E', '#0066FF', '#FFD700', '#FF4757']
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

        const recapText = stats.slips === 0
            ? '✅ Con đã đập tan toàn bộ cạm bẫy ngay lần đầu tiên!'
            : '🔁 Con đã kiên trì thử lại và đập tan cạm bẫy xuất sắc!';

        card.innerHTML = `
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png"
                 alt="CyberKnight" class="summary-logo">
            <div class="summary-icon-badge">🛡️</div>
            <h2 class="summary-title">LEVEL 7 HOÀN THÀNH!</h2>
            <div class="summary-stars">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${CONFIG.BADGE_NAME}</span>
            </div>

            <!-- 3 Ý nhớ nhanh: mỗi ý <= 10 từ, 1 emoji -->
            <div class="summary-points-list">
                <div class="summary-point-item">
                    <span class="summary-point-emoji">🎁</span>
                    <span>Quà miễn phí thường là bẫy lừa đảo</span>
                </div>
                <div class="summary-point-item">
                    <span class="summary-point-emoji">🔗</span>
                    <span>Không bao giờ bấm vào đường link lạ</span>
                </div>
                <div class="summary-point-item">
                    <span class="summary-point-emoji">👨‍👩‍👧</span>
                    <span>Thấy lạ thì đóng lại và báo ngay bố mẹ</span>
                </div>
            </div>

            <!-- Hành trình ngắn gọn -->
            <div style="font-size: 11px; font-weight: 700; color: var(--ck-blue-600); line-height: 1.3;">
                ${recapText}
            </div>

            <!-- Actions -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay" type="button" aria-label="Chơi lại Level 7">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue" type="button" aria-label="Tiếp tục hành trình">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', _replay);
        document.getElementById('btn-summary-continue')?.addEventListener('click', _continue);

        window.dispatchEvent(new CustomEvent('level7:complete', {
            detail: {
                stars: stats.stars,
                xp: stats.xp,
                badge: CONFIG.BADGE_NAME,
                slips: stats.slips
            }
        }));
    }

    function _replay() {
        sound.init();
        sound.playTick();
        _clearTimers();

        level7State.game.slips = 0;
        level7State.game.poppedCount = 0;
        level7State.game.active = false;
        level7State.currentScene = null;

        _sceneEnded.intro = false;
        _sceneEnded.good = false;
        _sceneEnded.bad = false;

        resetAllVideos();

        const overlay = document.getElementById('result-overlay');
        if (overlay) overlay.classList.add('hidden');

        if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';

        FreezeFrame.crossfade(() => {
            switchStage('intro');
            _playScene('intro');
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
        } catch (err) {
            if (_isDebugMode()) console.warn('postMessage error:', err);
        }
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

        const topBar = document.getElementById('level7-top-bar');
        const skipBtn = document.getElementById('btn-skip-video');
        const isSummary = (targetStage === 'summary');

        if (topBar) topBar.style.display = isSummary ? 'none' : '';
        if (skipBtn) skipBtn.classList.toggle('hidden', isSummary);

        const fc = document.getElementById('freeze-canvas');
        if (fc) {
            if (isSummary) {
                fc.style.display = 'none';
            } else {
                fc.style.display = '';
                fc.style.opacity = '0';
            }
        }

        if (targetStage !== 'game' && targetStage !== 'summary') {
            const overlay = document.getElementById('result-overlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                overlay.classList.add('hidden');
            }
        }
    }

    // =========================================================================
    // 11. DEBUG FLAGS (?skip=... & ?debug)
    // =========================================================================

    function handleDebugFlags() {
        const params = new URLSearchParams(window.location.search);
        const skip = params.get('skip');

        if (!skip) return false;

        document.getElementById('start-overlay')?.classList.add('hidden');

        // ?skip=intro|good|bad
        if (CONFIG.VIDEO_SCENES.includes(skip)) {
            _advanceToScene(skip);
            return true;
        }

        // ?skip=game
        if (skip === 'game') {
            _showGameStage({ fresh: true });
            return true;
        }

        // ?skip=result-wrong
        if (skip === 'result-wrong') {
            level7State.game.slips = 1;
            _showWrongResultScreen();
            return true;
        }

        // ?skip=summary-first (3 ⭐, 30 XP)
        if (skip === 'summary-first') {
            level7State.game.slips = 0;
            _showSummary();
            return true;
        }

        // ?skip=summary-retry (2 ⭐, 20 XP)
        if (skip === 'summary-retry') {
            level7State.game.slips = 1;
            _showSummary();
            return true;
        }

        // ?skip=summary (mặc định 3 ⭐, 30 XP)
        if (skip === 'summary') {
            level7State.game.slips = 0;
            _showSummary();
            return true;
        }

        return false;
    }

    // =========================================================================
    // 12. INITIALIZATION
    // =========================================================================

    function init() {
        FreezeFrame.init();
        TopBar.init();

        // Xử lý chuyển tab: tạm dừng game loop để không bị dồn bọt khi ẩn tab
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                _lastTime = null;
            } else {
                _lastTime = performance.now();
            }
        });

        // Nút Start Overlay
        const startBtn = document.getElementById('btn-start-level');
        const startOverlay = document.getElementById('start-overlay');

        if (startBtn) {
            startBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                if (startOverlay) startOverlay.classList.add('hidden');
                _playScene('intro');
            });
        }

        // Kiểm tra cờ debug
        const skipped = handleDebugFlags();
        if (!skipped) {
            // Chuẩn bị sẵn asset ở chế độ nền
            ensureAssets();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
