/**
 * CYBERKNIGHT — LEVEL 4: "BỨC ẢNH CÓ QUÁ NHIỀU BÍ MẬT"
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth & Mini-Game Engine.
 *
 * Inherits architecture from Level 3:
 * - Attempt-index base path probing (VideoSource.baseIdx)
 * - 1 video element per scene, preload only next scene
 * - Freeze-frame crossfade (canvas capture + opacity fade)
 * - AudioSynth (WebAudio, no audio files)
 * - Class-based stage switcher with z-index CSS scale
 * - THOÁT (ESC) button + postMessage fallback
 * - Video error panel (retry / skip scene)
 * - Debug flags in URL
 *
 * Differs from Level 3:
 * - SCENE_FLOW table (instead of parseInt + 1) for explicit transitions
 * - Q1 is hotspot-style (PhotoBoard) instead of A/B/C buttons
 * - Result screens never reveal the correct answer
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. CONFIG & STATE
    // =========================================================================

    const CONFIG = {
        VIDEO_BASES: [
            '../video/level4/',
            '../video/level 4/',
            'video/level4/',
            './'
        ],
        VIDEO_SCENES: ['scene1', 'scene2', 'reveal', 'scene3', 'scene4', 'scene5'],
        // Scenes whose video is optional — if file is missing on server, we
        // silently skip to the next stage instead of showing the error panel.
        // Used for transitional clips (e.g. 'reveal' between Q1 and scene3)
        // when the asset hasn't been produced yet.
        OPTIONAL_VIDEO_SCENES: ['reveal'],
        XP_REWARD: 30,
        BADGE_NAME: 'THÁM TỬ ẢNH AN TOÀN',
        LOADING_TIMEOUT_MS: 8000
    };

    /**
     * Explicit scene flow table.
     * Per spec §4.2 — we use this instead of parseInt + 1 because scene5
     * leads to 'summary' (not 'mission') and 'reveal' is a clip between
     * scene2 → scene3.
     */
    const SCENE_FLOW = {
        scene1: { next: 'scene2' },
        scene2: { question: 'find' },       // → photofind stage
        reveal: { next: 'scene3' },
        scene3: { question: 'fix' },         // → overlay
        scene4: { question: 'share' },      // → overlay
        scene5: { next: 'summary' }
    };

    // VideoSource: attempt-index based base discovery (never derive from URL)
    const VideoSource = {
        baseIdx: null,
        urlFor(scene, idx) {
            return encodeURI(CONFIG.VIDEO_BASES[idx] + scene + '.mp4');
        }
    };

    /**
     * Runtime state. Per spec §8.5.
     */
    const level4State = {
        currentScene: null,
        photofind: {
            wrongTaps: 0,
            hintsUsed: 0,
            blankTaps: 0,
            found: [],
            completed: false
        },
        answers: {
            fix:   { firstChoice: null, attempts: 0, correct: false, history: [] },
            share: { firstChoice: null, attempts: 0, correct: false, history: [] }
        }
    };

    // =========================================================================
    // 2. INTERACTION POINTS (Q2 fix & Q3 share)
    // =========================================================================

    /**
     * Q2 — "Xử lý bức ảnh" — after scene3.
     * Q3 — "Quyết định chia sẻ" — after scene4.
     *
     * IMPORTANT: Options are presented EQUAL (same size, same color).
     * NEVER pre-tint correct/wrong. When wrong, only the chosen option gets
     * a soft orange tint — the correct answer is NEVER revealed.
     */
    const interactionPoints = {
        fix: {
            id: 'fix',
            afterScene: 'scene3',
            nextScene: 'scene4',
            question: 'CyberKnight có ba công cụ để sửa ảnh trước khi đăng. Con chọn cách nào?',
            options: [
                { id: 'A', label: 'Giữ nguyên ảnh và đăng ngay.', icon: '🖼️' },
                { id: 'B', label: 'Cắt hoặc che các thông tin riêng tư trước.', icon: '✂️🖍️' },
                { id: 'C', label: 'Chỉ che mặt mình, giữ nguyên mọi thứ phía sau.', icon: '🙈' }
            ],
            correct: ['B'],
            correctFeedback: {
                icon: '✂️✔',
                text: 'Đúng rồi! Cắt hoặc che tên trường, thẻ tên, địa chỉ và số điện thoại thì ảnh vẫn đẹp mà an toàn hơn nhiều.',
                miniEffect: 'cover'
            },
            results: {
                A: {
                    icon: '🖼️',
                    tone: 'warn',
                    title: 'Khoan đã, ảnh còn nguyên bí mật!',
                    body: 'Nếu đăng ngay, người lạ có thể đọc được tên trường, tên lớp, địa chỉ và số điện thoại trong ảnh.',
                    bip: 'Trước khi bấm Đăng, hãy nhìn thật kỹ cả phía sau và xung quanh nhé!',
                    tip: 'Ảnh có thể để lộ nhiều hơn mình nghĩ.'
                },
                C: {
                    icon: '🙈',
                    tone: 'soft',
                    title: 'Che mặt rồi, nhưng bí mật vẫn còn đó!',
                    body: 'Che mặt là cẩn thận đấy, nhưng tên trường, thẻ tên, địa chỉ và số điện thoại phía sau vẫn nhìn thấy được.',
                    bip: 'Che cả những thứ có chữ và số, không chỉ che mặt nhé!',
                    tip: 'Che hoặc cắt mọi thứ có chữ và số riêng tư.'
                }
            }
        },
        share: {
            id: 'share',
            afterScene: 'scene4',
            nextScene: 'scene5',
            question: 'Ảnh đã được che xong. Trước khi chia sẻ, con sẽ làm gì?',
            options: [
                { id: 'A', label: 'Đăng công khai ngay.', icon: '🌐' },
                { id: 'B', label: 'Hỏi bố mẹ và kiểm tra ảnh thêm một lần nữa.', icon: '👨‍👩‍👧' },
                { id: 'C', label: 'Gửi ảnh cho người lạ đang xin xem.', icon: '👤' }
            ],
            correct: ['B'],
            correctFeedback: {
                icon: '👨‍👩‍👧✔',
                text: 'Tuyệt! Hỏi bố mẹ và nhìn lại ảnh một lần nữa giúp con không bỏ sót bí mật nào.'
            },
            results: {
                A: {
                    icon: '🌐',
                    tone: 'warn',
                    title: 'Đăng công khai là ai cũng xem được!',
                    body: 'Ảnh đăng công khai có thể bị nhiều người xem, lưu lại và chia sẻ tiếp. Dù đã che bí mật, con vẫn nên cho bố mẹ xem trước.',
                    bip: 'Chia sẻ công khai? Hỏi bố mẹ trước nhé!',
                    tip: 'Chia sẻ công khai = hỏi bố mẹ trước.'
                },
                C: {
                    icon: '👤',
                    tone: 'warn',
                    title: 'Người lạ xin ảnh thì rất đáng nghi!',
                    body: 'Con không biết người đó là ai và họ muốn dùng ảnh để làm gì. Đừng gửi ảnh cho người lạ.',
                    bip: 'Người lạ xin xem ảnh? Dừng lại và báo ngay cho bố mẹ nhé!',
                    tip: 'Người lạ xin ảnh → không gửi, báo người lớn.'
                }
            }
        }
    };

    // =========================================================================
    // 3. AUDIO SYNTH (inherited pattern, with 4 new methods per spec §10)
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

        // NEW for Level 4 — per spec §10
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

        coverStick() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(260, now);
            osc.frequency.exponentialRampToValueAtTime(180, now + 0.1);
            gain.gain.setValueAtTime(0.16, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.12);
        }

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
            const scene = level4State.currentScene;
            if (!scene) return;
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
            const videoStages = CONFIG.VIDEO_SCENES.map(s => s); // scene1..5, reveal
            const showSkip = videoStages.includes(stage);
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

    function _showVideoErrorPanel(stageId, sceneNum, triedAbsoluteUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

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
            VideoSource.baseIdx = null;
            _playScene(stageId, { forceReload: true });
        });

        panel.querySelector('.video-error-skip')?.addEventListener('click', () => {
            panel.remove();
            _handleSkipScene(stageId);
        });
    }

    function _isDebugMode() {
        return new URLSearchParams(window.location.search).has('debug');
    }

    /**
     * Handle "Bỏ qua cảnh" — route based on SCENE_FLOW.
     */
    function _handleSkipScene(stageId) {
        const flow = SCENE_FLOW[stageId];
        if (!flow) {
            // No flow defined → advance to next scene or summary
            const idx = CONFIG.VIDEO_SCENES.indexOf(stageId);
            if (idx >= 0 && idx < CONFIG.VIDEO_SCENES.length - 1) {
                _advanceToScene(CONFIG.VIDEO_SCENES[idx + 1]);
            } else if (stageId === 'scene5') {
                _showSummary();
            }
            return;
        }
        if (flow.next) {
            _advanceToScene(flow.next);
        } else if (flow.question) {
            if (flow.question === 'find') _showPhotofind();
            else _showInteraction(interactionPoints[flow.question]);
        }
    }

    /**
     * Main scene playback using VideoSource attempt index.
     * @param {string} sceneName - e.g. 'scene1', 'reveal'
     */
    function _playScene(sceneName, options = {}) {
        const { onEnded, forceReload } = options;
        level4State.currentScene = sceneName;

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (!videoEl) {
            if (_isDebugMode()) console.error(`[Level4] Video element #video-${sceneName} not found`);
            if (onEnded) onEnded();
            return;
        }

        // ---- Preload NEXT scene in flow (only one at a time to save decoders) ----
        const flow = SCENE_FLOW[sceneName];
        const nextSceneName = flow && flow.next ? flow.next : null;

        // Keep all video elements' preload state intact (set in HTML as
        // preload="auto"). Touching preload here forces the browser to
        // re-evaluate the network request on every scene transition, which
        // can re-buffer the audio track and cause visible "lost audio"
        // gaps at scene boundaries. We only ensure the next scene's src
        // is wired so it can begin preloading in parallel.
        if (nextSceneName && VideoSource.baseIdx !== null) {
            const nextVideo = document.getElementById(`video-${nextSceneName}`);
            if (nextVideo) {
                const expectedUrl = VideoSource.urlFor(nextSceneName, VideoSource.baseIdx);
                const currentDecoded = decodeURI(videoEl.getAttribute('src') || '');
                const expectedDecoded = decodeURI(expectedUrl);
                if (currentDecoded !== expectedDecoded) {
                    nextVideo.src = expectedUrl;
                }
            }
        }

        // ---- Loading state helpers ----
        let loadingShown = false;
        let loadingTimer = null;
        let slowLoadingTimer = null;

        function showLoading() {
            if (loadingShown) return;
            loadingShown = true;
            const container = videoEl.closest('.video-container');
            if (!container) return;
            const spinner = container.querySelector('.video-loading-spinner');
            if (spinner) spinner.classList.remove('hidden');
        }

        function hideLoading() {
            const container = videoEl.closest('.video-container');
            if (container) {
                const spinner = container.querySelector('.video-loading-spinner');
                if (spinner) spinner.classList.add('hidden');
                const slow = container.querySelector('.video-loading-slow');
                if (slow) slow.classList.add('hidden');
            }
            clearTimeout(loadingTimer);
            clearTimeout(slowLoadingTimer);
        }

        showLoading();
        loadingTimer = setTimeout(() => {
            const container = videoEl.closest('.video-container');
            if (container) {
                const slow = container.querySelector('.video-loading-slow');
                if (slow) slow.classList.remove('hidden');
            }
        }, CONFIG.LOADING_TIMEOUT_MS);

        const isFirstLoad = VideoSource.baseIdx === null;

        if (!isFirstLoad) {
            const idx = VideoSource.baseIdx;
            const url = VideoSource.urlFor(sceneName, idx);
            const currentSrc = videoEl.getAttribute('src') || videoEl.src;
            if (currentSrc !== url && !forceReload) {
                videoEl.removeAttribute('src');
                videoEl.load();
            }
            if (videoEl.getAttribute('src') !== url || forceReload) {
                // KHÔNG set muted — level 4 video có tiếng.
                videoEl.src = url;
            }
            videoEl.preload = 'auto';

            if (_isDebugMode()) {
                const abs = new URL(url, location.href).href;
                console.log(`[Level4] Scene ${sceneName} → ${abs}`);
            }

            let errorHandled = false;
            function onError() {
                if (errorHandled) return;
                errorHandled = true;
                hideLoading();
                cleanupListeners();
                VideoSource.baseIdx = null;
                const tried = CONFIG.VIDEO_BASES.map((_, i) => new URL(VideoSource.urlFor(sceneName, i), location.href).href);
                if (_isDebugMode()) console.error('[Level4] All bases failed for', sceneName, tried);
                // Same optional-skip behaviour as the first-load probe path.
                if (CONFIG.OPTIONAL_VIDEO_SCENES && CONFIG.OPTIONAL_VIDEO_SCENES.includes(sceneName)) {
                    if (_isDebugMode()) {
                        console.warn(`[Level4] Optional scene '${sceneName}' has no video — auto-skipping.`);
                    }
                    _handleSkipScene(sceneName);
                    return;
                }
                const sceneNum = sceneName.startsWith('reveal') ? 'reveal'
                    : sceneName.replace('scene', '');
                _showVideoErrorPanel(sceneName, sceneNum, CONFIG.VIDEO_BASES.map((b, i) => VideoSource.urlFor(sceneName, i)));
            }

            function onCanPlay() {
                VideoSource.baseIdx = idx;
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

            // Only reset currentTime if it's not already at 0. Setting
            // currentTime=0 on a freshly loaded, paused video can confuse
            // some Chromium builds into swallowing the subsequent play().
            if (videoEl.currentTime !== 0) {
                videoEl.currentTime = 0;
            }
            const startPlayback = () => {
                const playPromise = videoEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        if (err.name === 'NotAllowedError') {
                            // Autoplay bị chặn vì video có tiếng (không mute).
                            // Hiển thị play overlay để user bấm — KHÔNG mute video,
                            // vì level 4 cần phát audio.
                            hideLoading();
                            _showPlayButtonOverlay(videoEl, sceneName);
                        } else if (err.name === 'NotSupportedError' || err.name === 'AbortError') {
                            onError();
                        }
                    });
                }
            };
            // Always re-check after a microtask so the currentTime=0 reset
            // has settled before we attempt to play.
            Promise.resolve().then(() => {
                if (videoEl.readyState >= 3 && videoEl.paused) {
                    startPlayback();
                } else {
                    videoEl.addEventListener('canplay', function once() {
                        videoEl.removeEventListener('canplay', once);
                        startPlayback();
                    });
                }
            });

            switchStage(sceneName);
            TopBar.updateVisibility(sceneName);
            return;
        }

        // ---- First load: probe bases sequentially ----
        const triedAbsoluteUrls = CONFIG.VIDEO_BASES.map((_, i) => new URL(VideoSource.urlFor(sceneName, i), location.href).href);

        let probeIdx = 0;
        let errorHandled = false;

        function tryProbe(idx) {
            if (idx >= CONFIG.VIDEO_BASES.length) {
                if (errorHandled) return;
                errorHandled = true;
                hideLoading();
                cleanupProbeListeners();
                if (_isDebugMode()) {
                    console.error('[Level4] All bases failed for', sceneName, triedAbsoluteUrls);
                }
                // If this scene is marked as optional (transitional clip whose
                // asset may not exist yet), skip silently to the next stage
                // instead of blocking the user with an error panel.
                if (CONFIG.OPTIONAL_VIDEO_SCENES && CONFIG.OPTIONAL_VIDEO_SCENES.includes(sceneName)) {
                    if (_isDebugMode()) {
                        console.warn(`[Level4] Optional scene '${sceneName}' has no video — auto-skipping.`);
                    }
                    _handleSkipScene(sceneName);
                    return;
                }
                const sceneNum = sceneName.startsWith('reveal') ? 'reveal'
                    : sceneName.replace('scene', '');
                _showVideoErrorPanel(sceneName, sceneNum, triedAbsoluteUrls);
                return;
            }

            const url = VideoSource.urlFor(sceneName, idx);
            if (_isDebugMode()) {
                console.log(`[Level4] Probing ${sceneName} @ base[${idx}] → ${new URL(url, location.href).href}`);
            }

            videoEl.removeAttribute('src');
            videoEl.load();
            // NOTE: KHÔNG ép muted — level 4 video có tiếng (giọng kể/dẫn dắt).
            // Nếu browser chặn autoplay có âm thanh, onProbeCanPlay hoặc
            // Promise.catch bên dưới sẽ hiển thị play overlay để user bấm.
            videoEl.src = url;
            videoEl.preload = 'auto';
            // Kick off playback immediately, in the same call stack as the
            // caller's user gesture. Muted videos normally succeed here
            // because the element already has a src; if the call rejects
            // (e.g. NotSupportedError when data hasn't arrived yet), the
            // onProbeCanPlay handler below will retry once a frame is
            // available. This two-pronged approach survives Electron 42's
            // stricter autoplay gating.
            if (idx === 0) {
                const p = videoEl.play();
                if (p) {
                    p.then(() => {
                        if (_isDebugMode()) console.log(`[Level4] tryProbe[0] play OK scene=${sceneName}`);
                    }).catch((err) => {
                        if (_isDebugMode()) console.log(`[Level4] tryProbe[0] play FAIL scene=${sceneName} err=${err.name}`);
                        // Swallow — onProbeCanPlay will retry once data is ready.
                    });
                }
            }
        }

        function onProbeCanPlay() {
            if (VideoSource.baseIdx !== null) return;
            VideoSource.baseIdx = probeIdx;
            hideLoading();
            cleanupProbeListeners();
            if (_isDebugMode()) {
                console.log(`[Level4] baseIdx confirmed = ${probeIdx}`);
            }
            // Muted videos always autoplay, so we only need the play button
            // as a last-resort fallback. Even muted play() can fail in
            // Electron 42 when the user-gesture token has already expired
            // (the canplay event fires async, well after the originating
            // click handler returned). In that case, arm a one-shot click
            // listener on the document: the very next user click anywhere
            // (skip button, Q-option, zone tap, …) will resume playback.
            if (videoEl.paused && videoEl.currentTime === 0) {
                // KHÔNG set muted — video level 4 có tiếng.
                // Nếu autoplay bị chặn (do có âm thanh), retry sẽ catch và arm click fallback.
                const retry = videoEl.play();
                if (retry) {
                    retry.then(() => {
                        if (_isDebugMode()) console.log(`[Level4] onProbeCanPlay play OK scene=${sceneName} ct=${videoEl.currentTime}`);
                    }).catch((err) => {
                        if (_isDebugMode()) console.log(`[Level4] onProbeCanPlay play FAIL scene=${sceneName} err=${err.name} — arming click fallback`);
                        const armClick = () => {
                            document.removeEventListener('click', armClick, true);
                            document.removeEventListener('pointerdown', armClick, true);
                            // KHÔNG set muted — bấm là để đáp ứng gesture, video sẽ phát có tiếng
                            videoEl.play().catch(() => {
                                _showPlayButtonOverlay(videoEl, level4State.currentScene);
                            });
                        };
                        document.addEventListener('click', armClick, true);
                        document.addEventListener('pointerdown', armClick, true);
                    });
                }
            }
        }

        function onProbeError() {
            if (VideoSource.baseIdx !== null) return;
            if (errorHandled) return;
            probeIdx++;
            tryProbe(probeIdx);
        }

        function cleanupProbeListeners() {
            videoEl.removeEventListener('canplay', onProbeCanPlay);
            videoEl.removeEventListener('error', onProbeError);
            if (silentFailTimer) { clearTimeout(silentFailTimer); silentFailTimer = null; }
        }

        videoEl.addEventListener('canplay', onProbeCanPlay, { once: true });
        videoEl.addEventListener('error', onProbeError);

        // Safety net for silent failure: when the server returns 200 with an
        // HTML body (e.g. custom 404 page), the video element may reach
        // readyState=4 without firing 'error' or 'canplay'. Detect that by
        // checking if readyState=4 but the decoded data is not real video
        // (videoWidth/videoHeight stay 0). Using a self-rescheduling
        // setTimeout (instead of setInterval) so the timer stops firing
        // once a working base is found, eliminating per-1.5s overhead
        // throughout the rest of playback.
        let silentFailTimer = null;
        function scheduleSilentFailCheck() {
            if (silentFailTimer) clearTimeout(silentFailTimer);
            silentFailTimer = setTimeout(() => {
                if (errorHandled || VideoSource.baseIdx !== null) {
                    silentFailTimer = null;
                    return;
                }
                if (videoEl.readyState >= 1 && videoEl.videoWidth === 0 && videoEl.videoHeight === 0) {
                    silentFailTimer = null;
                    if (probeIdx < CONFIG.VIDEO_BASES.length - 1) {
                        probeIdx++;
                        tryProbe(probeIdx);
                        scheduleSilentFailCheck();
                    } else {
                        tryProbe(CONFIG.VIDEO_BASES.length);
                    }
                } else {
                    // Data looks valid; no need to retry. Let timer stay null.
                    silentFailTimer = null;
                }
            }, 1500);
        }
        scheduleSilentFailCheck();

        let endedTriggered = false;
        function triggerEnd() {
            if (endedTriggered) return;
            endedTriggered = true;
            cleanupProbeListeners();
            hideLoading();
            _triggerSceneEnd(sceneName, onEnded);
        }
        videoEl.onended = triggerEnd;
        videoEl.ontimeupdate = () => {
            if (videoEl.duration && !endedTriggered) {
                if (videoEl.duration - videoEl.currentTime <= 0.15) triggerEnd();
            }
        };

        videoEl.currentTime = 0;
        tryProbe(0);

        switchStage(sceneName);
        TopBar.updateVisibility(sceneName);

        // NOTE: We do NOT call play() here. The first-load probe path uses
        // onProbeCanPlay to start playback once a working base is found,
        // and trying to play() before video data is available causes
        // NotSupportedError in Electron 42 / Chromium. The
        // onProbeCanPlay handler is the single source of truth for
        // autoplaying after the probe succeeds.
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
     */
    function _triggerSceneEnd(sceneName, onEnded) {
        const videoEl = document.getElementById(`video-${sceneName}`);
        if (videoEl) {
            videoEl.pause();
            videoEl.onended = null;
            videoEl.ontimeupdate = null;
            // Defer freeze-frame capture to next animation frame so the
            // synchronous drawImage() call doesn't block scene transitions
            // and cause main-thread jank (visible stutter on low-end hw).
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

    /**
     * After a scene ends, route according to SCENE_FLOW.
     */
    function _advanceAfterSceneEnd(sceneName) {
        const flow = SCENE_FLOW[sceneName];
        if (!flow) {
            // No flow defined → fall back to next scene in VIDEO_SCENES order
            const idx = CONFIG.VIDEO_SCENES.indexOf(sceneName);
            if (idx >= 0 && idx < CONFIG.VIDEO_SCENES.length - 1) {
                _advanceToScene(CONFIG.VIDEO_SCENES[idx + 1]);
            } else if (sceneName === 'scene5') {
                _showSummary();
            }
            return;
        }
        if (flow.next) {
            _advanceToScene(flow.next);
        } else if (flow.question) {
            if (flow.question === 'find') _showPhotofind();
            else _showInteraction(interactionPoints[flow.question]);
        }
    }

    function _advanceToScene(sceneName) {
        sound.init();
        // 'summary' không phải video scene — gọi _showSummary() trực tiếp
        // để chuyển sang màn hình tổng kết khi scene5 kết thúc.
        if (sceneName === 'summary') {
            _showSummary();
            return;
        }
        _playScene(sceneName);
    }

    // =========================================================================
    // 7. Q1 — PHOTOFIND (hotspot interaction)
    // =========================================================================

    let _photofindBoard = null;

    function _showPhotofind() {
        sound.init();
        // Hide skip button during interactive stages
        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        FreezeFrame.crossfade(() => {
            switchStage('photofind');
            TopBar.updateVisibility('photofind');

            const container = document.getElementById('photofind-container');
            if (!container) return;

            // Reset state if first time
            if (!level4State.photofind.completed) {
                level4State.photofind = {
                    wrongTaps: 0,
                    hintsUsed: 0,
                    blankTaps: 0,
                    found: [],
                    completed: false
                };
            }

            container.innerHTML = `
                <div class="ph-mission-badge">🔍 TÌM THÔNG TIN BỊ LỘ</div>
                <h2 class="ph-mission-title">Tìm thông tin bị lộ trong ảnh</h2>
                <div class="ph-hud">
                    <div class="ph-hud-progress" id="ph-find-progress">
                        Đã tìm
                        <span class="ph-progress-dots">
                            <span class="ph-progress-dot" data-dot="0"></span>
                            <span class="ph-progress-dot" data-dot="1"></span>
                            <span class="ph-progress-dot" data-dot="2"></span>
                        </span>
                        <span id="ph-find-text">0/3</span>
                    </div>
                    <button class="ph-hud-btn" id="ph-find-hint-btn" type="button">💡 Gợi ý</button>
                </div>
                <div class="ph-bip" id="ph-find-bip">
                    <span class="ph-bip-icon">🤖</span>
                    <span>Chạm vào những thứ trong ảnh có thể cho người lạ biết thông tin riêng tư của con nhé!</span>
                </div>
                <div id="ph-find-board-host" style="width:100%;display:flex;justify-content:center;"></div>
            `;

            const hintBtn = document.getElementById('ph-find-hint-btn');
            if (hintBtn) {
                hintBtn.addEventListener('click', () => _onPhotofindManualHint());
            }

            const host = document.getElementById('ph-find-board-host');
            if (!host || typeof window.PhotoBoard !== 'function') return;

            _photofindBoard = new window.PhotoBoard(host, {
                scene: 'main',
                mode: 'find',
                onCorrect: (zone) => {
                    level4State.photofind.found.push(zone.id);
                    sound.playCorrectCatch();
                    _updatePhotofindProgress();
                    _showPhotofindBip(`Tốt lắm! Con đã tìm thấy một thông tin riêng tư nè ✨`);
                    _resetPhotofindIdle();
                },
                onDecoy: (zone) => {
                    level4State.photofind.wrongTaps++;
                    sound.magnify ? sound.magnify() : sound.playSoftBip();
                    _showPhotofindBip(
                        zone.id === 'trophy'
                            ? 'Chiếc cúp đẹp lắm, nhưng nó không cho ai biết thông tin riêng tư của con. Hãy tìm thứ có chữ hoặc số nhé!'
                            : 'Hmm, vùng này không có thông tin riêng tư. Tìm chỗ khác nhé!'
                    );
                    if (level4State.photofind.wrongTaps >= 2) {
                        _autoPhotofindHint();
                    }
                    _resetPhotofindIdle();
                },
                onBlankTap: () => {
                    level4State.photofind.blankTaps++;
                    if (level4State.photofind.blankTaps >= 5) {
                        _autoPhotofindHint();
                    }
                    _resetPhotofindIdle();
                },
                onAllFound: () => {
                    if (_photofindHintTimer) clearTimeout(_photofindHintTimer);
                    _onPhotofindComplete();
                }
            });

            // Play photoSnap when image appears
            sound.photoSnap();
            _updatePhotofindProgress();
            _resetPhotofindIdle();
        });
    }

    function _updatePhotofindProgress() {
        const dots = document.querySelectorAll('#ph-find-progress .ph-progress-dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('ph-progress-dot-active', i < level4State.photofind.found.length);
        });
        const txt = document.getElementById('ph-find-text');
        if (txt) txt.textContent = `${level4State.photofind.found.length}/3`;
    }

    function _showPhotofindBip(text) {
        const el = document.getElementById('ph-find-bip');
        if (!el) return;
        el.innerHTML = `<span class="ph-bip-icon">🤖</span><span>${text}</span>`;
    }

    let _photofindHintTimer = null;
    function _resetPhotofindIdle() {
        if (_photofindHintTimer) clearTimeout(_photofindHintTimer);
        _photofindHintTimer = setTimeout(() => _autoPhotofindHint(), 12000);
    }

    function _onPhotofindManualHint() {
        level4State.photofind.hintsUsed++;
        if (_photofindBoard) {
            _photofindBoard.showHint(Math.min(2, level4State.photofind.hintsUsed));
        }
        // Tell Bíp to say something specific about the next zone
        const remaining = (window.PhotoScenes ? window.PhotoScenes.getZones('main') : [])
            .filter(z => z.kind === 'private' && !level4State.photofind.found.includes(z.id));
        if (remaining.length > 0) {
            const next = remaining[0];
            const nameMap = { bag: 'cái balo', badge: 'thẻ tên', box: 'hộp hàng' };
            const level = Math.min(2, level4State.photofind.hintsUsed);
            const msgs = {
                1: `Hãy tìm những thứ có chữ hoặc số nhé!`,
                2: `Thử chạm vào ${nameMap[next.id] || 'vùng được viền vàng'} nào!`
            };
            _showPhotofindBip(msgs[level] || msgs[2]);
        }
        sound.playSoftBip();
    }

    function _autoPhotofindHint() {
        if (!_photofindBoard) return;
        if (level4State.photofind.completed) return;
        level4State.photofind.hintsUsed++;
        _photofindBoard.showHint(1);
        _showPhotofindBip('Hãy tìm những thứ có chữ hoặc số nhé!');
        sound.playSoftBip();
    }

    function _onPhotofindComplete() {
        level4State.photofind.completed = true;
        if (_photofindHintTimer) clearTimeout(_photofindHintTimer);
        sound.playVictoryChime();

        // Add success card + continue button
        const host = document.getElementById('ph-find-board-host');
        const continueWrap = document.createElement('div');
        continueWrap.className = 'ph-continue-row';
        continueWrap.innerHTML = `
            <div class="ph-continue-card">
                <span class="ph-continue-icon">🎉</span>
                <span>Đúng rồi! Bức ảnh khoe chiếc cúp nhưng lại để lộ tên trường, tên lớp, địa chỉ và số điện thoại.</span>
            </div>
            <button class="btn-photofind-continue" id="ph-find-continue-btn" type="button">
                Tiếp tục ▶
            </button>
        `;
        if (host && host.parentElement) {
            host.parentElement.appendChild(continueWrap);
        }

        const btn = document.getElementById('ph-find-continue-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                _advanceToScene('reveal');
            });
        }

        // Hide skip button (we're showing an interactive prompt)
        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');
    }

    // =========================================================================
    // 8. INTERACTION OVERLAY (Q2 fix & Q3 share)
    // =========================================================================

    let _currentInteraction = null;
    let _interactionAnswered = false;
    let _interactionResultShown = false;

    function _showInteraction(interaction) {
        _currentInteraction = interaction;
        _interactionAnswered = false;
        _interactionResultShown = false;

        if (TopBar.skipBtn) TopBar.skipBtn.classList.add('hidden');

        const overlay = document.getElementById('interaction-overlay');
        const badge = document.getElementById('interaction-badge');
        const question = document.getElementById('interaction-question');
        const optionsEl = document.getElementById('interaction-options');
        const feedbackEl = document.getElementById('interaction-feedback');
        const miniEffectEl = document.getElementById('interaction-mini-effect');
        const continueBtn = document.getElementById('btn-interaction-continue');

        if (!overlay) return;

        if (badge) badge.textContent = '🛡️ THỜI KHẮC QUYẾT ĐỊNH';

        if (question) question.textContent = interaction.question;

        if (feedbackEl) {
            feedbackEl.classList.add('hidden');
            feedbackEl.className = 'interaction-feedback hidden';
            feedbackEl.textContent = '';
        }
        if (miniEffectEl) {
            miniEffectEl.classList.add('hidden');
            miniEffectEl.innerHTML = '';
        }
        if (continueBtn) {
            continueBtn.classList.add('hidden');
            continueBtn.textContent = 'Tiếp tục ▶';
            continueBtn.onclick = null;
        }

        if (optionsEl) {
            optionsEl.innerHTML = interaction.options.map(opt => `
                <button class="interaction-option-btn"
                        data-option-id="${opt.id}"
                        type="button"
                        aria-label="${opt.icon ? opt.icon + ' ' : ''}${opt.label}">
                    <span aria-hidden="true">${opt.icon ? opt.icon + ' ' : ''}</span>${opt.label}
                </button>
            `).join('');

            optionsEl.querySelectorAll('.interaction-option-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (_interactionAnswered || _interactionResultShown) return;
                    _handleInteractionChoice(btn, btn.dataset.optionId);
                });
            });
        }

        overlay.classList.remove('hidden');
    }

    function _handleInteractionChoice(btnEl, chosenId) {
        if (_interactionAnswered || _interactionResultShown || !_currentInteraction) return;
        _interactionAnswered = true;

        const interaction = _currentInteraction;
        const isCorrect = interaction.correct.includes(chosenId);

        const ans = level4State.answers[interaction.id];
        ans.attempts++;
        ans.history.push(chosenId);
        if (ans.firstChoice === null) ans.firstChoice = chosenId;
        if (isCorrect) ans.correct = true;

        sound.init();
        if (isCorrect) {
            sound.playCorrectCatch();
        } else {
            sound.playIncorrectCatch();
        }

        // Per spec §1.2: When WRONG, only the chosen option gets a soft tint.
        // The correct answer is NEVER revealed to the child.
        document.querySelectorAll('.interaction-option-btn').forEach(btn => {
            btn.disabled = true;
            const optId = btn.dataset.optionId;
            if (optId === chosenId) {
                // Mark the chosen option. Correct gets green, wrong gets soft orange.
                if (isCorrect) {
                    btn.classList.add('selected-correct');
                } else {
                    btn.classList.add('selected-wrong');
                }
            }
        });

        if (isCorrect) {
            const feedbackEl = document.getElementById('interaction-feedback');
            if (feedbackEl) {
                feedbackEl.innerHTML = `
                    <div class="feedback-icon">${interaction.correctFeedback.icon}</div>
                    <div class="feedback-text">${interaction.correctFeedback.text}</div>
                `;
                feedbackEl.classList.remove('hidden');
                feedbackEl.className = 'interaction-feedback feedback-correct';
            }

            // For Q2 fix, show a mini cover animation BEFORE the continue button
            if (interaction.id === 'fix' && interaction.correctFeedback.miniEffect === 'cover') {
                _showMiniCoverEffect(() => {
                    const continueBtn = document.getElementById('btn-interaction-continue');
                    if (continueBtn) {
                        continueBtn.classList.remove('hidden');
                        continueBtn.onclick = () => _gotoNextAfterQuestion(interaction);
                    }
                });
            } else {
                const continueBtn = document.getElementById('btn-interaction-continue');
                if (continueBtn) {
                    continueBtn.classList.remove('hidden');
                    continueBtn.onclick = () => _gotoNextAfterQuestion(interaction);
                }
            }
        } else {
            _interactionResultShown = true;
            _showResultScreen(interaction, chosenId);
        }
    }

    /**
     * Show a small 4:3 photo card with 3 sticker-covers popping in.
     * Used after Q2 fix is answered correctly.
     */
    function _showMiniCoverEffect(onDone) {
        const el = document.getElementById('interaction-mini-effect');
        if (!el) {
            if (onDone) onDone();
            return;
        }
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        el.innerHTML = `
            <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                <rect width="400" height="300" fill="#E8F4FD"/>
                <!-- Mini CyberKnight -->
                <circle cx="200" cy="105" r="20" fill="#FFD7A8" stroke="#003D99" stroke-width="2"/>
                <path d="M 180 105 Q 200 70 220 105 L 220 95 Q 200 80 180 95 Z" fill="#0066FF" stroke="#003D99" stroke-width="2"/>
                <rect x="186" y="135" width="30" height="50" rx="6" fill="#0066FF"/>
                <!-- Mini bag on left -->
                <rect x="40" y="125" width="60" height="100" rx="8" fill="#0066FF" stroke="#003D99" stroke-width="1.5"/>
                <rect x="46" y="170" width="48" height="40" rx="4" fill="#3B8EFF"/>
                <rect x="50" y="135" width="40" height="10" rx="2" fill="#FFF"/>
                <!-- Mini name badge -->
                <rect x="180" y="138" width="28" height="12" rx="2" fill="#FFF" stroke="#003D99" stroke-width="1"/>
                <!-- Mini box on right -->
                <rect x="290" y="155" width="80" height="65" rx="4" fill="#D9A06E" stroke="#8B6A4A" stroke-width="1.5"/>
                <rect x="300" y="170" width="60" height="18" rx="2" fill="#FFF"/>
                <!-- Trophy -->
                <path d="M 175 200 Q 175 225 195 225 Q 215 225 215 200 Z" fill="#FFE066" stroke="#A07000" stroke-width="1.5"/>
                <rect x="180" y="240" width="30" height="6" rx="2" fill="#A0826D"/>
            </svg>
            <span class="mini-cover-label mini-cover-label-1">CHE TÊN TRƯỜNG</span>
            <span class="mini-cover-label mini-cover-label-2">CHE THẺ TÊN</span>
            <span class="mini-cover-label mini-cover-label-3">CHE SỐ ĐIỆN THOẠI</span>
        `;
        el.classList.remove('hidden');

        if (reduced) {
            // Skip animation, show all labels immediately
            el.querySelectorAll('.mini-cover-label').forEach(l => l.style.opacity = '1');
            setTimeout(() => onDone && onDone(), 300);
        } else {
            setTimeout(() => onDone && onDone(), 1700);
        }
    }

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

        // IMPORTANT: do NOT pre-color the correct answer (per spec §1.2).
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

    function _retryQuestion(interaction) {
        sound.init();
        sound.playTick();
        _currentInteraction = interaction;
        _interactionAnswered = false;
        _interactionResultShown = false;
        // Do NOT reset firstChoice — needed for summary to detect "was wrong, corrected"

        const card = document.getElementById('interaction-card');
        if (!card) return;

        card.innerHTML = `
            <div class="interaction-header">
                <span class="interaction-badge" id="interaction-badge">🛡️ THỜI KHẮC QUYẾT ĐỊNH</span>
                <h2 class="interaction-question" id="interaction-question">${interaction.question}</h2>
            </div>
            <div id="interaction-options" class="interaction-options">
                ${interaction.options.map(opt => `
                    <button class="interaction-option-btn"
                            data-option-id="${opt.id}"
                            type="button"
                            aria-label="${opt.icon ? opt.icon + ' ' : ''}${opt.label}">
                        <span aria-hidden="true">${opt.icon ? opt.icon + ' ' : ''}</span>${opt.label}
                    </button>
                `).join('')}
            </div>
            <div id="interaction-feedback" class="interaction-feedback hidden"></div>
            <div id="interaction-mini-effect" class="interaction-mini-effect hidden"></div>
            <button id="btn-interaction-continue" class="btn-interaction-continue hidden" type="button">
                Tiếp tục ▶
            </button>
        `;

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
            onEnded: () => {
                _currentInteraction = null;
                _interactionAnswered = false;
                _interactionResultShown = false;
                _showInteraction(interaction);
            }
        });
    }

    function _gotoNextAfterQuestion(interaction) {
        sound.init();
        sound.playTick();

        const overlay = document.getElementById('interaction-overlay');
        if (overlay) overlay.classList.add('hidden');

        _currentInteraction = null;
        _interactionAnswered = false;
        _interactionResultShown = false;

        _advanceToScene(interaction.nextScene);
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
     * Compute stars and XP based on answers + photofind performance.
     * Per spec §8.1 and §8.2 (mission removed — Q1 photofind already covers finding private info).
     */
    function _computeSummaryStats() {
        const ans = level4State.answers;
        const find = level4State.photofind;

        // slips
        let slips = 0;
        if (ans.fix.correct && ans.fix.firstChoice !== null && ans.fix.firstChoice !== 'B') slips++;
        if (ans.share.correct && ans.share.firstChoice !== null && ans.share.firstChoice !== 'B') slips++;
        if (find.completed && find.wrongTaps >= 2) slips++;

        let stars = 1;
        if (slips === 0) stars = 3;
        else if (slips === 1) stars = 2;
        else stars = 1;

        // XP — max 30 (Q1: 8, Q2: 11, Q3: 11)
        let xp = 0;
        if (find.completed) xp += find.wrongTaps <= 1 ? 8 : 4;
        if (ans.fix.correct) xp += ans.fix.history.length === 1 ? 11 : 6;
        if (ans.share.correct) xp += ans.share.history.length === 1 ? 11 : 6;

        return { stars, xp, slips };
    }

    function _renderSummary() {
        const card = document.getElementById('summary-card-container');
        if (!card) return;

        const ans = level4State.answers;
        const find = level4State.photofind;
        const stats = _computeSummaryStats();

        const starFull = '⭐';
        const starEmpty = '☆';
        const starsHtml = starFull.repeat(stats.stars) + starEmpty.repeat(3 - stats.stars);

        // Option label lookup
        const optionLabels = {
            fix: {
                A: 'Giữ nguyên ảnh và đăng ngay.',
                B: 'Cắt hoặc che các thông tin riêng tư trước.',
                C: 'Chỉ che mặt mình, giữ nguyên mọi thứ phía sau.'
            },
            share: {
                A: 'Đăng công khai ngay.',
                B: 'Hỏi bố mẹ và kiểm tra ảnh thêm một lần nữa.',
                C: 'Gửi ảnh cho người lạ đang xin xem.'
            }
        };

        const questionLabels = {
            fix: { label: 'Xử lý bức ảnh', tag: 'Cảnh 3 · Công cụ sửa ảnh' },
            share: { label: 'Quyết định chia sẻ', tag: 'Cảnh 4 · Trước khi chia sẻ' }
        };

        // Build recap items
        const recapItems = [];

        // Q1 photofind line
        if (find.completed) {
            recapItems.push(`
                <div class="choice-recap-item choice-recap-find">
                    <span class="choice-recap-icon">🔍</span>
                    <div class="choice-recap-content">
                        <div class="choice-recap-question">Tìm thông tin bị lộ · Cảnh 2</div>
                        <div class="choice-recap-answer">Con tìm đủ 3/3 thông tin riêng tư</div>
                        <div class="choice-recap-note">Con đã biết nhìn kỹ cả bức ảnh trước khi chia sẻ ✨</div>
                    </div>
                </div>
            `);
        }

        // Q2 fix
        if (ans.fix.correct) {
            const first = ans.fix.firstChoice;
            const wasFirstTry = ans.fix.history.length === 1;
            const firstLabel = first ? optionLabels.fix[first] : '—';
            const correctLabel = optionLabels.fix.B;
            if (wasFirstTry) {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-correct">
                        <span class="choice-recap-icon">✅</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels.fix.label} · ${questionLabels.fix.tag}</div>
                            <div class="choice-recap-answer">Con đã chọn: ${firstLabel}</div>
                            <div class="choice-recap-note">Tuyệt vời, con làm đúng ngay lần đầu!</div>
                        </div>
                    </div>
                `);
            } else {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-corrected">
                        <span class="choice-recap-icon">🔁</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels.fix.label} · ${questionLabels.fix.tag}</div>
                            <div class="choice-recap-answer">Lúc đầu con chọn: ${firstLabel}</div>
                            <div class="choice-recap-note">Sau đó con đã sửa lại thành: ${correctLabel}. Biết sửa sai cũng là siêu năng lực!</div>
                        </div>
                    </div>
                `);
            }
        }

        // Q3 share
        if (ans.share.correct) {
            const first = ans.share.firstChoice;
            const wasFirstTry = ans.share.history.length === 1;
            const firstLabel = first ? optionLabels.share[first] : '—';
            const correctLabel = optionLabels.share.B;
            if (wasFirstTry) {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-correct">
                        <span class="choice-recap-icon">✅</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels.share.label} · ${questionLabels.share.tag}</div>
                            <div class="choice-recap-answer">Con đã chọn: ${firstLabel}</div>
                            <div class="choice-recap-note">Tuyệt vời, con làm đúng ngay lần đầu!</div>
                        </div>
                    </div>
                `);
            } else {
                recapItems.push(`
                    <div class="choice-recap-item choice-recap-corrected">
                        <span class="choice-recap-icon">🔁</span>
                        <div class="choice-recap-content">
                            <div class="choice-recap-question">${questionLabels.share.label} · ${questionLabels.share.tag}</div>
                            <div class="choice-recap-answer">Lúc đầu con chọn: ${firstLabel}</div>
                            <div class="choice-recap-note">Sau đó con đã sửa lại thành: ${correctLabel}. Biết sửa sai cũng là siêu năng lực!</div>
                        </div>
                    </div>
                `);
            }
        }

        // Compose summary card
        card.innerHTML = `
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png"
                 alt="CyberKnight" class="summary-logo">
            <div class="summary-icon-badge">📸</div>
            <h2 class="summary-title">LEVEL 4 COMPLETED!</h2>
            <div class="summary-stars">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${CONFIG.BADGE_NAME}</span>
            </div>

            <div class="summary-message">
                Một bức ảnh có thể tiết lộ nhiều hơn mình nghĩ.<br>
                Nhìn kỹ – Che lại – Hỏi bố mẹ rồi mới chia sẻ nhé!
            </div>

            <hr class="summary-divider">

            <!-- NHÌN – CHE – HỎI -->
            <div class="summary-section-title">NHỚ NHANH: NHÌN – CHE – HỎI</div>
            <div class="ps-formula-row">
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">👀</div>
                    <div class="ps-formula-label">NHÌN</div>
                    <div class="ps-formula-text">Nhìn thật kỹ cả bức ảnh.</div>
                    <div class="ps-formula-sub">Xem cả phía sau, balo, thẻ tên, hộp hàng.</div>
                </div>
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">🖍️</div>
                    <div class="ps-formula-label">CHE</div>
                    <div class="ps-formula-text">Cắt hoặc che tên trường, tên lớp, địa chỉ, số điện thoại.</div>
                    <div class="ps-formula-sub">Che mặt thôi là chưa đủ.</div>
                </div>
                <div class="ps-formula-card">
                    <div class="ps-formula-icon">👨‍👩‍👧</div>
                    <div class="ps-formula-label">HỎI</div>
                    <div class="ps-formula-text">Hỏi bố mẹ trước khi chia sẻ.</div>
                    <div class="ps-formula-sub">Không gửi ảnh cho người lạ.</div>
                </div>
            </div>

            <hr class="summary-divider">

            <!-- 4 thông tin dễ bị lộ -->
            <div class="summary-section-title">4 THÔNG TIN DỄ BỊ LỘ TRONG ẢNH</div>
            <div class="ps-leak-list">
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">🏫</span>
                    <span class="ps-leak-text">Tên trường</span>
                    <span class="ps-leak-tag">Balo, cặp sách</span>
                </div>
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">📛</span>
                    <span class="ps-leak-text">Tên và lớp</span>
                    <span class="ps-leak-tag">Thẻ tên</span>
                </div>
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">🏠</span>
                    <span class="ps-leak-text">Địa chỉ</span>
                    <span class="ps-leak-tag">Hộp hàng, thư</span>
                </div>
                <div class="ps-leak-row">
                    <span class="ps-leak-icon">📞</span>
                    <span class="ps-leak-text">Số điện thoại</span>
                    <span class="ps-leak-tag">Giấy dán, hộp hàng</span>
                </div>
            </div>

            <hr class="summary-divider">

            <!-- HÀNH TRÌNH CỦA CON -->
            <div class="summary-section-title">HÀNH TRÌNH CỦA CON</div>
            <div class="choices-recap">
                ${recapItems.join('')}
            </div>

            <hr class="summary-divider">

            <!-- Tip + disclaimer -->
            <div class="ps-tip-line">💡 Lỡ đăng ảnh có bí mật rồi? Hãy báo bố mẹ để xoá hoặc chỉnh lại ảnh ngay.</div>
            <div class="ps-disclaimer">Mọi tên trường, địa chỉ, số điện thoại trong trò chơi đều là hư cấu.</div>

            <!-- Actions -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', () => _replay());
        document.getElementById('btn-summary-continue')?.addEventListener('click', () => _continue());

        // Dispatch CustomEvent
        window.dispatchEvent(new CustomEvent('level4:complete', {
            detail: {
                answers: level4State.answers,
                photofind: level4State.photofind,
                stars: stats.stars,
                xp: stats.xp,
                badge: CONFIG.BADGE_NAME
            }
        }));
    }

    function _replay() {
        sound.init();
        sound.playTick();

        // Reset state
        level4State.answers = {
            fix:   { firstChoice: null, attempts: 0, correct: false, history: [] },
            share: { firstChoice: null, attempts: 0, correct: false, history: [] }
        };
        level4State.photofind = { wrongTaps: 0, hintsUsed: 0, blankTaps: 0, found: [], completed: false };
        level4State.currentScene = null;
        _currentInteraction = null;
        _interactionAnswered = false;
        _interactionResultShown = false;

        if (_photofindBoard) {
            try { _photofindBoard.destroy(); } catch (e) {}
            _photofindBoard = null;
        }

        resetAllVideos();

        const overlay = document.getElementById('interaction-overlay');
        if (overlay) overlay.classList.add('hidden');

        if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';

        _restoreInteractionCard();

        FreezeFrame.crossfade(() => {
            switchStage('scene1');
            _playScene('scene1');
        });
    }

    function _restoreInteractionCard() {
        const card = document.getElementById('interaction-card');
        if (!card) return;
        if (card.querySelector('.interaction-header')) return;
        card.innerHTML = `
            <div class="interaction-header">
                <span class="interaction-badge" id="interaction-badge">🛡️ THỜI KHẮC QUYẾT ĐỊNH</span>
                <h2 class="interaction-question" id="interaction-question"></h2>
            </div>
            <div id="interaction-options" class="interaction-options"></div>
            <div id="interaction-feedback" class="interaction-feedback hidden"></div>
            <div id="interaction-mini-effect" class="interaction-mini-effect hidden"></div>
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
        } catch (err) { if (_isDebugMode()) console.warn('postMessage error:', err); }
        window.location.href = '../index.html';
    }

    // =========================================================================
    // 9. STAGE SWITCHER
    // =========================================================================

    const ALL_STAGES = [
        'scene1', 'scene2', 'reveal', 'scene3', 'scene4', 'scene5',
        'photofind', 'summary'
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

        const topBar = document.getElementById('level4-top-bar');
        const skipBtn = document.getElementById('btn-skip-video');
        const isSummary = targetStage === 'summary';
        if (topBar) topBar.style.display = isSummary ? 'none' : '';
        if (skipBtn) skipBtn.classList.toggle('hidden', isSummary);

        // Hide overlay canvases on summary so they don't cover the action buttons
        const pc = document.getElementById('particle-canvas');
        if (pc) pc.style.display = isSummary ? 'none' : '';
        // freeze-canvas is controlled by opacity transition; also hide it on summary
        const fc = document.getElementById('freeze-canvas');
        if (fc) {
            if (isSummary) {
                fc.style.display = 'none';
            } else {
                fc.style.display = '';
                // Ensure it stays invisible when not in use
                fc.style.opacity = '0';
            }
        }
    }

    // =========================================================================
    // 12. DEBUG FLAGS
    // =========================================================================

    function handleDebugFlags() {
        const params = new URLSearchParams(window.location.search);
        const skip = params.get('skip');

        // ?skip=scene1|scene2|reveal|scene3|scene4|scene5
        if (skip && CONFIG.VIDEO_SCENES.includes(skip)) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            _advanceToScene(skip);
            return true;
        }

        // ?skip=q1 → photofind
        if (skip === 'q1') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            // Pre-mark photofind state as if found 0/3 (defaults)
            switchStage('scene2');
            _showPhotofind();
            return true;
        }

        // ?skip=q2 → fix question
        if (skip === 'q2') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            switchStage('scene3');
            _showInteraction(interactionPoints.fix);
            return true;
        }

        // ?skip=q3 → share question
        if (skip === 'q3') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            switchStage('scene4');
            _showInteraction(interactionPoints.share);
            return true;
        }

        // ?skip=result-q2-A, result-q2-C, result-q3-A, result-q3-C
        const resultMatch = skip?.match(/^result-(q\d)-([A-Z])$/);
        if (resultMatch) {
            document.getElementById('start-overlay')?.classList.add('hidden');
            _resetAnswersForDebug();
            const [, qKey, choice] = resultMatch;
            const idMap = { q2: 'fix', q3: 'share' };
            const interaction = interactionPoints[idMap[qKey]];
            if (interaction) {
                level4State.answers[interaction.id].firstChoice = choice;
                level4State.answers[interaction.id].attempts = 1;
                level4State.answers[interaction.id].history = [choice];
                level4State.answers[interaction.id].correct = false;
                switchStage(interaction.afterScene);
                _showInteraction(interaction);
                setTimeout(() => {
                    const btn = document.querySelector(`[data-option-id="${choice}"]`);
                    if (btn) btn.click();
                }, 300);
            }
            return true;
        }

        // ?skip=summary-first → 3⭐, 30 XP (perfect run)
        if (skip === 'summary-first') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level4State.answers = {
                fix:   { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] },
                share: { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] }
            };
            level4State.photofind = { wrongTaps: 0, hintsUsed: 0, blankTaps: 0, found: ['bag','badge','box'], completed: true };
            _showSummary();
            return true;
        }

        // ?skip=summary-retry → 2⭐ (with retry history)
        if (skip === 'summary-retry') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level4State.answers = {
                fix:   { firstChoice: 'A', attempts: 2, correct: true, history: ['A', 'B'] },
                share: { firstChoice: 'C', attempts: 2, correct: true, history: ['C', 'B'] }
            };
            level4State.photofind = { wrongTaps: 1, hintsUsed: 0, blankTaps: 0, found: ['bag','badge','box'], completed: true };
            _showSummary();
            return true;
        }

        // ?skip=summary → default state
        if (skip === 'summary') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            level4State.answers = {
                fix:   { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] },
                share: { firstChoice: 'B', attempts: 1, correct: true, history: ['B'] }
            };
            level4State.photofind = { wrongTaps: 0, hintsUsed: 0, blankTaps: 0, found: ['bag','badge','box'], completed: true };
            _showSummary();
            return true;
        }

        return false;
    }

    function _resetAnswersForDebug() {
        level4State.answers = {
            fix:   { firstChoice: null, attempts: 0, correct: false, history: [] },
            share: { firstChoice: null, attempts: 0, correct: false, history: [] }
        };
        level4State.photofind = { wrongTaps: 0, hintsUsed: 0, blankTaps: 0, found: [], completed: false };
    }

    // =========================================================================
    // 13. INIT
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();

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