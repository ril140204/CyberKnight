/**
 * CKVideo — bộ nạp video dùng chung cho các level (tối ưu mạng yếu)
 *
 * Thứ tự ưu tiên nguồn:
 *   1. HLS thích ứng (hls.js qua MediaSource) — tự đổi 360p/480p/720p theo băng thông
 *   2. HLS native (Safari iOS/macOS)
 *   3. MP4 720p progressive (fallback cuối)
 *
 * API:
 *   CKVideo.sources(level, name)            → { hls, mp4 } theo quy ước /video/level<N>/...
 *   CKVideo.load(video, sources, opts)      → Promise<'hls'|'native'|'mp4'>
 *        opts.preloadOnly  chỉ nạp manifest (cảnh kế tiếp), bắt đầu tải segment khi play()
 *        opts.force        nạp lại dù đang gắn đúng nguồn
 *        opts.timeoutMs    quá hạn → reject + phát sự kiện 'error' trên thẻ video
 *   CKVideo.prefetch(sources)               → làm ấm cache playlist + segment đầu 240p (~60 KB)
 *   CKVideo.warm(sources, {level, seconds})  → tải trước NHIỀU segment ở bậc ABR sẽ chọn, tuần tự,
 *                                              tự dừng khi có video đang phát (dùng ở màn chờ/mini-game)
 *   CKVideo.warmStatus()                    → trạng thái warm (để đo/debug)
 *   CKVideo.detach(video)                   → huỷ hls.js instance
 *
 * Khi mọi nguồn đều hỏng, loader phát sự kiện 'error' trên thẻ <video> để code level
 * (vốn lắng nghe 'error') xử lý như trước. Khi dữ liệu sẵn sàng, 'loadedmetadata' / 'canplay'
 * vẫn do trình duyệt phát như bình thường, kể cả ở chế độ hls.js (MediaSource).
 */
