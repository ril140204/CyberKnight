/**
 * CYBERKNIGHT — LEVEL 2: "KẾT BẠN ONLINE — NGƯỜI BẠN MỚI" (GHÉP CỬA BẢO VỆ CĂN CỨ)
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth & 2-Branch Engine
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. STATE MACHINE & CONFIGURATION
    // =========================================================================

    const CONFIG = {
        TRANSITION_MS: 500,
        OUTRO_FALLBACK_TIMEOUT_MS: 60000,
        VIDEO_PATHS: {
            intro: [
                // Tên file thực tế trong thư mục (Tiếng Việt có dấu)
                '../video/level 2/gioi thieu.mp4',
                '../../video/level 2/gioi thieu.mp4',
                'video/level 2/gioi thieu.mp4',
                '/video/level 2/gioi thieu.mp4',
                // Fallback tên tiếng Anh (nếu user đổi tên)
                '../video/level 2/intro.mp4',
                '../../video/level 2/intro.mp4',
                'video/level 2/intro.mp4',
                '/video/level 2/intro.mp4'
            ],
            bad: [
                // Tên file thực tế trong thư mục (Tiếng Việt không dấu)
                '../video/level 2/hau qua xau.mp4',
                '../../video/level 2/hau qua xau.mp4',
                'video/level 2/hau qua xau.mp4',
                '/video/level 2/hau qua xau.mp4',
                // Fallback tên tiếng Anh
                '../video/level 2/bad.mp4',
                '../../video/level 2/bad.mp4',
                'video/level 2/bad.mp4',
                '/video/level 2/bad.mp4'
            ],
            good: [
                // Tên file thực tế trong thư mục (Tiếng Việt không dấu)
                '../video/level 2/hau qua tot.mp4',
                '../../video/level 2/hau qua tot.mp4',
                'video/level 2/hau qua tot.mp4',
                '/video/level 2/hau qua tot.mp4',
                // Fallback tên tiếng Anh
                '../video/level 2/good.mp4',
                '../../video/level 2/good.mp4',
                'video/level 2/good.mp4',
                '/video/level 2/good.mp4'
            ]
        }
    };

    const State = {
        currentStage: 'intro',
        chosenPath: null,
        lockedCount: 0
    };

    // =========================================================================
    // 2. SYNTHESIZED WEB AUDIO CONTROLLER (100% Offline, Zero external MP3)
    // =========================================================================

    class AudioSynth {
        constructor() {
            this.ctx = null;
        }

        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.ctx = new AudioCtx();
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
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
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.05);
        }

        playCorrectCatch(combo) {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const baseFreq = 523.25;
            const pitchMultiplier = Math.min(2.0, 1 + (combo - 1) * 0.12);
            const freq = baseFreq * pitchMultiplier;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.33, now + 0.18);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.28);
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
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.16);
        }

        playCatchMiss() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.linearRampToValueAtTime(200, now + 0.12);
            gain.gain.setValueAtTime(0.04, now);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        }

        playScanHum() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(320, this.ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(560, this.ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.08);
        }

        playChatPop() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(850, now + 0.06);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.06);
        }

        playClueFound() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [659.25, 987.77].forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.1);
                gain.gain.setValueAtTime(0.16, now + idx * 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.1);
                osc.stop(now + idx * 0.1 + 0.35);
            });
        }

        playDangerAlert() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [0, 0.16, 0.32].forEach((offset, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(idx % 2 === 0 ? 880 : 660, now + offset);
                gain.gain.setValueAtTime(0.2, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.14);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + offset);
                osc.stop(now + offset + 0.14);
            });
        }

        playGlitchExplosion() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const bufferSize = this.ctx.sampleRate * 0.4;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(80, now + 0.4);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start(now);
            noise.stop(now + 0.4);
        }

        playThoughtfulChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [349.23, 440.00, 523.25];
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + idx * 0.09);
                gain.gain.setValueAtTime(0.15, now + idx * 0.09);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.45);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.09);
                osc.stop(now + idx * 0.09 + 0.45);
            });
        }

        playVictoryChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                gain.gain.setValueAtTime(0.18, now + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.4);
            });
        }

        // =========================================================================
        // NEW: Tiếng "chốt khóa" chắc chắn khi ghép đúng
        // 2 oscillator sawtooth tần số thấp (110Hz + 165Hz) + 1 click ngắn 800Hz, envelope 80ms
        // =========================================================================
        playLockSnap() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // Oscillator 1: Sawtooth 110Hz (bass thấp)
            const osc1 = this.ctx.createOscillator();
            const gain1 = this.ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(110, now);
            gain1.gain.setValueAtTime(0.22, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc1.connect(gain1);
            gain1.connect(this.ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.08);

            // Oscillator 2: Sawtooth 165Hz (harmonics)
            const osc2 = this.ctx.createOscillator();
            const gain2 = this.ctx.createGain();
            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(165, now);
            gain2.gain.setValueAtTime(0.14, now);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc2.connect(gain2);
            gain2.connect(this.ctx.destination);
            osc2.start(now);
            osc2.stop(now + 0.08);

            // Oscillator 3: Sine 800Hz click ngắn (điểm "tách")
            const osc3 = this.ctx.createOscillator();
            const gain3 = this.ctx.createGain();
            osc3.type = 'sine';
            osc3.frequency.setValueAtTime(800, now);
            osc3.frequency.exponentialRampToValueAtTime(400, now + 0.05);
            gain3.gain.setValueAtTime(0.18, now);
            gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
            osc3.connect(gain3);
            gain3.connect(this.ctx.destination);
            osc3.start(now);
            osc3.stop(now + 0.06);
        }

        // =========================================================================
        // NEW: Tiếng "bật nhẹ" khi ghép sai
        // 1 oscillator triangle 300Hz giảm xuống 180Hz trong 120ms, volume thấp 0.08
        // =========================================================================
        playLockBounce() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        }

        // =========================================================================
        // NEW: Tiếng "từ chối" khi piece decoy bị đặt sai ô — buzz ngắn 220Hz
        // square wave, pitch drop + noise burst, envelope 150ms
        // =========================================================================
        playPieceReject() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;

            // Oscillator 1: Square 220Hz → 110Hz (buzz giảm pitch)
            const osc1 = this.ctx.createOscillator();
            const gain1 = this.ctx.createGain();
            osc1.type = 'square';
            osc1.frequency.setValueAtTime(220, now);
            osc1.frequency.exponentialRampToValueAtTime(110, now + 0.15);
            gain1.gain.setValueAtTime(0.1, now);
            gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc1.connect(gain1);
            gain1.connect(this.ctx.destination);
            osc1.start(now);
            osc1.stop(now + 0.15);
        }
    }

    const sound = new AudioSynth();

    // =========================================================================
    // 3. STOP ALL VIDEOS (Dừng triệt để mọi video & audio)
    // =========================================================================

    function stopAllVideos() {
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
            try {
                v.pause();
                v.currentTime = 0;
            } catch (e) {
                console.warn('stopVideo notice:', e);
            }
        });
        // ParticleSystem đã lược bỏ — không cần stop animation loop
    }

    // =========================================================================
    // 4. FREEZE-FRAME CROSSFADE (Không bao giờ để màn hình đen)
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
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);
                return true;
            } catch (err) {
                console.warn('Freeze frame capture notice:', err.message);
                return false;
            }
        },

        captureGradientBackground() {
            if (!this.ctx) return false;
            try {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
                grad.addColorStop(0, '#0a0e27');
                grad.addColorStop(1, '#050816');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                return true;
            } catch (err) {
                return false;
            }
        },

        async crossfade(prepareNewStageCallback) {
            if (!this.canvas) {
                if (prepareNewStageCallback) prepareNewStageCallback();
                return;
            }

            this.canvas.style.opacity = '1';
            await new Promise(r => setTimeout(r, 60));

            if (prepareNewStageCallback) {
                prepareNewStageCallback();
            }

            await new Promise(r => setTimeout(r, 120));
            this.canvas.style.opacity = '0';
        }
    };

    // =========================================================================
    // 5. TOP BAR CONTROLLER
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
                    if (State.currentStage === 'intro') {
                        VideoController.onIntroNearEnd();
                    } else if (State.currentStage === 'outro') {
                        VideoController.onOutroEnded();
                    }
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
                if (e.key === 'Escape') {
                    this.exitLevel();
                }
            });
        },

        updateVisibility(stage) {
            if (!this.skipBtn) return;
            if (stage === 'intro' || stage === 'outro') {
                this.skipBtn.classList.remove('hidden');
            } else {
                this.skipBtn.classList.add('hidden');
            }
        },

        exitLevel() {
            stopAllVideos();
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) {
                console.warn('postMessage error:', err);
            }
            window.location.href = '../index.html';
        }
    };

    // =========================================================================
    // 6. VIDEO CONTROLLER (Mở đầu & Rẽ 2 nhánh: open / closed)
    // =========================================================================

    const VideoController = {
        introVideo: null,
        outroVideo: null,
        preloadBad: null,
        preloadGood: null,
        introEndHandlerTriggered: false,

        init() {
            this.introVideo = document.getElementById('video-intro');
            this.outroVideo = document.getElementById('video-outro');
            this.preloadBad = document.getElementById('preload-bad');
            this.preloadGood = document.getElementById('preload-good');

            this.setupVideoFallback(this.introVideo, CONFIG.VIDEO_PATHS.intro);
            this.setupVideoFallback(this.preloadBad, CONFIG.VIDEO_PATHS.bad);
            this.setupVideoFallback(this.preloadGood, CONFIG.VIDEO_PATHS.good);

            if (this.introVideo) {
                this.introVideo.addEventListener('timeupdate', () => {
                    if (this.introVideo.duration && !this.introEndHandlerTriggered) {
                        const remaining = this.introVideo.duration - this.introVideo.currentTime;
                        if (remaining <= 0.45) {
                            this.introEndHandlerTriggered = true;
                            this.onIntroNearEnd();
                        }
                    }
                });

                this.introVideo.addEventListener('ended', () => {
                    if (!this.introEndHandlerTriggered) {
                        this.introEndHandlerTriggered = true;
                        this.onIntroNearEnd();
                    }
                });
            }

            if (this.outroVideo) {
                this.outroVideo.addEventListener('ended', () => {
                    this.onOutroEnded();
                });
            }
        },

        tryLoadWithFallback(videoEl, pathList, onSuccess, onAllFailed) {
            if (!videoEl || !pathList || pathList.length === 0) {
                if (onAllFailed) onAllFailed();
                return;
            }

            const HARD_TIMEOUT_MS = 3000;
            let loadTimeoutId = null;
            let currentIdx = 0;
            let isResolved = false;

            const resolve = (fn) => {
                if (isResolved) return;
                isResolved = true;
                if (loadTimeoutId) clearTimeout(loadTimeoutId);
                fn();
            };

            const tryNext = () => {
                if (currentIdx >= pathList.length) {
                    resolve(() => {
                        console.warn('Tất cả đường dẫn dự phòng đều thất bại');
                        if (onAllFailed) onAllFailed();
                    });
                    return;
                }

                const currentPath = pathList[currentIdx];
                console.log(`Dang thu path [${currentIdx + 1}/${pathList.length}]: ${currentPath}`);

                videoEl.removeAttribute('src');
                videoEl.load();
                videoEl.src = currentPath;
                videoEl.load();

                loadTimeoutId = setTimeout(() => {
                    console.warn(`Timeout [${currentIdx + 1}] — chuyen path tiep theo`);
                    handleError();
                }, HARD_TIMEOUT_MS);
            };

            const handleSuccess = () => {
                resolve(() => {
                    videoEl.removeEventListener('loadeddata', handleSuccess);
                    videoEl.removeEventListener('canplay', handleSuccess);
                    videoEl.removeEventListener('error', handleError);
                    console.log(`Load thanh cong: ${pathList[currentIdx]}`);
                    if (onSuccess) onSuccess();
                });
            };

            const handleError = () => {
                if (isResolved) return;
                videoEl.removeEventListener('loadeddata', handleSuccess);
                videoEl.removeEventListener('canplay', handleSuccess);
                videoEl.removeEventListener('error', handleError);
                if (loadTimeoutId) clearTimeout(loadTimeoutId);
                currentIdx++;
                tryNext();
            };

            videoEl.addEventListener('loadeddata', handleSuccess, { once: true });
            videoEl.addEventListener('canplay', handleSuccess, { once: true });
            videoEl.addEventListener('error', handleError, { once: true });

            tryNext();
        },

        setupVideoFallback(videoEl, pathList) {
            if (!videoEl || !pathList || pathList.length === 0) return;
            videoEl.src = pathList[0];
            videoEl.addEventListener('error', () => {
                console.warn(`Preload fallback triggered for video src: ${pathList[0]}`);
            });
        },

        playIntro() {
            stopAllVideos();
            if (!this.introVideo) return;
            this.introEndHandlerTriggered = false;
            this.setupVideoFallback(this.introVideo, CONFIG.VIDEO_PATHS.intro);
            this.introVideo.currentTime = 0;
            const playPromise = this.introVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    console.log('Autoplay video intro choi nguoi dung');
                });
            }
        },

        onIntroNearEnd() {
            FreezeFrame.captureFromVideo(this.introVideo);
            if (this.introVideo) this.introVideo.pause();

            FreezeFrame.crossfade(() => {
                switchStage('game');
                DoorPuzzleScene.start();
            });
        },

        playOutro(path) {
            this._outroEnded = false;
            stopAllVideos();

            console.log('Playing outro for path:', path);

            switchStage('outro');

            if (this.outroVideo) {
                void this.outroVideo.offsetHeight;
                this.outroVideo.style.display = '';
            }

            clearTimeout(this._outroFallbackTimer);
            this._outroFallbackTimer = setTimeout(() => {
                if (this._outroEnded) return;
                const hasStartedPlaying = this.outroVideo && this.outroVideo.currentTime > 0.1;
                if (hasStartedPlaying) {
                    console.log('Video da phat > 0.1s, khong fallback');
                    return;
                }
                console.warn('Outro timeout — video khong load duoc');
                this.showFallbackScene(path);
            }, CONFIG.OUTRO_FALLBACK_TIMEOUT_MS);

            if (this._outroErrorHandler) {
                this.outroVideo.removeEventListener('error', this._outroErrorHandler);
                this._outroErrorHandler = null;
            }

            const branchPaths = path === 'open' ? CONFIG.VIDEO_PATHS.bad : CONFIG.VIDEO_PATHS.good;

            const cancelFallbackOnReady = () => {
                if (this.outroVideo) {
                    this.outroVideo.removeEventListener('loadeddata', cancelFallbackOnReady);
                    this.outroVideo.removeEventListener('canplay', cancelFallbackOnReady);
                }
                clearTimeout(this._outroFallbackTimer);
                console.log('Video san sang phat — da huy fallback timeout');
            };
            if (this.outroVideo) {
                this.outroVideo.addEventListener('loadeddata', cancelFallbackOnReady, { once: true });
                this.outroVideo.addEventListener('canplay', cancelFallbackOnReady, { once: true });
            }

            const startPlay = () => {
                if (!this.outroVideo || this._outroEnded) return;
                this.outroVideo.currentTime = 0;

                OutroFallbackScene.hide();

                let timeUpdateFallbackTriggered = false;
                const checkVideoEnded = () => {
                    if (this._outroEnded || timeUpdateFallbackTriggered) return;
                    if (this.outroVideo && this.outroVideo.duration && this.outroVideo.currentTime > 0) {
                        const remaining = this.outroVideo.duration - this.outroVideo.currentTime;
                        if (remaining <= 0.5 && !this.outroVideo.paused) {
                            timeUpdateFallbackTriggered = true;
                            this.outroVideo.removeEventListener('timeupdate', checkVideoEnded);
                            console.log('Video timeupdate fallback: gan ket thuc');
                            this.onOutroEnded();
                        }
                    }
                };
                this.outroVideo.addEventListener('timeupdate', checkVideoEnded);

                const playPromise = this.outroVideo.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        clearTimeout(this._outroFallbackTimer);
                        console.log('Video da phat — fallback timeout huy');
                    }).catch(e => {
                        console.warn('Outro video play error:', e.message);
                        setTimeout(() => {
                            if (this._outroEnded || !this.outroVideo) return;
                            this.outroVideo.play().then(() => {
                                clearTimeout(this._outroFallbackTimer);
                            }).catch(err => {
                                console.error('Khong the play video:', err.message);
                                if (!this._outroEnded) {
                                    this.showFallbackScene(path);
                                }
                            });
                        }, 500);
                    });
                }
            };

            const showFallbackImmediately = (reason) => {
                console.warn(`${reason} — dung fallback scene`);
                clearTimeout(this._outroFallbackTimer);
                setTimeout(() => this.showFallbackScene(path), 100);
            };

            this.tryLoadWithFallback(
                this.outroVideo,
                branchPaths,
                () => {
                    console.log(`Video load xong cho path: ${path}`);
                    startPlay();
                },
                () => {
                    showFallbackImmediately('Tat ca duong dan deu that bai');
                }
            );
        },

        showFallbackScene(path) {
            if (this._outroEnded) return;
            this._outroEnded = true;
            clearTimeout(this._outroFallbackTimer);

            if (this.outroVideo) {
                try { this.outroVideo.pause(); } catch (e) {}
                this.outroVideo.style.display = 'none';
            }

            OutroFallbackScene.show(path, () => {
                this.onOutroEnded();
            });
        },

        onOutroEnded() {
            console.log('onOutroEnded() triggered - path:', State.chosenPath);
            if (this._outroEnded) {
                console.log('onOutroEnded da goi, bo qua');
                return;
            }
            this._outroEnded = true;
            clearTimeout(this._outroFallbackTimer);

            if (this.outroVideo) {
                try { this.outroVideo.pause(); } catch (e) {}
                if (this._outroErrorHandler) {
                    this.outroVideo.removeEventListener('error', this._outroErrorHandler);
                    this._outroErrorHandler = null;
                }
            }

            console.log('Calling switchStage("summary") and SummaryScene.render()');
            switchStage('summary');
            SummaryScene.render(State.chosenPath);
        }
    };

    // =========================================================================
    // 7. DOOR PUZZLE SCENE (Mini-game ghép cửa — BÊN TRONG level2.js)
    // =========================================================================

    // =========================================================================
    // 7B. DOOR PUZZLE SCENE — Thin wrapper quanh DoorPuzzleGame module
    // =========================================================================
    // Toàn bộ logic drag-drop / magnetic / shake / confetti đã được đóng gói
    // trong `door-puzzle.js` (DoorPuzzleEngine / DoorPuzzleGame). Scene này chỉ
    // làm nhiệm vụ:
    //   • Khởi tạo engine với CSS class overrides để khớp với level2.css
    //   • Kết nối callbacks (onComplete → showDecisionScreen, …)
    //   • Cập nhật State.lockedCount + phát âm thanh
    //   • Duy trì API cũ (init / start / showDecisionScreen) để level2.js gọi

    const DoorPuzzleScene = {
        engine: null,
        decisionWrapper: null,
        btnDecisionOpen: null,
        btnDecisionClosed: null,
        isCompleted: false,

        init() {
            if (typeof window.DoorPuzzleGame !== 'function') {
                console.error('[DoorPuzzleScene] DoorPuzzleGame module chưa được load. Kiểm tra thứ tự <script> trong level2.html.');
                return;
            }

            this.decisionWrapper = document.getElementById('decision-screen-wrapper');
            this.btnDecisionOpen = document.getElementById('btn-decision-open');
            this.btnDecisionClosed = document.getElementById('btn-decision-closed');

            this.setupDecisionButtons();

            // Khởi tạo engine 1 lần; gắn vào #door-puzzle-container
            this.engine = new window.DoorPuzzleGame('#door-puzzle-container', {
                slotCount: 3,
                onPieceCorrect: (piece, slotIdx) => this._handlePieceCorrect(piece, slotIdx),
                onPieceIncorrect: (piece) => this._handlePieceIncorrect(piece),
                onComplete: (stats) => this._handleComplete(stats)
                // CSS classes: dùng DEFAULT của DoorPuzzleGame để khớp
                // với selectors đã rewrite trong level2.css (.dp-*).
                // KHÔNG override classes ở đây — để mặc định dp-piece,
                // dp-slot, dp-complete-card, dp-confetti-canvas, ...
            });
        },

        // ---------------------------------------------------------------------
        // Callbacks nối vào engine
        // ---------------------------------------------------------------------

        _handlePieceCorrect(piece, slotIdx) {
            // Phát âm thanh "khóa vào"
            if (typeof sound !== 'undefined' && sound.playLockSnap) {
                sound.playLockSnap();
            }
            // Cập nhật State dùng chung cho summary / debug
            State.lockedCount = (State.lockedCount || 0) + 1;
        },

        _handlePieceIncorrect(piece) {
            // Phát âm thanh "bị từ chối"
            if (typeof sound !== 'undefined' && sound.playPieceReject) {
                sound.playPieceReject();
            }
        },

        _handleComplete(stats) {
            this.isCompleted = true;

            // Phát chiêng chiến thắng
            if (typeof sound !== 'undefined' && sound.playVictoryChime) {
                sound.playVictoryChime();
            }

            // Confetti (sử dụng canvas-confetti CDN đã load)
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 100,
                    spread: 80,
                    origin: { y: 0.6 }
                });
            }

            // Cộng XP thưởng (nếu có hệ XP — State.xp được khai báo tùy project)
            if (typeof State !== 'undefined' && typeof State.xp === 'number') {
                State.xp += 50;
            }

            // Sau 2.5s → chuyển sang màn hình quyết định
            setTimeout(() => this.showDecisionScreen(), 2500);
        },

        // ---------------------------------------------------------------------
        // API cũ — giữ nguyên contract để level2.js không cần đổi
        // ---------------------------------------------------------------------

        setupDecisionButtons() {
            if (this.btnDecisionOpen) {
                this.btnDecisionOpen.addEventListener('click', () => this.choosePath('open'));
            }
            if (this.btnDecisionClosed) {
                this.btnDecisionClosed.addEventListener('click', () => this.choosePath('closed'));
            }
        },

        start() {
            this.isCompleted = false;

            // Reset state chia sẻ
            if (typeof State !== 'undefined') {
                State.lockedCount = 0;
                State.chosenPath = null;
            }

            // UI: hiện puzzle, ẩn decision
            const puzzleContainer = document.getElementById('door-puzzle-container');
            if (puzzleContainer) puzzleContainer.classList.remove('hidden');
            if (this.decisionWrapper) this.decisionWrapper.classList.add('hidden');

            // Build / restart game về trạng thái fresh
            if (this.engine && typeof this.engine.start === 'function') {
                this.engine.start();
            }
        },

        showDecisionScreen() {
            if (typeof sound !== 'undefined' && sound.playTick) {
                sound.init();
                sound.playTick();
            }

            if (typeof FreezeFrame !== 'undefined' && FreezeFrame.crossfade) {
                FreezeFrame.crossfade(() => {
                    const puzzleContainer = document.getElementById('door-puzzle-container');
                    if (puzzleContainer) puzzleContainer.classList.add('hidden');
                    if (this.decisionWrapper) this.decisionWrapper.classList.remove('hidden');
                });
            } else {
                const puzzleContainer = document.getElementById('door-puzzle-container');
                if (puzzleContainer) puzzleContainer.classList.add('hidden');
                if (this.decisionWrapper) this.decisionWrapper.classList.remove('hidden');
            }
        },

        choosePath(path) {
            if (typeof State !== 'undefined') {
                State.chosenPath = path;
            }
            if (typeof sound !== 'undefined') {
                sound.init();
                if (path === 'open') {
                    sound.playGlitchExplosion && sound.playGlitchExplosion();
                } else {
                    sound.playVictoryChime && sound.playVictoryChime();
                }
            }

            // Confetti CDN — gọi thẳng (đã load ở level2.html) để thay cho ParticleSystem
            if (typeof confetti === 'function') {
                if (path === 'open') {
                    // Nhánh xấu: pháo màu đỏ-cam rải đều cảnh báo
                    confetti({
                        particleCount: 60,
                        spread: 70,
                        startVelocity: 25,
                        origin: { y: 0.55 },
                        colors: ['#FF4757', '#FF9F43', '#FF6B9D']
                    });
                } else {
                    // Nhánh tốt: pháo màu xanh-vàng-vàng (khiên căn cứ sáng)
                    confetti({
                        particleCount: 80,
                        spread: 80,
                        startVelocity: 30,
                        origin: { y: 0.55 },
                        colors: ['#22C55E', '#5BA8FF', '#FFD700']
                    });
                }
            }

            setTimeout(() => this.transitionToOutro(path), 450);
        },

        transitionToOutro(path) {
            if (this.decisionWrapper) this.decisionWrapper.classList.add('hidden');

            if (typeof FreezeFrame !== 'undefined') {
                FreezeFrame.captureGradientBackground && FreezeFrame.captureGradientBackground();
                if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '1';
            }

            setTimeout(() => {
                if (typeof switchStage === 'function') switchStage('outro');
                if (typeof FreezeFrame !== 'undefined' && FreezeFrame.canvas) {
                    FreezeFrame.canvas.style.opacity = '0';
                }
                if (typeof VideoController !== 'undefined') {
                    VideoController.playOutro(path);
                }
            }, 80);
        }
    };

// =========================================================================
// 8. (ParticleSystem đã được lược bỏ theo yêu cầu — chỉ dùng canvas-confetti CDN)
// =========================================================================
// Mọi hiệu ứng particle được thay bằng:
//   • canvas-confetti CDN (https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0)
//   • DOM animation trong CSS (shake, glow, scale bounce)
// Các nơi trước đây gọi ParticleSystem.burstGlitch()/burstShield() đã được
// thay bằng confetti({...}) hoặc playDropWithError(...) — xem DoorPuzzleScene.choosePath()

// =========================================================================
// 9. SUMMARY SCENE (2 nhánh: OPEN / CLOSED)
// =========================================================================

    const SummaryScene = {
        card: null,

        init() {
            this.card = document.getElementById('summary-card-container');
            OutroFallbackScene.init();
        },

        render(path) {
            console.log('SummaryScene.render() called with path:', path);
            if (!this.card) {
                console.error('SummaryScene.render: card element not found!');
                return;
            }
            sound.init();

            let titleText = '';
            let xpNumber = 0;
            let xpText = '';
            let badgeName = '';
            let badgeIcon = '';
            let cardClass = '';
            let lessonsHtml = '';

            if (path === 'open') {
                // Nhánh OPEN (Xấu)
                sound.playGlitchExplosion();
                cardClass = 'summary-card branch-open';
                badgeIcon = '😮';
                titleText = 'CẦN CẨN THẬN HƠN!';
                xpNumber = 5;
                xpText = '+5 XP';
                badgeName = 'Người Mới Học';

                lessonsHtml = `
                    <div class="lesson-item">
                        ⚠️ <b>Nguy hiểm!</b> Con đã mở cửa và tin tưởng người lạ trên mạng mà chưa xác minh danh tính!
                    </div>
                    <div class="lesson-item">
                        🏠 <b>Bài học:</b> Kẻ xấu có thể giả làm bạn mới, lợi dụng quà tặng để tiếp cận và lừa đảo trẻ em.
                    </div>
                    <div class="lesson-item">
                        💪 <b>Không sao cả!</b> Thất bại là cơ hội để học hỏi. Lần sau hãy luôn hỏi ý kiến bố mẹ trước nhé!
                    </div>
                `;
            } else {
                // Nhánh CLOSED (Tốt)
                sound.playVictoryChime();
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 90,
                        spread: 75,
                        origin: { y: 0.6 }
                    });
                }
                cardClass = 'summary-card branch-closed';
                badgeIcon = '🛡️';
                titleText = 'LEVEL 2 COMPLETED!';
                xpNumber = 20;
                xpText = '+20 XP';
                badgeName = 'HIỆP SĨ KẾT BẠN THÔNG MINH';

                lessonsHtml = `
                    <div class="lesson-item">
                        🎉 <b>Xuất sắc!</b> Con đã giữ cửa đóng và không tin ngay vào "người bạn mới" trên mạng!
                    </div>
                    <div class="lesson-item">
                        🛡️ <b>Nguyên tắc Hiệp Sĩ:</b> Không tin người lạ online, dù họ tặng quà hay nói chuyện thân thiện.
                    </div>
                    <div class="lesson-item">
                        🏠 <b>Bảo vệ tổ ấm:</b> Con đã bảo vệ sự an toàn cho gia đình bằng cách không tiết lộ thông tin! 💪
                    </div>
                `;
            }

            this.card.className = cardClass;
            this.card.style.display = 'flex';
            this.card.style.opacity = '1';
            this.card.style.visibility = 'visible';
            this.card.style.zIndex = '50';
            this.card.innerHTML = `
                <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png" alt="CyberKnight" style="width: 100px; margin-top: -6px; filter: drop-shadow(0 6px 16px rgba(0, 102, 255, 0.18)); animation: icon-bounce 2s ease-in-out infinite;">
                <div class="summary-icon-badge">${badgeIcon}</div>
                <h2 class="summary-title">${titleText}</h2>
                <div class="summary-reward-box">
                    <span class="summary-reward-xp">⭐ ${xpText}</span>
                    <span class="summary-reward-badge">🛡️ ${badgeName}</span>
                </div>

                <div class="lessons-container">
                    ${lessonsHtml}
                </div>

                <!-- LỜI KHUYÊN DÀNH CHO TRẺ (RÚT GỌN: 2 cột, 2 items mỗi cột) -->
                <div class="advice-box" aria-label="Lời khuyên an toàn dành cho em">
                    <div class="advice-box-title">📋 LỜI KHUYÊN DÀNH CHO EM</div>
                    <div class="advice-grid">
                        <div class="advice-do">
                            <div class="advice-header-do">✅ NÊN LÀM</div>
                            <div class="advice-item">Hỏi bố mẹ trước khi kết bạn với người lạ</div>
                            <div class="advice-item">Giữ bí mật thông tin cá nhân</div>
                        </div>
                        <div class="advice-dont">
                            <div class="advice-header-dont">❌ KHÔNG NÊN</div>
                            <div class="advice-item">Không tin người lạ dù tỏ ra thân thiện</div>
                            <div class="advice-item">Không tự ý gặp người quen online</div>
                        </div>
                    </div>
                    <div class="advice-motto">💡 <b>"Cẩn thận là vàng — An toàn là vàng!"</b></div>
                </div>

                <div class="summary-actions">
                    <button id="btn-summary-replay" class="btn-summary-replay">🔄 CHƠI LẠI LEVEL 2</button>
                    <button id="btn-summary-continue" class="btn-summary-continue">TIẾP TỤC HÀNH TRÌNH ▶</button>
                </div>
            `;

            document.getElementById('btn-summary-replay')?.addEventListener('click', () => this.replay());
            document.getElementById('btn-summary-continue')?.addEventListener('click', () => this.continueJourney());

            // Phát Custom Event cho hệ thống ngoài lắng nghe
            window.dispatchEvent(new CustomEvent('level2:complete', {
                detail: {
                    path: path,
                    xp: xpNumber,
                    badge: badgeName
                }
            }));
        },

        replay() {
            resetLevel2();
        },

        continueJourney() {
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) {
                console.warn('postMessage error:', err);
            }
            window.location.href = '../index.html';
        }
    };

    // =========================================================================
    // 9.5 OUTRO FALLBACK SCENE
    // =========================================================================

    const OutroFallbackScene = {
        panel: null,
        iconEl: null,
        titleEl: null,
        messageEl: null,
        lessonsEl: null,
        ctaBtn: null,
        _continueHandler: null,
        _autoProceedTimer: null,
        _countdownInterval: null,

        init() {
            this.panel = document.getElementById('outro-fallback-panel');
            this.iconEl = document.getElementById('outro-fallback-icon');
            this.titleEl = document.getElementById('outro-fallback-title');
            this.messageEl = document.getElementById('outro-fallback-message');
            this.lessonsEl = document.getElementById('outro-fallback-lessons');
            this.ctaBtn = document.getElementById('outro-fallback-continue');

            if (this.ctaBtn) {
                this.ctaBtn.addEventListener('click', () => {
                    if (this._continueHandler) this._continueHandler();
                });
            }
        },

        show(path, onContinue) {
            const data = this._getBranchData(path);
            if (!data) {
                if (onContinue) onContinue();
                return;
            }

            this._continueHandler = onContinue || null;

            if (this.panel) {
                this.panel.classList.remove('hidden', 'branch-open', 'branch-closed');
                this.panel.classList.add(`branch-${path}`);
            }
            if (this.iconEl) this.iconEl.textContent = data.icon;
            if (this.titleEl) this.titleEl.textContent = data.title;
            if (this.messageEl) this.messageEl.textContent = data.message;
            if (this.lessonsEl) {
                this.lessonsEl.innerHTML = data.lessons.map((l, i) => `
                    <div class="outro-fallback-lesson-item">
                        <span class="outro-fallback-lesson-icon">${l.icon}</span>
                        <span class="outro-fallback-lesson-text">${l.text}</span>
                    </div>
                `).join('');
            }

            const newCtaBtn = document.getElementById('outro-fallback-continue');
            if (newCtaBtn) {
                newCtaBtn.addEventListener('click', () => {
                    if (this._continueHandler) this._continueHandler();
                });
            }
            if (this.ctaBtn) this.ctaBtn.textContent = data.ctaText || 'XEM BÀI HỌC CHI TIẾT ▶';

            this._startAutoProceedCountdown();
        },

        _startAutoProceedCountdown() {
            this._cancelAutoProceed();

            let countdown = 5;
            const newCtaBtn = document.getElementById('outro-fallback-continue');
            if (newCtaBtn) {
                newCtaBtn.textContent = `XEM BÀI HỌC CHI TIẾT ▶ (${countdown}s)`;
            }

            this._countdownInterval = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    this._cancelAutoProceed();
                    if (this._continueHandler) this._continueHandler();
                    return;
                }
                const btn = document.getElementById('outro-fallback-continue');
                if (btn) btn.textContent = `XEM BÀI HỌC CHI TIẾT ▶ (${countdown}s)`;
            }, 1000);

            this._autoProceedTimer = setTimeout(() => {
                this._cancelAutoProceed();
                if (this._continueHandler) this._continueHandler();
            }, 5000);
        },

        _cancelAutoProceed() {
            if (this._autoProceedTimer) {
                clearTimeout(this._autoProceedTimer);
                this._autoProceedTimer = null;
            }
            if (this._countdownInterval) {
                clearInterval(this._countdownInterval);
                this._countdownInterval = null;
            }
            const btn = document.getElementById('outro-fallback-continue');
            if (btn) btn.textContent = 'XEM BÀI HỌC CHI TIẾT ▶';
        },

        hide() {
            this._cancelAutoProceed();
            if (this.panel) this.panel.classList.add('hidden');
            this._continueHandler = null;
        },

        _getBranchData(path) {
            const dataMap = {
                'open': {
                    icon: '😮',
                    title: 'NGUY HIỂM! ĐÃ MỞ CỬA CHO NGƯỜI LẠ',
                    message: 'Con đã tin tưởng và mở cửa cho người lạ trên mạng. Hãy xem hậu quả và bài học:',
                    ctaText: 'XEM HẬU QUẢ & CÁCH PHÒNG TRÁNH ▶',
                    lessons: [
                        { icon: '⚠️', text: '<b>Nguy hiểm:</b> Người lạ có thể giả làm bạn mới, lợi dụng quà tặng để tiếp cận trẻ em.' },
                        { icon: '🔓', text: '<b>Sai lầm:</b> Việc mở cửa (kết bạn, tin tưởng) mà chưa xác minh có thể gây nguy hiểm.' },
                        { icon: '👨‍👩‍👧', text: '<b>Bài học:</b> Luôn hỏi ý kiến bố mẹ trước khi kết bạn với người mới trên mạng.' },
                        { icon: '💪', text: '<b>Không sao cả!</b> Đây là bài học quý giá. Lần sau hãy cẩn thận hơn nhé!' }
                    ]
                },
                'closed': {
                    icon: '🛡️',
                    title: 'XUẤT SẮC! ĐÃ GIỮ CỬA AN TOÀN',
                    message: 'Bằng cách không mở cửa và giữ cảnh giác, con đã bảo vệ an toàn cho bản thân và gia đình:',
                    ctaText: 'XEM BÀI HỌC ĐÃ HỌC ĐƯỢC ▶',
                    lessons: [
                        { icon: '🎉', text: '<b>Xuất sắc!</b> Con đã không tin ngay vào "người bạn mới" trên mạng!' },
                        { icon: '🛡️', text: '<b>Nguyên tắc:</b> Không tin người lạ online dù họ tặng quà hay nói chuyện thân thiện.' },
                        { icon: '🏠', text: '<b>Bảo vệ tổ ấm:</b> Con đã giữ an toàn cho gia đình bằng cách cẩn thận!' },
                        { icon: '🌟', text: '<b>Lời khen:</b> Con là tấm gương sáng về an toàn trực tuyến!' }
                    ]
                }
            };
            return dataMap[path] || null;
        }
    };

    // =========================================================================
    // 10. RESET & GLOBAL STAGE SWITCHER
    // =========================================================================

    function resetLevel2() {
        stopAllVideos();
        DoorPuzzleScene.start();

        State.chosenPath = null;
        State.lockedCount = 0;

        FreezeFrame.crossfade(() => {
            switchStage('intro');
            VideoController.playIntro();
        });
    }

    function switchStage(targetStage) {
        State.currentStage = targetStage;
        const stages = ['intro', 'game', 'outro', 'summary'];
        stages.forEach(s => {
            const el = document.getElementById(`stage-${s}`);
            if (el) {
                if (s === targetStage) {
                    el.classList.add('active');
                    el.style.zIndex = '100';
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                    el.style.visibility = 'visible';
                    el.style.pointerEvents = 'auto';
                } else {
                    el.classList.remove('active');
                    el.style.zIndex = '10';
                }
            }
        });

        if (targetStage === 'summary') {
            // ParticleSystem đã lược bỏ — chỉ cần ẩn freeze canvas
            if (FreezeFrame.canvas) FreezeFrame.canvas.style.opacity = '0';
        }

        if (targetStage === 'summary') {
            const topBar = document.getElementById('level2-top-bar');
            if (topBar) topBar.style.display = 'none';
            const skipBtn = document.getElementById('btn-skip-video');
            if (skipBtn) skipBtn.style.display = 'none';
        } else {
            const topBar = document.getElementById('level2-top-bar');
            if (topBar) topBar.style.display = '';
        }

        TopBar.updateVisibility(targetStage);
    }

    // =========================================================================
    // 11. DEBUG FLAGS
    // =========================================================================

    function handleDebugFlags() {
        const urlParams = new URLSearchParams(window.location.search);
        const skip = urlParams.get('skip');

        if (skip === 'intro' || skip === 'game') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('game');
            DoorPuzzleScene.start();
            return true;
        }

        if (skip === 'decision') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('game');
            DoorPuzzleScene.showDecisionScreen();
            return true;
        }

        if (skip === 'summary-open') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'open';
            switchStage('summary');
            SummaryScene.render('open');
            return true;
        }

        if (skip === 'summary-closed') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'closed';
            switchStage('summary');
            SummaryScene.render('closed');
            return true;
        }

        if (skip === 'outro-open') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'open';
            VideoController.playOutro('open');
            return true;
        }

        if (skip === 'outro-closed') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'closed';
            VideoController.playOutro('closed');
            return true;
        }

        return false;
    }

    // =========================================================================
    // DOMContentLoaded: INIT ALL SYSTEMS
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();
        VideoController.init();
        DoorPuzzleScene.init();
        SummaryScene.init();
        OutroFallbackScene.init();
        // ParticleSystem.init() — đã lược bỏ, chỉ dùng canvas-confetti CDN

        const isSkipped = handleDebugFlags();
        if (isSkipped) return;

        const btnStart = document.getElementById('btn-start-level');
        const startOverlay = document.getElementById('start-overlay');

        if (btnStart && startOverlay) {
            btnStart.addEventListener('click', () => {
                sound.init();
                sound.playTick();
                startOverlay.classList.add('hidden');
                switchStage('intro');
                VideoController.playIntro();
            });
        }
    });

})();
