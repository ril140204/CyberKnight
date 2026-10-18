/**
 * CYBERKNIGHT — LEVEL 4
 * Photo scenes (SVG inline illustrations) + hotspot zone definitions.
 *
 * One scene:
 *   - 'main'  : CyberKnight khoe cúp trong phòng (used in Q1 photofind)
 *
 * Each scene also defines hotspot zones with rectangle coordinates
 * expressed as percentages of the 4:3 frame (so they remain responsive).
 *
 * Hotspot kinds:
 *   - 'private' : chứa thông tin riêng tư (đúng → reveal chip)
 *   - 'decoy'   : không chứa thông tin riêng tư (kính lúp + bip nhắc)
 *
 * Each scene also tries to load ../image/level4/<scene>.png as an override;
 * if the image loads successfully, it is shown instead of the SVG.
 */

(function () {
    'use strict';

    // =========================================================================
    // ZONE DEFINITIONS
    // =========================================================================

    const ZONES_MAIN = [
        {
            id: 'bag',
            kind: 'private',
            icon: '🎒',
            label: 'Balo',
            rect: { x: 6, y: 38, w: 24, h: 42 },
            reveal: 'Tên trường: TH Ngôi Sao Xanh'
        },
        {
            id: 'badge',
            kind: 'private',
            icon: '📛',
            label: 'Thẻ tên',
            rect: { x: 38, y: 46, w: 16, h: 14 },
            reveal: 'Tên và lớp: Bạn Hiệp Sĩ – Lớp 3A'
        },
        {
            id: 'box',
            kind: 'private',
            icon: '📦',
            label: 'Hộp hàng',
            rect: { x: 66, y: 50, w: 28, h: 32 },
            reveal: 'Địa chỉ: Số 12 Ngõ Hoa Mai, Phường Cầu Vồng\nSố điện thoại: 0123 456 789'
        },
        {
            id: 'trophy',
            kind: 'decoy',
            icon: '🏆',
            label: 'Chiếc cúp',
            rect: { x: 40, y: 70, w: 18, h: 24 },
            reveal: null
        }
    ];

    // =========================================================================
    // SVG ILLUSTRATIONS
    // Both scenes use viewBox 400x300 (4:3 aspect) and a flat, child-friendly
    // style. All sensitive info uses fictional names & numbers.
    // =========================================================================

    /**
     * Scene 'main' — CyberKnight khoe cúp trong phòng.
     * - Balo bên trái có tên trường
     * - CyberKnight đứng giữa, đeo thẻ tên
     * - Hộp hàng có địa chỉ + số điện thoại (dán tờ giấy)
     * - Cúp vàng trên bàn phía trước
     */
    function renderMainSVG() {
        return `
        <svg class="ph-frame-svg" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-label="Bức ảnh CyberKnight khoe chiếc cúp trong phòng">
            <!-- Background sky gradient -->
            <defs>
                <linearGradient id="l4-main-bg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#cfe6ff"/>
                    <stop offset="100%" stop-color="#a8d3ff"/>
                </linearGradient>
                <linearGradient id="l4-main-floor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#b8d4a8"/>
                    <stop offset="100%" stop-color="#8aa866"/>
                </linearGradient>
                <linearGradient id="l4-main-knight" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3B8EFF"/>
                    <stop offset="100%" stop-color="#0066FF"/>
                </linearGradient>
                <linearGradient id="l4-main-trophy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#FFE066"/>
                    <stop offset="100%" stop-color="#E0A000"/>
                </linearGradient>
            </defs>

            <!-- Sky/wall -->
            <rect x="0" y="0" width="400" height="220" fill="url(#l4-main-bg)"/>
            <!-- Floor -->
            <rect x="0" y="220" width="400" height="80" fill="url(#l4-main-floor)"/>

            <!-- Distant window frame -->
            <rect x="280" y="20" width="100" height="120" fill="#E0F0FF" stroke="#5BA8FF" stroke-width="3" rx="6"/>
            <line x1="330" y1="20" x2="330" y2="140" stroke="#5BA8FF" stroke-width="3"/>
            <line x1="280" y1="80" x2="380" y2="80" stroke="#5BA8FF" stroke-width="3"/>
            <!-- Window decoration -->
            <circle cx="305" cy="50" r="6" fill="#FFD700"/>
            <rect x="345" y="55" width="20" height="30" fill="#A7F3D0" rx="2"/>
            <rect x="290" y="100" width="20" height="20" fill="#FF6B9D" rx="2"/>

            <!-- Left shelf (decoration only — outside zones) -->
            <rect x="0" y="130" width="80" height="6" fill="#A0826D"/>
            <rect x="10" y="105" width="14" height="25" fill="#FF9F43" rx="2"/>
            <rect x="30" y="110" width="16" height="20" fill="#22C55E" rx="2"/>
            <rect x="52" y="100" width="14" height="30" fill="#8B5CF6" rx="2"/>

            <!-- ===== BALO (private zone — bag) ===== -->
            <!-- Position: rect x=6 y=38 w=24 h=42 → in viewBox ~ x:24..120, y:114..240 -->
            <g aria-hidden="true">
                <!-- Strap -->
                <path d="M 38 120 Q 32 145 36 175" stroke="#0052CC" stroke-width="3" fill="none"/>
                <path d="M 80 120 Q 86 145 82 175" stroke="#0052CC" stroke-width="3" fill="none"/>
                <!-- Bag body -->
                <rect x="28" y="115" width="62" height="115" rx="12" fill="#0066FF" stroke="#003D99" stroke-width="2"/>
                <!-- Bag pocket -->
                <rect x="38" y="160" width="42" height="40" rx="6" fill="#3B8EFF" stroke="#003D99" stroke-width="1.5"/>
                <!-- ZIP -->
                <line x1="38" y1="160" x2="80" y2="160" stroke="#FFD700" stroke-width="2"/>
                <!-- Bag top flap -->
                <path d="M 28 115 Q 59 100 90 115" fill="#0052CC"/>
                <!-- School name text (HƯ CẤU) -->
                <rect x="36" y="125" width="46" height="14" rx="2" fill="#FFFFFF" opacity="0.95"/>
                <text x="59" y="135" font-family="Poppins, sans-serif" font-size="8" font-weight="800" text-anchor="middle" fill="#0066FF">TH Ngôi Sao Xanh</text>
            </g>

            <!-- ===== CYBERKNIGHT CHARACTER ===== -->
            <!-- Center: roughly x=170..230, y=80..220 -->
            <g aria-hidden="true">
                <!-- Shield (left hand) -->
                <ellipse cx="160" cy="170" rx="20" ry="24" fill="#22C55E" stroke="#15803D" stroke-width="2"/>
                <path d="M 160 158 L 168 168 L 165 175 L 160 178 L 155 175 L 152 168 Z" fill="#FFFFFF"/>
                <text x="160" y="200" font-family="Poppins, sans-serif" font-size="8" font-weight="800" text-anchor="middle" fill="#15803D">CK</text>

                <!-- Body -->
                <rect x="180" y="130" width="40" height="70" rx="10" fill="url(#l4-main-knight)" stroke="#003D99" stroke-width="2"/>
                <!-- Belt -->
                <rect x="180" y="170" width="40" height="6" fill="#FFD700"/>
                <!-- Legs -->
                <rect x="184" y="200" width="14" height="22" rx="4" fill="#003D99"/>
                <rect x="202" y="200" width="14" height="22" rx="4" fill="#003D99"/>
                <!-- Boots -->
                <ellipse cx="191" cy="225" rx="10" ry="5" fill="#1E3A5F"/>
                <ellipse cx="209" cy="225" rx="10" ry="5" fill="#1E3A5F"/>

                <!-- Right arm raised celebrating -->
                <rect x="218" y="100" width="10" height="40" rx="5" fill="url(#l4-main-knight)" transform="rotate(-30 223 120)"/>
                <!-- Hand (thumbs up) -->
                <circle cx="232" cy="98" r="6" fill="#FFD7A8"/>

                <!-- Head (round) -->
                <circle cx="200" cy="105" r="22" fill="#FFD7A8" stroke="#003D99" stroke-width="2"/>
                <!-- Helmet -->
                <path d="M 178 105 Q 200 70 222 105 L 222 95 Q 200 80 178 95 Z" fill="#0066FF" stroke="#003D99" stroke-width="2"/>
                <!-- Helmet crest -->
                <path d="M 200 78 L 200 70 L 205 75 L 200 78 L 195 75 Z" fill="#FFD700"/>
                <!-- Visor -->
                <rect x="184" y="98" width="32" height="8" rx="3" fill="#5BA8FF" opacity="0.9"/>
                <!-- Eyes -->
                <circle cx="192" cy="102" r="1.6" fill="#1E3A5F"/>
                <circle cx="208" cy="102" r="1.6" fill="#1E3A5F"/>
                <!-- Smile -->
                <path d="M 192 116 Q 200 121 208 116" stroke="#1E3A5F" stroke-width="1.5" fill="none"/>

                <!-- ===== BADGE (name tag) — private zone ===== -->
                <!-- Position: rect x=38 y=46 w=16 h=14 → ~ x:152..216, y:138..180 -->
                <rect x="186" y="138" width="30" height="14" rx="3" fill="#FFFFFF" stroke="#003D99" stroke-width="1.5"/>
                <text x="201" y="143" font-family="Poppins, sans-serif" font-size="5" font-weight="700" text-anchor="middle" fill="#0066FF">Hiệp Sĩ</text>
                <text x="201" y="150" font-family="Poppins, sans-serif" font-size="5" font-weight="700" text-anchor="middle" fill="#0066FF">Lớp 3A</text>
                <!-- Lanyard -->
                <line x1="186" y1="138" x2="178" y2="128" stroke="#FF9F43" stroke-width="1.5"/>
                <line x1="216" y1="138" x2="222" y2="128" stroke="#FF9F43" stroke-width="1.5"/>
            </g>

            <!-- ===== BOX (hộp hàng) — private zone ===== -->
            <!-- Position: rect x=66 y=50 w=28 h=32 → ~ x:264..376, y:150..246 -->
            <g aria-hidden="true">
                <!-- Box body -->
                <rect x="270" y="155" width="100" height="90" rx="6" fill="#D9A06E" stroke="#8B6A4A" stroke-width="2"/>
                <!-- Top flaps -->
                <path d="M 270 155 L 320 145 L 370 155" fill="#C08855" stroke="#8B6A4A" stroke-width="2"/>
                <!-- Tape -->
                <rect x="265" y="148" width="110" height="6" fill="#FFFFFF" opacity="0.7"/>
                <!-- Address label -->
                <rect x="280" y="170" width="80" height="22" rx="2" fill="#FFFFFF" stroke="#8B6A4A" stroke-width="1"/>
                <text x="320" y="180" font-family="Poppins, sans-serif" font-size="7" font-weight="700" text-anchor="middle" fill="#1E3A5F">Số 12 Ngõ Hoa Mai,</text>
                <text x="320" y="188" font-family="Poppins, sans-serif" font-size="7" font-weight="700" text-anchor="middle" fill="#1E3A5F">P. Cầu Vồng</text>
                <!-- Phone paper stuck on box -->
                <rect x="305" y="200" width="60" height="32" rx="2" fill="#FFF8E1" stroke="#D4A017" stroke-width="1" transform="rotate(-3 335 216)"/>
                <text x="335" y="212" font-family="Poppins, sans-serif" font-size="6" font-weight="700" text-anchor="middle" fill="#92400E">📞 SĐT:</text>
                <text x="335" y="222" font-family="Poppins, sans-serif" font-size="8" font-weight="800" text-anchor="middle" fill="#92400E">0123 456 789</text>
            </g>

            <!-- ===== TROPHY (chiếc cúp) — DECOY zone ===== -->
            <!-- Position: rect x=40 y=70 w=18 h=24 → ~ x:160..232, y:210..282 -->
            <g aria-hidden="true">
                <!-- Base -->
                <rect x="175" y="248" width="40" height="8" rx="2" fill="#A0826D" stroke="#6F5B40" stroke-width="1"/>
                <rect x="180" y="240" width="30" height="8" rx="2" fill="#C08855"/>
                <!-- Stem -->
                <rect x="190" y="225" width="10" height="15" fill="#C0A030"/>
                <!-- Cup body -->
                <path d="M 175 200 Q 175 225 195 225 Q 215 225 215 200 Z" fill="url(#l4-main-trophy)" stroke="#A07000" stroke-width="2"/>
                <!-- Handles -->
                <path d="M 175 205 Q 165 210 170 220" fill="none" stroke="#A07000" stroke-width="2.5"/>
                <path d="M 215 205 Q 225 210 220 220" fill="none" stroke="#A07000" stroke-width="2.5"/>
                <!-- Star on cup -->
                <text x="195" y="218" font-family="Poppins, sans-serif" font-size="14" font-weight="900" text-anchor="middle" fill="#FFFFFF">★</text>
                <!-- Sparkle -->
                <circle cx="210" cy="195" r="2" fill="#FFFFFF"/>
                <circle cx="180" cy="195" r="1.5" fill="#FFFFFF"/>
            </g>

            <!-- Floor shadow under trophy -->
            <ellipse cx="195" cy="256" rx="32" ry="3" fill="#000000" opacity="0.12"/>
            <ellipse cx="320" cy="246" rx="55" ry="4" fill="#000000" opacity="0.12"/>
        </svg>
        `;
    }

    // =========================================================================
    // PHOTO SCENES API
    // =========================================================================

    const PhotoScenes = {
        /**
         * Get zone list for a scene.
         */
        getZones(sceneId) {
            if (sceneId === 'main') return ZONES_MAIN;
            return [];
        },

        /**
         * Render the SVG markup for a scene.
         */
        renderSVG(sceneId) {
            if (sceneId === 'main') return renderMainSVG();
            return '';
        },

        /**
         * Try to find an override image for a scene (../image/level4/<id>.png).
         * Returns a promise that resolves with the URL on success or null on failure.
         */
        tryImageOverride(sceneId) {
            return new Promise((resolve) => {
                const url = `../image/level4/photo-${sceneId}.png`;
                const img = new Image();
                let resolved = false;

                const done = (val) => {
                    if (resolved) return;
                    resolved = true;
                    resolve(val);
                };

                img.onload = () => done(img.naturalWidth > 0 ? url : null);
                img.onerror = () => done(null);
                // safety timeout
                setTimeout(() => done(null), 1500);
                img.src = url;
            });
        }
    };

    // Expose
    window.PhotoScenes = PhotoScenes;

})();