(function (global) {
    'use strict';

    const HLS_LIB_URL = '/assets/vendor/hls.light.min.js';
    const HLS_MIME = 'application/vnd.apple.mpegurl';

    const instances = new WeakMap();
    let hlsLibPromise = null;

    const HLS_CONFIG = {
        // Buffer vừa đủ: không tải trước quá nhiều, giải phóng phần đã xem
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        backBufferLength: 10,
        maxBufferSize: 8 * 1000 * 1000,
        // ABR: LUÔN khởi động ở bậc thấp nhất (240p, ~60 KB cho 2s đầu) để phát ngay cả trên 3G yếu,
        // rồi leo bậc dần khi đo được băng thông thực. Ước lượng ban đầu 300 kbps.
        startLevel: 0,
        abrEwmaDefaultEstimate: 300000,
        abrEwmaFastLive: 3,
        abrEwmaSlowLive: 9,
        abrEwmaFastVoD: 3,
        abrEwmaSlowVoD: 9,
        abrBandWidthFactor: 0.85,
        abrBandWidthUpFactor: 0.7,
        capLevelToPlayerSize: true,
        // Tải segment đầu ngay khi có manifest
        startFragPrefetch: true,
        // Retry kiên nhẫn hơn mặc định (mạng chập chờn)
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 16000,
        enableWorker: true,
        lowLatencyMode: false,
    };

    function hasMse() {
        try {
            return typeof global.MediaSource !== 'undefined'
                && typeof global.MediaSource.isTypeSupported === 'function'
                && global.MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f,mp4a.40.2"');
        } catch (e) { return false; }
    }

    function hasNativeHls(video) {
        try { return Boolean(video.canPlayType && video.canPlayType(HLS_MIME)); } catch (e) { return false; }
    }

    function loadHlsLib() {
        if (global.Hls) return Promise.resolve(global.Hls);
        if (hlsLibPromise) return hlsLibPromise;
        hlsLibPromise = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = HLS_LIB_URL;
            s.async = true;
            s.onload = () => resolve(global.Hls || null);
            s.onerror = () => { console.warn('[CKVideo] Không tải được hls.js → dùng MP4'); resolve(null); };
            document.head.appendChild(s);
        });
        return hlsLibPromise;
    }

    function detach(video) {
        const inst = instances.get(video);
        if (!inst) return;
        if (inst.cleanup) { try { inst.cleanup(); } catch (e) { /* ignore */ } }
        if (inst.hls) { try { inst.hls.destroy(); } catch (e) { /* ignore */ } }
        instances.delete(video);
    }

    function dispatchError(video) {
        try { video.dispatchEvent(new Event('error')); } catch (e) { /* ignore */ }
    }

    function sources(level, name) {
        return {
            hls: `/video/level${level}/hls/${name}/master.m3u8`,
            mp4: `/video/level${level}/${name}.mp4`,
        };
    }

    // ── Nguồn progressive (MP4) hoặc HLS native ─────────────────────────────
    function attachUrl(video, url, mode, opts, onReady, onFail) {
        const inst = { mode, src: url, started: !opts.preloadOnly, hls: null };
        const onMeta = () => { cleanup(); onReady(mode); };
        const onErr = () => { cleanup(); onFail(new Error(`${mode} failed: ${url}`)); };
        function cleanup() {
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('error', onErr);
        }
        inst.cleanup = cleanup;
        instances.set(video, inst);
        trackPlayback(video);

        video.addEventListener('loadedmetadata', onMeta, { once: true });
        video.addEventListener('error', onErr, { once: true });
        video.preload = opts.preloadOnly ? 'metadata' : 'auto';
        video.src = url;
        video.load();
        if (opts.preloadOnly) {
            video.addEventListener('play', () => { video.preload = 'auto'; }, { once: true });
        }
    }

    // ── Nguồn HLS qua hls.js ────────────────────────────────────────────────
    function attachHls(Hls, video, url, opts, onReady, onFail) {
        // Nếu video này đã được warm() ở một bậc → khởi động đúng bậc đó để trúng cache 100%
        const w = warmed.get(url);
        const cfg = Object.assign({}, HLS_CONFIG, { autoStartLoad: !opts.preloadOnly });
        const fullyWarmed = Boolean(w && typeof w.levelIndex === 'number' && w.total && w.seconds >= w.total - 0.1);
        if (w && typeof w.levelIndex === 'number') cfg.startLevel = w.levelIndex;
        // Đã warm TRỌN video ở bậc chọn theo băng thông đo được → khoá ABR ở bậc đó:
        // phát 100% từ cache, không một request mạng nào, không thể giật.
        if (fullyWarmed) cfg.capLevelToPlayerSize = false;
        const hls = new Hls(cfg);
        // LƯU Ý: hls.loadSource() đặt lại autoLevelCapping = -1 → phải khoá SAU loadSource (bên dưới)
        const lockWarmedLevel = () => { if (fullyWarmed) hls.autoLevelCapping = w.levelIndex; };
        const inst = { mode: 'hls', src: url, hls, started: !opts.preloadOnly };
        let mediaRecovered = false;
        let settled = false;

        const ensureStarted = () => {
            if (!inst.started) { inst.started = true; try { hls.startLoad(); } catch (e) { /* ignore */ } }
        };
        const onPlay = () => ensureStarted();
        const onMeta = () => { if (!settled) { settled = true; onReady('hls'); } };

        function cleanup() {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('loadedmetadata', onMeta);
        }
        inst.cleanup = cleanup;
        inst.ensureStarted = ensureStarted;
        instances.set(video, inst);
        trackPlayback(video);

        hls.on(Hls.Events.FRAG_LOADED, () => {
            if (hls.bandwidthEstimate > 0) lastBandwidth = hls.bandwidthEstimate;
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            lockWarmedLevel();
            if (opts.preloadOnly && !settled) { settled = true; onReady('hls'); }
        });
        // Chuẩn bị trước: ngoài manifest, kéo sẵn segment đầu bậc thấp nhất vào cache HTTP
        if (opts.preloadOnly && !opts.noSegment) prefetch({ hls: url }, { firstSegment: true });
        hls.on(Hls.Events.ERROR, (evt, data) => {
            if (!data || !data.fatal) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
                mediaRecovered = true;
                try { hls.recoverMediaError(); return; } catch (e) { /* rơi xuống fallback */ }
            }
            console.warn('[CKVideo] HLS lỗi nghiêm trọng, chuyển sang MP4:', data.details || data.type);
            detach(video);
            onFail(new Error(`hls failed: ${data.details || data.type}`));
        });

        video.addEventListener('play', onPlay);
        video.addEventListener('loadedmetadata', onMeta, { once: true });
        hls.attachMedia(video);
        hls.loadSource(url);
        lockWarmedLevel();
    }

    /**
     * Nạp nguồn video vào thẻ <video>.
     * @param {HTMLVideoElement} video
     * @param {{hls?: string, mp4?: string}} src
     * @param {{preloadOnly?: boolean, force?: boolean, timeoutMs?: number}} [opts]
     * @returns {Promise<string>} mode đã dùng
     */
    function load(video, src, opts) {
        opts = opts || {};
        if (!video || !src || (!src.hls && !src.mp4)) {
            return Promise.reject(new Error('CKVideo.load: thiếu thẻ video hoặc nguồn'));
        }

        // Đang gắn đúng nguồn (vd: đã preloadOnly ở cảnh trước) → tái sử dụng, chỉ cần bắt đầu tải
        const existing = instances.get(video);
        if (existing && !opts.force && existing.src === (src.hls || src.mp4) && !existing.failed) {
            if (existing.ensureStarted) existing.ensureStarted();
            else if (existing.mode !== 'hls') video.preload = 'auto';
            return Promise.resolve(existing.mode);
        }
        detach(video);

        return new Promise((resolve, reject) => {
            let done = false;
            let timer = null;
            const finish = (fn, v) => {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                fn(v);
            };
            const ready = (mode) => finish(resolve, mode);
            const fail = (err) => {
                const inst = instances.get(video);
                if (inst) inst.failed = true;
                finish(reject, err);
            };

            if (opts.timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (done) return;
                    detach(video);
                    dispatchError(video);
                    fail(new Error('CKVideo: quá thời gian tải video'));
                }, opts.timeoutMs);
            }

            const tryMp4 = () => {
                if (!src.mp4) { dispatchError(video); return fail(new Error('Không có nguồn MP4 dự phòng')); }
                // 'error' native của thẻ video sẽ tự phát nếu MP4 cũng hỏng
                attachUrl(video, src.mp4, 'mp4', opts, ready, fail);
            };

            if (!src.hls) return tryMp4();

            // 1) hls.js (MSE) — chạy đồng bộ nếu thư viện đã có để giữ "user gesture" cho play()
            if (hasMse()) {
                if (global.Hls && global.Hls.isSupported()) {
                    return attachHls(global.Hls, video, src.hls, opts, ready, tryMp4);
                }
                if (!global.Hls) {
                    loadHlsLib().then((Hls) => {
                        if (done) return;
                        if (Hls && Hls.isSupported()) attachHls(Hls, video, src.hls, opts, ready, tryMp4);
                        else if (hasNativeHls(video)) attachUrl(video, src.hls, 'native', opts, ready, tryMp4);
                        else tryMp4();
                    });
                    return;
                }
            }
            // 2) HLS native (Safari)
            if (hasNativeHls(video)) {
                return attachUrl(video, src.hls, 'native', opts, ready, tryMp4);
            }
            // 3) MP4
            tryMp4();
        });
    }


    // ══════════════════════════════════════════════════════════════════════
    // WARM — tải trước có kiểm soát (dùng ở các "khoảng rảnh": màn Bắt đầu,
    // mini-game, câu hỏi). Khác prefetch(): tải NHIỀU segment, đúng bậc ABR
    // sẽ chọn, tuần tự từng file, và TỰ DỪNG khi có video đang phát.
    // ══════════════════════════════════════════════════════════════════════
    let lastBandwidth = 0;                 // ước lượng băng thông gần nhất từ hls.js (bit/s)
    const playingSet = new Set();          // các thẻ video đang phát
    const warmed = new Map();              // hlsUrl → { height, levelIndex, seconds, bytes }
    const warmJobs = new Map();            // hlsUrl → job đang chờ/chạy
    const warmQueue = [];
    let warmRunning = false;
    let warmAbort = null;
    let idleWaiters = [];
    let warmCurrent = null;                // tiến độ job đang chạy { url, seconds, bytes }

    function isIdle() { return playingSet.size === 0; }
    function notifyIdle() { if (!isIdle()) return; const w = idleWaiters; idleWaiters = []; w.forEach((fn) => fn()); }
    function waitIdle() { return isIdle() ? Promise.resolve() : new Promise((r) => idleWaiters.push(r)); }

    function trackPlayback(video) {
        if (video.__ckTracked) return;
        video.__ckTracked = true;
        const on = () => { playingSet.add(video); if (warmAbort) { try { warmAbort.abort(); } catch (e) { /* ignore */ } } };
        const off = () => { playingSet.delete(video); notifyIdle(); };
        video.addEventListener('playing', on);
        ['pause', 'ended', 'emptied', 'error'].forEach((ev) => video.addEventListener(ev, off));
    }

    /** Ngân sách tải trước theo loại mạng (Chrome/Android có navigator.connection; nơi khác → mặc định) */
    function networkBudget() {
        const c = global.navigator && global.navigator.connection ? global.navigator.connection : {};
        if (c.saveData) return { maxHeight: 240, seconds: 8, reason: 'saveData' };
        const t = String(c.effectiveType || '');
        if (t === 'slow-2g' || t === '2g') return { maxHeight: 240, seconds: 8, reason: t };
        if (t === '3g') return { maxHeight: 360, seconds: Infinity, reason: t };
        return { maxHeight: 480, seconds: Infinity, reason: t || 'unknown' };
    }

    function parseMaster(text) {
        const lines = text.split('\n').map((l) => l.trim());
        const variants = [];
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
            const bw = /BANDWIDTH=(\d+)/.exec(lines[i]);
            const res = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
            const uri = (lines[i + 1] || '').trim();
            if (uri && !uri.startsWith('#')) variants.push({ bw: bw ? Number(bw[1]) : Infinity, height: res ? Number(res[1]) : 0, uri });
        }
        variants.sort((a, b) => a.bw - b.bw);          // cùng thứ tự hls.js sắp xếp levels
        return variants.map((v, i) => Object.assign(v, { levelIndex: i }));
    }

    function parseSegments(text) {
        const out = [];
        let dur = 0;
        for (const raw of text.split('\n')) {
            const l = raw.trim();
            if (l.startsWith('#EXTINF:')) { dur = parseFloat(l.slice(8)) || 0; continue; }
            if (l && !l.startsWith('#')) { out.push({ uri: l, dur: dur || 2 }); dur = 0; }
        }
        return out;
    }

    /** Chọn bậc: 'lowest' | số px chiều cao | 'auto' (theo băng thông đo được, trong ngân sách mạng) */
    function chooseVariant(variants, level) {
        if (!variants.length) return null;
        if (level === 'lowest') return variants[0];
        if (typeof level === 'number') {
            return variants.filter((v) => v.height <= level).pop() || variants[0];
        }
        const budget = networkBudget();
        const bw = lastBandwidth > 0 ? lastBandwidth * 0.8 : 0;
        let pick = variants[0];
        for (const v of variants) {
            if (v.height > budget.maxHeight) break;
            if (bw === 0 ? v === variants[0] : v.bw <= bw) pick = v;
        }
        return pick;
    }

    async function fetchText(url, signal) {
        const r = await global.fetch(url, { credentials: 'same-origin', signal });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
        return r.text();
    }

    async function runWarm(job) {
        const dirOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);
        const master = await fetchText(job.src.hls);
        const variant = chooseVariant(parseMaster(master), job.level);
        if (!variant) throw new Error('master không có variant');
        const plUrl = dirOf(job.src.hls) + variant.uri;
        const segments = parseSegments(await fetchText(plUrl));
        const budgetSeconds = Math.min(job.seconds, networkBudget().seconds);
        let acc = 0;
        let bytes = 0;
        let i = 0;
        warmCurrent = { url: job.src.hls, height: variant.height, seconds: 0, bytes: 0 };
        while (i < segments.length && acc < budgetSeconds) {
            if (job.cancelled) break;
            await waitIdle();                                   // có video đang phát → đứng chờ
            if (job.cancelled) break;
            const ctrl = new AbortController();
            warmAbort = ctrl;
            try {
                const r = await global.fetch(dirOf(plUrl) + segments[i].uri, { credentials: 'same-origin', signal: ctrl.signal, priority: 'low' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const buf = await r.arrayBuffer();              // đọc hết để trình duyệt ghi cache
                bytes += buf.byteLength;
                acc += segments[i].dur;
                i++;
                warmCurrent = { url: job.src.hls, height: variant.height, seconds: acc, bytes };
            } catch (e) {
                if (e && e.name === 'AbortError') continue;    // bị ngắt vì video đang phát → thử lại segment này sau
                throw e;
            } finally {
                if (warmAbort === ctrl) warmAbort = null;
            }
        }
        warmCurrent = null;
        const info = { height: variant.height, levelIndex: variant.levelIndex, seconds: acc, total: segments.reduce((a, s) => a + s.dur, 0), bytes };
        const prev = warmed.get(job.src.hls);
        if (!prev || prev.seconds <= acc) warmed.set(job.src.hls, info);
        return info;
    }

    async function pumpWarm() {
        if (warmRunning) return;
        warmRunning = true;
        while (warmQueue.length) {
            const job = warmQueue.shift();
            try { job.resolve(await runWarm(job)); }
            catch (e) { warmCurrent = null; job.resolve({ error: e && e.message }); }
            finally { if (warmJobs.get(job.src.hls) === job) warmJobs.delete(job.src.hls); }
        }
        warmRunning = false;
    }

    /**
     * Tải trước một video vào cache HTTP, tuần tự, tự dừng khi có video đang phát.
     * @param {{hls?: string}} src
     * @param {{level?: 'auto'|'lowest'|number, seconds?: number}} [opts]
     *   level   : bậc cần tải — 'auto' (mặc định: theo băng thông đo được, trong ngân sách mạng), 'lowest', hoặc chiều cao px
     *   seconds : số giây cần tải trước (mặc định toàn bộ, vẫn bị giới hạn bởi networkBudget())
     * @returns {Promise<{height:number, seconds:number, bytes:number}|{error:string}>}
     */
    function warm(src, opts) {
        opts = opts || {};
        if (!src || !src.hls || typeof global.fetch !== 'function') return Promise.resolve({ error: 'no-hls' });
        const seconds = opts.seconds == null ? Infinity : opts.seconds;
        const have = warmed.get(src.hls);
        if (have && !have.error && have.seconds >= Math.min(seconds, have.total || Infinity) - 0.01) return Promise.resolve(have);
        const running = warmJobs.get(src.hls);
        if (running && running.seconds >= seconds) return running.promise;   // job đang chờ đã đủ dài
        if (hasMse()) loadHlsLib();
        const job = { src, level: opts.level || 'auto', seconds, cancelled: false };
        job.promise = new Promise((resolve) => { job.resolve = resolve; });
        warmJobs.set(src.hls, job);
        warmQueue.push(job);
        pumpWarm();
        return job.promise;
    }

    /** Huỷ mọi job warm đang chờ (vd. khi thoát level) */
    function cancelWarm() {
        warmQueue.splice(0).forEach((j) => { j.cancelled = true; j.resolve({ error: 'cancelled' }); warmJobs.delete(j.src.hls); });
        if (warmAbort) { try { warmAbort.abort(); } catch (e) { /* ignore */ } }
    }

    function warmStatus() {
        const out = {};
        warmed.forEach((v, k) => { out[k] = v; });
        return { warmed: out, queued: warmQueue.length, running: warmRunning, current: warmCurrent, idle: isIdle(), bandwidth: Math.round(lastBandwidth), budget: networkBudget() };
    }

    const prefetched = new Set();

    /**
     * Làm ấm cache HTTP cho một video: master playlist + mọi variant playlist, và (mặc định)
     * SEGMENT ĐẦU TIÊN của bậc thấp nhất (~60 KB). Nhờ vậy khi người chơi bấm nhánh/cảnh kế tiếp,
     * hls.js lấy playlist + segment đầu từ cache và phát gần như tức thì, kể cả mạng yếu.
     * @param {{hls?: string}} src
     * @param {{firstSegment?: boolean, whenPlaying?: HTMLVideoElement, delayMs?: number}} [opts]
     *   whenPlaying: chỉ prefetch SAU KHI thẻ video này đã phát (không tranh băng thông lúc khởi động)
     *   delayMs:     chờ thêm (mặc định 2000 ms sau khi phát) để video hiện tại kịp có buffer
     */
    function prefetch(src, opts) {
        opts = opts || {};
        const wantSeg = opts.firstSegment !== false;
        if (!src || !src.hls || typeof global.fetch !== 'function') return;
        if (opts.whenPlaying) {
            const v = opts.whenPlaying;
            const delay = opts.delayMs == null ? 2000 : opts.delayMs;
            const go = () => setTimeout(() => prefetch(src, { firstSegment: wantSeg }), delay);
            if (!v.paused && v.currentTime > 0) go();
            else v.addEventListener('playing', go, { once: true });
            return;
        }
        const key = src.hls + (wantSeg ? '#seg' : '');
        if (prefetched.has(key)) return;
        prefetched.add(key);
        if (hasMse()) loadHlsLib();

        const get = (url) => global.fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''));
        const dirOf = (url) => url.slice(0, url.lastIndexOf('/') + 1);
        const base = dirOf(src.hls);

        get(src.hls).then((master) => {
            const lines = master.split('\n').map((l) => l.trim());
            const variants = [];
            for (let i = 0; i < lines.length; i++) {
                if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
                const m = /BANDWIDTH=(\d+)/.exec(lines[i]);
                const uri = (lines[i + 1] || '').trim();
                if (uri && !uri.startsWith('#')) variants.push({ bw: m ? Number(m[1]) : Infinity, uri });
            }
            if (!variants.length) return;
            variants.sort((a, b) => a.bw - b.bw);
            variants.forEach((v, idx) => {
                const url = base + v.uri;
                get(url).then((pl) => {
                    if (!wantSeg || idx !== 0) return;
                    const seg = pl.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
                    if (seg) global.fetch(dirOf(url) + seg, { credentials: 'same-origin' }).catch(() => {});
                }).catch(() => {});
            });
        }).catch(() => {});
    }

    /**
     * Thông tin chẩn đoán: bậc đang phát, băng thông ước lượng (hls.js) — dùng để đo/debug.
     */
    function stats(video) {
        const inst = instances.get(video);
        if (!inst) return null;
        const out = { mode: inst.mode, src: inst.src };
        if (inst.hls) {
            const h = inst.hls;
            out.level = h.currentLevel;
            out.levelHeight = h.levels && h.levels[h.currentLevel] ? h.levels[h.currentLevel].height : null;
            out.levels = (h.levels || []).map((l) => l.height);
            out.bandwidthEstimate = Math.round(h.bandwidthEstimate || 0);
        }
        return out;
    }

    function mode(video) {
        const inst = instances.get(video);
        return inst ? inst.mode : null;
    }

    global.CKVideo = { sources, load, prefetch, warm, cancelWarm, warmStatus, detach, mode, stats, loadHlsLib };

    // Nạp sẵn hls.js ngay khi trang mở (≈350 KB, cache dài) để lần load() đầu tiên
    // gắn nguồn ĐỒNG BỘ trong call stack của click → play() không bị huỷ (AbortError)
    // và quyền autoplay từ cú click được giữ nguyên.
    if (hasMse()) {
        try { setTimeout(loadHlsLib, 0); } catch (e) { /* ignore */ }
    }
})(window);
