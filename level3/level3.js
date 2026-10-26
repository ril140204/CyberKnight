/**
 * CYBERKNIGHT — LEVEL 3: "BỐN CHÌA KHÓA BÍ MẬT"
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth & Mini-Game Engine
 *
 * PHASE REFACTOR COMPLETE:
 * - Phase 0: All debug/AI code removed
 * - Phase 1: Class-based stage switching + CSS z-index scale
 * - Phase 2: Flexible video paths, loading states, autoplay handling
 * - Phase 3: Full interactionPoints state machine
 * - Phase 4: key-audit.js handles its own logic
 * - Phase 5: Dynamic summary with stars/XP
 * - Phase 6: Debug flags
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    const CONFIG = {
        VIDEO_BASE: '/video/level3/',
        VIDEO_SCENES: ['scene1', 'scene2', 'scene3', 'scene4', 'scene5'],
        XP_REWARD: 30,
        BADGE_NAME: 'NGƯỜI GIỮ CHÌA KHÓA',
        LOADING_TIMEOUT_MS: 8000,
        FEEDBACK_DISPLAY_MS: 1500,
        SCREEN_SHAKE_MS: 300,
    };

    // VideoSource: nguồn HLS/MP4 cho từng cảnh (đường dẫn tuyệt đối, không suy từ URL trang)
    const VideoSource = {
        baseIdx: 0,             // giữ để tương thích (nút "Thử lại" đặt về null)
        sourcesFor(scene) {
            return {
                hls: `${CONFIG.VIDEO_BASE}hls/${scene}/master.m3u8`,
                mp4: `${CONFIG.VIDEO_BASE}${scene}.mp4`,
            };
        },
        triedScenes: new WeakSet(),
    };

    const level3State = {
        currentScene: null,
        keyGameEngine: null,
        // Per-question state
        answers: {
            micro:    { firstChoice: null, attempts: 0, correct: false, history: [] },
            location: { firstChoice: null, attempts: 0, correct: false, history: [] },
            photos:   { firstChoice: null, attempts: 0, correct: false, history: [] }
        },
        keygame: { mistakes: 0, rounds: [] },
    };

    // =========================================================================
    // 2. INTERACTION POINTS (3 questions)
    // =========================================================================

    /**
     * REMINDER FOR FUTURE MAINTAINERS:
     * Options are presented EQUAL — same size, same prominence, same animation.
     * Do NOT pre-color correct/wrong options in the HTML.
     * Color is applied DYNAMICALLY after the child makes a choice.
     */
    const interactionPoints = [
        {
            id: 'micro',
            afterScene: 'scene2',
            nextScene: 'scene3',
            question: 'Bút Màu muốn dùng Micro để tô màu con rồng. Con sẽ làm gì?',
            options: [
                { id: 'A', label: 'Đưa chìa Micro cho Bút Màu' },
                { id: 'B', label: 'Không đưa chìa Micro' }
            ],
            correct: ['B'],
            correctFeedback: {
                icon: '🎤✔',
                text: 'Chuẩn luôn! Tô tranh đâu cần nghe hay ghi âm, nên con giữ chìa Micro lại.'
            },
            results: {
                A: {
                    icon: '🎤',
                    tone: 'warn',
                    title: 'Ồ, tô màu mà cần micro sao?',
                    body: 'Tô màu chỉ cần bút và giấy. Nếu đưa chìa Micro, ứng dụng có thể nghe được cả những điều con nói ở nhà.',
                    bip: 'Trước khi đưa chìa, hãy hỏi: "Để làm gì vậy?" Nếu chức năng không cần, đừng đưa nhé!',
                    tip: 'Quyền không liên quan tới việc đang làm = dấu hiệu đáng ngờ.'
                }
            }
        },
        {
            id: 'location',
            afterScene: 'scene3',
            nextScene: 'scene4',
            question: 'Bản Đồ muốn dùng Vị trí để chỉ đường cho con. Con chọn gì?',
            options: [
                { id: 'A', label: 'Cho dùng vị trí khi đang chỉ đường' },
                { id: 'B', label: 'Không cấp quyền, tự chọn điểm bắt đầu' },
                { id: 'C', label: 'Cho dùng vị trí mọi lúc, kể cả khi không dùng' }
            ],
            correct: ['A'],
            correctFeedback: {
                icon: '📍✔',
                text: 'Hay lắm! Bản Đồ cần biết con đang đứng đâu để chỉ đường, và chỉ trong lúc đang chỉ đường thôi.'
            },
            results: {
                B: {
                    icon: '📍',
                    tone: 'soft',
                    title: 'Cẩn thận là tốt, nhưng lần này hơi khác!',
                    body: 'Không cấp quyền thì an toàn đấy, nhưng Bản Đồ chỉ đường từ chỗ con đang đứng nên thật sự cần vị trí. Cách tốt nhất là cho phép "khi đang dùng" — vừa tiện vừa an toàn.',
                    bip: 'Quyền cần thiết cho đúng chức năng thì có thể cho, nhưng chỉ khi đang dùng thôi.',
                    tip: 'Chọn "Khi đang dùng ứng dụng" thay vì "Luôn luôn".'
                },
                C: {
                    icon: '📡',
                    tone: 'warn',
                    title: 'Khoan! "Mọi lúc" nghĩa là gì nhỉ?',
                    body: 'Nếu cho dùng mọi lúc, Bản Đồ biết con ở đâu cả khi không dùng — ở nhà, ở trường, trên đường đi. Thông tin nơi con ở rất riêng tư.',
                    bip: 'Chỉ đưa chìa khi thật sự cần, và lấy lại khi xong việc!',
                    tip: 'Tránh chọn "Luôn luôn / mọi lúc".'
                }
            }
        },
        {
            id: 'photos',
            afterScene: 'scene4',
            nextScene: 'scene5',
            question: 'Bản Đồ đã chỉ đường xong nhưng lại xin xem TẤT CẢ ảnh của con. Con sẽ…',
            options: [
                { id: 'A', label: 'Cho phép xem tất cả ảnh' },
                { id: 'B', label: 'Không cho phép xem ảnh' }
            ],
            correct: ['B'],
            correctFeedback: {
                icon: '🖼️✔',
                text: 'Chuẩn! Đã tìm được đường rồi thì Bản Đồ không cần xem ảnh của con.'
            },
            results: {
                A: {
                    icon: '🖼️',
                    tone: 'warn',
                    title: 'Tìm đường xong rồi, sao còn xem ảnh?',
                    body: 'Trong thư viện ảnh có ảnh mặt con, gia đình, nhà cửa… Ứng dụng đã làm xong việc mà vẫn xin thêm quyền thì rất đáng nghi.',
                    bip: 'Khi ứng dụng xin thêm quyền không liên quan, hãy dừng lại và hỏi người lớn nhé!',
                    tip: 'Xin thêm quyền sau khi xong việc = hãy nghi ngờ.'
                }
            }
        }
    ];

    // =========================================================================
    // 3. AUDIO SYNTH (reused from Level 1 & 2)
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

        playGlitchExplosion() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const bufferSize = this.ctx.sampleRate * 0.4;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(80, now + 0.4);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
            noise.start(now); noise.stop(now + 0.4);
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
    }

    const sound = new AudioSynth();
    // Expose for child modules (key-audit.js, permission-game.js) that look up
    // `window.parent.sound` or `window.sound` to call extension methods.
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

        /**
         * Capture from video respecting object-fit:contain geometry.
         * Computes centered letterbox/pillarbox to match what the user sees.
         */
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
                    // Video wider: fit to width
                    drawW = cw;
                    drawH = cw / vAspect;
                    drawX = 0;
                    drawY = (ch - drawH) / 2;
                } else {
                    // Video taller: fit to height
                    drawH = ch;
                    drawW = ch * vAspect;
                    drawX = (cw - drawW) / 2;
                    drawY = 0;
                }

                this.ctx.clearRect(0, 0, cw, ch);
                // Fill ambient background (in case of letterbox)
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, cw, ch);
                this.ctx.drawImage(videoEl, drawX, drawY, drawW, drawH);
                return true;
            } catch (err) {
                console.warn('Freeze frame capture failed:', err.message);
                return false;
            }
        },

        /**
         * Crossfade via CSS opacity transition + rAF-driven scheduling.
         * captureFromVideo should be called BEFORE this so the canvas already
         * holds a frame snapshot; we just fade it in/out without blocking.
         */
        async crossfade(prepareNewStageCallback) {
            if (!this.canvas) {
                if (prepareNewStageCallback) prepareNewStageCallback();
                return;
            }

            // Ensure we start from visible (from previous scene's capture)
            this.canvas.style.opacity = '1';
            this.canvas.style.transition = 'opacity 0.25s ease-in-out';

            // Defer callback to the next animation frame — main thread stays free
            if (prepareNewStageCallback) {
                requestAnimationFrame(prepareNewStageCallback);
            }

            // Fade canvas out after render cycle
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

        /**
         * "Skip" = end current scene right now (trigger the same end logic).
         * Scene 2/3/4 still lead to their questions.
         */
        _skipCurrent() {
            const scene = level3State.currentScene;
            if (!scene || !scene.startsWith('scene')) return;
            const videoEl = document.getElementById(`video-${scene}`);
            if (videoEl && !videoEl.ended) {
                if (videoEl.duration && videoEl.readyState >= 1) {
                    videoEl.currentTime = videoEl.duration - 0.05;
                } else {
                    _triggerSceneEnd(scene);
                }
            } else {
                _triggerSceneEnd(scene);
            }
        },

        updateVisibility(stage) {
            if (!this.skipBtn) return;
            const sceneStages = ['scene1', 'scene2', 'scene3', 'scene4', 'scene5'];
            const showSkip = sceneStages.includes(stage);
            this.skipBtn.classList.toggle('hidden', !showSkip);
        },

        exitLevel() {
            stopAllVideos();
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) { console.warn('postMessage error:', err); }
            window.location.href = '../index.html';
        }
    };

    // =========================================================================
    // 6. VIDEO / SCENE MANAGEMENT
    // =========================================================================

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

    /**
     * Show friendly error panel on a stage.
     */
    function _showVideoErrorPanel(stageId, sceneNum, triedAbsoluteUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

        // Remove any existing error panel
        const existing = stage.querySelector('.video-error-panel');
        if (existing) existing.remove();

        const debugHtml = _isDebugMode()
            ? `<div class="video-error-urls">Đã thử:<br>${triedAbsoluteUrls.map(u => {
                const abs = new URL(u, location.href).href;
                return abs;
            }).join('<br>')}</div>`
            : '';

        const panel = document.createElement('div');
        panel.className = 'video-error-panel';
        panel.innerHTML = `
            <div class="video-error-inner">
                <div class="video-error-icon">😢</div>
                <div class="video-error-title">Không tải được video cảnh ${sceneNum} 😢</div>
                ${debugHtml}
                <div class="video-error-buttons">
                    <button class="video-error-btn video-error-retry" data-scene="${stageId}">🔄 Thử lại</button>
                    <button class="video-error-btn video-error-skip" data-after-scene="${stageId}">⏭️ Bỏ qua cảnh</button>
                </div>
            </div>
        `;

        stage.querySelector('.video-container')?.appendChild(panel);

        panel.querySelector('.video-error-retry')?.addEventListener('click', () => {
            panel.remove();
            VideoSource.baseIdx = null; // force re-probe
            _playScene(stageId, { forceReload: true });
        });

        panel.querySelector('.video-error-skip')?.addEventListener('click', () => {
            panel.remove();
            const interaction = interactionPoints.find(ip => ip.afterScene === stageId);
            if (interaction) {
                _showInteraction(interaction);
            } else {
                const sceneNum = parseInt(stageId.replace('scene', ''), 10);
                if (sceneNum < 5) {
                    _gotoNextAfterQuestion({ nextScene: `scene${sceneNum + 1}` });
                } else {
                    _gotoNextAfterQuestion({ nextScene: 'keygame' });
                }
            }
        });
    }

    function _isDebugMode() {
        return new URLSearchParams(window.location.search).has('debug');
    }

    /**
     * Phát một cảnh. Nguồn video do CKVideo quản lý:
     *   HLS thích ứng (hls.js, tự đổi 360p/480p/720p theo băng thông)
     *   → HLS native (Safari) → MP4 720p (fallback cuối).
     * Chỉ cảnh KẾ TIẾP được chuẩn bị trước (nạp playlist, chưa tải segment)
     * để không tranh băng thông với cảnh đang phát trên mạng yếu.
     * @param {string} sceneName - e.g. 'scene1'
     * @param {Object} options
     * @param {Function} [options.onEnded] - callback when scene ends
     * @param {boolean} [options.forceReload] - nạp lại nguồn (nút "Thử lại")
     */
    function _playScene(sceneName, options = {}) {
        const { onEnded, forceReload } = options;
        const sceneNum = parseInt(sceneName.replace('scene', ''), 10);
        level3State.currentScene = sceneName;

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (!videoEl) {
            console.error(`[Level3] Video element #video-${sceneName} not found`);
            if (onEnded) onEnded();
            return;
        }

        // ---- Chuẩn bị cảnh KẾ TIẾP (playlist + segment đầu 240p) — nhưng chỉ SAU KHI cảnh này
        //      đã phát được 2s, để không tranh băng thông lúc khởi động trên mạng yếu ----
        const nextSceneIdx = sceneNum + 1;
        const prepareNext = () => {
            if (nextSceneIdx > 5) return;
            const nextVideo = document.getElementById(`video-scene${nextSceneIdx}`);
            if (nextVideo) {
                CKVideo.load(nextVideo, VideoSource.sourcesFor(`scene${nextSceneIdx}`), { preloadOnly: true }).catch(() => {});
            }
        };
        videoEl.addEventListener('playing', () => setTimeout(prepareNext, 2000), { once: true });

        // ---- Loading state helpers ----
        const container = videoEl.closest('.video-container');
        const spinner = container ? container.querySelector('.video-loading-spinner') : null;
        const slowNote = container ? container.querySelector('.video-loading-slow') : null;
        let loadingTimer = null;

        function showLoading() {
            if (spinner) spinner.classList.remove('hidden');
        }
        function hideLoading() {
            if (spinner) spinner.classList.add('hidden');
            if (slowNote) slowNote.classList.add('hidden');
            clearTimeout(loadingTimer);
        }

        showLoading();
        loadingTimer = setTimeout(() => {
            if (slowNote) slowNote.classList.remove('hidden');
        }, CONFIG.LOADING_TIMEOUT_MS);

        const sources = VideoSource.sourcesFor(sceneName);
        if (_isDebugMode()) console.log(`[Level3] Scene ${sceneName} →`, sources);

        let errorHandled = false;
        function onError() {
            if (errorHandled) return;
            errorHandled = true;
            hideLoading();
            cleanupListeners();
            if (_isDebugMode()) console.error('[Level3] Video failed for', sceneName, sources);
            _showVideoErrorPanel(sceneName, sceneNum, [sources.hls, sources.mp4]);
        }
        function onCanPlay() { hideLoading(); }
        function onWaiting() { showLoading(); }   // đang buffer giữa chừng → hiện spinner
        function onPlaying() { hideLoading(); }
        function cleanupListeners() {
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.removeEventListener('error', onError);
            videoEl.removeEventListener('waiting', onWaiting);
            videoEl.removeEventListener('playing', onPlaying);
        }

        videoEl.addEventListener('canplay', onCanPlay, { once: true });
        videoEl.addEventListener('error', onError);
        videoEl.addEventListener('waiting', onWaiting);
        videoEl.addEventListener('playing', onPlaying);

        // End detection: 'ended' primary, ontimeupdate fallback
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

        // Gắn nguồn (tái dùng instance nếu cảnh này đã được chuẩn bị trước),
        // rồi gọi play() NGAY trong call stack hiện tại để giữ quyền autoplay.
        CKVideo.load(videoEl, sources, { force: Boolean(forceReload) }).catch(onError);
        if (videoEl.currentTime !== 0) {
            try { videoEl.currentTime = 0; } catch (e) { /* chưa có metadata */ }
        }
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
            playPromise.catch((err) => {
                if (errorHandled || endedTriggered) return;
                if (err && err.name === 'NotAllowedError') {
                    hideLoading();
                    _showPlayButtonOverlay(videoEl, sceneName);
                } else {
                    // Chưa có dữ liệu lúc gọi play(), hoặc play() bị huỷ (AbortError) vì nguồn
                    // được gắn ngay sau đó → thử lại khi có thể phát
                    const retryPlay = () => {
                        if (errorHandled || endedTriggered || !videoEl.paused) return;
                        videoEl.play().catch(() => _showPlayButtonOverlay(videoEl, sceneName));
                    };
                    if (videoEl.readyState >= 3) retryPlay();
                    else videoEl.addEventListener('canplay', retryPlay, { once: true });
                }
            });
        }

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
            <button class="video-play-btn" type="button">
                ▶ BẤM ĐỂ XEM TIẾP
            </button>
        `;

        overlay.querySelector('.video-play-btn')?.addEventListener('click', () => {
            overlay.remove();
            const p = videoEl.play();
            if (p) {
                p.catch(() => {});
            }
        });

        container.appendChild(overlay);
    }

    /**
     * Trigger end of scene — capture freeze frame, then show interaction or advance.
     * @param {string} sceneName
     * @param {Function} [onEnded] - explicit callback; if absent runs default flow
     */
    function _triggerSceneEnd(sceneName, onEnded) {
        const sceneNum = parseInt(sceneName.replace('scene', ''), 10);
        const videoEl = document.getElementById(`video-${sceneName}`);
        if (videoEl) {
            FreezeFrame.captureFromVideo(videoEl);
            videoEl.pause();
            videoEl.onended = null;
            videoEl.ontimeupdate = null;
        }

        FreezeFrame.crossfade(() => {
            if (onEnded) {
                onEnded();
                return;
            }
            // Default flow
            const interaction = interactionPoints.find(ip => ip.afterScene === sceneName);
            if (interaction) {
                // Câu hỏi không có video → tải trước TRỌN cảnh kế tiếp (bậc theo băng thông đã đo)
                if (sceneNum < 5) CKVideo.warm(VideoSource.sourcesFor(`scene${sceneNum + 1}`));
                _showInteraction(interaction);
            } else {
                if (sceneNum < 5) {
                    _advanceToScene(`scene${sceneNum + 1}`);
                } else {
                    _advanceToKeyGame();
                }
            }
        });
    }

    function _advanceToScene(sceneName) {
        sound.init();
        _playScene(sceneName);
    }

    // =========================================================================
    // 7. INTERACTION OVERLAY (QUESTION FLOW)
    // =========================================================================

    let _currentInteraction = null;
    let _interactionAnswered = false;
    let _interactionResultShown = false;

    function _showInteraction(interaction) {
        _currentInteraction = interaction;
        _interactionAnswered = false;
        _interactionResultShown = false;

        const overlay = document.getElementById('interaction-overlay');
        const badge = document.getElementById('interaction-badge');
        const question = document.getElementById('interaction-question');
        const optionsEl = document.getElementById('interaction-options');
        const feedbackEl = document.getElementById('interaction-feedback');
        const continueBtn = document.getElementById('btn-interaction-continue');

        if (!overlay) return;

        // Badge
        if (badge) badge.textContent = '🔑 THỜI KHẮC QUYẾT ĐỊNH';

        // Question
        if (question) question.textContent = interaction.question;

        // Clear feedback & continue
        if (feedbackEl) {
            feedbackEl.classList.add('hidden');
            feedbackEl.className = 'interaction-feedback hidden';
            feedbackEl.textContent = '';
        }
        if (continueBtn) {
            continueBtn.classList.add('hidden');
            continueBtn.textContent = 'Tiếp tục ▶';
            continueBtn.onclick = null;
        }

        // Render options (EQUAL, no pre-coloring — see comment in interactionPoints)
        if (optionsEl) {
            optionsEl.innerHTML = interaction.options.map(opt => `
                <button class="interaction-option-btn"
                        data-option-id="${opt.id}"
                        type="button">
                    ${opt.label}
                </button>
            `).join('');

            optionsEl.querySelectorAll('.interaction-option-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (_interactionAnswered || _interactionResultShown) return;
                    _handleInteractionChoice(btn, btn.dataset.optionId);
                });
            });
        }

        // Show overlay
        overlay.classList.remove('hidden');
        // Hide skip button during questions/results
        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');
    }

    function _handleInteractionChoice(btnEl, chosenId) {
        if (_interactionAnswered || _interactionResultShown || !_currentInteraction) return;
        _interactionAnswered = true;

        const interaction = _currentInteraction;
        const isCorrect = interaction.correct.includes(chosenId);

        // Phase 3.2: Track per-question state
        const ans = level3State.answers[interaction.id];
        ans.attempts++;
        ans.history.push(chosenId);
        if (ans.firstChoice === null) ans.firstChoice = chosenId;
        if (isCorrect) ans.correct = true;

        // Play sound
        sound.init();
        if (isCorrect) {
            sound.playCorrectCatch();
        } else {
            sound.playIncorrectCatch();
        }

        // Disable all buttons (pre-color correct/wrong)
        document.querySelectorAll('.interaction-option-btn').forEach(btn => {
            btn.disabled = true;
            const optId = btn.dataset.optionId;
            if (interaction.correct.includes(optId)) {
                btn.classList.add('selected-correct');
            } else if (optId === chosenId) {
                btn.classList.add('selected-wrong');
            }
        });

        if (isCorrect) {
            // Phase 3.4: Positive feedback → continue immediately
            const feedbackEl = document.getElementById('interaction-feedback');
            if (feedbackEl) {
                feedbackEl.innerHTML = `
                    <div class="feedback-icon">${interaction.correctFeedback.icon}</div>
                    <div class="feedback-text">${interaction.correctFeedback.text}</div>
                `;
                feedbackEl.classList.remove('hidden');
                feedbackEl.className = 'interaction-feedback feedback-correct';
            }

            const continueBtn = document.getElementById('btn-interaction-continue');
            if (continueBtn) {
                continueBtn.classList.remove('hidden');
                continueBtn.onclick = () => _gotoNextAfterQuestion(interaction);
            }
        } else {
            // Phase 3.5: Wrong → show result screen
            _interactionResultShown = true;
            _showResultScreen(interaction, chosenId);
        }
    }

    /**
     * Show the result screen (full overlay, same z-layer as question).
     * Tone: positive, encouraging. tone:'warn' = light orange; tone:'soft' = gentle green.
     */
    function _showResultScreen(interaction, chosenId) {
        const result = interaction.results[chosenId];
        if (!result) return;

        const overlay = document.getElementById('interaction-overlay');
        const card = document.getElementById('interaction-card');
        if (!overlay || !card) return;

        const toneClass = result.tone === 'soft' ? 'result-soft' : 'result-warn';
        const bipSound = result.tone === 'soft' ? 'playSoftBip' : 'playGlitchExplosion';
        sound.init();
        sound[bipSound]();

        card.innerHTML = `
            <div class="result-screen ${toneClass}">
                <div class="result-icon">${result.icon}</div>
                <div class="result-title">${result.title}</div>
                <div class="result-body">${result.body}</div>
                <div class="result-bip">💬 <em>${result.bip}</em></div>
                <div class="result-tip">💡 <strong>Mẹo nhớ:</strong> ${result.tip}</div>
                <div class="result-actions">
                    <button class="result-btn result-btn-retry" data-action="retry" type="button">
                        🔄 Thử lại
                    </button>
                    <button class="result-btn result-btn-replay" data-action="replay" type="button">
                        🎬 Xem lại cảnh
                    </button>
                </div>
            </div>
        `;

        card.querySelector('.result-btn-retry')?.addEventListener('click', () => {
            _retryQuestion(interaction);
        });

        card.querySelector('.result-btn-replay')?.addEventListener('click', () => {
            _replaySceneForQuestion(interaction);
        });
    }

    /**
     * Retry: return to the same question, buttons reset to neutral.
     */
    function _retryQuestion(interaction) {
        sound.init();
        sound.playTick();
        _currentInteraction = interaction;
        _interactionAnswered = false;
        _interactionResultShown = false;
        // NOTE: Do NOT reset firstChoice — needed for summary to detect "was wrong, corrected"

        const card = document.getElementById('interaction-card');
        if (!card) return;

        // Restore card content
        card.innerHTML = `
            <div class="interaction-header">
                <span class="interaction-badge" id="interaction-badge">THỜI KHẮC QUYẾT ĐỊNH</span>
                <h2 class="interaction-question" id="interaction-question">${interaction.question}</h2>
            </div>
            <div id="interaction-options" class="interaction-options">
                ${interaction.options.map(opt => `
                    <button class="interaction-option-btn"
                            data-option-id="${opt.id}"
                            type="button">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
            <div id="interaction-feedback" class="interaction-feedback hidden"></div>
            <button id="btn-interaction-continue" class="btn-interaction-continue hidden" type="button">
                Tiếp tục ▶
            </button>
        `;

        // Re-bind option listeners
        card.querySelectorAll('.interaction-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (_interactionAnswered || _interactionResultShown) return;
                _handleInteractionChoice(btn, btn.dataset.optionId);
            });
        });

        const continueBtn = document.getElementById('btn-interaction-continue');
        if (continueBtn) {
            continueBtn.addEventListener('click', () => _gotoNextAfterQuestion(interaction));
        }
    }

    /**
     * Replay the video of the scene just before the question, then return to question.
     * When replay ends, show the question ONCE and do NOT count as a new attempt.
     */
    function _replaySceneForQuestion(interaction) {
        sound.init();
        sound.playTick();

        const overlay = document.getElementById('interaction-overlay');
        if (overlay) overlay.classList.add('hidden');

        const sceneToReplay = interaction.afterScene;
        const videoEl = document.getElementById(`video-${sceneToReplay}`);
        if (videoEl) {
            try { videoEl.currentTime = 0; } catch(e) {}
        }

        _playScene(sceneToReplay, {
            onEnded() {
                // Return to the question — does NOT count as a new attempt
                _currentInteraction = null;
                _interactionAnswered = false;
                _interactionResultShown = false;
                _showInteraction(interaction);
            }
        });
    }

    /**
     * Common function to go to nextScene from an interaction.
     * Used after correct answer or skip.
     */
    function _gotoNextAfterQuestion(interaction) {
        sound.init();
        sound.playTick();

        const overlay = document.getElementById('interaction-overlay');
        if (overlay) overlay.classList.add('hidden');

        _currentInteraction = null;
        _interactionAnswered = false;
        _interactionResultShown = false;

        // Immediately go to nextScene (no setTimeout delay)
        _advanceToScene(interaction.nextScene);
    }

    // =========================================================================
    // 8. KEY AUDIT GAME
    // =========================================================================

    function _startKeyGame(options = {}) {
        sound.init();

        FreezeFrame.crossfade(() => {
            switchStage('keygame');
            TopBar.updateVisibility('keygame');

            // Destroy existing engine if any
            if (level3State.keyGameEngine) {
                if (typeof level3State.keyGameEngine.destroy === 'function') {
                    level3State.keyGameEngine.destroy();
                }
                level3State.keyGameEngine = null;
            }

            // Initialize PermissionGame
            if (typeof window.PermissionGame === 'function') {
                level3State.keyGameEngine = new window.PermissionGame('#key-match-container', {
                    onComplete: (result) => {
                        // Save keygame result
                        if (result.mistakes !== undefined) {
                            level3State.keygame.mistakes = result.mistakes;
                        }
                        if (result.rounds) {
                            level3State.keygame.rounds = result.rounds;
                        }
                        // No setTimeout — self-celebrates internally, call summary immediately
                        _showSummary();
                    }
                });

                // Handle debug skip flags: ?skip=keygame → intro, ?skip=keygame-round3 → round 3
                const params = new URLSearchParams(window.location.search);
                const skip = params.get('skip');
                if (skip?.startsWith('keygame-round')) {
                    const roundNum = parseInt(skip.replace('keygame-round', ''), 10);
                    if (roundNum >= 1 && roundNum <= 5 && level3State.keyGameEngine) {
                        // Jump to round N-1 by simulating N-1 correct answers
                        const game = level3State.keyGameEngine;
                        for (let i = 0; i < roundNum - 1; i++) {
                            // Simulate correct: push correct round data without triggering UI
                            const roundData = {
                                id: ['camera','puzzle','torch','map','call'][i],
                                chosen: ['allow','deny','deny','while','ask'][i],
                                correct: true
                            };
                            game.rounds.push(roundData);
                        }
                        game.roundIndex = roundNum - 1;
                        game._transition(() => game._renderRound());
                    }
                }
            } else {
                console.error('[Level3] PermissionGame module not loaded');
            }
        });
    }

    function _advanceToKeyGame() {
        sound.init();
        sound.playVictoryChime();
        _startKeyGame();
    }

    // =========================================================================
    // 9. SUMMARY SCREEN
    // =========================================================================

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

    /**
     * Compute stars and XP based on answers and keygame performance.
     */
    function _computeSummaryStats() {
        const ans = level3State.answers;
        const kg = level3State.keygame;

        const questionsRightFirstTry = [
            ans.micro.correct && ans.micro.firstChoice === 'B',
            ans.location.correct && ans.location.firstChoice === 'A',
            ans.photos.correct && ans.photos.firstChoice === 'B'
        ].filter(Boolean).length;

        const questionsNeedingRetry = [
            ans.micro.correct && ans.micro.firstChoice !== 'B' && ans.micro.firstChoice !== null,
            ans.location.correct && ans.location.firstChoice !== 'A' && ans.location.firstChoice !== null,
            ans.photos.correct && ans.photos.firstChoice !== 'B' && ans.photos.firstChoice !== null
        ].filter(Boolean).length;

        const questionsAllCorrect = questionsRightFirstTry === 3;
        // "Good" keygame: mistakes <= 1 (per spec — the game self-celebrates)
        const goodKeygame = kg.mistakes <= 1;

        let stars = 1;
        if (questionsAllCorrect && goodKeygame) stars = 3;
        else if (questionsNeedingRetry === 0 && goodKeygame) stars = 2;
        else if (questionsNeedingRetry === 1) stars = 2;

        // XP calculation
        let xp = 0;
        xp += ans.micro.correct    ? (ans.micro.history.length <= 1    ? 8 : 4) : 0;
        xp += ans.location.correct ? (ans.location.history.length <= 1 ? 8 : 4) : 0;
        xp += ans.photos.correct   ? (ans.photos.history.length <= 1   ? 8 : 4) : 0;
        xp += goodKeygame ? 6 : 3;

        return { stars, xp, questionsAllCorrect, questionsRightFirstTry };
    }

    function _renderSummary() {
        const card = document.getElementById('summary-card-container');
        if (!card) return;

        const ans = level3State.answers;
        const kg = level3State.keygame;
        const stats = _computeSummaryStats();

        // Build star HTML
        const starFull = '⭐';
        const starEmpty = '☆';
        const starsHtml = starFull.repeat(stats.stars) + starEmpty.repeat(3 - stats.stars);

        // Option label lookup
        const optionLabels = {
            micro:    { A: 'Đưa chìa Micro cho Bút Màu', B: 'Không đưa chìa Micro' },
            location: { A: 'Cho dùng vị trí khi đang chỉ đường', B: 'Không cấp quyền, tự chọn điểm bắt đầu', C: 'Cho dùng vị trí mọi lúc, kể cả khi không dùng' },
            photos:   { A: 'Cho phép xem tất cả ảnh', B: 'Không cho phép xem ảnh' }
        };

        // Question labels + scene tag
        const questionLabels = {
            micro:    { label: 'Bút Màu xin Micro', tag: 'Cảnh 2 · Phòng 1' },
            location: { label: 'Bản Đồ xin Vị trí', tag: 'Cảnh 3 · Phòng 3' },
            photos:   { label: 'Bản Đồ xin xem Ảnh', tag: 'Cảnh 4' }
        };

        // Build recap cards
        const recapItems = [];
        for (const id of ['micro', 'location', 'photos']) {
            const a = ans[id];
            if (!a.correct) continue;
            const wasCorrectFirstTry = a.history.length === 1;
            const firstChoiceLabel = a.firstChoice ? (optionLabels[id][a.firstChoice] || '—') : '—';
            const correctChoiceLabel = optionLabels[id][interactionPoints.find(ip => ip.id === id).correct[0]];

            if (wasCorrectFirstTry) {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-correct">
                        <span class="choice-recap-icon">✅</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels[id].label}</div>
                            <div class="choice-recap-answer">Con đã chọn: ${firstChoiceLabel}</div>
                            <div class="choice-recap-note">Tuyệt vời, con làm đúng ngay lần đầu!</div>
                        </div>
                    </div>
                `);
            } else {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-corrected">
                        <span class="choice-recap-icon">🔁</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels[id].label}</div>
                            <div class="choice-recap-answer">Lúc đầu con chọn: ${firstChoiceLabel}</div>
                            <div class="choice-recap-note">Sau đó con đã sửa lại thành: ${correctChoiceLabel}. Biết sửa sai cũng là siêu năng lực!</div>
                        </div>
                    </div>
                `);
            }
        }

        // Keygame recap line
        const keygameScore = 5 - kg.mistakes;
        const keygameLabel = `Cho phép hay không? — Con đúng ${keygameScore}/5`;

        card.innerHTML = `
            <!-- D1: Title + badge + stars + XP -->
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.webp"
                 alt="CyberKnight" style="width:90px;margin-top:-4px;filter:drop-shadow(0 6px 16px rgba(0,102,255,0.18));animation:icon-bounce 2s ease-in-out infinite;">
            <div class="summary-icon-badge">🔑</div>
            <h2 class="summary-title">LEVEL 3 COMPLETED!</h2>
            <div style="font-size:22px;margin:-4px 0 2px;">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${CONFIG.BADGE_NAME}</span>
            </div>

            <hr style="width:100%;border:none;border-top:1.5px solid var(--ck-blue-200);margin:4px 0;">

            <!-- D2: BỐN CHÌA KHÓA AN TOÀN — 3 cards tinh gọn -->
            <div class="summary-section-title">🔑 BỐN CHÌA KHÓA AN TOÀN</div>
            <div class="ka-formula-row">
                <div class="ka-formula-card">
                    <div class="ka-formula-icon">📷</div>
                    <div class="ka-formula-label">CAMERA & MIC</div>
                    <div class="ka-formula-text">Chỉ bật khi thật cần thiết.</div>
                </div>
                <div class="ka-formula-card">
                    <div class="ka-formula-icon">📍</div>
                    <div class="ka-formula-label">VỊ TRÍ & ẢNH</div>
                    <div class="ka-formula-text">Giữ kín, không chia sẻ bừa.</div>
                </div>
                <div class="ka-formula-card">
                    <div class="ka-formula-icon">🚫</div>
                    <div class="ka-formula-label">TỪ CHỐI</div>
                    <div class="ka-formula-text">Khóa quyền lạ, hỏi người lớn.</div>
                </div>
            </div>

            <div class="keygame-recap-line" style="margin-top: 8px;">🎮 Đúng ${keygameScore}/5 thử thách quyền!</div>

            <!-- D3: Disclaimer -->
            <div class="ka-disclaimer" style="margin-top: 4px;">Trò chơi giả lập — không xin quyền thật của con.</div>

            <!-- D4: Actions -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', () => _replay());
        document.getElementById('btn-summary-continue')?.addEventListener('click', () => _continue());

        // Dispatch CustomEvent
        window.dispatchEvent(new CustomEvent('level3:complete', {
            detail: {
                answers: level3State.answers,
                keygame: level3State.keygame,
                stars: stats.stars,
                xp: stats.xp,
                badge: CONFIG.BADGE_NAME
            }
        }));
    }

    function _replay() {
        sound.init();
        sound.playTick();

        // Reset all state
        level3State.answers = {
            micro:    { firstChoice: null, attempts: 0, correct: false, history: [] },
            location: { firstChoice: null, attempts: 0, correct: false, history: [] },
            photos:   { firstChoice: null, attempts: 0, correct: false, history: [] }
        };
        level3State.keygame = { mistakes: 0, rounds: [] };
        level3State.currentScene = null;
        _currentInteraction = null;
        _interactionAnswered = false;
        _interactionResultShown = false;

        // Destroy and null key game engine
        if (level3State.keyGameEngine) {
            if (typeof level3State.keyGameEngine.destroy === 'function') {
                level3State.keyGameEngine.destroy();
            }
            level3State.keyGameEngine = null;
        }

        // Reset all videos (including currentTime)
        resetAllVideos();

        // Clear interaction overlay
        const overlay = document.getElementById('interaction-overlay');
        if (overlay) overlay.classList.add('hidden');

        // Reset freeze canvas
        if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';

        // Restore interaction card (in case it was showing result screen)
        _restoreInteractionCard();

        FreezeFrame.crossfade(() => {
            switchStage('scene1');
            _playScene('scene1');
        });
    }

    /**
     * Restore the interaction card HTML (in case result screen modified it).
     */
    function _restoreInteractionCard() {
        const card = document.getElementById('interaction-card');
        if (!card) return;
        // Check if it already has the standard structure
        if (card.querySelector('.interaction-header')) return;
        card.innerHTML = `
            <div class="interaction-header">
                <span class="interaction-badge" id="interaction-badge">THỜI KHẮC QUYẾT ĐỊNH</span>
                <h2 class="interaction-question" id="interaction-question"></h2>
            </div>
            <div id="interaction-options" class="interaction-options"></div>
            <div id="interaction-feedback" class="interaction-feedback hidden"></div>
            <button id="btn-interaction-continue" class="btn-interaction-continue hidden" type="button">
                Tiếp tục ▶
            </button>
        `;
    }

    function _continue() {
        sound.init();
        sound.playTick();
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'closeGameModal' }, '*');
                return;
            }
        } catch (err) { console.warn('postMessage error:', err); }
        window.location.href = '../index.html';
    }

    // =========================================================================
    // 10. STAGE SWITCHER (class-based, no inline styles)
    // =========================================================================

    const ALL_STAGES = [
        'scene1', 'scene2', 'scene3', 'scene4', 'scene5',
        'keygame', 'summary'
    ];

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

        // Reset interaction overlay when leaving interaction
        // (handled by _showInteraction / _gotoNextAfterQuestion)

        // Show/hide top bar on summary
        const topBar = document.getElementById('level3-top-bar');
        const skipBtn = document.getElementById('btn-skip-video');
        const isSummary = targetStage === 'summary';
        if (topBar) topBar.style.display = isSummary ? 'none' : '';
        if (skipBtn) skipBtn.classList.toggle('hidden', isSummary);

        // Particle canvas
        const pc = document.getElementById('particle-canvas');
        if (pc) pc.style.display = isSummary ? 'none' : '';
    }

    // =========================================================================
    // 11. DEBUG FLAGS
    // =========================================================================

    function handleDebugFlags() {
        const params = new URLSearchParams(window.location.search);
        const skip = params.get('skip');

        // ?skip=scene2|scene3|scene4|scene5 — jump to scene
        if (skip && CONFIG.VIDEO_SCENES.includes(skip)) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            _advanceToScene(skip);
            return true;
        }

        // ?skip=q1|q2|q3 — jump directly to question
        const qMap = { q1: 'micro', q2: 'location', q3: 'photos' };
        if (skip && qMap[skip]) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            const interaction = interactionPoints.find(ip => ip.id === qMap[skip]);
            if (interaction) {
                // First go to the afterScene (or keygame) then show question
                switchStage(interaction.afterScene);
                _showInteraction(interaction);
            }
            return true;
        }

        // ?skip=result-q1-A, result-q2-B, result-q2-C, result-q3-A
        const resultMatch = skip?.match(/^result-(q\d)-([A-Z])$/);
        if (resultMatch) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            const [, qKey, choice] = resultMatch;
            const idMap = { q1: 'micro', q2: 'location', q3: 'photos' };
            const interaction = interactionPoints.find(ip => ip.id === idMap[qKey]);
            if (interaction) {
                // Pre-set the answer to the wrong choice
                level3State.answers[interaction.id].firstChoice = choice;
                level3State.answers[interaction.id].attempts = 1;
                level3State.answers[interaction.id].history = [choice];
                level3State.answers[interaction.id].correct = false;
                switchStage(interaction.afterScene);
                _showInteraction(interaction);
                // Auto-click the wrong choice to trigger result screen
                setTimeout(() => {
                    const btn = document.querySelector(`[data-option-id="${choice}"]`);
                    if (btn) btn.click();
                }, 300);
            }
            return true;
        }

        // ?skip=keygame
        if (skip === 'keygame') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            _advanceToKeyGame();
            return true;
        }

        // ?skip=keygame — jump to game intro
        if (skip === 'keygame') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            _advanceToKeyGame();
            return true;
        }

        // ?skip=keygame-round1..5 — jump to specific round (after correct answers for prior rounds)
        const roundMatch = skip?.match(/^keygame-round(\d)$/);
        if (roundMatch) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            _advanceToKeyGame();
            return true;
        }

        // ?skip=summary-first — all 3 right first try
        if (skip === 'summary-first') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level3State.answers = {
                micro:    { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] },
                location: { firstChoice: 'A', attempts: 1, correct: true, history: ['A'] },
                photos:   { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] }
            };
            level3State.keygame = { mistakes: 0, rounds: [] };
            _showSummary();
            return true;
        }

        // ?skip=summary-retry — with corrections
        if (skip === 'summary-retry') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level3State.answers = {
                micro:    { firstChoice: 'A', attempts: 2, correct: true, history: ['A', 'B'] },
                location: { firstChoice: 'C', attempts: 2, correct: true, history: ['C', 'A'] },
                photos:   { firstChoice: 'A', attempts: 2, correct: true, history: ['A', 'B'] }
            };
            level3State.keygame = { mistakes: 1, rounds: [] };
            _showSummary();
            return true;
        }

        // ?skip=summary — default choices
        if (skip === 'summary') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level3State.answers = {
                micro:    { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] },
                location: { firstChoice: 'A', attempts: 1, correct: true, history: ['A'] },
                photos:   { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] }
            };
            level3State.keygame = { mistakes: 0, rounds: [] };
            _showSummary();
            return true;
        }

        return false;
    }

    function _resetAnswersForDebug() {
        level3State.answers = {
            micro:    { firstChoice: null, attempts: 0, correct: false, history: [] },
            location: { firstChoice: null, attempts: 0, correct: false, history: [] },
            photos:   { firstChoice: null, attempts: 0, correct: false, history: [] }
        };
        level3State.keygame = { mistakes: 0, rounds: [] };
    }

    // =========================================================================
    // 12. INIT
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();

        const isSkipped = handleDebugFlags();
        if (isSkipped) return;

        // Chuẩn bị sẵn cảnh 1 ngay khi mở trang (playlist + segment đầu bậc thấp nhất)
        // → bấm "Bắt đầu" là phát ngay, kể cả mạng yếu.
        try {
            const firstVideo = document.getElementById('video-scene1');
            if (firstVideo && window.CKVideo) {
                CKVideo.load(firstVideo, VideoSource.sourcesFor('scene1'), { preloadOnly: true }).catch(() => {});
                // Màn "Bắt đầu": tải sẵn 10s đầu của cảnh 1 ở bậc thấp nhất (~250 KB)
                CKVideo.warm(VideoSource.sourcesFor('scene1'), { level: 'lowest', seconds: 10 });
            }
        } catch (e) { if (_isDebugMode()) console.warn('[Level3] preload scene1:', e); }

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
