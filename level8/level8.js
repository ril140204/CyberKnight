/**
 * CYBERKNIGHT — LEVEL 8: "TRẬN CHIẾN AN TOÀN SỐ"
 * Core Controller: State Machine, Map Navigation, 3 Stations, Boss Battle, Audio Synth, Resource Probing.
 *
 * Architecture based on Level 5 & Level 7:
 * - ResourceSource probing for video & image assets (handles folder space "level 8")
 * - 1 video element per scene (intro, outro), playsinline, WITH SOUND (not muted)
 * - FreezeFrame crossfade (canvas capture + opacity fade)
 * - AudioSynth (WebAudio synthesis, zero external audio files)
 * - Class-based stage switcher with z-index scale
 * - TopBar THOÁT (ESC) + BỎ QUA ⏩ (only on video stages, 1.5s safety net)
 * - Summary with compact 4-tips (<= 8 words each, 1 emoji) + Honorary Diploma
 * - Slips-based 3-star rating & XP calculation (max 30 XP)
 * - Event dispatch: level8:complete
 * - Full clean state reset on replay
 * - URL debug parameters (?debug=1, ?skip=...)
 */

(function () {
    'use strict';

    // #region agent log
    const _DBG_SID = '378bcc';
    const _DBG_ENDPOINT = 'http://127.0.0.1:7486/ingest/8602fe44-4a08-43e9-a828-2d55bf3cf826';
    function _dbg(hypothesisId, location, message, data) {
        try {
            fetch(_DBG_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': _DBG_SID },
                body: JSON.stringify({
                    sessionId: _DBG_SID,
                    runId: _dbg.runId,
                    hypothesisId,
                    location,
                    message,
                    data: data || {},
                    timestamp: Date.now(),
                }),
            }).catch(() => {});
        } catch (e) { /* debug only */ }
    }
    _dbg.runId = 'run1';
    try { window.__l8dbg = _dbg; } catch (e) {}
    // #endregion

    // =========================================================================
    // 1. CONFIG & GLOBAL STATE
    // =========================================================================

    const CONFIG = {
        BASES: [
            '../video/level 8/',
            '../video/level8/',
            'video/level8/',
            './'
        ],
        VIDEO_EXTS: ['.mp4', '.webm', '.mov'],
        IMAGE_EXTS: ['.jpg', '.jpeg', '.png', '.webp', '.jfif', '.avif', '.gif'],
        IMAGE_NAMES: ['quai_vat_ai', 'quai_vat', 'anh_AI'],
        VIDEO_SCENES: ['intro', 'outro'],
        BADGE_NAME: 'HIỆP SĨ AN TOÀN SỐ',
        BOSS_CLICKS_NEEDED: 20,
        IDLE_HINT_MS: 15000,
        BOSS_IDLE_HINT_MS: 10000,
        DRAG_THRESHOLD_PX: 8,
        THROTTLE_BEAM_MS: 80
    };

    /**
     * Bảng luồng tường minh cho các video stage.
     * Các trạm tương tác (st1, st2, st3, boss) do State Machine riêng điều khiển.
     */
    const SCENE_FLOW = {
        intro: { next: 'map' },
        outro: { next: 'summary' }
    };

    const ALL_STAGES = ['intro', 'map', 'st1', 'st2', 'st3', 'boss', 'outro', 'summary'];

    const _sceneEnded = { intro: false, outro: false };

    /**
     * Runtime State của Level 8
     */
    const level8State = {
        currentScene: null,
        currentStage: null,
        slips: 0,
        spheres: [false, false, false],
        currentStation: null,
        magnifyMode: false,
        zoomed: false,
        station1: {
            scanned: false,
            answered: false,
            attempts: 0
        },
        station2: {
            attempts: 0,
            answered: false
        },
        station3: {
            selectedApp: null,
            trashedApps: new Set(),
            attempts: 0,
            completed: false
        },
        boss: {
            clicks: 0,
            defeated: false,
            lastClickTime: 0
        }
    };

    // =========================================================================
    // 2. RESOURCE SOURCE PROBING (VIDEO & IMAGE)
    // =========================================================================

    const ResourceSource = {
        baseIdx: null,
        videoExt: null,
        imageExt: null,
        imageName: null,
        _sceneVideoUrls: {},

        base() {
            return (this.baseIdx === null) ? CONFIG.BASES[0] : CONFIG.BASES[this.baseIdx];
        },

        videoUrl(sceneName) {
            if (this._sceneVideoUrls[sceneName]) {
                return this._sceneVideoUrls[sceneName];
            }
            if (this.baseIdx === null || !this.videoExt) return null;
            return encodeURI(this.base() + sceneName + this.videoExt);
        },

        imageUrl() {
            const name = this.imageName || CONFIG.IMAGE_NAMES[0];
            const ext = this.imageExt || '.jpg';
            return encodeURI(this.base() + name + ext);
        }
    };

    let _probePromise = null;

    async function _probeResourceBase() {
        if (_probePromise) return _probePromise;

        _probePromise = (async () => {
            // 1. Dò base cho video
            for (let b = 0; b < CONFIG.BASES.length; b++) {
                const base = CONFIG.BASES[b];
                for (let e = 0; e < CONFIG.VIDEO_EXTS.length; e++) {
                    const ext = CONFIG.VIDEO_EXTS[e];
                    const testUrl = encodeURI(base + 'intro' + ext);
                    const ok = await _probeVideo(testUrl);
                    if (ok) {
                        ResourceSource.baseIdx = b;
                        ResourceSource.videoExt = ext;
                        if (_isDebugMode()) console.log(`[Level8 Probe] Base found: ${base}, videoExt: ${ext}`);
                        break;
                    }
                }
                if (ResourceSource.baseIdx !== null) break;
            }

            if (ResourceSource.baseIdx === null) {
                ResourceSource.baseIdx = 0;
                ResourceSource.videoExt = '.mp4';
            }

            // #region agent log
            _dbg('F', 'level8.js:_probeResourceBase', 'Dò xong base video', {
                baseIdx: ResourceSource.baseIdx,
                base: ResourceSource.base(),
                videoExt: ResourceSource.videoExt,
                introUrl: ResourceSource.videoUrl('intro'),
            });
            // #endregion

            // Dò riêng cho scene outro (thử cả outtro và outro)
            await _probeOutroVideo();

            // 2. Dò ảnh quái vật AI cho Trạm 2
            await _probeMonsterImage();
        })();

        return _probePromise;
    }

    async function _probeOutroVideo() {
        const base = ResourceSource.base();
        const names = ['outtro', 'outro'];
        for (const name of names) {
            for (const ext of CONFIG.VIDEO_EXTS) {
                const url = encodeURI(base + name + ext);
                const ok = await _probeVideo(url);
                if (ok) {
                    ResourceSource._sceneVideoUrls['outro'] = url;
                    if (_isDebugMode()) console.log(`[Level8 Probe] Outro scene video found: ${url}`);
                    return;
                }
            }
        }
        ResourceSource._sceneVideoUrls['outro'] = encodeURI(base + 'outtro.mp4');
    }

    async function _probeMonsterImage() {
        const base = ResourceSource.base();
        for (const name of CONFIG.IMAGE_NAMES) {
            for (const ext of CONFIG.IMAGE_EXTS) {
                const url = encodeURI(base + name + ext);
                const ok = await _probeImage(url);
                if (ok) {
                    ResourceSource.imageName = name;
                    ResourceSource.imageExt = ext;
                    if (_isDebugMode()) console.log(`[Level8 Probe] Monster image found: ${url}`);
                    return;
                }
            }
        }
        ResourceSource.imageName = CONFIG.IMAGE_NAMES[0];
        ResourceSource.imageExt = '.jpg';
        // #region agent log
        _dbg('F', 'level8.js:_probeMonsterImage', 'Dò ảnh quái vật AI', {
            imageName: ResourceSource.imageName,
            imageExt: ResourceSource.imageExt,
            imageUrl: ResourceSource.imageUrl(),
        });
        // #endregion
    }

    function _probeVideo(url) {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            let resolved = false;

            const cleanup = () => {
                v.removeAttribute('src');
                v.load();
            };

            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(false);
                }
            }, 2500);

            v.onloadedmetadata = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    const valid = v.videoWidth > 0 && v.videoHeight > 0;
                    cleanup();
                    resolve(valid);
                }
            };

            v.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve(false);
                }
            };

            v.src = url;
        });
    }

    async function _probeImage(url) {
        if (location.protocol === 'file:') {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img.naturalWidth > 0);
                img.onerror = () => resolve(false);
                img.src = url;
            });
        }

        try {
            const res = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-0' } });
            const statusOk = res.ok || res.status === 206;
            const contentType = res.headers.get('content-type') || '';
            const typeOk = contentType.trim().toLowerCase().startsWith('image/');
            return statusOk && typeOk;
        } catch (e) {
            return false;
        }
    }

    // =========================================================================
    // 3. AUDIO SYNTHESIZER (WEBAUDIO, KHÔNG DÙNG FILE NGOÀI)
    // =========================================================================

    class AudioSynth {
        constructor() {
            this.ctx = null;
        }

        init() {
            if (this.ctx) return;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
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

        playCorrectCatch() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.07);
                gain.gain.setValueAtTime(0.18, now + idx * 0.07);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.07); osc.stop(now + idx * 0.07 + 0.35);
            });
        }

        playIncorrectCatch() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.25);
        }

        playSoftBip() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.12);
        }

        playScanTone() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(1200, now + 0.6);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.65);
        }

        playBeamHit() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.08);
        }

        playTrashPop() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);
            gain.gain.setValueAtTime(0.18, now);
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
            osc.frequency.linearRampToValueAtTime(900, now + 0.35);
            osc.frequency.linearRampToValueAtTime(400, now + 0.7);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.75);
        }

        photoSnap() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2200, now);
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.04);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(now); osc.stop(now + 0.05);
        }

        playVictoryChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.1);
                gain.gain.setValueAtTime(0.2, now + idx * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.6);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.1); osc.stop(now + idx * 0.1 + 0.6);
            });
        }
    }

    const sound = new AudioSynth();
    try { window.sound = sound; } catch (e) {}

    // =========================================================================
    // 4. FREEZE-FRAME CROSSFADE & STAGE SWITCHER
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
            if (prepareNewStageCallback) prepareNewStageCallback();
            setTimeout(() => {
                if (this.canvas) this.canvas.style.opacity = '0';
            }, 50);
        }
    };

    function switchStage(stageName) {
        level8State.currentStage = stageName;
        ALL_STAGES.forEach(name => {
            const el = document.getElementById(`stage-${name}`);
            if (el) el.classList.toggle('active', name === stageName);
        });
        TopBar.updateVisibility(stageName);
    }

    // =========================================================================
    // 5. TOPBAR & EXIT / SKIP HANDLERS
    // =========================================================================

    const TopBar = {
        exitBtn: null,
        skipBtn: null,
        _skipFallbackTimer: null,

        init() {
            this.exitBtn = document.getElementById('btn-exit-level');
            this.skipBtn = document.getElementById('btn-skip-video');

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
            const scene = level8State.currentScene;
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
            const showSkip = CONFIG.VIDEO_SCENES.includes(stage);
            this.skipBtn.classList.toggle('hidden', !showSkip);
        },

        exitLevel() {
            _clearAllTimers();
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

    // =========================================================================
    // 6. VIDEO SCENE MANAGEMENT
    // =========================================================================

    async function _playScene(sceneName, options = {}) {
        await _probeResourceBase();
        _clearAllTimers();
        level8State.currentScene = sceneName;
        _sceneEnded[sceneName] = false;

        const videoUrl = ResourceSource.videoUrl(sceneName);
        const stageEl = document.getElementById(`stage-${sceneName}`);
        const videoEl = document.getElementById(`video-${sceneName}`);

        if (!videoEl || !videoUrl) {
            _showVideoErrorPanel(sceneName, sceneName === 'intro' ? 'Cảnh mở đầu' : 'Cảnh kết thúc', [videoUrl || 'Chưa tìm thấy URL']);
            return;
        }

        switchStage(sceneName);

        const spinner = stageEl.querySelector('.video-loading-spinner');
        const slowHint = stageEl.querySelector('.video-loading-slow');
        if (spinner) spinner.classList.remove('hidden');

        const slowTimer = setTimeout(() => {
            if (slowHint) slowHint.classList.remove('hidden');
        }, 3000);

        videoEl.onplaying = () => {
            clearTimeout(slowTimer);
            if (spinner) spinner.classList.add('hidden');
            if (slowHint) slowHint.classList.add('hidden');
        };

        videoEl.onended = () => {
            _triggerSceneEnd(sceneName);
        };

        videoEl.onerror = () => {
            clearTimeout(slowTimer);
            if (spinner) spinner.classList.add('hidden');
            if (slowHint) slowHint.classList.add('hidden');
            _showVideoErrorPanel(sceneName, sceneName === 'intro' ? 'Cảnh mở đầu' : 'Cảnh kết thúc', [videoUrl]);
        };

        if (videoEl.src !== videoUrl || options.forceReload) {
            videoEl.src = videoUrl;
            videoEl.load();
        }

        videoEl.play().catch(() => {
            // Autoplay bị chặn -> hiện nút Bấm để xem tiếp
            _showAutoplayOverlay(stageEl, videoEl);
        });
    }

    function _triggerSceneEnd(sceneName) {
        if (_sceneEnded[sceneName]) return;
        _sceneEnded[sceneName] = true;

        // #region agent log
        _dbg('G', 'level8.js:_triggerSceneEnd', 'Video kết thúc → chuyển stage', {
            sceneName,
            next: (SCENE_FLOW[sceneName] && SCENE_FLOW[sceneName].next) || null,
            spheres: level8State.spheres.slice(),
        });
        // #endregion

        const videoEl = document.getElementById(`video-${sceneName}`);
        if (videoEl) FreezeFrame.captureFromVideo(videoEl);

        const flow = SCENE_FLOW[sceneName];
        if (flow && flow.next) {
            if (flow.next === 'map') {
                _showMapStage();
            } else if (flow.next === 'summary') {
                _showSummaryStage();
            }
        }
    }

    function _showAutoplayOverlay(stageEl, videoEl) {
        const existing = stageEl.querySelector('.video-autoplay-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'video-autoplay-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:35;';
        overlay.innerHTML = `
            <button type="button" class="btn-cyber-primary" style="min-height:48px;padding:0 24px;">
                ▶ BẤM ĐỂ XEM TIẾP
            </button>
        `;
        stageEl.querySelector('.video-container')?.appendChild(overlay);

        overlay.querySelector('button')?.addEventListener('click', () => {
            sound.init();
            sound.playTick();
            overlay.remove();
            videoEl.play();
        });
    }

    function _showVideoErrorPanel(stageId, sceneLabel, triedUrls) {
        const stage = document.getElementById(`stage-${stageId}`);
        if (!stage) return;

        switchStage(stageId);
        TopBar.updateVisibility(stageId);

        const existing = stage.querySelector('.video-error-panel');
        if (existing) existing.remove();

        const debugHtml = _isDebugMode()
            ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:12px;word-break:break-all;">Đã thử:<br>${triedUrls.join('<br>')}</div>`
            : '';

        const panel = document.createElement('div');
        panel.className = 'video-error-panel';
        panel.innerHTML = `
            <div class="video-error-inner">
                <div class="video-error-icon">😢</div>
                <div class="video-error-title">Không tải được video ${sceneLabel} 😢</div>
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
            _triggerSceneEnd(stageId);
        });
    }

    // =========================================================================
    // 7. STAGE MAP: STATE MACHINE & BẢN ĐỒ THÀNH PHỐ SỐ
    // =========================================================================

    let _idleTimer = null;

    function _clearAllTimers() {
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
        if (TopBar._skipFallbackTimer) { clearTimeout(TopBar._skipFallbackTimer); TopBar._skipFallbackTimer = null; }
    }

    function _startIdleTimer(callback, delayMs = CONFIG.IDLE_HINT_MS) {
        _clearAllTimers();
        _idleTimer = setTimeout(callback, delayMs);
    }

    function _showMapStage() {
        sound.init();
        FreezeFrame.crossfade(() => {
            switchStage('map');
            _updateMapUI();
            _startIdleTimer(() => {
                _setBipText('map-bip-msg', 'Con hãy chọn trạm đang mở để tiếp tục thu thập Mảnh Cầu nhé!');
            });
        });
    }

    function _updateMapUI() {
        const count = level8State.spheres.filter(Boolean).length;
        const countText = document.getElementById('map-sphere-text');
        if (countText) countText.textContent = `${count}/3`;

        for (let i = 1; i <= 3; i++) {
            const slot = document.getElementById(`sphere-slot-${i}`);
            if (slot) slot.classList.toggle('bt-slot-active', level8State.spheres[i - 1]);
        }

        // Trạm 1 luôn mở nếu chưa xong
        const node1 = document.getElementById('node-station-1');
        const status1 = document.getElementById('node-1-status');
        if (level8State.spheres[0]) {
            node1?.classList.add('bt-completed');
            if (status1) status1.textContent = 'ĐÃ XONG ✔';
        } else {
            node1?.classList.remove('bt-locked');
            if (status1) status1.textContent = 'SẴN SÀNG';
        }

        // Trạm 2 mở khi trạm 1 xong
        const node2 = document.getElementById('node-station-2');
        const status2 = document.getElementById('node-2-status');
        if (level8State.spheres[1]) {
            node2?.classList.add('bt-completed');
            if (status2) status2.textContent = 'ĐÃ XONG ✔';
        } else if (level8State.spheres[0]) {
            node2?.classList.remove('bt-locked');
            if (status2) status2.textContent = 'SẴN SÀNG';
        } else {
            node2?.classList.add('bt-locked');
            if (status2) status2.textContent = '🔒 KHÓA';
        }

        // Trạm 3 mở khi trạm 2 xong
        const node3 = document.getElementById('node-station-3');
        const status3 = document.getElementById('node-3-status');
        if (level8State.spheres[2]) {
            node3?.classList.add('bt-completed');
            if (status3) status3.textContent = 'ĐÃ XONG ✔';
        } else if (level8State.spheres[1]) {
            node3?.classList.remove('bt-locked');
            if (status3) status3.textContent = 'SẴN SÀNG';
        } else {
            node3?.classList.add('bt-locked');
            if (status3) status3.textContent = '🔒 KHÓA';
        }

        // Boss Node mở khi đủ 3 mảnh cầu
        const nodeBoss = document.getElementById('node-station-boss');
        const statusBoss = document.getElementById('node-boss-status');
        if (count === 3) {
            nodeBoss?.classList.remove('bt-locked');
            if (statusBoss) statusBoss.textContent = '⚔️ VÀO TRẬN CHIẾN!';
            _setBipText('map-bip-msg', 'Tuyệt vời! Đã đủ 3 Mảnh Cầu! Hãy bấm vào <b>Tháp Vua Độc Hại</b> để phong ấn hắn!');
        } else {
            nodeBoss?.classList.add('bt-locked');
            if (statusBoss) statusBoss.textContent = `🔒 CẦN ${3 - count} MẢNH`;
        }
    }

    function _wireMapNodes() {
        const n1 = document.getElementById('node-station-1');
        const n2 = document.getElementById('node-station-2');
        const n3 = document.getElementById('node-station-3');
        const nBoss = document.getElementById('node-station-boss');

        const attachNode = (node, handler) => {
            if (!node) return;
            node.addEventListener('click', (e) => {
                e.preventDefault();
                sound.init();
                handler();
            });
            node.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    sound.init();
                    handler();
                }
            });
        };

        attachNode(n1, () => {
            sound.playTick();
            _startStation1();
        });

        attachNode(n2, () => {
            if (!level8State.spheres[0]) {
                sound.playIncorrectCatch();
                _setBipText('map-bip-msg', 'Con cần hoàn thành <b>Trạm 1</b> trước để nhận Mảnh Cầu nhé!');
                return;
            }
            sound.playTick();
            _startStation2();
        });

        attachNode(n3, () => {
            if (!level8State.spheres[1]) {
                sound.playIncorrectCatch();
                _setBipText('map-bip-msg', 'Con cần hoàn thành <b>Trạm 2</b> trước để nhận Mảnh Cầu nhé!');
                return;
            }
            sound.playTick();
            _startStation3();
        });

        attachNode(nBoss, () => {
            const count = level8State.spheres.filter(Boolean).length;
            if (count < 3) {
                sound.playIncorrectCatch();
                _setBipText('map-bip-msg', 'Chưa đủ 3 Mảnh Cầu nên Khiên Ánh Sáng chưa thể hợp nhất. Con hãy vượt qua cả 3 trạm nhé!');
                return;
            }
            sound.playTick();
            _startBossBattle();
        });
    }

    function _setBipText(elementId, htmlContent) {
        const el = document.getElementById(elementId);
        if (el) el.innerHTML = htmlContent;
    }

    // =========================================================================
    // 8. TRẠM 1: CÔNG VIÊN QR
    // =========================================================================

    function _startStation1() {
        level8State.currentStation = 1;
        FreezeFrame.crossfade(() => {
            switchStage('st1');
            _resetStation1UI();
            _startIdleTimer(() => {
                _setBipText('st1-bip-text', 'Mã QR lạ dán ở nơi công cộng rất nguy hiểm, con đừng vội mở ra nhé!');
            });
        });
    }

    function _resetStation1UI() {
        const phone = document.getElementById('st1-phone-popup');
        const answers = document.getElementById('st1-answers');
        const beam = document.getElementById('st1-scan-beam');
        const scanBtn = document.getElementById('btn-st1-scan');

        if (phone) phone.classList.add('hidden');
        if (answers) answers.classList.add('hidden');
        if (beam) beam.classList.add('hidden');
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = '📷 QUÉT MÃ';
        }

        ['btn-st1-open', 'btn-st1-send', 'btn-st1-delete'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('bt-selected-correct', 'bt-selected-wrong');
            }
        });

        _setBipText('st1-bip-text', 'Con hãy bấm "📷 QUÉT MÃ" để xem mã QR này dẫn tới đâu nhé!');
    }

    function _wireStation1() {
        const scanBtn = document.getElementById('btn-st1-scan');
        const beam = document.getElementById('st1-scan-beam');
        const phone = document.getElementById('st1-phone-popup');
        const answers = document.getElementById('st1-answers');

        if (scanBtn) {
            scanBtn.addEventListener('click', () => {
                sound.init();
                sound.playScanTone();
                scanBtn.disabled = true;
                if (beam) beam.classList.remove('hidden');

                setTimeout(() => {
                    if (beam) beam.classList.add('hidden');
                    if (phone) phone.classList.remove('hidden');
                    if (answers) answers.classList.remove('hidden');
                    _setBipText('st1-bip-text', 'Mã QR dẫn tới trang lạ đòi tặng quà! Con sẽ làm gì?');
                    _startIdleTimer(() => {
                        _setBipText('st1-bip-text', 'Link lạ không rõ nguồn gốc có thể lừa đảo. Hãy tắt và xóa nó đi con nhé!');
                    });
                }, 1000);
            });
        }

        ['btn-st1-open', 'btn-st1-send', 'btn-st1-delete'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;

            btn.addEventListener('click', () => {
                sound.init();
                const choice = btn.dataset.choice;
                level8State.station1.attempts++;

                if (choice === 'delete') {
                    // ĐÚNG
                    btn.classList.add('bt-selected-correct');
                    ['btn-st1-open', 'btn-st1-send'].forEach(otherId => {
                        const b = document.getElementById(otherId);
                        if (b) b.disabled = true;
                    });

                    sound.playCorrectCatch();
                    try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } }); } catch (e) {}
                    _setBipText('st1-bip-text', 'Hoan hô con! <b>Tắt và xóa mã QR lạ</b> là quyết định chuẩn của Hiệp Sĩ Số!');

                    level8State.spheres[0] = true;
                    setTimeout(() => {
                        _showMapStage();
                    }, 1800);
                } else {
                    // SAI
                    btn.classList.add('bt-selected-wrong');
                    // #region agent log
                    _dbg('B', 'level8.js:st1-wrong', 'Trạm 1: bấm đáp án sai', {
                        choice,
                        attempts: level8State.station1.attempts,
                        slipsBefore: level8State.slips,
                        btnDisabled: btn.disabled,
                        btnHasWrongClass: btn.classList.contains('bt-selected-wrong'),
                    });
                    // #endregion
                    level8State.slips++;
                    sound.playIncorrectCatch();
                    _setBipText('st1-bip-text', 'Link lạ này có thể chứa virus hoặc bẫy lừa đảo đấy, con chọn lại nhé!');
                }
            });
        });
    }

    // =========================================================================
    // 9. TRẠM 2: TIN GIẢ & BÚT THỬ AI (MAGNIFIER)
    // =========================================================================

    function _startStation2() {
        level8State.currentStation = 2;
        FreezeFrame.crossfade(() => {
            switchStage('st2');
            _resetStation2UI();
            sound.photoSnap();
            _startIdleTimer(() => {
                _setBipText('st2-bip-text', 'Con hãy bật Bút Thử AI và chạm vào ảnh để soi kỹ các chi tiết vô lý nhé!');
            });
        });
    }

    function _resetStation2UI() {
        _setMagnifyMode(false, false);
        _setZoom(false);

        ['btn-st2-like', 'btn-st2-share', 'btn-st2-report'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('bt-selected-correct', 'bt-selected-wrong');
            }
        });

        const img = document.getElementById('st2-ai-image');
        if (img) img.src = ResourceSource.imageUrl();

        _setBipText('st2-bip-text', 'Hãy bật Bút Thử AI và soi kỹ số ngón tay, ngón chân của quái vật nhé con!');
    }

    function _setMagnifyMode(on, playSound = true) {
        level8State.magnifyMode = on;
        const btn = document.getElementById('btn-magnifier-st2');
        const frame = document.getElementById('st2-zoom-frame');
        if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (frame) frame.classList.toggle('bt-zoom-active', on);
        if (on && playSound) sound.magnify();
    }

    function _setZoom(on) {
        level8State.zoomed = on;
        const img = document.getElementById('st2-ai-image');
        if (img) img.classList.toggle('bt-zoomed', on);
        if (!on && img) {
            img.style.transformOrigin = '50% 50%';
        }
    }

    function _zoomToPoint(clientX, clientY) {
        const img = document.getElementById('st2-ai-image');
        const frame = document.getElementById('st2-zoom-frame');
        if (!img || !frame) return;

        const rect = frame.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const originX = ((clientX - rect.left) / rect.width) * 100;
        const originY = ((clientY - rect.top) / rect.height) * 100;

        const cx = Math.min(Math.max(originX, 0), 100);
        const cy = Math.min(Math.max(originY, 0), 100);

        img.style.transformOrigin = `${cx.toFixed(2)}% ${cy.toFixed(2)}%`;
        _setZoom(true);
    }

    function _wireStation2() {
        const magnifyBtn = document.getElementById('btn-magnifier-st2');
        const hintBtn = document.getElementById('btn-hint-st2');
        const frame = document.getElementById('st2-zoom-frame');

        if (magnifyBtn) {
            magnifyBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const next = !level8State.magnifyMode;
                _setMagnifyMode(next);
                if (!next) _setZoom(false);
            });
        }

        if (hintBtn) {
            hintBtn.addEventListener('click', () => {
                sound.init();
                sound.playSoftBip();
                _setBipText('st2-bip-text', 'Bật Bút Thử AI soi sẽ thấy: Quái vật có tới 7 cái vuốt và chữ trên bờ biển bị nhòe méo!');
            });
        }

        if (frame) {
            frame.addEventListener('click', (e) => {
                if (!level8State.magnifyMode) return;
                e.preventDefault();
                if (level8State.zoomed) {
                    _setZoom(false);
                } else {
                    _zoomToPoint(e.clientX, e.clientY);
                }
            });
        }

        ['btn-st2-like', 'btn-st2-share', 'btn-st2-report'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;

            btn.addEventListener('click', () => {
                sound.init();
                const choice = btn.dataset.choice;
                level8State.station2.attempts++;

                if (choice === 'report') {
                    // ĐÚNG
                    btn.classList.add('bt-selected-correct');
                    ['btn-st2-like', 'btn-st2-share'].forEach(otherId => {
                        const b = document.getElementById(otherId);
                        if (b) b.disabled = true;
                    });

                    sound.playCorrectCatch();
                    try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } }); } catch (e) {}
                    _setBipText('st2-bip-text', 'Chính xác! <b>Báo cáo tin giả</b> là hành động chuẩn xác để bảo vệ mọi người!');

                    level8State.spheres[1] = true;
                    setTimeout(() => {
                        _showMapStage();
                    }, 1800);
                } else {
                    // SAI
                    btn.classList.add('bt-selected-wrong');
                    // #region agent log
                    _dbg('B', 'level8.js:st2-wrong', 'Trạm 2: bấm đáp án sai', {
                        choice,
                        attempts: level8State.station2.attempts,
                        slipsBefore: level8State.slips,
                        btnDisabled: btn.disabled,
                        btnHasWrongClass: btn.classList.contains('bt-selected-wrong'),
                    });
                    // #endregion
                    level8State.slips++;
                    sound.playIncorrectCatch();
                    _setBipText('st2-bip-text', 'Khoan đã con ơi, tin giật gân này chưa được kiểm chứng, đừng vội tương tác!');
                }
            });
        });
    }

    // =========================================================================
    // 10. TRẠM 3: LỌC APP ĐỘC HẠI (TOUCH-FIRST & POINTER DRAG)
    // =========================================================================

    function _startStation3() {
        level8State.currentStation = 3;
        FreezeFrame.crossfade(() => {
            switchStage('st3');
            _resetStation3UI();
            _startIdleTimer(() => {
                _setBipText('st3-bip-text', 'Con hãy chạm vào một app nhái rồi chạm vào thùng rác để dọn dẹp nhé!');
            });
        });
    }

    function _resetStation3UI() {
        level8State.station3.selectedApp = null;
        level8State.station3.trashedApps.clear();
        level8State.station3.completed = false;

        ['app-card-safe', 'app-card-fake1', 'app-card-fake2', 'app-card-fake3'].forEach(id => {
            const card = document.getElementById(id);
            if (card) {
                card.classList.remove('hidden', 'bt-app-selected', 'bt-app-dragged');
                card.style.transform = '';
            }
        });

        _updateTrashCounter();
        _setBipText('st3-bip-text', 'Hãy quan sát kỹ dấu tích xanh và quyền truy cập để tìm ra 3 app nhái nhé con!');
    }

    function _updateTrashCounter() {
        const counter = document.getElementById('st3-trash-counter');
        const count = level8State.station3.trashedApps.size;
        if (counter) counter.textContent = `Đã dọn: ${count}/3 app nhái`;
    }

    function _wireStation3() {
        const appGrid = document.getElementById('st3-app-grid');
        const trashArea = document.getElementById('st3-trash-area');
        if (!appGrid || !trashArea) return;

        let activePointerCard = null;
        let startX = 0;
        let startY = 0;
        let isDragging = false;
        let suppressClick = false;

        // Xử lý chạm chọn thẻ app (Cách chính 2 bước)
        appGrid.querySelectorAll('.bt-app-card').forEach(card => {
            card.addEventListener('pointerdown', (e) => {
                // #region agent log
                _dbg('A', 'level8.js:pointerdown', 'pointerdown trên thẻ app', {
                    app: card.dataset.app,
                    pointerId: e.pointerId,
                    hasPointerCapture: (typeof card.setPointerCapture === 'function') ? card.hasPointerCapture(e.pointerId) : 'unsupported',
                });
                // #endregion
                activePointerCard = card;
                startX = e.clientX;
                startY = e.clientY;
                isDragging = false;
            });

            card.addEventListener('pointermove', (e) => {
                if (!activePointerCard) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Ngưỡng kéo >= 8px chống nuốt chạm khi tay hơi rung
                if (dist >= CONFIG.DRAG_THRESHOLD_PX) {
                    isDragging = true;
                    suppressClick = true;
                    card.classList.add('bt-app-dragged');
                    card.style.transform = `translate(${dx}px, ${dy}px)`;

                    // Kiểm tra chạm thùng rác
                    const trashRect = trashArea.getBoundingClientRect();
                    const isOverTrash = (
                        e.clientX >= trashRect.left &&
                        e.clientX <= trashRect.right &&
                        e.clientY >= trashRect.top &&
                        e.clientY <= trashRect.bottom
                    );
                    trashArea.classList.toggle('bt-trash-hover', isOverTrash);
                }
            });

            card.addEventListener('pointerup', (e) => {
                // #region agent log
                _dbg('A', 'level8.js:pointerup', 'pointerup trên thẻ app', {
                    app: card.dataset.app,
                    pointerId: e.pointerId,
                    isDragging,
                    hasActiveCard: !!activePointerCard,
                    activeApp: activePointerCard ? activePointerCard.dataset.app : null,
                    stillHasDragClass: card.classList.contains('bt-app-dragged'),
                    transform: card.style.transform || '',
                });
                // #endregion
                if (!activePointerCard) return;

                if (isDragging) {
                    const trashRect = trashArea.getBoundingClientRect();
                    const isOverTrash = (
                        e.clientX >= trashRect.left &&
                        e.clientX <= trashRect.right &&
                        e.clientY >= trashRect.top &&
                        e.clientY <= trashRect.bottom
                    );

                    card.classList.remove('bt-app-dragged');
                    card.style.transform = '';
                    trashArea.classList.remove('bt-trash-hover');

                    if (isOverTrash) {
                        _handleTrashApp(card.dataset.app, card);
                    }

                    setTimeout(() => { suppressClick = false; }, 50);
                } else if (!suppressClick) {
                    // CHẠM CHỌN (1 chạm)
                    sound.init();
                    sound.playTick();
                    _selectAppCard(card);
                }

                activePointerCard = null;
                isDragging = false;
            });

            // #region agent log
            // pointerup/pointercancel có thể KHÔNG bắn trên thẻ khi con trỏ rời thẻ (kéo ra ngoài)
            // → phải ghi nhận để chứng minh giả thuyết A (mất pointerup → kẹt trạng thái).
            card.addEventListener('lostpointercapture', () => {
                _dbg('A', 'level8.js:lostpointercapture', 'lostpointercapture phát sinh', {
                    app: card.dataset.app,
                    isDragging,
                    hasActiveCard: !!activePointerCard,
                    stillHasDragClass: card.classList.contains('bt-app-dragged'),
                });
            });
            // #endregion
        });

        // Chạm vào thùng rác sau khi đã chọn app (Cách chính bước 2)
        trashArea.addEventListener('click', () => {
            if (!level8State.station3.selectedApp) {
                sound.init();
                sound.playSoftBip();
                _setBipText('st3-bip-text', 'Con hãy chạm chọn 1 app nhái trước, rồi chạm vào thùng rác nhé!');
                return;
            }

            const appType = level8State.station3.selectedApp.dataset.app;
            _handleTrashApp(appType, level8State.station3.selectedApp);
        });
    }

    function _selectAppCard(card) {
        document.querySelectorAll('.bt-app-card').forEach(c => c.classList.remove('bt-app-selected'));
        if (level8State.station3.selectedApp === card) {
            level8State.station3.selectedApp = null;
        } else {
            level8State.station3.selectedApp = card;
            card.classList.add('bt-app-selected');
            _setBipText('st3-bip-text', `Đã chọn <b>${card.querySelector('.bt-app-title')?.textContent || 'App'}</b>. Giờ hãy chạm vào thùng rác 🗑️ để bỏ nhé!`);
        }
    }

    function _handleTrashApp(appType, cardEl) {
        level8State.station3.attempts++;
        // #region agent log
        _dbg('C', 'level8.js:_handleTrashApp', 'Nhận app vào thùng rác', {
            appType,
            attempts: level8State.station3.attempts,
            slipsBefore: level8State.slips,
            trashedCount: level8State.station3.trashedApps.size,
        });
        // #endregion

        if (appType === 'safe') {
            // NÉM NHẦM APP XỊN VÀO THÙNG RÁC
            level8State.slips++;
            sound.playIncorrectCatch();
            _setBipText('st3-bip-text', 'App Trường Học Số được tải từ cửa hàng chính thức và an toàn mà con!');

            // Hiệu ứng rung và trả lại chỗ cũ
            cardEl.style.transform = 'translateX(-10px)';
            setTimeout(() => { cardEl.style.transform = 'translateX(10px)'; }, 100);
            setTimeout(() => { cardEl.style.transform = ''; }, 200);
            cardEl.classList.remove('bt-app-selected');
            level8State.station3.selectedApp = null;
        } else {
            // NÉM ĐÚNG APP NHÁI
            sound.playTrashPop();
            cardEl.classList.add('hidden');
            cardEl.classList.remove('bt-app-selected');
            level8State.station3.selectedApp = null;
            level8State.station3.trashedApps.add(appType);

            _updateTrashCounter();

            if (level8State.station3.trashedApps.size === 3) {
                // HOÀN THÀNH TRẠM 3
                sound.playCorrectCatch();
                try { confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } }); } catch (e) {}
                _setBipText('st3-bip-text', 'Xuất sắc! Con đã dọn sạch 3 app nhái độc hại và giữ lại app an toàn!');

                level8State.spheres[2] = true;
                setTimeout(() => {
                    _showMapStage();
                }, 1800);
            } else {
                _setBipText('st3-bip-text', 'Đúng rồi! Hãy tiếp tục dọn các app nhái còn lại nhé con!');
            }
        }
    }

    // =========================================================================
    // 11. TRẬN ĐẤU TRÙM: VUA ĐỘC HẠI
    // =========================================================================

    function _startBossBattle() {
        level8State.currentStation = 'boss';
        FreezeFrame.crossfade(() => {
            switchStage('boss');
            _resetBossUI();
            _startIdleTimer(() => {
                _setBipText('boss-bip-bubble', 'Bấm nhanh vào Khiên nhé con!');
            }, CONFIG.BOSS_IDLE_HINT_MS);
        });
    }

    function _resetBossUI() {
        level8State.boss.clicks = 0;
        level8State.boss.defeated = false;
        level8State.boss.lastClickTime = 0;

        const hpFill = document.getElementById('boss-hp-fill');
        const hpText = document.getElementById('boss-hp-text');
        const counter = document.getElementById('boss-click-counter');
        const monster = document.getElementById('boss-monster');
        const lid = document.getElementById('boss-jar-lid');

        if (hpFill) hpFill.style.width = '100%';
        if (hpText) hpText.textContent = 'Năng Lượng: 100%';
        if (counter) counter.textContent = `0 / ${CONFIG.BOSS_CLICKS_NEEDED}`;
        if (monster) {
            monster.style.transform = 'scale(1)';
            monster.style.opacity = '1';
        }
        if (lid) lid.textContent = 'NẮP MỞ';

        _setBipText('boss-bip-bubble', '3 Mảnh Cầu đã hợp nhất thành Khiên Ánh Sáng! <b>Con hãy bấm liên tục vào Khiên</b> để phong ấn hắn nhé!');
    }

    function _wireBossBattle() {
        const shieldBtn = document.getElementById('btn-boss-shield');
        const beamTrack = document.getElementById('boss-beam-track');

        const handleShieldPress = (e) => {
            if (e) e.preventDefault();
            sound.init();

            if (level8State.boss.defeated) return;

            const now = Date.now();
            // Điều tiết hiệu ứng chùm sáng (tối đa 1 chùm / 80ms, không nhấp nháy > 3 lần/s)
            if (now - level8State.boss.lastClickTime < CONFIG.THROTTLE_BEAM_MS) {
                // #region agent log
                _dbg('E', 'level8.js:boss-throttle', 'Bấm bị throttle (không tính vào điểm)', {
                    clicks: level8State.boss.clicks,
                    needed: CONFIG.BOSS_CLICKS_NEEDED,
                    sinceLastMs: now - level8State.boss.lastClickTime,
                    throttleMs: CONFIG.THROTTLE_BEAM_MS,
                });
                // #endregion
                return;
            }
            level8State.boss.lastClickTime = now;

            level8State.boss.clicks++;
            sound.playBeamHit();

            // Hiệu ứng chùm sáng
            if (beamTrack) {
                beamTrack.classList.remove('bt-beam-active');
                void beamTrack.offsetWidth; // trigger reflow
                beamTrack.classList.add('bt-beam-active');
            }

            const needed = CONFIG.BOSS_CLICKS_NEEDED;
            const clicks = Math.min(level8State.boss.clicks, needed);
            const remainingPct = Math.max(0, Math.round((1 - clicks / needed) * 100));

            const hpFill = document.getElementById('boss-hp-fill');
            const hpText = document.getElementById('boss-hp-text');
            const counter = document.getElementById('boss-click-counter');
            const monster = document.getElementById('boss-monster');

            if (hpFill) hpFill.style.width = `${remainingPct}%`;
            if (hpText) hpText.textContent = `Năng Lượng: ${remainingPct}%`;
            if (counter) counter.textContent = `${clicks} / ${needed}`;

            // Quái vật thu nhỏ dần theo số lần bấm
            const scale = Math.max(0.2, 1 - (clicks / needed) * 0.7);
            if (monster) monster.style.transform = `scale(${scale})`;

            // ĐỦ 20 LẦN BẤM -> CHIẾN THẮNG
            if (clicks >= needed) {
                level8State.boss.defeated = true;
                _finishBossBattle();
            }
        };

        if (shieldBtn) {
            shieldBtn.addEventListener('pointerdown', handleShieldPress);
        }

        // Hỗ trợ cả phím Space và Enter
        window.addEventListener('keydown', (e) => {
            if (level8State.currentStage === 'boss' && (e.key === ' ' || e.key === 'Enter')) {
                handleShieldPress(e);
            }
        });
    }

    function _finishBossBattle() {
        const monster = document.getElementById('boss-monster');
        const lid = document.getElementById('boss-jar-lid');

        if (monster) {
            monster.style.transition = 'all 0.8s ease-in';
            monster.style.transform = 'translateY(120px) scale(0.1)';
            monster.style.opacity = '0';
        }

        sound.playVictoryChime();
        try {
            confetti({ particleCount: 80, spread: 80, origin: { y: 0.5 } });
        } catch (e) {}

        setTimeout(() => {
            if (lid) lid.textContent = '🔒 ĐÃ KHÓA CHẶT';
            _setBipText('boss-bip-bubble', 'Vua Độc Hại đã bị nhốt vào lọ thủy tinh! Thành Phố Số đã an toàn!');
        }, 800);

        setTimeout(() => {
            _playScene('outro');
        }, 2200);
    }

    // =========================================================================
    // 12. SUMMARY & STARS / XP CALCULATION
    // =========================================================================

    function _computeStats() {
        const slips = level8State.slips;
        let stars = 3;
        let xp = 30;

        if (slips <= 1) {
            stars = 3;
            xp = 30;
        } else if (slips <= 3) {
            stars = 2;
            xp = 20;
        } else {
            stars = 1;
            xp = 10;
        }

        // #region agent log
        _dbg('D', 'level8.js:_computeStats', 'Tính sao/XP từ số lần trượt', {
            slips, stars, xp,
            breakdown: {
                st1_attempts: level8State.station1.attempts,
                st2_attempts: level8State.station2.attempts,
                st3_attempts: level8State.station3.attempts,
            },
        });
        // #endregion

        return { slips, stars, xp };
    }

    function _showSummaryStage() {
        sound.init();
        FreezeFrame.crossfade(() => {
            switchStage('summary');
            _renderSummary();
            sound.playVictoryChime();
            try {
                confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
            } catch (e) {}
        });
    }

    function _renderSummary() {
        const container = document.getElementById('summary-card-container');
        if (!container) return;

        const stats = _computeStats();
        const starsHtml = '⭐'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars);

        // Escape string an toàn nếu có biến
        const safeBadge = typeof window.escapeHtml === 'function'
            ? window.escapeHtml(CONFIG.BADGE_NAME)
            : CONFIG.BADGE_NAME;

        container.innerHTML = `
            <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png"
                 alt="CyberKnight" class="summary-logo">
            <div class="summary-icon-badge">🛡️</div>
            <h2 class="summary-title">LEVEL 8 COMPLETED!</h2>
            <div class="summary-stars">${starsHtml}</div>

            <div class="summary-reward-box">
                <span class="summary-reward-xp">⭐ +${stats.xp} XP</span>
                <span class="summary-reward-badge">🏅 ${safeBadge}</span>
            </div>

            <hr class="summary-divider">

            <!-- 4 BÍ KÍP HIỆP SĨ SỐ (Mỗi ý <= 8 từ, 1 emoji) -->
            <div class="bt-summary-formula-grid">
                <div class="bt-summary-formula-card">
                    <span class="bt-formula-icon">🔗</span>
                    <span class="bt-formula-text">Không bấm link lạ</span>
                </div>
                <div class="bt-summary-formula-card">
                    <span class="bt-formula-icon">📱</span>
                    <span class="bt-formula-text">Không tải app rởm</span>
                </div>
                <div class="bt-summary-formula-card">
                    <span class="bt-formula-icon">🖼️</span>
                    <span class="bt-formula-text">Không tin ảnh AI</span>
                </div>
                <div class="bt-summary-formula-card">
                    <span class="bt-formula-icon">👨‍👩‍👧</span>
                    <span class="bt-formula-text">Luôn hỏi ý kiến Bố Mẹ</span>
                </div>
            </div>

            <!-- BẰNG KHEN DANH DỰ GỌN GÀNG (Không hiển thị hay hỏi tên trẻ) -->
            <div class="bt-diploma-card">
                <div class="bt-diploma-seal">🎖️</div>
                <div class="bt-diploma-info">
                    <div class="bt-diploma-title">BẰNG KHEN HIỆP SĨ AN TOÀN SỐ</div>
                    <div class="bt-diploma-sub">Đã xuất sắc vượt qua 3 Trạm Thử Thách và phong ấn Vua Độc Hại!</div>
                </div>
            </div>

            <!-- 2 Nút hành động (luôn nhìn thấy được mà không cần cuộn) -->
            <div class="summary-actions">
                <button id="btn-summary-replay" class="btn-summary-replay" type="button" aria-label="Chơi lại level 8">🔄 Chơi lại</button>
                <button id="btn-summary-continue" class="btn-summary-continue" type="button" aria-label="Tiếp tục hành trình">Tiếp tục hành trình ▶</button>
            </div>
        `;

        document.getElementById('btn-summary-replay')?.addEventListener('click', _replayLevel8);
        document.getElementById('btn-summary-continue')?.addEventListener('click', () => {
            TopBar.exitLevel();
        });

        // Phát sự kiện hoàn thành màn chơi ra window
        window.dispatchEvent(new CustomEvent('level8:complete', {
            detail: {
                slips: stats.slips,
                stars: stats.stars,
                xp: stats.xp,
                badge: CONFIG.BADGE_NAME
            }
        }));
    }

    function _replayLevel8() {
        sound.init();
        sound.playTick();
        _clearAllTimers();

        // Reset state sạch sẽ 100%
        level8State.slips = 0;
        level8State.spheres = [false, false, false];
        level8State.currentStation = null;
        level8State.currentScene = null;
        level8State.magnifyMode = false;
        level8State.zoomed = false;
        level8State.station1 = { scanned: false, answered: false, attempts: 0 };
        level8State.station2 = { attempts: 0, answered: false };
        level8State.station3 = { selectedApp: null, trashedApps: new Set(), attempts: 0, completed: false };
        level8State.boss = { clicks: 0, defeated: false, lastClickTime: 0 };

        _sceneEnded.intro = false;
        _sceneEnded.outro = false;

        resetAllVideos();
        _showMapStage();
    }

    // =========================================================================
    // 13. BOOTSTRAP & DEBUG SKIP FLAGS
    // =========================================================================

    function _initDebugSkip() {
        const params = new URLSearchParams(window.location.search);
        const skip = params.get('skip');

        if (!skip) return false;

        const startOverlay = document.getElementById('start-overlay');
        if (startOverlay) startOverlay.classList.add('hidden');

        switch (skip) {
            case 'intro':
                _playScene('intro');
                return true;
            case 'map':
                _showMapStage();
                return true;
            case 'st1':
                _startStation1();
                return true;
            case 'st2':
                level8State.spheres[0] = true;
                _startStation2();
                return true;
            case 'st3':
                level8State.spheres[0] = true;
                level8State.spheres[1] = true;
                _startStation3();
                return true;
            case 'boss':
                level8State.spheres = [true, true, true];
                _startBossBattle();
                return true;
            case 'outro':
                _playScene('outro');
                return true;
            case 'summary-first':
                level8State.slips = 0;
                _showSummaryStage();
                return true;
            case 'summary-retry':
                level8State.slips = 2;
                _showSummaryStage();
                return true;
            case 'summary':
                level8State.slips = 0;
                _showSummaryStage();
                return true;
            default:
                return false;
        }
    }

    function init() {
        FreezeFrame.init();
        TopBar.init();
        _wireMapNodes();
        _wireStation1();
        _wireStation2();
        _wireStation3();
        _wireBossBattle();

        const startBtn = document.getElementById('btn-start-level');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                const startOverlay = document.getElementById('start-overlay');
                if (startOverlay) startOverlay.classList.add('hidden');
                _playScene('intro');
            });
        }

        // Bắt đầu dò tài nguyên nền
        _probeResourceBase();

        // Xử lý cờ ?skip= nếu có
        const skipped = _initDebugSkip();
        if (!skipped) {
            // Mặc định hiện start overlay
            const startOverlay = document.getElementById('start-overlay');
            if (startOverlay) startOverlay.classList.remove('hidden');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
