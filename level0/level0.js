/**
 * CYBERKNIGHT — LEVEL 0: "MÁY SOI KIM CƯƠNG" (HỘP QUÀ BÍ ẨN)
 * Core Controller: State Machine, Freeze-Frame Transitions, Audio Synth & Minigame Engine
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. STATE MACHINE & CONFIGURATION
    // =========================================================================

    const CONFIG = {
        SCAN_THRESHOLD: 1.0,       // Đạt 100% diện tích soi thì phát hiện mã độc
        COUNTDOWN_SECONDS: 15,     // 15 giây đếm ngược clickbait
        GRACE_SECONDS: 5,          // 5 giây gia hạn khi hết giờ lần đầu
        TRANSITION_MS: 500,        // Thời gian chuyển cảnh crossfade
        VIDEO_PATHS: {
            intro: [
                '../video/level 0/intro.mp4',
                '../video/level 0/Vd tình huống.mp4',
                '/video/level 0/intro.mp4'
            ],
            bad: [
                '../video/level 0/bad.mp4',
                '../video/level 0/hậu quả xấu .mp4',
                '/video/level 0/bad.mp4'
            ],
            good: [
                '../video/level 0/good.mp4',
                '../video/level 0/hậu quả tốt .mp4',
                '/video/level 0/good.mp4'
            ]
        }
    };

    const State = {
        currentStage: 'intro',      // 'intro' | 'game' | 'outro' | 'summary'
        chosenPath: null,           // 'good' | 'bad'
        scanRatio: 0,               // 0.0 -> 1.0
        isVirusRevealed: false,
        countdownRemaining: CONFIG.COUNTDOWN_SECONDS,
        countdownTimer: null,
        hasPausedOnce: false,       // Đã pause gợi ý lần đầu chưa
        isDraggingMagnifier: false,
        particles: []
    };

    // =========================================================================
    // 2. SYNTHESIZED WEB AUDIO CONTROLLER (Không lo 404 file mp3)
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

        // Tiếng "tách / click" nhẹ khi tương tác
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

        // Tiếng rà quét điện tử (scanner hum)
        playScanHum() {
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(320, this.ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(540, this.ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.08);
        }

        // Còi cảnh báo khi phát hiện Virus (2-tone Siren)
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

        // Hiệu ứng nổ / glitch khi bấm nhầm clickbait
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

        // Hợp âm chiến thắng khi từ chối bẫy độc hại (Arpeggio Chime)
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
    // 3. FREEZE-FRAME CROSSFADE (Nguyên tắc: Không bao giờ để màn hình đen)
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

        // Chụp khung hình hiện tại từ thẻ video hoặc vẽ nền game
        captureFromVideo(videoEl) {
            if (!this.ctx || !videoEl || videoEl.readyState < 2) return false;
            try {
                this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);
                return true;
            } catch (err) {
                console.warn('⚠️ Freeze frame capture notice:', err.message);
                return false;
            }
        },

        // Thực hiện crossfade: hiện freeze frame -> đổi DOM stage -> fade out freeze frame
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
    // 4. VIDEO CONTROLLER (Mở đầu & Rẽ nhánh Hậu quả)
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

            // Nút bỏ qua video (cho phụ huynh / dev test)
            const skipIntroBtn = document.getElementById('btn-skip-intro');
            if (skipIntroBtn) {
                skipIntroBtn.addEventListener('click', () => {
                    this.onIntroNearEnd();
                });
            }

            const skipOutroBtn = document.getElementById('btn-skip-outro');
            if (skipOutroBtn) {
                skipOutroBtn.addEventListener('click', () => {
                    this.onOutroEnded();
                });
            }
        },

        setupVideoFallback(videoEl, pathList) {
            if (!videoEl || !pathList || pathList.length === 0) return;
            let currentIdx = 0;
            videoEl.src = pathList[0];

            videoEl.addEventListener('error', () => {
                currentIdx++;
                if (currentIdx < pathList.length) {
                    console.warn(`🔄 Thử tải đường dẫn dự phòng cho video: ${pathList[currentIdx]}`);
                    videoEl.src = pathList[currentIdx];
                    videoEl.load();
                }
            });
        },

        playIntro() {
            if (!this.introVideo) return;
            this.introEndHandlerTriggered = false;
            this.introVideo.currentTime = 0;
            const playPromise = this.introVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    console.log('Autoplay audio bị chặn; video sẽ phát muted hoặc chờ tương tác');
                });
            }
        },

        onIntroNearEnd() {
            // Chụp frame cuối thẻ video vào freeze canvas
            FreezeFrame.captureFromVideo(this.introVideo);
            if (this.introVideo) this.introVideo.pause();

            // Chuyển cảnh sang Stage 2: Mini-game
            FreezeFrame.crossfade(() => {
                switchStage('game');
                MinigameScene.start();
            });
        },

        playOutro(branch) {
            // Reset flag for replay
            this._outroEnded = false;

            if (!this.outroVideo) {
                // No video element — skip directly to summary
                switchStage('summary');
                SummaryScene.render(State.chosenPath);
                return;
            }

            // Determine which preloaded video and path list to use
            const preloadEl = branch === 'good' ? this.preloadGood : this.preloadBad;
            const paths = branch === 'good' ? CONFIG.VIDEO_PATHS.good : CONFIG.VIDEO_PATHS.bad;

            // Try to use preloaded video src if it's ready
            let srcToUse = null;
            if (preloadEl && preloadEl.readyState >= 2 && preloadEl.src) {
                srcToUse = preloadEl.src;
            }

            // Clean up any previous error listeners on outroVideo to prevent accumulation
            const oldOnError = this._outroErrorHandler;
            if (oldOnError) {
                this.outroVideo.removeEventListener('error', oldOnError);
            }

            if (srcToUse) {
                // Use the preloaded src directly
                this.outroVideo.src = srcToUse;
            } else {
                // Fallback: set src from path list and load
                let fallbackIdx = 0;
                this.outroVideo.src = paths[0];

                this._outroErrorHandler = () => {
                    fallbackIdx++;
                    if (fallbackIdx < paths.length) {
                        console.warn(`🔄 Thử tải đường dẫn dự phòng: ${paths[fallbackIdx]}`);
                        this.outroVideo.src = paths[fallbackIdx];
                        this.outroVideo.load();
                    } else {
                        // All paths failed — go to summary
                        console.warn('⚠️ Tất cả đường dẫn video outro đều thất bại');
                        this.onOutroEnded();
                    }
                };
                this.outroVideo.addEventListener('error', this._outroErrorHandler);
            }

            this.outroVideo.load();
            this.outroVideo.currentTime = 0;

            // Safety fallback: if video doesn't play within 5s, skip to summary
            clearTimeout(this._outroFallbackTimer);
            this._outroFallbackTimer = setTimeout(() => {
                if (!this._outroEnded) {
                    console.warn('⚠️ Outro video timeout — skipping to summary');
                    this.onOutroEnded();
                }
            }, 5000);

            // Attempt to play
            const playPromise = this.outroVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.warn('Outro play err:', e);
                    // If play fails, go to summary after a short delay
                    if (!this._outroEnded) {
                        clearTimeout(this._outroFallbackTimer);
                        setTimeout(() => this.onOutroEnded(), 500);
                    }
                });
            }
        },

        onOutroEnded() {
            // Prevent double-fire
            if (this._outroEnded) return;
            this._outroEnded = true;
            clearTimeout(this._outroFallbackTimer);

            // Pause and clean up video
            if (this.outroVideo) {
                try { this.outroVideo.pause(); } catch (e) {}
                // Remove accumulated error handler
                if (this._outroErrorHandler) {
                    this.outroVideo.removeEventListener('error', this._outroErrorHandler);
                    this._outroErrorHandler = null;
                }
            }

            // Directly switch to summary (no FreezeFrame — avoids white screen bug)
            switchStage('summary');
            SummaryScene.render(State.chosenPath);
        }
    };

    // =========================================================================
    // 5. MINIGAME SCENE: "MÁY SOI KIM CƯƠNG"
    // =========================================================================

    const MinigameScene = {
        scratchCanvas: null,
        scratchCtx: null,
        magnifier: null,
        actionBtn: null,
        dualContainer: null,
        btnDecisionBad: null,
        btnDecisionGood: null,
        cardWrapper: null,
        beam: null,
        hintBubble: null,
        progressBar: null,
        progressText: null,
        countdownCircle: null,
        countdownText: null,
        lastScanSoundTime: 0,

        init() {
            this.scratchCanvas = document.getElementById('scratch-canvas');
            this.magnifier = document.getElementById('magnifier-tool');
            this.actionBtn = document.getElementById('btn-action');
            this.dualContainer = document.getElementById('dual-decision-container');
            this.btnDecisionBad = document.getElementById('btn-decision-bad');
            this.btnDecisionGood = document.getElementById('btn-decision-good');
            this.cardWrapper = document.getElementById('gift-card-wrapper');
            this.beam = document.getElementById('scanner-light-beam');
            this.hintBubble = document.getElementById('hint-speech-bubble');
            this.progressBar = document.getElementById('scan-progress-bar');
            this.progressText = document.getElementById('scan-progress-text');
            this.countdownCircle = document.getElementById('countdown-circle');
            this.countdownText = document.getElementById('countdown-text');

            if (this.scratchCanvas) {
                this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: true });
                this.resetScratchLayer();
            }

            this.setupMagnifierDrag();
            this.setupActionButton();
            ParticleSystem.init();
        },

        start() {
            State.scanRatio = 0;
            State.isVirusRevealed = false;
            State.countdownRemaining = CONFIG.COUNTDOWN_SECONDS;
            State.hasPausedOnce = false;

            this.resetScratchLayer();
            this.updateProgressBar(0);
            this.resetActionButton();
            this.startCountdown();

            if (this.hintBubble) {
                this.hintBubble.classList.remove('visible');
            }

            // Đặt lại vị trí kính lúp
            if (this.magnifier) {
                this.magnifier.style.transform = 'translate3d(0, 0, 0)';
            }
        },

        resetScratchLayer() {
            if (!this.scratchCanvas || !this.scratchCtx) return;
            const rect = this.scratchCanvas.getBoundingClientRect();
            this.scratchCanvas.width = rect.width || 296;
            this.scratchCanvas.height = rect.height || 296;

            // Phủ lớp mặt nạ che giấu chi tiết bên dưới
            this.scratchCtx.globalCompositeOperation = 'source-over';
            this.scratchCtx.fillStyle = 'rgba(200, 220, 255, 0.94)';
            this.scratchCtx.fillRect(0, 0, this.scratchCanvas.width, this.scratchCanvas.height);

            // Vẽ viền hướng dẫn soi
            this.scratchCtx.strokeStyle = 'rgba(0, 102, 255, 0.25)';
            this.scratchCtx.lineWidth = 4;
            this.scratchCtx.strokeRect(6, 6, this.scratchCanvas.width - 12, this.scratchCanvas.height - 12);
        },

        setupMagnifierDrag() {
            if (!this.magnifier) return;

            let isDragging = false;
            let startX = 0;
            let startY = 0;
            let currentX = 0;
            let currentY = 0;

            const onStart = (e) => {
                isDragging = true;
                State.isDraggingMagnifier = true;
                sound.init();
                sound.playTick();

                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                startX = clientX - currentX;
                startY = clientY - currentY;

                this.magnifier.classList.add('dragging');
                if (this.beam) this.beam.style.display = 'block';

                e.preventDefault();
            };

            const onMove = (e) => {
                if (!isDragging) return;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;

                currentX = clientX - startX;
                currentY = clientY - startY;

                this.magnifier.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;

                // Cập nhật vị trí vệt sáng theo kính lúp
                if (this.beam) {
                    this.beam.style.left = `${clientX}px`;
                    this.beam.style.top = `${clientY}px`;
                }

                // Thực hiện quét/soi lên canvas hộp quà
                this.performScanAt(clientX, clientY);
                e.preventDefault();
            };

            const onEnd = () => {
                if (!isDragging) return;
                isDragging = false;
                State.isDraggingMagnifier = false;
                this.magnifier.classList.remove('dragging');
                if (this.beam) this.beam.style.display = 'none';
            };

            this.magnifier.addEventListener('mousedown', onStart);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onEnd);

            this.magnifier.addEventListener('touchstart', onStart, { passive: false });
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onEnd);
        },

        performScanAt(screenX, screenY) {
            if (!this.scratchCanvas || !this.scratchCtx) return;
            const rect = this.scratchCanvas.getBoundingClientRect();

            // Kiểm tra xem vị trí kính lúp có nằm trong phạm vi hộp quà không
            if (
                screenX >= rect.left - 20 &&
                screenX <= rect.right + 20 &&
                screenY >= rect.top - 20 &&
                screenY <= rect.bottom + 20
            ) {
                const canvasX = screenX - rect.left;
                const canvasY = screenY - rect.top;

                // Cạo lớp phủ để lộ chi tiết (destination-out)
                this.scratchCtx.save();
                this.scratchCtx.globalCompositeOperation = 'destination-out';
                const radius = 45; // Bán kính vòng soi kính lúp
                const grad = this.scratchCtx.createRadialGradient(canvasX, canvasY, 0, canvasX, canvasY, radius);
                grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
                grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.85)');
                grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                this.scratchCtx.fillStyle = grad;
                this.scratchCtx.beginPath();
                this.scratchCtx.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
                this.scratchCtx.fill();
                this.scratchCtx.restore();

                // Âm thanh quét mỗi 140ms
                const now = performance.now();
                if (now - this.lastScanSoundTime > 140) {
                    sound.playScanHum();
                    this.lastScanSoundTime = now;
                }

                // Tính toán tỷ lệ phần trăm đã soi
                this.calculateScanRatio();
            }
        },

        calculateScanRatio() {
            if (!this.scratchCanvas || !this.scratchCtx || State.isVirusRevealed) return;

            // Đọc mẫu điểm ảnh vùng trung tâm để tối ưu hiệu năng
            const w = this.scratchCanvas.width;
            const h = this.scratchCanvas.height;
            const sampleStep = 8;
            const imgData = this.scratchCtx.getImageData(0, 0, w, h);
            const pixels = imgData.data;

            let transparentCount = 0;
            let totalSampled = 0;

            for (let y = 0; y < h; y += sampleStep) {
                for (let x = 0; x < w; x += sampleStep) {
                    const idx = (y * w + x) * 4;
                    const alpha = pixels[idx + 3];
                    if (alpha < 80) {
                        transparentCount++;
                    }
                    totalSampled++;
                }
            }

            // Tỷ lệ soi đạt 100% khi người chơi rà quanh vùng hộp quà
            State.scanRatio = Math.min(1, transparentCount / (totalSampled * 0.48));
            this.updateProgressBar(State.scanRatio);

            // Khi soi đạt 100% -> Kích hoạt phát hiện mã độc và mở 2 lựa chọn song song
            if (State.scanRatio >= CONFIG.SCAN_THRESHOLD && !State.isVirusRevealed) {
                this.onVirusRevealed();
            }
        },

        updateProgressBar(ratio) {
            const pct = Math.round(ratio * 100);
            if (this.progressBar) {
                this.progressBar.style.width = `${pct}%`;
                if (ratio >= CONFIG.SCAN_THRESHOLD) {
                    this.progressBar.classList.add('danger');
                } else {
                    this.progressBar.classList.remove('danger');
                }
            }
            if (this.progressText) {
                this.progressText.textContent = `${pct}%`;
            }
        },

        onVirusRevealed() {
            State.isVirusRevealed = true;
            sound.playDangerAlert();

            // Đảm bảo thanh tiến độ đạt 100% và trạng thái cảnh báo nguy hiểm
            this.updateProgressBar(1);

            // Dọn sạch hoàn toàn lớp phủ scratch để lộ rõ toàn bộ con Virus và cảnh báo
            if (this.scratchCtx && this.scratchCanvas) {
                this.scratchCtx.clearRect(0, 0, this.scratchCanvas.width, this.scratchCanvas.height);
            }

            // Hiệu ứng rung màn hình cảnh báo
            const arena = document.querySelector('.game-arena');
            if (arena) {
                arena.classList.add('screen-shake');
                setTimeout(() => arena.classList.remove('screen-shake'), 450);
            }

            // Hộp quà chuyển sang trạng thái cảnh báo nguy hiểm
            if (this.cardWrapper) {
                this.cardWrapper.classList.add('danger');
            }

            // Ẩn nút mồi nhử đơn ban đầu
            if (this.actionBtn) {
                this.actionBtn.classList.add('hidden');
            }

            // Hiện SONG SONG 2 lựa chọn bình đẳng, kích thước bằng nhau, không thiên vị
            if (this.dualContainer) {
                this.dualContainer.classList.remove('hidden');
            }

            // Dừng và chuyển vòng tròn đếm ngược sang trạng thái an toàn
            if (this.countdownCircle) {
                this.countdownCircle.classList.remove('danger');
                this.countdownCircle.classList.add('paused');
            }
            clearInterval(State.countdownTimer);

            // Bong bóng thông báo trung lập để trẻ tự đưa ra quyết định
            if (this.hintBubble) {
                this.hintBubble.innerHTML = `
                    <span style="color: #FF4757; font-weight: 800;">⚠️ PHÁT HIỆN MÃ ĐỘC!</span><br>
                    Hộp quà chứa mã độc nguy hiểm! Con hãy đưa ra lựa chọn của mình.
                `;
                this.hintBubble.classList.add('visible');
            }
        },

        setupActionButton() {
            if (this.actionBtn) {
                this.actionBtn.addEventListener('click', () => {
                    sound.init();
                    // Trẻ bấm nhận quà ngay trước khi kiểm tra -> NHÁNH XẤU
                    this.choosePath('bad');
                });
            }

            if (this.btnDecisionBad) {
                this.btnDecisionBad.addEventListener('click', () => {
                    sound.init();
                    // Trẻ vẫn quyết định nhận quà dù đã biết có virus -> NHÁNH XẤU
                    this.choosePath('bad');
                });
            }

            if (this.btnDecisionGood) {
                this.btnDecisionGood.addEventListener('click', () => {
                    sound.init();
                    // Trẻ quyết định không nhận quà sau khi phát hiện mã độc -> NHÁNH TỐT
                    this.choosePath('good');
                });
            }
        },

        resetActionButton() {
            if (this.actionBtn) {
                this.actionBtn.classList.remove('hidden');
                this.actionBtn.className = 'btn-game-action bait-state';
                this.actionBtn.innerHTML = `
                    <span class="flex items-center gap-2">
                        🎁 NHẬN NGAY!
                    </span>
                `;
            }
            if (this.dualContainer) {
                this.dualContainer.classList.add('hidden');
            }
            if (this.cardWrapper) {
                this.cardWrapper.classList.remove('danger');
            }
        },

        startCountdown() {
            clearInterval(State.countdownTimer);
            const total = CONFIG.COUNTDOWN_SECONDS;
            const circleLength = 201; // 2 * PI * 32

            const updateDisplay = () => {
                if (this.countdownText) {
                    this.countdownText.textContent = State.countdownRemaining;
                }
                if (this.countdownCircle) {
                    const offset = circleLength - (State.countdownRemaining / total) * circleLength;
                    this.countdownCircle.style.strokeDashoffset = offset;
                    if (State.countdownRemaining <= 5) {
                        this.countdownCircle.classList.add('danger');
                    } else {
                        this.countdownCircle.classList.remove('danger');
                    }
                }
            };

            updateDisplay();

            State.countdownTimer = setInterval(() => {
                State.countdownRemaining--;
                updateDisplay();

                if (State.countdownRemaining <= 0) {
                    clearInterval(State.countdownTimer);
                    this.onCountdownZero();
                }
            }, 1000);
        },

        onCountdownZero() {
            // Lần 1: Hiển thị gợi ý cho trẻ nhỏ và gia hạn thêm 5 giây
            if (!State.hasPausedOnce && !State.isVirusRevealed) {
                State.hasPausedOnce = true;
                State.countdownRemaining = CONFIG.GRACE_SECONDS;
                if (this.hintBubble) {
                    this.hintBubble.innerHTML = `
                        💡 <b>Khoan đã!</b> Con hãy dùng <b>kính lúp 🔍</b> ở góc dưới để kiểm tra hộp quà trước nhé!
                    `;
                    this.hintBubble.classList.add('visible');
                }
                this.startCountdown();
            } else if (!State.isVirusRevealed) {
                // Lần 2 vẫn không làm gì -> Coi như mặc định dính bẫy (nhánh xấu)
                this.choosePath('bad');
            }
        },

        choosePath(branch) {
            clearInterval(State.countdownTimer);
            State.chosenPath = branch;

            if (branch === 'bad') {
                // Hiệu ứng nổ vỡ kim cương thành mã độc
                sound.playGlitchExplosion();
                ParticleSystem.burstMalware();

                // Rung màn hình
                const arena = document.querySelector('.game-arena');
                if (arena) arena.classList.add('screen-shake');

                setTimeout(() => {
                    this.transitionToOutro('bad');
                }, 400);
            } else {
                // Hiệu ứng khiên bảo vệ CyberKnight
                sound.playVictoryChime();
                ParticleSystem.burstShield();

                setTimeout(() => {
                    this.transitionToOutro('good');
                }, 400);
            }
        },

        transitionToOutro(branch) {
            FreezeFrame.crossfade(() => {
                switchStage('outro');
                VideoController.playOutro(branch);
            });
        }
    };

    // =========================================================================
    // 6. PARTICLE SYSTEM (Kim cương lấp lánh & Vụ nổ glitch)
    // =========================================================================

    const ParticleSystem = {
        canvas: null,
        ctx: null,
        particles: [],
        animId: null,

        init() {
            this.canvas = document.getElementById('particle-canvas');
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
            for (let i = 0; i < 22; i++) {
                this.particles.push({
                    x: Math.random() * (this.canvas ? this.canvas.width : 400),
                    y: Math.random() * (this.canvas ? this.canvas.height : 400),
                    size: Math.random() * 8 + 4,
                    speedY: -(Math.random() * 0.6 + 0.2),
                    speedX: (Math.random() - 0.5) * 0.4,
                    alpha: Math.random() * 0.6 + 0.3,
                    color: Math.random() > 0.5 ? '#FFD700' : '#5BA8FF',
                    type: 'diamond'
                });
            }
        },

        burstMalware() {
            for (let i = 0; i < 40; i++) {
                this.particles.push({
                    x: this.canvas.width / 2,
                    y: this.canvas.height / 2,
                    size: Math.random() * 12 + 6,
                    speedX: (Math.random() - 0.5) * 12,
                    speedY: (Math.random() - 0.5) * 12,
                    alpha: 1,
                    color: Math.random() > 0.5 ? '#FF4757' : '#FF6B9D',
                    type: 'glitch'
                });
            }
        },

        burstShield() {
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
                    // Vẽ hình thoi kim cương lấp lánh
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x, p.y - p.size);
                    this.ctx.lineTo(p.x + p.size, p.y);
                    this.ctx.lineTo(p.x, p.y + p.size);
                    this.ctx.lineTo(p.x - p.size, p.y);
                    this.ctx.closePath();
                    this.ctx.fill();
                } else {
                    // Vẽ hạt glitch pixel vuông
                    this.ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                }
                this.ctx.restore();
            }

            this.animId = requestAnimationFrame(() => this.loop());
        }
    };

    // =========================================================================
    // 7. SUMMARY SCENE: KẾT QUẢ & BÀI HỌC AN TOÀN MẠNG
    // =========================================================================

    const SummaryScene = {
        card: null,

        init() {
            this.card = document.getElementById('summary-card-container');
            const btnReplay = document.getElementById('btn-summary-replay');
            const btnContinue = document.getElementById('btn-summary-continue');

            if (btnReplay) {
                btnReplay.addEventListener('click', () => {
                    this.replay();
                });
            }

            if (btnContinue) {
                btnContinue.addEventListener('click', () => {
                    this.continueJourney();
                });
            }
        },

        render(branch) {
            const isGood = branch === 'good';
            if (!this.card) return;

            sound.init();
            if (isGood) {
                sound.playVictoryChime();
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 80,
                        spread: 70,
                        origin: { y: 0.6 }
                    });
                }
            } else {
                sound.playGlitchExplosion();
            }

            this.card.className = `summary-card ${isGood ? 'good-branch' : 'bad-branch'}`;

            const badgeIcon = isGood ? '🛡️' : '⚠️';
            const titleText = isGood ? 'XUẤT SẮC! BẢO VỆ MÁY TÍNH THÀNH CÔNG! 🎉' : 'CẢNH BÁO: MÁY TÍNH ĐÃ BỊ NHIỄM MÃ ĐỘC! 💡';
            const xpText = isGood ? '+20 XP' : '+5 XP (Khích lệ)';
            const badgeName = isGood ? '🏆 Hiệp Sĩ Cảnh Giác' : '📚 Cần Rút Kinh Nghiệm';

            const lessonsHtml = isGood ? `
                <div class="lesson-item">
                    🛡️ <b>Hành động chính xác:</b> Con đã dùng kính lúp soi kỹ tệp lạ, phát hiện đuôi <code>.exe</code> độc hại và kiên quyết chọn <b>"KHÔNG NHẬN"</b>.
                </div>
                <div class="lesson-item">
                    ✨ <b>Kết quả:</b> Máy tính an toàn tuyệt đối, dữ liệu cá nhân không bị đánh cắp và kẻ xấu không thể lợi dụng tài khoản của con!
                </div>
                <div class="lesson-item">
                    💡 <b>Quy tắc 3 KHÔNG hiệp sĩ mạng:</b><br>
                    1. <b>KHÔNG</b> tin quà tặng hay kim cương "miễn phí" bất ngờ trên mạng.<br>
                    2. <b>KHÔNG</b> tải tệp lạ khi chưa kiểm tra bằng mắt thần cảnh giác.<br>
                    3. <b>LUÔN HỎI</b> người lớn hoặc thầy cô khi gặp đường link đáng ngờ!
                </div>
            ` : `
                <div class="lesson-item">
                    💣 <b>Hậu quả vừa xảy ra:</b> Khi con bấm <b>"NHẬN QUÀ"</b> mà chưa soi kỹ, mã độc ẩn bên trong lập tức kích hoạt, làm đơ máy và kẻ xấu có thể xâm nhập lấy mất tài khoản!
                </div>
                <div class="lesson-item">
                    🔍 <b>Chiêu trò của kẻ xấu:</b> Kẻ xấu luôn dùng mồi nhử "Quà miễn phí", "Vật phẩm game hiếm" để kích thích sự tò mò của chúng ta.
                </div>
                <div class="lesson-item">
                    🛠️ <b>Cách khắc phục & bài học nhớ đời:</b><br>
                    1. <b>Bình tĩnh xử lý:</b> Rút dây mạng/tắt Wi-Fi ngay và báo cho người lớn quét virus.<br>
                    2. <b>Ghi nhớ:</b> "Miếng phô mai miễn phí thường nằm trong bẫy chuột" — Luôn soi trước, bấm sau!<br>
                    3. Hãy bấm <b>"CHƠI LẠI LEVEL 0"</b> bên dưới để thử lại và giành huy hiệu Hiệp Sĩ nhé! 💪
                </div>
            `;

            this.card.innerHTML = `
                <img src="../image/z8014995224177_069f99816bf77dda5fed3feb153a6c0e-removebg-preview.png" alt="CyberKnight" style="width: 140px; margin-top: -8px; filter: drop-shadow(0 6px 16px rgba(0, 102, 255, 0.18)); animation: icon-bounce 2s ease-in-out infinite;">
                <div class="summary-icon-badge">${badgeIcon}</div>
                <h2 class="summary-title">${titleText}</h2>
                <div class="summary-reward-box">
                    <span class="summary-reward-xp">⭐ ${xpText}</span>
                    <span class="summary-reward-badge">🛡️ ${badgeName}</span>
                </div>
                <div class="lessons-container">
                    ${lessonsHtml}
                </div>
                <div class="summary-actions">
                    <button id="btn-summary-replay" class="btn-summary-replay">🔄 CHƠI LẠI LEVEL 0</button>
                    <button id="btn-summary-continue" class="btn-summary-continue">TIẾP TỤC HÀNH TRÌNH ▶</button>
                </div>
            `;

            // Gán lại sự kiện nút bấm sau khi render động
            document.getElementById('btn-summary-replay')?.addEventListener('click', () => this.replay());
            document.getElementById('btn-summary-continue')?.addEventListener('click', () => this.continueJourney());

            // Phát Custom Event cho các component khác của game lắng nghe
            window.dispatchEvent(new CustomEvent('level0:complete', {
                detail: {
                    path: branch,
                    xp: isGood ? 20 : 5,
                    badge: badgeName
                }
            }));
        },

        replay() {
            FreezeFrame.crossfade(() => {
                switchStage('intro');
                VideoController.playIntro();
            });
        },

        continueJourney() {
            // Nếu được nhúng trong iframe (ở index.html), gửi thông điệp yêu cầu đóng modal fullscreen
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'closeGameModal' }, '*');
                    return;
                }
            } catch (err) {
                console.warn('postMessage error:', err);
            }
            // Nếu mở độc lập: chuyển hướng về trang chủ
            window.location.href = '../index.html';
        }
    };

    // =========================================================================
    // 8. GLOBAL STAGE SWITCHER & DEBUG FLAGS
    // =========================================================================

    function switchStage(targetStage) {
        State.currentStage = targetStage;
        const stages = ['intro', 'game', 'outro', 'summary'];
        stages.forEach(s => {
            const el = document.getElementById(`stage-${s}`);
            if (el) {
                if (s === targetStage) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            }
        });
    }

    // Xử lý các cờ debug URL param: ?skip=intro, ?skip=game, ?skip=summary-good, v.v.
    function handleDebugFlags() {
        const urlParams = new URLSearchParams(window.location.search);
        const skip = urlParams.get('skip');

        if (skip === 'intro' || skip === 'game') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('game');
            MinigameScene.start();
            return true;
        }

        if (skip === 'summary-good') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('summary');
            SummaryScene.render('good');
            return true;
        }

        if (skip === 'summary-bad') {
            document.getElementById('start-overlay')?.classList.add('hidden');
            switchStage('summary');
            SummaryScene.render('bad');
            return true;
        }

        return false;
    }

    // Khởi chạy toàn bộ ứng dụng khi DOM sẵn sàng
    document.addEventListener('DOMContentLoaded', () => {
        FreezeFrame.init();
        VideoController.init();
        MinigameScene.init();
        SummaryScene.init();

        const isSkipped = handleDebugFlags();
        if (isSkipped) return;

        // Bắt sự kiện nút bắt đầu để mở khóa Web Audio context
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
