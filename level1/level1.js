/**
 * CYBERKNIGHT — LEVEL 1: "THÁM TỬ MẠNG — SOI ĐOẠN CHAT" (LỚP TRƯỞNG GỬI LINK NHẬN QUÀ)
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth & 3-Branch Engine
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. STATE MACHINE & CONFIGURATION
    // =========================================================================

    const CONFIG = {
        COUNTDOWN_SECONDS: 15,     // 15 giây đếm ngược clickbait
        GRACE_SECONDS: 5,          // 5 giây gia hạn khi hết giờ lần đầu
        TRANSITION_MS: 500,        // Thời gian chuyển cảnh crossfade
        OUTRO_FALLBACK_TIMEOUT_MS: 60000, // 60s fallback CHỈ khi video KHÔNG LOAD ĐƯỢC (load mạng chậm)
        VIDEO_PATHS: {
            // Mỗi mảng là danh sách đường dẫn dự phòng, browser sẽ thử lần lượt nếu file này 404
            intro: [
                '../video/level 1/intro.mp4',
                '../../video/level 1/intro.mp4',
                'video/level 1/intro.mp4',
                '/video/level 1/intro.mp4'
            ],
            bad: [
                '../video/level 1/bad.mp4',
                '../../video/level 1/bad.mp4',
                'video/level 1/bad.mp4',
                '/video/level 1/bad.mp4'
            ],
            middle: [
                '../video/level 1/middle.mp4',
                '../../video/level 1/middle.mp4',
                'video/level 1/middle.mp4',
                '/video/level 1/middle.mp4'
            ],
            good: [
                '../video/level 1/good.mp4',
                '../../video/level 1/good.mp4',
                'video/level 1/good.mp4',
                '/video/level 1/good.mp4'
            ]
        }
    };

    const State = {
        currentStage: 'intro',      // 'intro' | 'game' | 'outro' | 'summary'
        chosenPath: null,           // 'A' | 'B' | 'C'
        gameStats: null
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

        // Tiếng "tách / click" nhẹ khi tương tác nút bấm
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

        // Tiếng ting thanh khi bắt đúng vào giỏ (tăng cao độ theo combo)
        playCorrectCatch(combo = 1) {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const baseFreq = 523.25; // C5
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

        // Tiếng bụp nhẹ khi bắt sai (âm trầm nhẹ nhàng, không tiêu cực)
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

        // Tiếng vụt nhẹ khi vật phẩm trôi qua (Missed - trung lập)
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

        // Tiếng rà quét điện tử (scanner hum) khi rê kính lúp
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

        // Tiếng bong bóng tin nhắn chat nhảy vào (Chat Pop)
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

        // Tiếng chuông khi tìm ra một manh mối (Clue Found Chime)
        playClueFound() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            [659.25, 987.77].forEach((freq, idx) => { // E5 -> B5
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

        // Còi cảnh báo nguy hiểm (2-tone Siren)
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

        // Hiệu ứng nổ / glitch khi chọn Nhánh A (Xấu)
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

        // Hợp âm suy ngẫm cho Nhánh B (Trung gian: F4 -> A4 -> C5)
        playThoughtfulChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [349.23, 440.00, 523.25]; // F4, A4, C5
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

        // Hợp âm chiến thắng cho Nhánh C (Tốt: Arpeggio Chime C5, E5, G5, C6)
        playVictoryChime() {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
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
    }

    const sound = new AudioSynth();

    // =========================================================================
    // 3. QUAN TRỌNG: DỪNG TRIỆT ĐỂ MỌI VIDEO & AUDIO ĐỂ TRÁNH TRÙNG TIẾNG
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
        // Giải phóng CPU/GPU: dừng particle loop khi chuyển stage video
        // (đã được resume khi quay về stage game)
        if (window.ParticleSystem && typeof window.ParticleSystem.stop === 'function') {
            window.ParticleSystem.stop();
        }
    }

    // =========================================================================
    // 4. FREEZE-FRAME CROSSFADE (Nguyên tắc: Không bao giờ để màn hình đen)
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
                // QUAN TRỌNG: Clear canvas trước khi vẽ frame mới để tránh đè
                // nhiều frame chồng lên nhau gây mờ/nhấp nháy.
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);
                return true;
            } catch (err) {
                console.warn('⚠️ Freeze frame capture notice:', err.message);
                return false;
            }
        },

        // Phiên bản đặc biệt: vẽ background gradient thay cho frame, dùng khi không có video
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

            // 1. Hiện canvas freeze frame đè lên
            this.canvas.style.opacity = '1';

            // 2. Chờ 60ms cho render ổn định
            await new Promise(r => setTimeout(r, 60));

            // 3. Chuyển đổi DOM ngầm bên dưới
            if (prepareNewStageCallback) {
                prepareNewStageCallback();
            }

            // 4. Fade out canvas freeze frame mượt mà để lộ stage mới
            await new Promise(r => setTimeout(r, 120));
            this.canvas.style.opacity = '0';
        }
    };

    // =========================================================================
    // 5. TOP BAR CONTROLLER (Bỏ qua & Thoát)
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

            // Lắng nghe phím Escape để thoát nhanh
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
    // 6. VIDEO CONTROLLER (Mở đầu & Rẽ 3 nhánh Hậu quả: bad / middle / good)
    // =========================================================================

    const VideoController = {
        introVideo: null,
        outroVideo: null,
        preloadBad: null,
        preloadMiddle: null,
        preloadGood: null,
        introEndHandlerTriggered: false,

        init() {
            this.introVideo = document.getElementById('video-intro');
            this.outroVideo = document.getElementById('video-outro');
            this.preloadBad = document.getElementById('preload-bad');
            this.preloadMiddle = document.getElementById('preload-middle');
            this.preloadGood = document.getElementById('preload-good');

            this.setupVideoFallback(this.introVideo, CONFIG.VIDEO_PATHS.intro);
            this.setupVideoFallback(this.preloadBad, CONFIG.VIDEO_PATHS.bad);
            this.setupVideoFallback(this.preloadMiddle, CONFIG.VIDEO_PATHS.middle);
            this.setupVideoFallback(this.preloadGood, CONFIG.VIDEO_PATHS.good);

            // Bắt sự kiện gần hết video mở đầu
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

            // Bắt sự kiện kết thúc video hậu quả
            if (this.outroVideo) {
                this.outroVideo.addEventListener('ended', () => {
                    this.onOutroEnded();
                });
            }
        },

        // Hàm helper: thử load video qua danh sách đường dẫn dự phòng,
        // trả về Promise resolve(true) khi tìm được file phát được, false khi thất bại hết.
        tryLoadWithFallback(videoEl, pathList, onSuccess, onAllFailed) {
            if (!videoEl || !pathList || pathList.length === 0) {
                if (onAllFailed) onAllFailed();
                return;
            }

            // HARD TIMEOUT: Nếu không load được sau 3s per path → thử path tiếp theo
            // Ngăn chặn trường hợp browser treo mãi không fire error trên file không tồn tại
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
                        console.warn('❌ Tất cả đường dẫn dự phòng đều thất bại');
                        if (onAllFailed) onAllFailed();
                    });
                    return;
                }

                const currentPath = pathList[currentIdx];
                console.log(`🔄 Đang thử đường dẫn [${currentIdx + 1}/${pathList.length}]: ${currentPath}`);

                // Reset trạng thái video trước khi thử đường dẫn mới
                videoEl.removeAttribute('src');
                videoEl.load();
                videoEl.src = currentPath;
                videoEl.load();

                // HARD TIMEOUT: Nếu path này không load được trong 3s → thử path tiếp theo
                loadTimeoutId = setTimeout(() => {
                    console.warn(`⏰ Timeout [${currentIdx + 1}] — chuyển sang path tiếp theo`);
                    handleError();
                }, HARD_TIMEOUT_MS);
            };

            const handleSuccess = () => {
                resolve(() => {
                    videoEl.removeEventListener('loadeddata', handleSuccess);
                    videoEl.removeEventListener('canplay', handleSuccess);
                    videoEl.removeEventListener('error', handleError);
                    console.log(`✅ Load thành công: ${pathList[currentIdx]}`);
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
            // Backward compatible: chỉ set src đầu tiên cho các lần gọi init
            // (Preload sẽ tự try thêm nếu file đầu 404)
            if (!videoEl || !pathList || pathList.length === 0) return;
            videoEl.src = pathList[0];

            // Tự retry nếu file đầu không load được
            videoEl.addEventListener('error', () => {
                console.warn(`🔄 Preload fallback triggered for video src: ${pathList[0]}`);
                // Logic retry đầy đủ sẽ chạy trong playOutro
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
                    console.log('Autoplay video intro chờ tương tác người dùng');
                });
            }
        },

        onIntroNearEnd() {
            FreezeFrame.captureFromVideo(this.introVideo);
            if (this.introVideo) this.introVideo.pause();

            FreezeFrame.crossfade(() => {
                switchStage('game');
                MinigameScene.start();
            });
        },

        playOutro(branch) {
            this._outroEnded = false;
            stopAllVideos();

            console.log('🎬 Playing outro for branch:', branch);

            // Bước 1: Chuyển stage TRƯỚC (trước cả crossfade) để DOM sẵn sàng render video element
            switchStage('outro');

            // Bước 2: Force DOM reflow để chắc chắn #video-outro đã hiển thị
            if (this.outroVideo) {
                void this.outroVideo.offsetHeight;
                // Hiện lại video (trong lần replay hoặc sau khi ẩn ở fallback trước)
                this.outroVideo.style.display = '';
            }

            // Bước 3: Setup fallback timer (60s) — CHỈ chạy khi video CHƯA bắt đầu play
            // Sẽ bị huỷ ngay khi video có thể phát (loadeddata/canplay) hoặc đã kết thúc (ended)
            clearTimeout(this._outroFallbackTimer);
            this._outroFallbackTimer = setTimeout(() => {
                if (this._outroEnded) return;
                // Chỉ fallback khi video chưa thực sự phát (currentTime gần 0 = chưa play được)
                const hasStartedPlaying = this.outroVideo && this.outroVideo.currentTime > 0.1;
                if (hasStartedPlaying) {
                    console.log('ℹ️ Video đã phát > 0.1s, không fallback dù timeout');
                    return;
                }
                console.warn('⚠️ Outro timeout — video không load được, hiển thị fallback scene');
                this.showFallbackScene(branch);
            }, CONFIG.OUTRO_FALLBACK_TIMEOUT_MS);

            // Bước 4: Cleanup error handler cũ (nếu có)
            if (this._outroErrorHandler) {
                this.outroVideo.removeEventListener('error', this._outroErrorHandler);
                this._outroErrorHandler = null;
            }

            // Bước 5: Kiểm tra video preload đã sẵn sàng chưa
            const preloadMap = { 'A': this.preloadBad, 'B': this.preloadMiddle, 'C': this.preloadGood };
            const preloadVideo = preloadMap[branch];
            const branchPaths = branch === 'A' ? CONFIG.VIDEO_PATHS.bad :
                                branch === 'B' ? CONFIG.VIDEO_PATHS.middle :
                                CONFIG.VIDEO_PATHS.good;

            // Bước 6: Listener "huỷ fallback timeout khi video sẵn sàng phát"
            // Đây là FIX ROOT CAUSE: video play đến khi bị ngắt là vì timeout huỷ video khi vẫn còn đang phát
            const cancelFallbackOnReady = () => {
                if (this.outroVideo) {
                    this.outroVideo.removeEventListener('loadeddata', cancelFallbackOnReady);
                    this.outroVideo.removeEventListener('canplay', cancelFallbackOnReady);
                }
                clearTimeout(this._outroFallbackTimer);
                console.log('✅ Video sẵn sàng phát → đã huỷ fallback timeout');
            };
            if (this.outroVideo) {
                this.outroVideo.addEventListener('loadeddata', cancelFallbackOnReady, { once: true });
                this.outroVideo.addEventListener('canplay', cancelFallbackOnReady, { once: true });
            }

            const startPlay = () => {
                if (!this.outroVideo || this._outroEnded) return;
                this.outroVideo.currentTime = 0;

                // Ẩn fallback panel (nếu đang hiển thị)
                OutroFallbackScene.hide();

                // Fallback: nếu video phát hết nhưng 'ended' event không fire,
                // dùng timeupdate để phát hiện khi gần kết thúc
                let timeUpdateFallbackTriggered = false;
                const checkVideoEnded = () => {
                    if (this._outroEnded || timeUpdateFallbackTriggered) return;
                    if (this.outroVideo && this.outroVideo.duration && this.outroVideo.currentTime > 0) {
                        const remaining = this.outroVideo.duration - this.outroVideo.currentTime;
                        // Nếu còn < 0.5s và video đang chạy → coi như đã kết thúc
                        if (remaining <= 0.5 && !this.outroVideo.paused) {
                            timeUpdateFallbackTriggered = true;
                            this.outroVideo.removeEventListener('timeupdate', checkVideoEnded);
                            console.log('⏱️ Video timeupdate fallback: gần kết thúc, gọi onOutroEnded()');
                            this.onOutroEnded();
                        }
                    }
                };
                this.outroVideo.addEventListener('timeupdate', checkVideoEnded);

                const playPromise = this.outroVideo.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        // Video đã thực sự play → huỷ fallback timeout ngay
                        clearTimeout(this._outroFallbackTimer);
                        console.log('▶️ Video đã phát → fallback timeout huỷ vĩnh viễn');
                    }).catch(e => {
                        console.warn('⚠️ Outro video play error:', e.message);
                        // Thử play lại sau 500ms (đề phòng autoplay restriction)
                        setTimeout(() => {
                            if (this._outroEnded || !this.outroVideo) return;
                            this.outroVideo.play().then(() => {
                                clearTimeout(this._outroFallbackTimer);
                            }).catch(err => {
                                console.error('❌ Không thể play video:', err.message);
                                if (!this._outroEnded) {
                                    this.showFallbackScene(branch);
                                }
                            });
                        }, 500);
                    });
                }
            };

            const showFallbackImmediately = (reason) => {
                console.warn(`⚠️ ${reason} — dùng fallback scene`);
                clearTimeout(this._outroFallbackTimer);
                setTimeout(() => this.showFallbackScene(branch), 100);
            };

            // Thử load trực tiếp với danh sách path dự phòng
            this.tryLoadWithFallback(
                this.outroVideo,
                branchPaths,
                () => {
                    // Thành công - load xong nhưng chưa chắc play được
                    console.log(`✅ Video load xong cho branch: ${branch}`);
                    startPlay();
                },
                () => {
                    // Tất cả path đều fail → fallback scene ngay
                    showFallbackImmediately('Tất cả đường dẫn video outro đều thất bại');
                }
            );
        },

        // Hiển thị màn hình kết quả thay cho video (khi video không có hoặc không load được)
        showFallbackScene(branch) {
            if (this._outroEnded) return;
            this._outroEnded = true;
            clearTimeout(this._outroFallbackTimer);

            // Ẩn video element (nếu đang hiển thị)
            if (this.outroVideo) {
                try { this.outroVideo.pause(); } catch (e) {}
                this.outroVideo.style.display = 'none';
            }

            // Hiển thị fallback scene với nút "TIẾP TỤC" → SummaryScene
            OutroFallbackScene.show(branch, () => {
                this.onOutroEnded();
            });
        },

        onOutroEnded() {
            console.log('🔵 onOutroEnded() triggered - branch:', State.chosenPath);
            if (this._outroEnded) {
                console.log('⚠️ onOutroEnded already called, skipping');
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

            console.log('🔵 Calling switchStage("summary") and SummaryScene.render()');
            switchStage('summary');
            SummaryScene.render(State.chosenPath);
        }
    };

    // =========================================================================
    // 7. MINIGAME SCENE: "LƯỚI LỌC AN TOÀN" (SAFETY CATCH) & 3-WAY DECISION
    // =========================================================================

    const MinigameScene = {
        container: null,
        decisionWrapper: null,
        game: null,
        btnDecisionA: null,
        btnDecisionB: null,
        btnDecisionC: null,

        init() {
            this.container = document.getElementById('safety-catch-container');
            this.decisionWrapper = document.getElementById('decision-screen-wrapper');
            this.btnDecisionA = document.getElementById('btn-decision-a');
            this.btnDecisionB = document.getElementById('btn-decision-b');
            this.btnDecisionC = document.getElementById('btn-decision-c');

            if (window.SafetyCatchGame && this.container) {
                this.game = new window.SafetyCatchGame(this.container, {
                    durationSeconds: 28,
                    onCorrect: (item, combo) => {
                        sound.playCorrectCatch(combo);
                    },
                    onIncorrect: (item) => {
                        sound.playIncorrectCatch();
                    },
                    onMissed: (item) => {
                        sound.playCatchMiss();
                    },
                    onComplete: (stats) => {
                        State.gameStats = stats;
                        this.showDecisionScreen();
                    }
                });
            }

            this.setupDecisionButtons();
        },

        start() {
            State.chosenPath = null;
            State.gameStats = null;

            // Đảm bảo mini-game hiện, màn hình 3 quyết định ẩn
            if (this.decisionWrapper) {
                this.decisionWrapper.classList.add('hidden');
            }
            if (this.container) {
                this.container.classList.remove('hidden');
            }

            if (this.game) {
                this.game.start();
            }
        },

        showDecisionScreen() {
            sound.init();
            sound.playTick();

            FreezeFrame.crossfade(() => {
                if (this.container) {
                    this.container.classList.add('hidden');
                }
                if (this.decisionWrapper) {
                    this.decisionWrapper.classList.remove('hidden');
                }
            });
        },

        setupDecisionButtons() {
            if (this.btnDecisionA) {
                this.btnDecisionA.addEventListener('click', () => {
                    this.choosePath('A');
                });
            }

            if (this.btnDecisionB) {
                this.btnDecisionB.addEventListener('click', () => {
                    this.choosePath('B');
                });
            }

            if (this.btnDecisionC) {
                this.btnDecisionC.addEventListener('click', () => {
                    this.choosePath('C');
                });
            }
        },

        choosePath(branch) {
            State.chosenPath = branch;
            sound.init();

            if (branch === 'A') {
                sound.playGlitchExplosion();
                ParticleSystem.burstGlitch();
            } else if (branch === 'B') {
                sound.playThoughtfulChime();
                ParticleSystem.burstQuestion();
            } else {
                sound.playVictoryChime();
                ParticleSystem.burstShield();
            }

            // Chuyển sang video hậu quả ngay (450ms đủ để particle burst hiển thị rõ)
            setTimeout(() => {
                this.transitionToOutro(branch);
            }, 450);
        },

        transitionToOutro(branch) {
            console.log('🔄 Transitioning to outro with branch:', branch);

            // Ẩn decision screen wrapper để tránh nó hiện đè lên video outro
            const decisionWrapper = document.getElementById('decision-screen-wrapper');
            if (decisionWrapper) {
                decisionWrapper.classList.add('hidden');
            }

            // Chụp frame game hiện tại lên freeze-canvas TRƯỚC khi chuyển
            // (đây là lúc duy nhất DOM game đang hiển thị, không phải video element)
            FreezeFrame.captureGradientBackground();
            FreezeFrame.canvas.style.opacity = '1';

            // Đợi 80ms để canvas hiển thị đè lên màn hình
            setTimeout(() => {
                // Giờ mới gọi switchStage + playOutro (DOM outro đã active)
                switchStage('outro');
                if (FreezeFrame.canvas) {
                    FreezeFrame.canvas.style.opacity = '0';
                }
                VideoController.playOutro(branch);
            }, 80);
        }
    };

    // =========================================================================
    // 8. PARTICLE SYSTEM (Hiệu ứng hạt rơi & Vụ nổ lựa chọn)
    // =========================================================================

    const ParticleSystem = {
        canvas: null,
        ctx: null,
        particles: [],
        animId: null,

        init() {
            this.canvas = document.getElementById('particle-canvas');
            // Agent telemetry disabled - endpoint unavailable
            // fetch('http://127.0.0.1:7270/ingest/...', ...).catch(()=>{});
            if (this.canvas) {
                this.ctx = this.canvas.getContext('2d');
                this.resize();
                window.addEventListener('resize', () => this.resize());
                this.spawnFloatingDiamonds();
                this.loop();
            }
        },

        resize() {
            if (!this.canvas) return;
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width + 120;
            this.canvas.height = rect.height + 120;
        },

        spawnFloatingDiamonds() {
            this.particles = [];
            for (let i = 0; i < 20; i++) {
                this.particles.push({
                    x: Math.random() * (this.canvas ? this.canvas.width : 400),
                    y: Math.random() * (this.canvas ? this.canvas.height : 400),
                    size: Math.random() * 7 + 3,
                    speedY: -(Math.random() * 0.5 + 0.2),
                    speedX: (Math.random() - 0.5) * 0.3,
                    alpha: Math.random() * 0.5 + 0.3,
                    color: Math.random() > 0.5 ? '#FFD700' : '#5BA8FF',
                    type: 'diamond'
                });
            }
        },

        burstGlitch() {
            // Agent telemetry disabled - endpoint unavailable
            // fetch('http://127.0.0.1:7270/ingest/...', ...).catch(()=>{});
            if (!this.canvas) return;
            for (let i = 0; i < 40; i++) {
                this.particles.push({
                    x: this.canvas.width / 2,
                    y: this.canvas.height / 2,
                    size: Math.random() * 12 + 6,
                    speedX: (Math.random() - 0.5) * 12,
                    speedY: (Math.random() - 0.5) * 12,
                    alpha: 1,
                    color: Math.random() > 0.5 ? '#FF4757' : '#FF6B9D',
                    type: 'square'
                });
            }
        },

        burstQuestion() {
            // Agent telemetry disabled - endpoint unavailable
            // fetch('http://127.0.0.1:7270/ingest/...', ...).catch(()=>{});
            if (!this.canvas) return;
            for (let i = 0; i < 35; i++) {
                this.particles.push({
                    x: this.canvas.width / 2,
                    y: this.canvas.height / 2,
                    size: Math.random() * 10 + 4,
                    speedX: (Math.random() - 0.5) * 9,
                    speedY: (Math.random() - 0.5) * 9,
                    alpha: 1,
                    color: Math.random() > 0.5 ? '#F59E0B' : '#FBBF24',
                    type: 'diamond'
                });
            }
        },

        burstShield() {
            // Agent telemetry disabled - endpoint unavailable
            // fetch('http://127.0.0.1:7270/ingest/...', ...).catch(()=>{});
            if (!this.canvas) return;
            for (let i = 0; i < 45; i++) {
                this.particles.push({
                    x: this.canvas.width / 2,
                    y: this.canvas.height / 2,
                    size: Math.random() * 10 + 4,
                    speedX: (Math.random() - 0.5) * 9,
                    speedY: (Math.random() - 0.5) * 9,
                    alpha: 1,
                    color: Math.random() > 0.4 ? '#22C55E' : '#5BA8FF',
                    type: 'shield'
                });
            }
        },

        loop() {
            if (!this.ctx || !this.canvas) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.x += p.speedX;
                p.y += p.speedY;

                if (p.type === 'diamond') {
                    if (p.y < -20) p.y = this.canvas.height + 20;
                    if (p.x < -20) p.x = this.canvas.width + 20;
                    if (p.x > this.canvas.width + 20) p.x = -20;
                } else {
                    p.alpha -= 0.02;
                    if (p.alpha <= 0) {
                        this.particles.splice(i, 1);
                        continue;
                    }
                }

                this.ctx.save();
                this.ctx.globalAlpha = p.alpha;
                this.ctx.fillStyle = p.color;

                if (p.type === 'diamond' || p.type === 'shield') {
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x, p.y - p.size);
                    this.ctx.lineTo(p.x + p.size, p.y);
                    this.ctx.lineTo(p.x, p.y + p.size);
                    this.ctx.lineTo(p.x - p.size, p.y);
                    this.ctx.closePath();
                    this.ctx.fill();
                } else {
                    this.ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                }
                this.ctx.restore();
            }

            this.animId = requestAnimationFrame(() => this.loop());
        },

        // Dừng animation loop (giải phóng CPU/GPU khi video đang play)
        stop() {
            if (this.animId) {
                cancelAnimationFrame(this.animId);
                this.animId = null;
            }
        },

        // Resume animation loop (nếu bị stop trước đó)
        resume() {
            if (!this.animId && this.ctx && this.canvas) {
                this.loop();
            }
        }
    };

    // Expose ParticleSystem to window để stopAllVideos() và switchStage() có thể gọi được
    window.ParticleSystem = ParticleSystem;

    // =========================================================================
    // 9. SUMMARY SCENE: KẾT QUẢ & 3 BÀI HỌC KỸ NĂNG THEO NHÁNH A / B / C
    // =========================================================================

    const SummaryScene = {
        card: null,

        init() {
            this.card = document.getElementById('summary-card-container');
            OutroFallbackScene.init();
        },

        render(branch) {
            console.log('🔵 SummaryScene.render() called with branch:', branch);
            if (!this.card) {
                console.error('❌ SummaryScene.render: card element not found!');
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

            if (branch === 'A') {
                // Nhánh A (Xấu)
                sound.playGlitchExplosion();
                cardClass = 'summary-card branch-a';
                badgeIcon = '😮';
                titleText = 'CẦN CẨN THẬN HƠN!';
                xpNumber = 10;
                xpText = '+10 XP';
                badgeName = 'Người Mới Học';

                lessonsHtml = `
                    <div class="lesson-item">
                        ⚠️ <b>Ôi không!</b> Việc bấm vào link lạ và điền địa chỉ nhà đã khiến thông tin cá nhân của con bị gửi thẳng đến kẻ lừa đảo!
                    </div>
                    <div class="lesson-item">
                        🏠 <b>Bài học:</b> Kẻ xấu có thể dùng địa chỉ nhà để mạo danh shipper giao hàng, tống tiền hoặc gây nguy hiểm cho gia đình.
                    </div>
                    <div class="lesson-item">
                        💪 <b>Không sao cả!</b> Thất bại là cơ hội để học hỏi. Lần sau hãy luôn hỏi ý kiến bố mẹ hoặc cô giáo trước nhé!
                    </div>
                `;
            } else if (branch === 'B') {
                // Nhánh B (Trung gian)
                sound.playThoughtfulChime();
                cardClass = 'summary-card branch-b';
                badgeIcon = '🤔';
                titleText = 'GẦN ĐÚNG RỒI!';
                xpNumber = 25;
                xpText = '+25 XP';
                badgeName = 'Người Hỏi Thông Minh';

                lessonsHtml = `
                    <div class="lesson-item">
                        💬 <b>Phản xạ tốt:</b> Con đã có ý thức không bấm ngay mà hỏi lại lớp trưởng để kiểm tra nguồn gốc.
                    </div>
                    <div class="lesson-item">
                        ⚠️ <b>Lưu ý quan trọng:</b> Kẻ xấu có thể đã chiếm đoạt tài khoản (hack nick) của lớp trưởng để nhắn tin lừa đảo hàng loạt!
                    </div>
                    <div class="lesson-item">
                        🛡️ <b>Cách xử lý an toàn:</b> Gọi điện thoại trực tiếp hoặc gặp mặt xác nhận, đồng thời báo cho thầy cô giáo.
                    </div>
                `;
            } else {
                // Nhánh C (Tốt)
                sound.playVictoryChime();
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 90,
                        spread: 75,
                        origin: { y: 0.6 }
                    });
                }
                cardClass = 'summary-card branch-c';
                badgeIcon = '🛡️';
                titleText = 'LEVEL 1 COMPLETED!';
                xpNumber = 40;
                xpText = '+40 XP';
                badgeName = 'LINK GUARDIAN';

                lessonsHtml = `
                    <div class="lesson-item">
                        🎉 <b>Xuất sắc!</b> Con đã phát hiện các dấu hiệu lừa đảo và chọn phương án an toàn nhất: Nhờ người lớn hỗ trợ!
                    </div>
                    <div class="lesson-item">
                        🛑 <b>Nguyên tắc Hiệp Sĩ:</b> Không bao giờ click vào link lạ dù người gửi là bạn bè hay người quen.
                    </div>
                    <div class="lesson-item">
                        🏠 <b>Bảo vệ tổ ấm:</b> Con đã bảo vệ an toàn cho cả gia đình khi không cung cấp địa chỉ nhà! 💪
                    </div>
                `;
            }

            this.card.className = cardClass;
            // CRITICAL FIX: Force inline styles to ensure visibility
            this.card.style.display = 'flex';
            this.card.style.opacity = '1';
            this.card.style.visibility = 'visible';
            this.card.style.zIndex = '50';
            this.card.innerHTML = `
                <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png" alt="CyberKnight" style="width: 130px; margin-top: -6px; filter: drop-shadow(0 6px 16px rgba(0, 102, 255, 0.18)); animation: icon-bounce 2s ease-in-out infinite;">
                <div class="summary-icon-badge">${badgeIcon}</div>
                <h2 class="summary-title">${titleText}</h2>
                <div class="summary-reward-box">
                    <span class="summary-reward-xp">⭐ ${xpText}</span>
                    <span class="summary-reward-badge">🛡️ ${badgeName}</span>
                </div>

                <div class="lessons-container">
                    ${lessonsHtml}
                </div>

                <!-- LỜI KHUYÊN DÀNH CHO TRẺ (2 CỘT NÊN / KHÔNG NÊN) - rõ ràng, dễ nhớ -->
                <div class="advice-box" aria-label="Lời khuyên an toàn dành cho em">
                    <div class="advice-box-title">📋 LỜI KHUYÊN DÀNH CHO EM</div>
                    <div class="advice-grid">
                        <div class="advice-do">
                            <div class="advice-header-do">✅ NÊN LÀM</div>
                            <div class="advice-item">Hỏi bố mẹ hoặc cô giáo trước khi bấm vào bất kỳ link nào</div>
                            <div class="advice-item">Gọi điện hoặc gặp trực tiếp để xác nhận khi thấy nghi ngờ</div>
                            <div class="advice-item">Báo ngay cho người lớn khi nhận được tin nhắn lạ</div>
                        </div>
                        <div class="advice-dont">
                            <div class="advice-header-dont">❌ KHÔNG NÊN</div>
                            <div class="advice-item">Không bấm vào link lạ, dù người gửi là bạn bè hay người quen</div>
                            <div class="advice-item">Không cung cấp địa chỉ nhà, số điện thoại trên mạng</div>
                            <div class="advice-item">Không tự mình xử lý khi thấy dấu hiệu lừa đảo</div>
                        </div>
                    </div>
                    <div class="advice-motto">💡 Ghi nhớ: <b>"Nghi ngờ → Hỏi người lớn → An toàn!"</b></div>
                </div>

                <!-- LUÔN HIỂN THỊ ĐỦ 3 KỸ NĂNG ĐÃ HỌC (BẤT KỂ NHÁNH NÀO) -->
                <div class="skills-mastered-box">
                    <div class="skills-title">🛡️ 3 KỸ NĂNG AN TOÀN TRỰC TUYẾN ĐÃ HỌC:</div>
                    <div class="skills-list">
                        <div class="skill-row">
                            <span>🔗</span>
                            <span>Nhận biết đường link đáng ngờ & tên miền bị lệch</span>
                        </div>
                        <div class="skill-row">
                            <span>🏠</span>
                            <span>Bảo vệ thông tin về nơi ở và số điện thoại cá nhân</span>
                        </div>
                        <div class="skill-row">
                            <span>🛑</span>
                            <span>Không click theo lời người khác (dù là người quen)</span>
                        </div>
                    </div>
                </div>

                <div class="summary-actions">
                    <button id="btn-summary-replay" class="btn-summary-replay">🔄 CHƠI LẠI LEVEL 1</button>
                    <button id="btn-summary-continue" class="btn-summary-continue">TIẾP TỤC HÀNH TRÌNH ▶</button>
                </div>
            `;

            document.getElementById('btn-summary-replay')?.addEventListener('click', () => this.replay());
            document.getElementById('btn-summary-continue')?.addEventListener('click', () => this.continueJourney());

            // Phát Custom Event cho hệ thống ngoài lắng nghe
            window.dispatchEvent(new CustomEvent('level1:complete', {
                detail: {
                    path: branch,
                    xp: xpNumber,
                    badge: badgeName
                }
            }));
        },

        replay() {
            resetLevel1();
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
    // 9.5 OUTRO FALLBACK SCENE (Hiển thị thay cho video khi video không load được)
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

        // Hiển thị fallback panel cho 1 nhánh cụ thể
        show(branch, onContinue) {
            const data = this._getBranchData(branch);
            if (!data) {
                if (onContinue) onContinue();
                return;
            }

            this._continueHandler = onContinue || null;

            if (this.panel) {
                this.panel.classList.remove('hidden', 'branch-a', 'branch-b', 'branch-c');
                this.panel.classList.add(`branch-${branch.toLowerCase()}`);
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

            // Re-attach listener AFTER innerHTML (button element was just replaced by show())
            const newCtaBtn = document.getElementById('outro-fallback-continue');
            if (newCtaBtn) {
                newCtaBtn.addEventListener('click', () => {
                    if (this._continueHandler) this._continueHandler();
                });
            }
            if (this.ctaBtn) this.ctaBtn.textContent = data.ctaText || 'XEM BÀI HỌC CHI TIẾT ▶';

            // TỰ ĐỘNG CHUYỂN SANG SUMMARY SAU 5 GIÂY (không cần click)
            // User vẫn có thể click nút để chuyển ngay
            this._startAutoProceedCountdown();
        },

        _startAutoProceedCountdown() {
            // Huỷ timer cũ nếu có (ngăn chồng timer)
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
                if (btn) {
                    btn.textContent = `XEM BÀI HỌC CHI TIẾT ▶ (${countdown}s)`;
                }
            }, 1000);

            // Tự động chuyển sau 5 giây
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
            // Reset button text
            const btn = document.getElementById('outro-fallback-continue');
            if (btn) {
                btn.textContent = 'XEM BÀI HỌC CHI TIẾT ▶';
            }
        },

        hide() {
            this._cancelAutoProceed();
            if (this.panel) {
                this.panel.classList.add('hidden');
            }
            this._continueHandler = null;
        },

        _getBranchData(branch) {
            const dataMap = {
                'A': {
                    icon: '😮',
                    title: 'ÔI KHÔNG! ĐÃ BẤM VÀO LINK LẠ',
                    message: 'Bằng cách bấm vào link và điền địa chỉ nhà, con đã vô tình gửi thông tin cá nhân cho kẻ lừa đảo. Hãy xem hậu quả và bài học:',
                    ctaText: 'XEM HẬU QUẢ & CÁCH PHÒNG TRÁNH ▶',
                    lessons: [
                        { icon: '⚠️', text: '<b>Mất an toàn:</b> Kẻ xấu biết chính xác địa chỉ nhà con, có thể mạo danh shipper giao hàng để theo dõi.' },
                        { icon: '🏠', text: '<b>Nguy hiểm cho cả gia đình:</b> Thông tin có thể bị bán cho người lạ hoặc dùng để tống tiền, đe dọa.' },
                        { icon: '🔓', text: '<b>Tài khoản bị xâm nhập:</b> Mật khẩu, email, số điện thoại có thể bị đánh cắp và lạm dụng.' },
                        { icon: '💪', text: '<b>Không sao cả!</b> Đây là bài học quý giá. Lần sau hãy LUÔN hỏi bố mẹ/cô giáo trước khi bấm bất kỳ link nào nhé!' }
                    ]
                },
                'B': {
                    icon: '🤔',
                    title: 'PHẢN XẠ TỐT — NHƯNG CHƯA ĐỦ AN TOÀN',
                    message: 'Con đã có ý thức không bấm ngay. Tuy nhiên, chỉ hỏi lớp trưởng qua tin nhắn vẫn có rủi ro. Hãy xem chi tiết:',
                    ctaText: 'XEM CÁCH XÁC MINH AN TOÀN HƠN ▶',
                    lessons: [
                        { icon: '💬', text: '<b>Phản xạ tốt:</b> Con đã biết không bấm ngay vào link mà muốn kiểm tra nguồn gốc.' },
                        { icon: '⚠️', text: '<b>Rủi ro tiềm ẩn:</b> Kẻ xấu có thể đã hack (chiếm đoạt) tài khoản của lớp trưởng để nhắn lừa đảo hàng loạt.' },
                        { icon: '📞', text: '<b>Cách xác minh an toàn hơn:</b> Gọi điện thoại trực tiếp HOẶC gặp mặt lớp trưởng để xác nhận link.' },
                        { icon: '👨‍🏫', text: '<b>Báo cho người lớn:</b> Thông báo cho thầy cô giáo hoặc phụ huynh để cùng xử lý và cảnh báo bạn bè khác.' }
                    ]
                },
                'C': {
                    icon: '🛡️',
                    title: 'XUẤT SẮC! ĐÃ BẢO VỆ AN TOÀN',
                    message: 'Bằng cách không bấm link và nhờ người lớn hỗ trợ, con đã bảo vệ an toàn cho cả gia đình. Đây là hành động của một Hiệp Sĩ Mạng:',
                    ctaText: 'XEM BÀI HỌC ĐÃ HỌC ĐƯỢC ▶',
                    lessons: [
                        { icon: '🎉', text: '<b>Xuất sắc!</b> Con đã phát hiện dấu hiệu lừa đảo và chọn phương án an toàn nhất.' },
                        { icon: '🛑', text: '<b>Nguyên tắc Hiệp Sĩ:</b> Không bao giờ click vào link lạ dù người gửi là bạn bè hay người quen.' },
                        { icon: '🏠', text: '<b>Bảo vệ tổ ấm:</b> Con đã bảo vệ an toàn cho cả gia đình khi không cung cấp địa chỉ nhà!' },
                        { icon: '🌟', text: '<b>Lời khen:</b> Con là tấm gương sáng về an toàn trực tuyến cho bạn bè và em nhỏ!' }
                    ]
                }
            };
            return dataMap[branch] || null;
        }
    };

    // =========================================================================
    // =========================================================================

    function resetLevel1() {
        stopAllVideos();
        if (MinigameScene.game) {
            MinigameScene.game.reset();
        }

        State.chosenPath = null;
        State.gameStats = null;

        FreezeFrame.crossfade(() => {
            switchStage('intro');
            VideoController.playIntro();
        });
    }

    // =========================================================================
    // 11. GLOBAL STAGE SWITCHER & DEBUG FLAGS
    // =========================================================================

    function switchStage(targetStage) {
        State.currentStage = targetStage;
        const stages = ['intro', 'game', 'outro', 'summary'];
        stages.forEach(s => {
            const el = document.getElementById(`stage-${s}`);
            if (el) {
                if (s === targetStage) {
                    el.classList.add('active');
                    // FORCE: Đảm bảo stage active luôn có z-index cao nhất
                    // CRITICAL FIX: summary phải hiện trên tất cả các stage khác
                    el.style.zIndex = '100';
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                    el.style.visibility = 'visible';
                    el.style.pointerEvents = 'auto';
                } else {
                    el.classList.remove('active');
                    // CRITICAL FIX: Các stage không active không được đè lên summary
                    el.style.zIndex = '10';
                }
            }
        });

        // CRITICAL FIX: Pause particle system khi vào summary để tránh canvas che màn hình
        if (targetStage === 'summary') {
            // Pause particle animation
            if (window.ParticleSystem && typeof window.ParticleSystem.stop === 'function') {
                window.ParticleSystem.stop();
            }
            // Ẩn particle canvas để không che Summary
            const particleCanvas = document.getElementById('particle-canvas');
            if (particleCanvas) {
                particleCanvas.style.display = 'none';
            }
            // Đảm bảo freeze canvas cũng ẩn
            if (FreezeFrame.canvas) {
                FreezeFrame.canvas.style.opacity = '0';
            }
        }

        // Ẩn top bar ở summary (nút CHƠI LẠI ở dưới cùng của card, không cần nút THOÁT trên cùng)
        if (targetStage === 'summary') {
            const topBar = document.getElementById('level1-top-bar');
            if (topBar) {
                topBar.style.display = 'none';
            }
            // Cũng ẩn nút skip video ở Summary
            const skipBtn = document.getElementById('btn-skip-video');
            if (skipBtn) {
                skipBtn.style.display = 'none';
            }
        } else {
            const topBar = document.getElementById('level1-top-bar');
            if (topBar) {
                topBar.style.display = '';
            }
            // skipBtn sẽ tự động hiện/ẩn theo state của game, không cần force ở đây
        }

        // Resume particle loop khi quay lại stage game (không cần particle ở video stage)
        const needsParticles = (targetStage === 'game');
        if (needsParticles) {
            // Hiện lại particle canvas
            const particleCanvas = document.getElementById('particle-canvas');
            if (particleCanvas) {
                particleCanvas.style.display = '';
                particleCanvas.style.opacity = '';
            }
            if (window.ParticleSystem && typeof window.ParticleSystem.resume === 'function') {
                window.ParticleSystem.resume();
            }
        }

        TopBar.updateVisibility(targetStage);
    }

    // Xử lý các cờ debug URL param: ?skip=intro, ?skip=game, ?skip=catchgame, ?skip=decision, ?skip=summary-A, v.v.
    function handleDebugFlags() {
        const urlParams = new URLSearchParams(window.location.search);
        const skip = urlParams.get('skip');

        if (skip === 'intro' || skip === 'game' || skip === 'catchgame') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('game');
            MinigameScene.start();
            return true;
        }

        if (skip === 'decision') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('game');
            MinigameScene.showDecisionScreen();
            return true;
        }

        if (skip === 'summary-A') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'A';
            switchStage('summary');
            SummaryScene.render('A');
            return true;
        }

        if (skip === 'summary-B') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'B';
            switchStage('summary');
            SummaryScene.render('B');
            return true;
        }

        if (skip === 'summary-C') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            State.chosenPath = 'C';
            switchStage('summary');
            SummaryScene.render('C');
            return true;
        }

        // Debug: ?skip=outro-A/B/C để test trực tiếp video hậu quả mà không cần chơi game
        if (skip === 'outro-A' || skip === 'outro-B' || skip === 'outro-C') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            const branch = skip.slice(-1); // 'A' | 'B' | 'C'
            State.chosenPath = branch;
            VideoController.playOutro(branch);
            return true;
        }

        return false;
    }

    // Khởi chạy khi DOM sẵn sàng
    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        TopBar.init();
        VideoController.init();
        MinigameScene.init();
        SummaryScene.init();
        OutroFallbackScene.init();
        ParticleSystem.init();

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
