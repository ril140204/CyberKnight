/**
 * CYBERKNIGHT — LEVEL 5: "THẬT HAY GIẢ? ĐỐNG ẢNH AI"
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth, Magnifier.
 *
 * Kiến trúc kế thừa từ Level 4:
 * - Asset base probing (ResourceSource.baseIdx + imageExt/videoExt) — KHÔNG derive từ URL
 * - 1 video element / scene, preload="auto", playsinline, CÓ TIẾNG (không muted)
 * - Freeze-frame crossfade (canvas capture + opacity fade)
 * - AudioSynth (WebAudio, không dùng file âm thanh)
 * - Class-based stage switcher + z-index CSS scale
 * - THOÁT (ESC) + postMessage fallback
 * - Video error panel (retry / skip scene)
 * - Debug flags trong URL
 *
 * Khác Level 4:
 * - SCENE_FLOW table (không parseInt + 1)
 * - CHỈ 1 câu hỏi (stage-photo) với Bút Thử AI (magnifier)
 * - good/bad được gọi trực tiếp theo đáp án, không phải chuỗi tuần tự
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    const CONFIG = {
        // Thứ tự ưu tiên thư mục asset (thư mục thật có KHOẢNG TRẮNG: "level 5")
        BASES: [
            '../video/level 5/',
            '../video/level5/',
            'video/level5/',
            './'
        ],
        VIDEO_EXTS: ['.mp4', '.webm', '.mov'],
        // Đuôi THẬT của video/level 5/anh_AI.jpg được đặt lên đầu để giảm số request 404.
        // Đuôi còn lại là dự phòng (đổi tên file hoặc dùng định dạng khác).
        IMAGE_EXTS: ['.jpg', '.jpeg', '.png', '.webp', '.jfif', '.avif', '.gif'],
        IMAGE_NAME: 'anh_AI',
        VIDEO_SCENES: ['intro', 'good', 'bad'],
        BADGE_NAME: 'THÁM TỬ SOI ẢNH AI',
        LOADING_TIMEOUT_MS: 8000,
        IDLE_HINT_MS: 15000,
        CORRECT_EFFECT_MS: 800,
        WRONG_EFFECT_MS: 600
    };

    /**
     * Bảng luồng tường minh — thay cho parseInt + 1.
     * intro → câu hỏi · good → summary · bad → màn kết quả sai (rồi mới quay lại câu hỏi)
     */
    const SCENE_FLOW = {
        intro: { question: 'detect' },
        good:  { next: 'summary' },
        bad:   { question: 'detect-retry' }
    };

    const ALL_STAGES = ['intro', 'photo', 'good', 'bad', 'summary'];

    /** Cờ chống kết thúc scene trùng lặp (xem _triggerSceneEnd) */
    const _sceneEnded = { intro: false, good: false, bad: false };

    const HINT_LEVEL_1 = 'Hãy nhìn thật kỹ bàn chân và đôi cánh của chú mèo nhé!';
    const HINT_LEVEL_2 = 'Thử đếm xem chú mèo có mấy cái chân, và chữ trong ảnh có rõ nét không?';

    /**
     * ResourceSource: dò thư mục + đuôi file, cache lại để dùng chung
     * cho CẢ video lẫn ảnh (baseIdx chung).
     */
    const ResourceSource = {
        baseIdx: null,
        videoExt: null,
        imageExt: null,

        base() {
            return (this.baseIdx === null) ? '' : CONFIG.BASES[this.baseIdx];
        },

        videoUrl(sceneName) {
            if (this.baseIdx === null || !this.videoExt) return null;
            return encodeURI(this.base() + sceneName + this.videoExt);
        },

        imageUrl() {
            if (this.baseIdx === null || !this.imageExt) return null;
            return encodeURI(this.base() + CONFIG.IMAGE_NAME + this.imageExt);
        },

        /** Danh sách URL tuyệt đối đã thử — dùng cho error panel khi debug */
        triedImageUrls() {
            return CONFIG.BASES.map(b => CONFIG.IMAGE_EXTS.map(e => b + CONFIG.IMAGE_NAME + e)).flat();
        }
    };

    /**
     * Runtime state.
     */
    const level5State = {
        currentScene: null,
        question: {
            firstChoice: null,
            attempts: 0,
            correct: false,
            locked: false,        // khoá 2 nút sau lần chạm đầu (tránh double-fire)
            history: []           // mảng 'fake' | 'real' theo thứ tự con chọn
        },
        hintLevel: 0,            // mức gợi ý đã hiện (0 = chưa hiện, 1, 2)
        magnifyMode: false,
        zoomed: false
    };

    // =========================================================================
    // 2. ASSET PROBING
    // =========================================================================

    let _probePromise = null;
    let _imageProbePromise = null;

    /** Nhật ký kết quả probe ảnh (url → status/content-type) để hiện ở panel lỗi khi ?debug=1 */
    const _imageProbeLog = new Map();

    function _recordImageProbe(url, status, contentType, ok) {
        _imageProbeLog.set(url, { status, contentType, ok });
    }

    /**
     * Dò sự tồn tại của file ảnh.
     * - http/https: dùng fetch + Range (nhẹ, không tải hết file).
     * - file://: fetch bị chặn CORS → dùng <img> onload (giống cách Level 4 dò).
     * Lưu ý: cả 2 cách đều ghi 1 dòng 404 vào Console khi thử đuôi file không tồn tại
     * — giống hành vi probing của Level 4, KHÔNG phải lỗi JS.
     */
    async function _probeImage(url) {
        if (location.protocol === 'file:') {
            return new Promise(resolve => {
                const img = new Image();
                let settled = false;
                const finish = (ok) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    img.onload = null;
                    img.onerror = null;
                    resolve(ok);
                };
                const timer = setTimeout(() => finish(false), 6000);
                // Phải kiểm naturalWidth: nếu server/file trả HTML (SPA fallback),
                // <img> vẫn có thể fire onload với naturalWidth = 0 → coi nhầm là ảnh.
                img.onload = () => {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    const ok = w > 0 && h > 0;
                    _recordImageProbe(String(url), ok ? 200 : 200, 'image/ (file://)', ok);
                    finish(ok);
                };
                img.onerror = () => {
                    _recordImageProbe(String(url), 'error', 'n/a', false);
                    finish(false);
                };
                img.src = encodeURI(url);
            });
        }
        try {
            const res = await fetch(encodeURI(url), { method: 'GET', headers: { Range: 'bytes=0-0' } });
            const statusOk = res.ok || res.status === 206;
            // BẮT BUỘC kiểm Content-Type: server có SPA fallback trả 200/206 + text/html
            // (index.html) cho MỌI đường dẫn không tồn tại. Chỉ kiểm status sẽ coi
            // HTML là ảnh hợp lệ → <img> tải ra HTML → ảnh vỡ. (xem README mục "Lỗi đã gặp")
            const contentType = res.headers.get('content-type') || '';
            const typeOk = contentType.trim().toLowerCase().startsWith('image/');
            _recordImageProbe(String(url), res.status, contentType, statusOk && typeOk);
            try { res.body?.cancel(); } catch (e) {}
            return statusOk && typeOk;
        } catch (e) {
            return false;
        }
    }

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
                // Chỉ coi là video thật khi có kích thước khung hình > 0
                finish(v.videoWidth > 0 && v.videoHeight > 0);
            };
            v.onerror = (ev) => {
                finish(false);
            };
            v.src = encodeURI(url);
            v.load();
        });
    }

    async function _probeImageExts(base) {
        for (const ext of CONFIG.IMAGE_EXTS) {
            if (await _probeImage(base + CONFIG.IMAGE_NAME + ext)) return ext;
        }
        return null;
    }

    async function _probeVideoExts(base) {
        for (const ext of CONFIG.VIDEO_EXTS) {
            if (await _probeVideo(base + 'intro' + ext)) return ext;
        }
        return null;
    }

    /**
     * Dò tất cả: ưu tiên thư mục, sau đó ưu tiên đuôi file.
     * baseIdx chung cho video + ảnh.
     */
    async function _probeAll() {
        let fallback = null;

        for (let b = 0; b < CONFIG.BASES.length; b++) {
            const base = CONFIG.BASES[b];
            const [imgExt, vidExt] = await Promise.all([
                _probeImageExts(base),
                _probeVideoExts(base)
            ]);

            if (imgExt && vidExt) {
                ResourceSource.baseIdx = b;
                ResourceSource.imageExt = imgExt;
                ResourceSource.videoExt = vidExt;
                if (_isDebugMode()) {
                    console.log(`[Level5] Assets OK → base[${b}]=${base} image=${imgExt} video=${vidExt}`);
                }
                return true;
            }

            if ((imgExt || vidExt) && !fallback) {
                fallback = { b, imgExt, vidExt };
            }
        }

        if (fallback) {
            ResourceSource.baseIdx = fallback.b;
            ResourceSource.imageExt = fallback.imgExt;
            ResourceSource.videoExt = fallback.vidExt;
            if (_isDebugMode()) {
                console.warn('[Level5] Partial assets found', fallback);
            }
            return !!(fallback.imgExt || fallback.vidExt);
        }

        if (_isDebugMode()) console.error('[Level5] Không tìm thấy asset nào');
        return false;
    }

    function ensureAssets() {
        if (!_probePromise) _probePromise = _probeAll();
        return _probePromise;
    }

    /** Dò lại riêng ảnh (dùng cho nút "🔄 Thử lại" ở error panel) */
    function reprobeImage() {
        ResourceSource.imageExt = null;
        if (!_imageProbePromise) {
            _imageProbePromise = (async () => {
                for (let b = 0; b < CONFIG.BASES.length; b++) {
                    const ext = await _probeImageExts(CONFIG.BASES[b]);
                    if (ext) {
                        ResourceSource.baseIdx = b;
                        ResourceSource.imageExt = ext;
                        return true;
                    }
                }
                return false;
            })();
        }
        return _imageProbePromise;
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

        /** Tiếng "Tách!" máy ảnh — khi ảnh xuất hiện */
        photoSnap() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2200, now);
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.04);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.05);
        }

        /** Âm quét kính lúp — bật Bút Thử AI */
        magnify() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(900, now + 0.4);
            osc.frequency.linearRampToValueAtTime(400, now + 0.8);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.85);
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
            const scene = level5State.currentScene;
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
            // BỎ QUA chỉ hiện ở các stage VIDEO (intro / good / bad)
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

    function _showVideoErrorPanel(stageId, sceneLabel, triedUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

        // QUAN TRỌNG: nếu scene lỗi phát sinh TRƯỚC khi stage được kích hoạt
        // (ví dụ không tìm thấy file video → _playScene return sớm), error panel
        // sẽ nằm trong một stage không có class 'active' → NGƯỜI DÙNG KHÔNG
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
     * @param {string} sceneName - 'intro' | 'good' | 'bad'
     */
    async function _playScene(sceneName, options = {}) {
        const { onEnded, forceReload } = options;
        level5State.currentScene = sceneName;

        // Huỷ lưới an toàn của lần BỎ QUA trước đó (nếu có)
        if (TopBar._skipFallbackTimer) {
            clearTimeout(TopBar._skipFallbackTimer);
            TopBar._skipFallbackTimer = null;
        }

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (!videoEl) {
            if (_isDebugMode()) console.error(`[Level5] Không tìm thấy #video-${sceneName}`);
            if (onEnded) onEnded();
            return;
        }

        // DỪNG mọi video khác đang phát. Nếu không, handler 'ended' của video
        // cũ (ví dụ intro) có thể bắn lại sau khi đã chuyển sang cảnh khác và
        // làm luồng nhảy sai (Level 4 không cần vì luồng tuần tự tuyệt đối).
        document.querySelectorAll('video').forEach(v => {
            if (v === videoEl) return;
            try {
                v.pause();
                v.onended = null;
                v.ontimeupdate = null;
            } catch (e) {}
        });

        // Cho phép scene này kết thúc lại (dùng lại khi xem lại cảnh giới thiệu)
        if (_sceneEnded.hasOwnProperty(sceneName)) _sceneEnded[sceneName] = false;

        await ensureAssets();

        const url = ResourceSource.videoUrl(sceneName);
        if (!url) {
            _showVideoErrorPanel(sceneName, sceneName, _allTriedVideoUrls(sceneName));
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
            // KHÔNG set muted — video Level 5 CÓ TIẾNG.
            videoEl.src = url;
        }
        videoEl.preload = 'auto';

        if (_isDebugMode()) {
            console.log(`[Level5] Scene ${sceneName} → ${new URL(url, location.href).href}`);
        }

        let errorHandled = false;
        function onError() {
            if (errorHandled) return;
            errorHandled = true;
            hideLoading();
            cleanupListeners();
            if (_isDebugMode()) console.error('[Level5] Video lỗi:', sceneName, url);
            _showVideoErrorPanel(sceneName, sceneName, _allTriedVideoUrls(sceneName));
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
            const p = videoEl.play();
        });

        container.appendChild(overlay);
    }

    /**
     * Kết thúc scene — capture freeze-frame rồi chuyển tiếp.
     *
     * Cờ `_sceneEnded` chống gọi trùng: nếu không có nó, khi người dùng bấm
     * "BỎ QUA" trước khi video kịp seek (duration chưa sẵn sàng) và sau đó video
     * thật sự phát hết, handler 'ended' sẽ bắn LẦN NỮA → chạy lại luồng →
     * reset lịch sử trả lời (lượt chơi bị tính sai).
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
     *  - 'detect'       : màn câu hỏi (mới hoàn toàn)
     *  - 'detect-retry' : màn kết quả sai (sau khi xem xong video bad)
     */
    function _handleQuestion(kind) {
        if (kind === 'detect') {
            _showPhotoStage({ fresh: true });
        } else if (kind === 'detect-retry') {
            _showWrongResultScreen();
        }
    }

    // =========================================================================
    // 7. GAME STAGE (stage-photo) — Bút Thử AI
    // =========================================================================

    let _idleHintTimer = null;
    let _flowTimer = null;

    function _clearTimers() {
        if (_idleHintTimer) { clearTimeout(_idleHintTimer); _idleHintTimer = null; }
        if (_flowTimer) { clearTimeout(_flowTimer); _flowTimer = null; }
    }

    function _showPhotoStage(options = {}) {
        const { fresh = true } = options;
        sound.init();

        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        FreezeFrame.crossfade(() => {
            switchStage('photo');
            TopBar.updateVisibility('photo');

            _resetPhotoStageUI(fresh);

            // Chỉ bật nhạc/hiệu ứng lần đầu khi ảnh vừa xuất hiện
            sound.photoSnap();

            _ensureImageLoaded();

            // Nếu con đã trượt ít nhất 1 lần → tự hiện gợi ý mức 1
            if (level5State.question.history.some(h => h === 'real')) {
                _showHint(1, false);
            }

            _resetIdleHint();
        });
    }

    /**
     * Reset UI màn câu hỏi (giữ lại màu cam của nút đã chọn sai trước đó).
     */
    function _resetPhotoStageUI(fresh) {
        const fakeBtn = document.getElementById('btn-answer-fake');
        const realBtn = document.getElementById('btn-answer-real');

        // Tắt chế độ phóng to
        _setMagnifyMode(false, false);
        _setZoom(false);

        if (fresh) {
            level5State.question.history = [];
            level5State.question.firstChoice = null;
            level5State.question.attempts = 0;
            level5State.question.correct = false;
                level5State.hintLevel = 0;
        }

        // Mở khoá 2 nút đáp án (dù chơi lại lần nữa sau khi trượt)
        level5State.question.locked = false;

        [fakeBtn, realBtn].forEach(btn => {
            if (!btn) return;
            btn.classList.remove('ai-selected-correct', 'ai-selected-wrong');
            btn.disabled = false;
        });

        // Giữ lại màu cam nhạt của nút con đã chọn sai (để con nhớ)
        if (realBtn && level5State.question.history.includes('real')) {
            realBtn.classList.add('ai-selected-wrong');
        }

        // Bíp về trạng thái mặc định
        _setBip('Bíp đây! Con dùng Bút Thử AI để soi kỹ từng chi tiết rồi chọn xem đây là ảnh thật hay ảnh do AI vẽ nhé!');
        const bip = document.getElementById('ai-bip');
        if (bip) bip.classList.remove('ai-bip-hint');
    }

    function _setBip(text) {
        const el = document.getElementById('ai-bip-text');
        if (el) el.textContent = text;
    }

    function _showHint(level, playSound = true) {
        _setBip(level >= 2 ? HINT_LEVEL_2 : HINT_LEVEL_1);
        const bip = document.getElementById('ai-bip');
        if (bip) bip.classList.add('ai-bip-hint');
        level5State.hintLevel = Math.max(level5State.hintLevel, level);
        if (playSound) sound.playSoftBip();
    }

    function _resetIdleHint() {
        if (_idleHintTimer) clearTimeout(_idleHintTimer);
        _idleHintTimer = setTimeout(() => {
            if (level5State.question.correct) return;
            _showHint(1);
        }, CONFIG.IDLE_HINT_MS);
    }

    // ---------------------------------------------------------------- Ảnh ---

    function _ensureImageLoaded() {
        const img = document.getElementById('ai-image');
        const err = document.getElementById('ai-image-error');
        if (!img) return;

        ensureAssets().then(() => {
            const url = ResourceSource.imageUrl();
            if (!url) {
                _showImageError();
                return;
            }
            if (img.getAttribute('src') === url && img.complete && img.naturalWidth > 0) return;
            img.onload = () => {
                if (err) err.classList.add('hidden');
            };
            img.onerror = (ev) => {
                // <img> hỏng SAU khi dò → thử đuôi/thư mục kế tiếp thay vì báo lỗi ngay.
                if (_tryNextImageCandidate()) return;
                _showImageError();
            };
            img.src = url;
        });
    }

    /**
     * Sinh danh sách ứng viên (base × đuôi) theo thứ tự ưu tiên, bắt đầu từ vị trí
     * đang dùng. Dùng lại cho cả probe lẫn fallback khi <img> hỏng.
     */
    function _imageCandidates(fromBaseIdx, fromExt) {
        const out = [];
        const b0 = Number.isInteger(fromBaseIdx) ? fromBaseIdx : 0;
        const startBases = [];
        for (let i = 0; i < CONFIG.BASES.length; i++) startBases.push((b0 + i) % CONFIG.BASES.length);

        const startExts = [];
        const e0 = CONFIG.IMAGE_EXTS.indexOf(fromExt);
        for (let i = 0; i < CONFIG.IMAGE_EXTS.length; i++) {
            startExts.push(CONFIG.IMAGE_EXTS[(Math.max(e0, 0) + i) % CONFIG.IMAGE_EXTS.length]);
        }

        for (const b of startBases) {
            for (const ext of startExts) {
                out.push({ baseIdx: b, ext, url: CONFIG.BASES[b] + CONFIG.IMAGE_NAME + ext });
            }
        }
        return out;
    }

    let _triedImageUrls = [];
    let _imageCandidatesExhausted = false;

    /** Thử ứng viên kế tiếp sau 1 lần onerror. Trả false khi đã hết danh sách. */
    function _tryNextImageCandidate() {
        const img = document.getElementById('ai-image');
        if (!img) return false;

        const candidates = _imageCandidates(ResourceSource.baseIdx, ResourceSource.imageExt);
        let idx = candidates.findIndex((c) => encodeURI(c.url) === img.getAttribute('src'));

        for (let i = idx + 1; i < candidates.length; i++) {
            const cand = candidates[i];
            ResourceSource.baseIdx = cand.baseIdx;
            ResourceSource.imageExt = cand.ext;
            const abs = new URL(encodeURI(cand.url), location.href).href;
            // Gán trực tiếp; onload/onerror đã gắn sẵn nên chuỗi fallback tự chạy.
            img.src = cand.url;
            return true;
        }

        _imageCandidatesExhausted = true;
        return false;
    }

    function _showImageError() {
        const err = document.getElementById('ai-image-error');
        const urls = document.getElementById('ai-image-error-urls');
        if (err) err.classList.remove('hidden');
        if (urls) {
            if (_isDebugMode()) {
                const lines = ResourceSource.triedImageUrls().map(u => {
                    const abs = new URL(encodeURI(u), location.href).href;
                    const rec = _imageProbeLog.get(u);
                    const detail = rec
                        ? ` → ${rec.status} · ${rec.contentType || '(no content-type)'} · ${rec.ok ? 'OK' : 'REJECT'}`
                        : ' → (không có phản hồi)';
                    return `${abs}${detail}`;
                });
                urls.innerHTML = 'Đã thử:<br>' + lines.join('<br>');
            } else {
                urls.innerHTML = '';
            }
        }
    }

    function _wireImageControls() {
        const retryBtn = document.getElementById('btn-image-retry');
        const skipBtn = document.getElementById('btn-image-skip');

        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const err = document.getElementById('ai-image-error');
                if (err) err.classList.add('hidden');
                const img = document.getElementById('ai-image');
                if (img) img.removeAttribute('src');
                // Xoá cache baseIdx/imageExt và kết quả probe cũ để dò lại thật sự từ đầu
                ResourceSource.baseIdx = null;
                ResourceSource.imageExt = null;
                _imageProbePromise = null;
                _probePromise = null;
                _imageProbeLog.clear();
                _imageCandidatesExhausted = false;
                const errPanel = document.getElementById('ai-image-error');
                if (errPanel) errPanel.classList.add('hidden');
                reprobeImage().then(() => _ensureImageLoaded());
            });
        }

        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const err = document.getElementById('ai-image-error');
                if (err) err.classList.add('hidden');
                const img = document.getElementById('ai-image');
                if (img) {
                    img.removeAttribute('src');
                    img.alt = 'Ảnh không tải được — hãy chọn đáp án dựa vào trải nghiệm';
                }
                _setBip('Ảnh không tải được, nhưng con vẫn có thể chọn đáp án nhé!');
            });
        }
    }

    // ------------------------------------------------------- Bút Thử AI -----

    function _setMagnifyMode(on, playSound = true) {
        level5State.magnifyMode = on;
        const btn = document.getElementById('btn-magnifier');
        const frame = document.getElementById('ai-zoom-frame');
        if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (frame) frame.classList.toggle('ai-zoom-active', on);
        if (on && playSound) sound.magnify();
    }

    function _setZoom(on) {
        level5State.zoomed = on;
        const img = document.getElementById('ai-image');
        if (img) img.classList.toggle('ai-zoomed', on);
        if (!on) {
            const img2 = document.getElementById('ai-image');
            if (img2) img2.style.transformOrigin = '50% 50%';
        }
    }

    /**
     * Tính transform-origin theo toạ độ chạm (tương đối so với khung ảnh).
     * Dùng cho cả chuột và cảm ứng (sự kiện 'click').
     *
     * Lưu ý: dùng rect của KHUNG (frame) chứ không phải của <img>, vì khi đang
     * zoom, rect của <img> đã bị scale nên toạ độ sẽ bị lệch.
     */
    function _zoomToPoint(clientX, clientY) {
        const img = document.getElementById('ai-image');
        const frame = document.getElementById('ai-zoom-frame');
        if (!img || !frame) return;

        const rect = frame.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        // <img> phủ kín khung (inset:0) nên hộp ảnh trùng hộp khung
        const originX = ((clientX - rect.left) / rect.width) * 100;
        const originY = ((clientY - rect.top) / rect.height) * 100;

        const cx = Math.min(Math.max(originX, 0), 100);
        const cy = Math.min(Math.max(originY, 0), 100);

        img.style.transformOrigin = `${cx.toFixed(2)}% ${cy.toFixed(2)}%`;
        _setZoom(true);
    }

    function _wireMagnifier() {
        const btn = document.getElementById('btn-magnifier');
        const frame = document.getElementById('ai-zoom-frame');

        if (btn) {
            btn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const next = !level5State.magnifyMode;
                _setMagnifyMode(next);
                if (!next) _setZoom(false);
                _resetIdleHint();
            });
        }

        if (frame) {
            frame.addEventListener('click', (e) => {
                if (!level5State.magnifyMode) return;
                e.preventDefault();
                if (level5State.zoomed) {
                    _setZoom(false);
                } else {
                    _zoomToPoint(e.clientX, e.clientY);
                }
                _resetIdleHint();
            });
        }
    }

    // --------------------------------------------------------- Đáp án -------

    function _wireAnswerButtons() {
        const fakeBtn = document.getElementById('btn-answer-fake');
        const realBtn = document.getElementById('btn-answer-real');

        [fakeBtn, realBtn].forEach(btn => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                _handleAnswer(btn.dataset.choice, btn);
            });
        });
    }

    function _handleAnswer(choice, btnEl) {
        const q = level5State.question;
        if (q.locked) return;   // khoá sau lần chạm đầu (tránh double-fire)

        q.locked = true;
        q.attempts++;
        q.history.push(choice);
        if (q.firstChoice === null) q.firstChoice = choice;

        const isCorrect = (choice === 'fake');

        sound.init();
        if (isCorrect) sound.playCorrectCatch();
        else sound.playIncorrectCatch();

        // Chỉ nút ĐÃ CHỌN được tô màu — KHÔNG bao giờ lộ đáp án đúng
        const fakeBtn = document.getElementById('btn-answer-fake');
        const realBtn = document.getElementById('btn-answer-real');
        [fakeBtn, realBtn].forEach(b => { if (b) b.disabled = true; });
        if (btnEl) {
            btnEl.classList.remove('ai-selected-correct', 'ai-selected-wrong');
            btnEl.classList.add(isCorrect ? 'ai-selected-correct' : 'ai-selected-wrong');
        }

        _resetIdleHint();

        if (isCorrect) {
            q.correct = true;
            _setBip('Chuẩn rồi con! Bíp thấy những chi tiết rất đáng ngờ trong ảnh này đấy!');
            _flowTimer = setTimeout(() => {
                _flowTimer = null;
                _playScene('good');
            }, CONFIG.CORRECT_EFFECT_MS);
        } else {
            _setBip('Bíp cần thêm một chút thông tin nữa. Xem cảnh tiếp theo nhé con!');
            _flowTimer = setTimeout(() => {
                _flowTimer = null;
                _playScene('bad');
            }, CONFIG.WRONG_EFFECT_MS);
        }
    }

    // =========================================================================
    // 8. WRONG RESULT SCREEN
    // =========================================================================

    function _showWrongResultScreen() {
        sound.init();
        sound.playSoftBip();

        // Ẩn nút BỎ QUA (chỉ hiện ở stage video)
        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        const overlay = document.getElementById('result-overlay');
        const card = document.getElementById('ai-result-card');
        if (!overlay || !card) return;

        card.innerHTML = `
            <div class="result-screen result-soft">
                <div class="result-icon">🔎</div>
                <div class="result-title">Khoan đã, soi kỹ lại nào!</div>
                <div class="result-body">Mọi người bảo ảnh này là giả đó! Con nhìn kỹ lại bàn chân và dòng chữ phía sau xem có bị dị thường không nhé!</div>
                <div class="result-bip">💬 <em>Hãy dùng Bút Thử AI soi thật kỹ từng chi tiết!</em></div>
                <div class="result-tip">💡 <strong>Mẹo nhớ:</strong> Ảnh AI hay vẽ thừa chân, thừa ngón tay và chữ bị nhòe.</div>
                <div class="result-actions">
                    <button class="result-btn result-btn-retry" type="button" aria-label="Thử lại câu hỏi">🔄 Thử lại</button>
                    <button class="result-btn result-btn-replay" type="button" aria-label="Xem lại cảnh giới thiệu">🎬 Xem lại cảnh giới thiệu</button>
                </div>
            </div>
        `;

        card.querySelector('.result-btn-retry')?.addEventListener('click', () => {
            sound.init();
            sound.playTick();
            overlay.classList.add('hidden');
            // Giữ nguyên firstChoice & history (không reset) — giữ màu cam nút đã chọn sai
            _showPhotoStage({ fresh: false });
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
                _showPhotoStage({ fresh: false });
            }
        });
    }

    // =========================================================================
    // 9. SUMMARY
    // =========================================================================

    function _computeStats() {
        const hist = level5State.question.history;
        const slips = hist.filter(h => h === 'real').length;

        let stars = 1;
        if (slips === 0) stars = 3;
        else if (slips === 1) stars = 2;

        let xp = 10;
        if (slips === 0) xp = 30;
        else if (slips === 1) xp = 20;

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
                    colors: ['#22C55E', '#5BA8FF', '#FFD700']
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

        const wasFirstTry = stats.slips === 0;
        const recapHtml = wasFirstTry
            ? `
                <div class="choice-recap-item choice-recap-correct">
                    <span class="choice-recap-icon">✅</span>
                    <div class="choice-recap-content">
                        <div class="choice-recap-question">Thám Tử Soi Chi Tiết AI · Trò chơi nhận biết ảnh AI</div>
                        <div class="choice-recap-answer">✅ đúng ngay lần đầu</div>
                        <div class="choice-recap-note">Con đã nhìn ra dấu hiệu ảnh AI ngay lần đầu — đỉnh thật đấy!</div>
                    </div>
                </div>
            `
            : `
                <div class="choice-recap-item choice-recap-corrected">
                    <span class="choice-recap-icon">🔁</span>
                    <div class="choice-recap-content">
                        <div class="choice-recap-question">Thám Tử Soi Chi Tiết AI · Trò chơi nhận biết ảnh AI</div>
                        <div class="choice-recap-answer">🔁 lúc đầu chọn "ẢNH THẬT 100%", sau đã sửa lại thành "ẢNH GIẢ DO AI VẼ"</div>
                        <div class="choice-recap-note">Biết sửa lại cũng là siêu năng lực! Lần sau con sẽ soi kỹ hơn nhé.</div>
                    </div>
                </div>
            `;

        card.innerHTML = `
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png"
                 alt="CyberKnight" class="summary-logo">
            <div class="summary-icon-badge">🕵️</div>
            <h2 class="summary-title">LEVEL 5 COMPLETED!</h2>
            <div class="summary-stars">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${CONFIG.BADGE_NAME}</span>
            </div>

            <div class="summary-message">
                AI vẽ ảnh rất đẹp nhưng hay sai ở những chi tiết nhỏ.<br>
                Soi kỹ – Kiểm tra – Hỏi người lớn rồi mới tin nhé!
            </div>

            <hr class="summary-divider">

            <!-- NHỚ NHANH: SOI – KIỂM – HỎI -->
            <div class="summary-section-title">NHỚ NHANH: SOI – KIỂM – HỎI</div>
            <div class="ps-formula-row">
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">🔍</div>
                    <div class="ps-formula-label">SOI</div>
                    <div class="ps-formula-text">Soi kỹ tay, chân, ngón, chữ.</div>
                    <div class="ps-formula-sub">Dùng Bút Thử AI phóng to từng chi tiết.</div>
                </div>
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">✅</div>
                    <div class="ps-formula-label">KIỂM</div>
                    <div class="ps-formula-text">Xem nguồn ảnh, có quá hoàn hảo/vô lý không.</div>
                    <div class="ps-formula-sub">Mèo có cánh, bóng đổ lạ là dấu hiệu.</div>
                </div>
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">👨‍👩‍👧</div>
                    <div class="ps-formula-label">HỎI</div>
                    <div class="ps-formula-text">Không chắc thì hỏi bố mẹ, thầy cô.</div>
                    <div class="ps-formula-sub">Đừng chia sẻ ngay khi chưa chắc.</div>
                </div>
            </div>

            <hr class="summary-divider">

            <!-- 3 DẤU HIỆU ẢNH DO AI VẼ -->
            <div class="summary-section-title">3 DẤU HIỆU ẢNH DO AI VẼ</div>
            <div class="ps-leak-list">
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">🐾</span>
                    <span class="ps-leak-text">Tay, chân, ngón thừa hoặc thiếu</span>
                    <span class="ps-leak-tag">Đếm ngón</span>
                </div>
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">🔤</span>
                    <span class="ps-leak-text">Chữ bị nhòe, méo, đọc không ra</span>
                    <span class="ps-leak-tag">Soi chữ</span>
                </div>
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">🌈</span>
                    <span class="ps-leak-text">Quá hoàn hảo hoặc vô lý</span>
                    <span class="ps-leak-tag">Mèo có cánh, bóng đổ lạ</span>
                </div>
            </div>

            <hr class="summary-divider">

            <!-- HÀNH TRÌNH CỦA CON -->
            <div class="summary-section-title">HÀNH TRÌNH CỦA CON</div>
            <div class="choices-recap">
                ${recapHtml}
            </div>

            <hr class="summary-divider">

            <!-- Tip + disclaimer -->
            <div class="ps-tip-line">💡 Không chắc ảnh thật hay giả? Hãy hỏi người lớn trước khi tin hoặc chia sẻ nhé!</div>
            <div class="ps-disclaimer">Bức ảnh mèo biết bay trong trò chơi là ảnh do AI tạo ra để học tập.</div>

            <!-- Actions -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay" type="button" aria-label="Chơi lại level 5">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue" type="button" aria-label="Tiếp tục hành trình">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', _replay);
        document.getElementById('btn-summary-continue')?.addEventListener('click', _continue);

        window.dispatchEvent(new CustomEvent('level5:complete', {
            detail: {
                answers: level5State.question,
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

        level5State.question = {
            firstChoice: null,
            attempts: 0,
            correct: false,
            locked: false,
            history: []
        };
        level5State.hintLevel = 0;
        level5State.magnifyMode = false;
        level5State.zoomed = false;
        level5State.currentScene = null;

        // Cho phép 3 video phát lại từ đầu
        _sceneEnded.intro = false;
        _sceneEnded.good = false;
        _sceneEnded.bad = false;

        resetAllVideos();

        const overlay = document.getElementById('result-overlay');
        if (overlay) overlay.classList.add('hidden');

        const resultCard = document.getElementById('ai-result-card');
        if (resultCard) resultCard.innerHTML = '';

        if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';

        // Reset lại UI màn câu hỏi cho lượt chơi mới
        _resetPhotoStageUI(true);

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

        const topBar = document.getElementById('level5-top-bar');
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

        // Ẩn overlay kết quả khi rời khỏi màn câu hỏi
        if (targetStage !== 'photo') {
            const overlay = document.getElementById('result-overlay');
            if (overlay && !overlay.classList.contains('hidden') && targetStage !== 'summary') {
                overlay.classList.add('hidden');
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

        // ?skip=intro|good|bad → nhảy thẳng tới stage video
        if (CONFIG.VIDEO_SCENES.includes(skip)) {
            _resetForDebug();
            _advanceToScene(skip);
            return true;
        }

        // ?skip=q1 → nhảy thẳng tới màn câu hỏi
        if (skip === 'q1') {
            _resetForDebug();
            _showPhotoStage({ fresh: true });
            return true;
        }

        // ?skip=result-wrong → tự chọn 🟢 rồi hiện màn kết quả sai (không xem video bad)
        if (skip === 'result-wrong') {
            _resetForDebug();
            _showPhotoStage({ fresh: true });
            setTimeout(() => {
                const realBtn = document.getElementById('btn-answer-real');
                if (realBtn) {
                    // Chọn sai nhưng KHÔNG phát video bad
                    const q = level5State.question;
                    q.attempts++;
                    q.history.push('real');
                    if (q.firstChoice === null) q.firstChoice = 'real';
                    realBtn.classList.add('ai-selected-wrong');
                    sound.playIncorrectCatch();
                    _showWrongResultScreen();
                }
            }, 300);
            return true;
        }

        // ?skip=summary-first → 3⭐, 30 XP
        if (skip === 'summary-first') {
            level5State.question = { firstChoice: 'fake', attempts: 1, correct: true, history: ['fake'] };
            _showSummary();
            return true;
        }

        // ?skip=summary-retry → 2⭐, 20 XP
        if (skip === 'summary-retry') {
            level5State.question = { firstChoice: 'real', attempts: 2, correct: true, history: ['real', 'fake'] };
            _showSummary();
            return true;
        }

        // ?skip=summary → mặc định đúng lần đầu (3⭐, 30 XP)
        if (skip === 'summary') {
            level5State.question = { firstChoice: 'fake', attempts: 1, correct: true, history: ['fake'] };
            _showSummary();
            return true;
        }

        return false;
    }

    function _resetForDebug() {
        level5State.question = { firstChoice: null, attempts: 0, correct: false, locked: false, history: [] };
        level5State.hintLevel = 0;
        level5State.magnifyMode = false;
        level5State.zoomed = false;
    }

    // =========================================================================
    // 12. INIT
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();

        _wireMagnifier();
        _wireAnswerButtons();
        _wireImageControls();

        // Nút "💡 Gợi ý" — hiện gợi ý mức 1, bấm lần 2 → mức 2
        const hintBtn = document.getElementById('btn-hint');
        if (hintBtn) {
            hintBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const nextLevel = level5State.hintLevel >= 1 ? 2 : 1;
                _showHint(nextLevel);
                _resetIdleHint();
            });
        }

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
                _advanceToScene('intro');
            });
        }
    });

})();
