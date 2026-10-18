/**
 * CYBERKNIGHT — LEVEL 4
 * PhotoBoard: shared photo + hotspot component.
 *
 * Used by Q1 (photofind) to find private information in photos.
 * Renders the polaroid frame, image (SVG or PNG override), and clickable
 * hotspot zones. Coordinates are % of the frame (4:3 aspect) so they remain
 * responsive across viewports.
 *
 * Mode:
 *   - 'find'  : when a private zone is tapped, show a chip with the leaked info
 *               and lock the zone (it stays found, still readable).
 *               When a decoy zone is tapped, magnifier sweep + bip text.
 *               Calling onAllFound() when all private zones are tapped.
 *
 * Public API:
 *   - new PhotoBoard(containerEl, opts)
 *   - photoBoard.destroy()
 *   - photoBoard.showHint(level)        // 0..2 progressive hint levels
 *   - photoBoard.getState()             // {found, mistakes, hintsUsed, blankTaps}
 */

(function () {
    'use strict';

    class PhotoBoard {
        constructor(containerEl, options = {}) {
            this.container = containerEl;
            if (!this.container) {
                console.error('[PhotoBoard] Container not found');
                return;
            }

            this.scene = options.scene || 'main';
            this.onCorrect = options.onCorrect || (() => {});
            this.onDecoy = options.onDecoy || (() => {});
            this.onBlankTap = options.onBlankTap || (() => {});
            this.onAllFound = options.onAllFound || (() => {});

            this.zones = (window.PhotoScenes ? window.PhotoScenes.getZones(this.scene) : [])
                .map(z => ({ ...z }));

            this.privateZones = this.zones.filter(z => z.kind === 'private');

            this.found = [];   // ids of private zones found
            this.mistakes = 0;
            this.hintsUsed = 0;
            this.blankTaps = 0;

            this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            // Listener bookkeeping for clean destroy()
            this._zoneListeners = [];
            this._frameListeners = [];
            this._idleHandler = null;

            this._init();
        }

        // =====================================================================
        // INIT
        // =====================================================================

        async _init() {
            const svgMarkup = window.PhotoScenes ? window.PhotoScenes.renderSVG(this.scene) : '';
            const overrideUrl = window.PhotoScenes ? await window.PhotoScenes.tryImageOverride(this.scene) : null;

            const wrap = document.createElement('div');
            wrap.className = 'ph-polaroid';

            const frame = document.createElement('div');
            frame.className = 'ph-frame';
            frame.setAttribute('role', 'group');
            frame.setAttribute('aria-label', 'Bức ảnh có thể chứa thông tin riêng tư. Hãy chạm vào những vùng có chữ hoặc số.');

            if (overrideUrl) {
                const img = document.createElement('img');
                img.className = 'ph-frame-img';
                img.src = overrideUrl;
                img.alt = 'Bức ảnh minh hoạ';
                frame.appendChild(img);
            } else if (svgMarkup) {
                frame.insertAdjacentHTML('beforeend', svgMarkup);
            } else {
                frame.innerHTML = '<div style="padding:24px;color:#1E3A5F;font-weight:700;text-align:center;">Không có ảnh minh hoạ</div>';
            }

            // Mount zones
            this.zones.forEach(zone => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ph-zone';
                btn.dataset.zoneId = zone.id;
                btn.dataset.kind = zone.kind;
                btn.setAttribute('aria-label', `${zone.kind === 'private' ? 'Vùng riêng tư: ' : 'Vật trang trí: '}${zone.label}`);
                btn.style.left = `${zone.rect.x}%`;
                btn.style.top = `${zone.rect.y}%`;
                btn.style.width = `${zone.rect.w}%`;
                btn.style.height = `${zone.rect.h}%`;

                const onTap = (ev) => {
                    ev.preventDefault();
                    this._handleZoneTap(zone, btn);
                };
                btn.addEventListener('click', onTap);
                btn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this._handleZoneTap(zone, btn);
                    }
                });

                this._zoneListeners.push({ el: btn, event: 'click', handler: onTap });
                frame.appendChild(btn);
            });

            // Blank-tap ripple
            const onFrameClick = (ev) => {
                if (ev.target !== frame) return;
                this._handleBlankTap(ev);
            };
            frame.addEventListener('click', onFrameClick);
            this._frameListeners.push({ el: frame, event: 'click', handler: onFrameClick });

            wrap.appendChild(frame);

            // Caption (fictional disclaimer)
            const caption = document.createElement('div');
            caption.className = 'ph-caption';
            caption.textContent = 'Mọi tên trường, địa chỉ, số điện thoại đều là hư cấu.';
            wrap.appendChild(caption);

            this.container.appendChild(wrap);
            this.frameEl = frame;
            this.wrapEl = wrap;

            // Start idle timer for progressive hints
            this._resetIdleTimer();
        }

        // =====================================================================
        // TAP HANDLERS
        // =====================================================================

        _handleZoneTap(zone, btn) {
            if (zone.kind === 'private') {
                if (this.found.includes(zone.id)) return; // already found
                this._markFound(zone, btn);
            } else {
                // Decoy — gentle, encouraging, not punishing
                this.mistakes++;
                this._showDecoyEffect(btn);
                this.onDecoy(zone);
            }
        }

        _handleBlankTap(ev) {
            const rect = this.frameEl.getBoundingClientRect();
            const x = ((ev.clientX - rect.left) / rect.width) * 100;
            const y = ((ev.clientY - rect.top) / rect.height) * 100;

            // Visual ripple
            const ripple = document.createElement('div');
            ripple.className = 'ph-ripple';
            ripple.style.left = `${x}%`;
            ripple.style.top = `${y}%`;
            this.frameEl.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);

            this.blankTaps++;
            this.onBlankTap(this.blankTaps);
        }

        // =====================================================================
        // FIND MODE: mark a private zone as found
        // =====================================================================

        _markFound(zone, btn) {
            this.found.push(zone.id);

            // Add CSS class for visual feedback
            btn.classList.add('ph-zone--found');
            btn.setAttribute('aria-label', `Đã tìm thấy: ${zone.label} – ${zone.reveal || ''}`);

            // Show chip with the leaked info
            this._showChip(zone, btn);

            // Correct callback
            this.onCorrect(zone);

            // Check if all private zones are found
            if (this.found.length >= this.privateZones.length) {
                this._clearIdleTimer();
                setTimeout(() => this.onAllFound(), 350);
            }
        }

        _showChip(zone, btn) {
            if (!zone.reveal) return;
            // Position the chip just below the zone
            const rect = btn.getBoundingClientRect();
            const frameRect = this.frameEl.getBoundingClientRect();
            const leftPct = ((rect.left - frameRect.left) / frameRect.width) * 100;
            const topPct = ((rect.bottom - frameRect.top) / frameRect.height) * 100;

            const chip = document.createElement('div');
            chip.className = 'ph-chip';
            chip.style.left = `${Math.min(Math.max(leftPct - 5, 0), 60)}%`;
            chip.style.top = `${Math.min(topPct + 1, 85)}%`;
            chip.textContent = zone.reveal;
            this.frameEl.appendChild(chip);

            // Auto-remove chip after 5s (re-clickable since chip is on top of zone,
            // but the zone already has --found which makes it non-tappable)
            setTimeout(() => chip.remove(), 5000);
        }

        _showDecoyEffect(btn) {
            btn.classList.add('ph-zone--decoy-tap');
            setTimeout(() => btn.classList.remove('ph-zone--decoy-tap'), 500);
        }

        // =====================================================================
        // HINTS (3 progressive levels)
        // =====================================================================

        showHint(level) {
            this.hintsUsed++;

            // Find a private zone that hasn't been found yet
            const remaining = this.privateZones.filter(z => !this.found.includes(z.id));

            if (remaining.length === 0) return;

            // Pick the first remaining; pulses it
            const target = remaining[0];
            const btn = this.frameEl.querySelector(`.ph-zone[data-zone-id="${target.id}"]`);
            if (!btn) return;

            if (level >= 1) {
                btn.classList.add('ph-zone--hint');
                // Hint hint level 1: pulse only
            }
            if (level >= 2) {
                // Hint level 2: stronger pulse + outline
                btn.style.outline = '3px solid var(--ck-orange)';
                btn.style.outlineOffset = '2px';
            }
            // Hint level 3 (callable separately): no visual difference — controller
            // typically uses showHint(2) and speaks the zone name via Bíp.
            // We do not auto-clear so the hint persists until the user finds it.
        }

        clearHints() {
            this.frameEl.querySelectorAll('.ph-zone').forEach(btn => {
                btn.classList.remove('ph-zone--hint');
                btn.style.outline = '';
                btn.style.outlineOffset = '';
            });
        }

        // =====================================================================
        // IDLE TIMER
        //
        // The PhotoBoard does not own the idle-hint logic — the parent
        // controller listens to onCorrect/onDecoy/onBlankTap and decides
        // when to escalate. We keep an internal reset hook for symmetry and
        // future use, but the actual timer is a no-op.
        // =====================================================================

        _resetIdleTimer() {
            // no-op: see controller
        }

        _clearIdleTimer() {
            // no-op
        }

        // =====================================================================
        // STATE / DESTROY
        // =====================================================================

        getState() {
            return {
                found: [...this.found],
                mistakes: this.mistakes,
                hintsUsed: this.hintsUsed,
                blankTaps: this.blankTaps
            };
        }

        destroy() {
            this._clearIdleTimer();
            this._zoneListeners.forEach(({ el, event, handler }) => {
                try { el.removeEventListener(event, handler); } catch (e) { /* gone */ }
            });
            this._zoneListeners = [];

            this._frameListeners.forEach(({ el, event, handler }) => {
                try { el.removeEventListener(event, handler); } catch (e) { /* gone */ }
            });
            this._frameListeners = [];

            if (this.frameEl) {
                this.frameEl.querySelectorAll('.ph-chip, .ph-ripple').forEach(el => el.remove());
            }

            if (this.container) {
                this.container.innerHTML = '';
            }
        }
    }

    // Expose
    window.PhotoBoard = PhotoBoard;

})();