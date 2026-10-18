#!/usr/bin/env bash
# =============================================================================
# CyberKnight / Sigmabloom — Post-Deploy End-to-End Verification Script
#
# Chạy NGAY SAU `pm2 start` trên VPS, trước khi tuyên bố deploy thành công.
# Exit 0 = tất cả green. Exit 1 = có ít nhất 1 lỗi nghiêm trọng.
#
# Cách dùng:
#   sudo bash deploy/postdeploy-check.sh [--domain <TEN_MIEN>] [--db-password <pw>] [--skip-public] [--skip-db]
#   sudo bash deploy/postdeploy-check.sh --self-test   # dry-run với stub commands
#
# Yêu cầu: curl, ss, mysql, openssl, stat, grep, awk, date (đều có sẵn trên Ubuntu).
# Chạy với quyền root hoặc deployer (sudo cho một số lệnh).
# =============================================================================

set -uo pipefail   # -u: undefined var = exit; -o pipefail: pipe fails if any cmd fails
                   # KHÔNG dùng -e vì ta cần KEEP GOING sau mỗi lỗi để user thấy full picture.

# ── ANSI colours (no emoji — avoids encoding issues on some terminals) ──────────
C_PASS='\033[0;32m'   # green
C_FAIL='\033[0;31m'   # red
C_WARN='\033[1;33m'   # yellow
C_INFO='\033[0;36m'   # cyan
C_BOLD='\033[1m'
C_RESET='\033[0m'

# ── Defaults ───────────────────────────────────────────────────────────────────
DOMAIN=""                   # optional, set by --domain
DB_PASSWORD=""              # optional, set by --db-password; otherwise read from .env
SKIP_PUBLIC=false           # skip public HTTPS checks (no domain given)
SKIP_DB=false               # skip MySQL checks
SELF_TEST=false             # --self-test mode: mock external tools

# Paths (can be overridden via env vars for sandbox testing)
ENV_FILE="${EXEWEB_ROOT:-/opt/cyberknight}/backend/.env"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cyberknight}"
LOG_DIR="${LOG_DIR:-/var/log}"

# ── Helpers ───────────────────────────────────────────────────────────────────
log_info()  { echo -e "${C_INFO}[INFO]${C_RESET} $*"; }
log_pass()  { echo -e "${C_PASS}[PASS]${C_RESET} $*"; }
log_fail()  { echo -e "${C_FAIL}[FAIL]${C_RESET} $*"; }
log_warn()  { echo -e "${C_WARN}[WARN]${C_RESET} $*"; }

# Track check results:  "name|result"  where result = PASS / FAIL / WARN
declare -a CHECKS=()
critical_failures=0

record() {
  # record "CHECK_NAME" "PASS|FAIL|WARN" "detail"
  CHECKS+=("$1|$2|$3")
  [[ "$2" == "FAIL" ]] && critical_failures=$((critical_failures + 1))
}

# ── CLI parsing ────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --domain <DOMAIN>     Ten mien chinh (VD: tenmiencuaban.vn)
  --db-password <PW>    Mat khau sigmabloom_app (neu khong truyen, doc tu .env)
  --skip-public         Bo qua kiem tra HTTPS / security headers
  --skip-db             Bo qua kiem tra MySQL
  --self-test           Chai nut external commands (curl/mysql/ss) bang stub
  -h, --help            Hien thị trợ giúp
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)        DOMAIN="$2";       shift 2 ;;
    --db-password)   DB_PASSWORD="$2";  shift 2 ;;
    --skip-public)   SKIP_PUBLIC=true;  shift   ;;
    --skip-db)        SKIP_DB=true;     shift   ;;
    --self-test)      SELF_TEST=true;   shift   ;;
    -h|--help)        usage             ;;
    *)                echo "Unknown option: $1"; usage ;;
  esac
done

# ── Self-test mode: override external commands with stubs ──────────────────────
if [[ "$SELF_TEST" == "true" ]]; then
  log_info "=== SELF-TEST MODE: overriding external commands ==="

  # Mock curl (just returns HTTP 200 for /api/health, 301 for http://, etc.)
  _self_test_domain="${DOMAIN:-test.example.com}"
  curl() {
    local _url="$1"
    case "$_url" in
      *"/api/health"*|*"/health"*)
        echo "HTTP/2 200";;
      *"http://${_self_test_domain}/"*)
        echo "HTTP/1.1 301 Moved Permanently";;
      *"https://${_self_test_domain}/"*)
        echo "HTTP/2 200";;
      *"https://www.${_self_test_domain}/"*)
        echo "HTTP/2 301";;
      *)
        echo "HTTP/2 200";;
    esac
  }
  export -f curl 2>/dev/null || true

  # Mock ss (loopback port 5000)
  ss() {
    case "$*" in
      *":5000"*)  echo "LISTEN  127.0.0.1:5000  *:*";;
      *":3306"*)  echo "LISTEN  127.0.0.1:3306  *:*";;
      *)          echo "";;
    esac
  }
  export -f ss 2>/dev/null || true

  # Mock mysql (SELECT 1)
  mysql() {
    if [[ "$*" == *"SELECT 1"* ]]; then echo "1"; else echo "1"; fi
  }
  export -f mysql 2>/dev/null || true

  # Pre-set CERT_EXPIRY_RAW so cert expiry check uses stub value
  export CERT_EXPIRY_RAW="Oct 18 12:00:00 2027 GMT"

  # Mock pm2 (returns online, 0 restarts)
  pm2() {
    case "$*" in
      *'jlist'*)
        # Simulate JSON output for pm2 jlist
        printf '%s' '[{"name":"cyberknight","pid":12345,"monit":{"memory":52428800,"cpu":0.7},"pm2_env":{"status":"online","restart_time":0}}]';;
      *"show cyberknight"*)
        echo "status                          online"
        echo "pid                             12345"
        echo "restarting                      0"
        echo "uptime                          3600";;
      *"logs"*"-err"*)
        echo "";;
      *)  echo "ok";;
    esac
  }
  export -f pm2 2>/dev/null || true

  # Mock ufw
  ufw() {
    case "$*" in
      *"status"*)  echo "Status: active"; echo "To                         Action      From"; echo "--                         ----      ----"; echo "OpenSSH                    ALLOW     Anywhere"; echo "Nginx Full                 ALLOW     Anywhere";;
      *)  echo "ok";;
    esac
  }
  export -f ufw 2>/dev/null || true

  # Mock fail2ban-client
  fail2ban-client() {
    if [[ "$*" == *"status sshd"* ]]; then
      echo "Status for the jail sshd: 9 filed, 2 banned"
    else
      echo "ok"
    fi
  }
  export -f fail2ban-client 2>/dev/null || true

  # Mock stat
  stat() {
    echo "-rwx------ 1 deployer deployer 600 Oct 18 12:00 backend/.env"
  }
  export -f stat 2>/dev/null || true

  log_info "Self-test stubs active."
fi

# ── Tool check ────────────────────────────────────────────────────────────────
log_info "=== POST-DEPLOY CHECK — CyberKnight / Sigmabloom ==="
echo ""

MISSING_TOOLS=""
for tool in curl ss mysql stat grep awk date; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING_TOOLS="$MISSING_TOOLS $tool"
  fi
done
# openssl is optional in self-test (CERT_EXPIRY_RAW is pre-set via env)
if [[ -n "$MISSING_TOOLS" ]]; then
  log_fail "Missing required tools:$MISSING_TOOLS  — cannot run."
  exit 1
fi

# ── Helper: run a check, record result, print line ───────────────────────────
run_check() {
  # $1 = check name (short)
  # $2 = detail string (printed after PASS/FAIL)
  # $3 = status (PASS / FAIL / WARN)
  # $4 = extra (optional, appended to detail)
  local name="$1"; local detail="$2"; local status="$3"; local extra="${4:-}"
  record "$name" "$status" "$detail $extra"
  case "$status" in
    PASS) log_pass "$detail $extra" ;;
    FAIL) log_fail "$detail $extra" ;;
    WARN) log_warn "$detail $extra" ;;
  esac
}

# ════════════════════════════════════════════════════════════════════════════════
# 1. SYSTEM INFO
# ════════════════════════════════════════════════════════════════════════════════
echo -e "${C_BOLD}--- 1. System Info ---${C_RESET}"
SYS_HOSTNAME="$(hostname 2>/dev/null || echo 'N/A')"
SYS_KERNEL="$(uname -r 2>/dev/null || echo 'N/A')"
SYS_OS_VERSION="$(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || echo 'N/A')"
SYS_UPTIME="$(uptime -p 2>/dev/null || uptime 2>/dev/null || echo 'N/A')"
SYS_DISK_PCT="$(df -h / 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%' || echo 'N/A')"
SYS_MEM_FREE_MB="$(free -m 2>/dev/null | awk 'NR==2 {print $7}' || echo 'N/A')"

echo "  Hostname    : $SYS_HOSTNAME"
echo "  Kernel      : $SYS_KERNEL"
echo "  OS          : $SYS_OS_VERSION"
echo "  Uptime      : $SYS_UPTIME"
echo "  Disk /      : ${SYS_DISK_PCT}% used"
echo "  RAM free    : ${SYS_MEM_FREE_MB} MB"
echo ""

# Disk warning
if [[ "$SYS_DISK_PCT" != "N/A" ]] && [[ "$SYS_DISK_PCT" -ge 80 ]]; then
  run_check "DISK" "Disk / ${SYS_DISK_PCT}% used (threshold 80%)" "WARN"
else
  run_check "DISK" "Disk / ${SYS_DISK_PCT}% used" "PASS"
fi

# RAM warning
if [[ "$SYS_MEM_FREE_MB" != "N/A" ]] && [[ "$SYS_MEM_FREE_MB" -lt 200 ]]; then
  run_check "RAM" "RAM free ${SYS_MEM_FREE_MB} MB (threshold 200 MB)" "WARN"
else
  run_check "RAM" "RAM free ${SYS_MEM_FREE_MB} MB" "PASS"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 2. PM2 STATUS
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 2. PM2 Status ---${C_RESET}"

PM2_STATUS="FAIL"
PM2_STATUS_RAW=""
PM2_PID=""
PM2_RESTARTS=""
PM2_UPTIME=""
PM2_ERR_LINES=""

# pm2 show may need PATH; try common locations
PM2_BIN="${PM2_BIN:-$(command -v pm2 2>/dev/null || echo '/usr/local/bin/pm2')}"

if [[ -x "$PM2_BIN" ]] || command -v pm2 &>/dev/null; then
  # Try JSON list first (most reliable)
  PM2_JSON=$(pm2 jlist 2>/dev/null || true)
  if [[ -n "$PM2_JSON" ]]; then
    PM2_JSON_OUT=$(echo "$PM2_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'],d[0]['pid'],d[0]['pm2_env']['restart_time'])" 2>/dev/null || true)
    if [[ -n "$PM2_JSON_OUT" ]]; then
      read -r PM2_STATUS_RAW PM2_PID PM2_RESTARTS <<< "$PM2_JSON_OUT"
    fi
  fi
    # Fallback: pm2 show text output
    PM2_TEXT=$(pm2 show cyberknight 2>/dev/null || true)
    if [[ -n "$PM2_TEXT" ]]; then
      PM2_STATUS_RAW=$(echo "$PM2_TEXT" | grep -i "^status" | awk '{print $2}' | tr -d '[:space:]')
      PM2_PID=$(echo "$PM2_TEXT" | grep "^pid" | awk '{print $2}' | tr -d '[:space:]')
      PM2_RESTARTS=$(echo "$PM2_TEXT" | grep -i "^restarting\|^restarts" | awk '{print $2}' | tr -d '[:space:]')
      PM2_UPTIME=$(echo "$PM2_TEXT" | grep "^uptime" | cut -d: -f2- | xargs || true)
    fi
  fi

  if [[ "${PM2_STATUS_RAW:-N/A}" == "online" ]]; then
    PM2_STATUS="PASS"
  fi
else
  log_warn "pm2 not found in PATH — skipping PM2 check"
  record "PM2" "WARN" "pm2 not in PATH"
fi

# Check pm2 logs for ERROR/FATAL/Exception
PM2_ERR_LINES=$(pm2 logs cyberknight --lines 50 --nostream 2>/dev/null | \
  grep -iE 'ERROR|FATAL|Exception' | head -5 || true)

if [[ -n "$PM2_ERR_LINES" ]]; then
  run_check "PM2" "cyberknight is ${PM2_STATUS_RAW:-N/A}, pid=$PM2_PID, restarts=$PM2_RESTARTS" "FAIL" \
    " | Log errors found: $(echo "$PM2_ERR_LINES" | head -1)"
else
  run_check "PM2" "cyberknight is ${PM2_STATUS_RAW:-N/A}, pid=$PM2_PID, restarts=$PM2_RESTARTS" \
    "${PM2_STATUS}" "uptime=${PM2_UPTIME:-N/A}"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 3. PROCESS LISTENING ON PORT 5000
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 3. Port 5000 Listening ---${C_RESET}"

PORT5000_LINE=$(ss -tlnp 2>/dev/null | grep -w ':5000' || true)

if [[ -n "$PORT5000_LINE" ]]; then
  # Verify it's bound to localhost (127.0.0.1 or ::: or 0.0.0.0)
  if echo "$PORT5000_LINE" | grep -qE '127\.0\.0\.1:5000|:::5000|0\.0\.0\.0:5000'; then
    run_check "PORT5000" "Port 5000 is listening: $PORT5000_LINE" "PASS"
  else
    run_check "PORT5000" "Port 5000 listening but NOT on loopback: $PORT5000_LINE" "WARN"
  fi
else
  run_check "PORT5000" "Port 5000 NOT listening — server may be down" "FAIL"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 4. LOOPBACK HEALTH CHECK
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 4. Loopback Health ---${C_RESET}"

# Try common health endpoints
HEALTH_PATH=""
for _path in "/api/health" "/health" "/api/status"; do
  _code=$(curl -fsS -o /dev/null -w "%{http_code}" "http://127.0.0.1:5000${_path}" 2>/dev/null)
  if [[ "$_code" == "200" ]]; then
    HEALTH_PATH="$_path"
    break
  fi
done

if [[ -n "$HEALTH_PATH" ]]; then
  run_check "HEALTH_LOOPBACK" "GET http://127.0.0.1:5000${HEALTH_PATH} = 200" "PASS" \
    "(health path: ${HEALTH_PATH})"
else
  run_check "HEALTH_LOOPBACK" "No health endpoint returned 200 — tried /api/health, /health" "FAIL"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 5. PUBLIC HTTPS HEALTH (skip if no domain)
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 5. Public HTTPS Health ---${C_RESET}"

if [[ "$SKIP_PUBLIC" == "true" ]] || [[ -z "$DOMAIN" ]]; then
  log_warn "Skipping public checks (no --domain given or --skip-public set)"
  record "HTTPS_HEALTH" "WARN" "Skipped: no domain"
  record "SEC_HEADERS" "WARN" "Skipped: no domain"
  record "HTTP_TO_HTTPS" "WARN" "Skipped: no domain"
  record "WWW_REDIRECT" "WARN" "Skipped: no domain"
  record "CERT_EXPIRY" "WARN" "Skipped: no domain"
else
  HTTPS_CODE=$(curl -fsS -o /dev/null -w "%{http_code}" "https://${DOMAIN}/api/health" 2>/dev/null || echo "000")
  if [[ "$HTTPS_CODE" == "200" ]]; then
    run_check "HTTPS_HEALTH" "GET https://${DOMAIN}/api/health = 200" "PASS"
  else
    run_check "HTTPS_HEALTH" "GET https://${DOMAIN}/api/health = ${HTTPS_CODE}" "FAIL"
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # 6. SECURITY HEADERS
  # ════════════════════════════════════════════════════════════════════════════
  echo ""
  echo -e "${C_BOLD}--- 6. Security Headers ---${C_RESET}"

  HTTPS_HEADERS=$(curl -fsSI "https://${DOMAIN}/" 2>/dev/null)
  HEADER_MISSING=0

  check_header() {
    local _h="$1"; local _desc="$2"
    if echo "$HTTPS_HEADERS" | grep -qi "^${_h}:"; then
      log_pass "  ${_h}: present"
    else
      log_fail "  ${_h}: MISSING"
      HEADER_MISSING=$((HEADER_MISSING + 1))
    fi
  }

  check_header "strict-transport-security" "HSTS"
  check_header "x-content-type-options"    "X-Content-Type-Options"
  check_header "referrer-policy"           "Referrer-Policy"
  # CSP or X-Frame-Options
  if echo "$HTTPS_HEADERS" | grep -qi "content-security-policy:"; then
    log_pass "  Content-Security-Policy: present"
    # Check frame-ancestors inside CSP
    if echo "$HTTPS_HEADERS" | grep -Ai "content-security-policy:" | grep -qi "frame-ancestors"; then
      log_pass "  frame-ancestors (in CSP): present"
    else
      log_warn "  frame-ancestors: MISSING (CSP present but no frame-ancestors)"
    fi
  elif echo "$HTTPS_HEADERS" | grep -qi "x-frame-options:"; then
    log_pass "  X-Frame-Options: present (fallback)"
  else
    log_fail "  Content-Security-Policy / X-Frame-Options: MISSING"
    HEADER_MISSING=$((HEADER_MISSING + 1))
  fi

  if [[ "$HEADER_MISSING" -gt 0 ]]; then
    run_check "SEC_HEADERS" "${HEADER_MISSING} security header(s) missing" "FAIL"
  else
    run_check "SEC_HEADERS" "All required security headers present" "PASS"
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # 7. HTTP -> HTTPS REDIRECT
  # ════════════════════════════════════════════════════════════════════════════
  echo ""
  echo -e "${C_BOLD}--- 7. HTTP -> HTTPS Redirect ---${C_RESET}"

  HTTP_RESP=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "http://${DOMAIN}/" 2>/dev/null)
  HTTP_CODE=$(echo "$HTTP_RESP" | awk '{print $1}')
  HTTP_REDIR=$(echo "$HTTP_RESP" | awk '{print $2}')

  if [[ "$HTTP_CODE" == "301" ]] || [[ "$HTTP_CODE" == "302" ]] || [[ "$HTTP_CODE" == "308" ]]; then
    if [[ "$HTTP_REDIR" == "https://"* ]]; then
      run_check "HTTP_TO_HTTPS" "HTTP ${HTTP_CODE} -> ${HTTP_REDIR}" "PASS"
    else
      run_check "HTTP_TO_HTTPS" "HTTP ${HTTP_CODE} but redirect not to HTTPS: ${HTTP_REDIR}" "FAIL"
    fi
  else
    run_check "HTTP_TO_HTTPS" "Expected 301/302/308, got ${HTTP_CODE}" "FAIL"
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # 8. WWW -> APEX REDIRECT
  # ════════════════════════════════════════════════════════════════════════════
  echo ""
  echo -e "${C_BOLD}--- 8. www -> Apex Redirect ---${C_RESET}"

  WWW_RESP=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" \
    "https://www.${DOMAIN}/" 2>/dev/null || echo "000 ")
  WWW_CODE=$(echo "$WWW_RESP" | awk '{print $1}')
  WWW_REDIR=$(echo "$WWW_RESP" | awk '{print $2}')

  if [[ "$WWW_CODE" == "000" ]]; then
    log_warn "  www.${DOMAIN} does not resolve — skipping"
    record "WWW_REDIRECT" "WARN" "www.${DOMAIN} does not resolve"
  elif [[ "$WWW_CODE" == "301" ]] || [[ "$WWW_CODE" == "302" ]] || [[ "$WWW_CODE" == "308" ]]; then
    if [[ "$WWW_REDIR" == "https://${DOMAIN}"* ]]; then
      run_check "WWW_REDIRECT" "www -> apex: ${WWW_CODE} -> ${WWW_REDIR}" "PASS"
    else
      run_check "WWW_REDIRECT" "www -> apex redirect NOT to apex: ${WWW_CODE} -> ${WWW_REDIR}" "FAIL"
    fi
  else
    run_check "WWW_REDIRECT" "www.${DOMAIN} returned ${WWW_CODE} (expected 301/302/308)" "WARN"
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # 20. CERT EXPIRY
  # ════════════════════════════════════════════════════════════════════════════
  echo ""
  echo -e "${C_BOLD}--- 20. Certificate Expiry ---${C_RESET}"

  # Use env var in self-test mode (pre-set); otherwise call openssl
  CERT_EXPIRY_RAW=""
  if [[ -z "${CERT_EXPIRY_RAW:-}" ]]; then
    CERT_EXPIRY_RAW=$(echo | openssl s_client -connect "${DOMAIN}:443" -servername "${DOMAIN}" \
      2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter | cut -d= -f2 || true)
  fi

  if [[ -n "$CERT_EXPIRY_RAW" ]]; then
    CERT_EXPIRY_EPOCH=$(date -d "$CERT_EXPIRY_RAW" +%s 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    DAYS_LEFT=$(( (CERT_EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    CERT_EXPIRY_STR=$(echo "$CERT_EXPIRY_RAW" | xargs)

    if [[ "$DAYS_LEFT" -lt 0 ]]; then
      run_check "CERT_EXPIRY" "Certificate EXPIRED on ${CERT_EXPIRY_STR} (${DAYS_LEFT} days)" "FAIL"
    elif [[ "$DAYS_LEFT" -lt 14 ]]; then
      run_check "CERT_EXPIRY" "Certificate expires in ${DAYS_LEFT} days (${CERT_EXPIRY_STR})" "WARN"
    else
      run_check "CERT_EXPIRY" "Certificate valid for ${DAYS_LEFT} days (expires ${CERT_EXPIRY_STR})" "PASS"
    fi
  else
    run_check "CERT_EXPIRY" "Could not fetch certificate from ${DOMAIN}:443" "FAIL"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════════
# 9 & 10 & 11. MYSQL
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 9. MySQL Connection ---${C_RESET}"

if [[ "$SKIP_DB" == "true" ]]; then
  log_warn "Skipping MySQL checks (--skip-db)"
  record "MYSQL_CONN"  "WARN" "Skipped: --skip-db"
  record "MYSQL_TABLES" "WARN" "Skipped: --skip-db"
  record "MYSQL_USERS"  "WARN" "Skipped: --skip-db"
else
  # Read DB password from .env if not provided
  if [[ -z "$DB_PASSWORD" ]]; then
    if [[ -f "$ENV_FILE" ]]; then
      DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
    fi
  fi

  if [[ -z "$DB_PASSWORD" ]]; then
    log_warn "DB password not available — skipping MySQL checks"
    record "MYSQL_CONN"  "WARN" "DB password not provided"
    record "MYSQL_TABLES" "WARN" "DB password not provided"
    record "MYSQL_USERS"  "WARN" "DB password not provided"
  else
    # 9. MySQL SELECT 1
    MYSQL_OUT=$(mysql -u sigmabloom_app -p"${DB_PASSWORD}" -e "SELECT 1 AS test" 2>&1 || true)
    if echo "$MYSQL_OUT" | grep -q "1"; then
      run_check "MYSQL_CONN" "mysql -u sigmabloom_app -e 'SELECT 1' = 1" "PASS"
    else
      run_check "MYSQL_CONN" "MySQL connection FAILED: $MYSQL_OUT" "FAIL"
    fi

    # 10. Table count
    TABLE_COUNT=$(mysql -u sigmabloom_app -p"${DB_PASSWORD}" sigmabloom \
      -e "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema='sigmabloom'" \
      2>/dev/null | tail -1 | tr -d '[:space:]' || echo "0")

    if [[ "$TABLE_COUNT" -ge 15 ]]; then
      run_check "MYSQL_TABLES" "sigmabloom has ${TABLE_COUNT} tables (expected ~20)" "PASS"
    elif [[ "$TABLE_COUNT" -gt 0 ]]; then
      run_check "MYSQL_TABLES" "sigmabloom has ${TABLE_COUNT} tables (warn: < 15)" "WARN"
    else
      run_check "MYSQL_TABLES" "sigmabloom has ${TABLE_COUNT} tables (warn: DB may be empty)" "WARN"
    fi

    # 11. 3 DB users exist
    DB_USER_COUNT=$(mysql -u sigmabloom_app -p"${DB_PASSWORD}" mysql \
      -e "SELECT COUNT(*) FROM mysql.user WHERE user LIKE 'sigmabloom%'" \
      2>/dev/null | tail -1 | tr -d '[:space:]' || echo "0")

    if [[ "$DB_USER_COUNT" == "3" ]]; then
      run_check "MYSQL_USERS" "3 sigmabloom DB users found" "PASS"
    elif [[ "$DB_USER_COUNT" -gt 0 ]]; then
      run_check "MYSQL_USERS" "${DB_USER_COUNT} sigmabloom DB users (expected 3)" "WARN"
    else
      run_check "MYSQL_USERS" "No sigmabloom DB users found" "FAIL"
    fi
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # 12. MySQL bind-address
  # ════════════════════════════════════════════════════════════════════════════
  echo ""
  echo -e "${C_BOLD}--- 12. MySQL Bind Address ---${C_RESET}"

  MYSQL_BIND=$(ss -tlnp 2>/dev/null | grep ':3306' | grep -v '::' || true)

  if [[ -z "$MYSQL_BIND" ]]; then
    log_warn "  MySQL not listening on port 3306 (may be socket-only)"
    record "MYSQL_BIND" "WARN" "MySQL not detected on TCP 3306"
  elif echo "$MYSQL_BIND" | grep -q "127.0.0.1:3306"; then
    run_check "MYSQL_BIND" "MySQL bound to 127.0.0.1:3306 only — secure" "PASS"
  else
    run_check "MYSQL_BIND" "MySQL NOT bound to 127.0.0.1 only: $MYSQL_BIND" "FAIL"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════════
# 13. UFW
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 13. UFW Firewall ---${C_RESET}"

if command -v ufw &>/dev/null; then
  UFW_STATUS=$(ufw status 2>/dev/null || echo "unknown")
  UFW_ACTIVE=$(echo "$UFW_STATUS" | grep -i "Status: active" || true)
  UFW_SSH_OK=$(echo "$UFW_STATUS" | grep -iE "OpenSSH.*ALLOW|22.*ALLOW" || true)
  UFW_NGINX_OK=$(echo "$UFW_STATUS" | grep -iE "Nginx Full.*ALLOW|80.*ALLOW|443.*ALLOW" || true)

  if [[ -n "$UFW_ACTIVE" ]]; then
    UFW_COUNT=0
    [[ -n "$UFW_SSH_OK" ]]  && UFW_COUNT=$((UFW_COUNT + 1))
    [[ -n "$UFW_NGINX_OK" ]] && UFW_COUNT=$((UFW_COUNT + 1))

    if [[ "$UFW_COUNT" -ge 2 ]]; then
      run_check "UFW" "UFW active, OpenSSH + Nginx rules present" "PASS"
    else
      run_check "UFW" "UFW active but missing rules (SSH=${UFW_COUNT} Nginx?)" "WARN"
    fi
  else
    run_check "UFW" "UFW is NOT active" "FAIL"
  fi
else
  log_warn "ufw not installed — skipping firewall check"
  record "UFW" "WARN" "ufw not installed"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 14. fail2ban
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 14. fail2ban ---${C_RESET}"

if command -v fail2ban-client &>/dev/null; then
  FAIL2BAN_SSHD=$(fail2ban-client status sshd 2>&1 || true)
  if echo "$FAIL2BAN_SSHD" | grep -qi "Status\|Jail"; then
    run_check "FAIL2BAN" "fail2ban sshd jail active: $(echo "$FAIL2BAN_SSHD" | head -2 | tr '\n' ' ')" "PASS"
  else
    run_check "FAIL2BAN" "fail2ban-client status sshd returned unexpected output" "WARN"
  fi
else
  log_warn "fail2ban-client not found — skipping"
  record "FAIL2BAN" "WARN" "fail2ban not installed"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 15. SSH Hardening
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 15. SSH Hardening ---${C_RESET}"

SSH_HARDEN_FILE="/etc/ssh/sshd_config.d/00-hardening.conf"
if [[ -f "$SSH_HARDEN_FILE" ]]; then
  SSH_ROOT=$(grep -i "^PermitRootLogin" "$SSH_HARDEN_FILE" | awk '{print $2}' || true)
  SSH_PASS=$(grep -i "^PasswordAuthentication" "$SSH_HARDEN_FILE" | awk '{print $2}' || true)

  if [[ "$SSH_ROOT" == "no" ]] && [[ "$SSH_PASS" == "no" ]]; then
    run_check "SSH_HARDEN" "PermitRootLogin no, PasswordAuthentication no" "PASS"
  else
    run_check "SSH_HARDEN" "SSH hardening file found but values unexpected (root=$SSH_ROOT pass=$SSH_PASS)" "WARN"
  fi
else
  run_check "SSH_HARDEN" "/etc/ssh/sshd_config.d/00-hardening.conf not found" "WARN"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 16. .env Permissions
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 16. .env Permissions ---${C_RESET}"

ENV_PERMS_OK=true
if [[ -f "$ENV_FILE" ]]; then
  ENV_PERMS=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "unknown")
  ENV_OWNER=$(stat -c '%U' "$ENV_FILE" 2>/dev/null || echo "unknown")
  ENV_GROUP=$(stat -c '%G' "$ENV_FILE" 2>/dev/null || echo "unknown")

  if [[ "$ENV_PERMS" == "600" ]]; then
    run_check "ENV_PERMS" ".env permissions: ${ENV_PERMS} (owner: ${ENV_OWNER})" "PASS"
  else
    run_check "ENV_PERMS" ".env permissions: ${ENV_PERMS} (should be 600) — WORLD-READABLE!" "FAIL"
    ENV_PERMS_OK=false
  fi
else
  run_check "ENV_PERMS" ".env not found at ${ENV_FILE}" "WARN"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 17. SEED_ADMIN_PASSWORD leak check
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 17. SEED_ADMIN_PASSWORD Leak Check ---${C_RESET}"

if [[ -f "$ENV_FILE" ]]; then
  SEED_LEAK=$(grep -E '^SEED_ADMIN_PASSWORD=.+$' "$ENV_FILE" 2>/dev/null || true)
  if [[ -n "$SEED_LEAK" ]]; then
    run_check "SEED_LEAK" "FAIL: SEED_ADMIN_PASSWORD still set in .env — REMOVE IT NOW" "FAIL" \
      "Line: $(echo "$SEED_LEAK" | cut -c1-60)..."
  else
    run_check "SEED_LEAK" "SEED_ADMIN_PASSWORD not in .env (safe)" "PASS"
  fi
else
  run_check "SEED_LEAK" "Cannot check — .env not found at ${ENV_FILE}" "WARN"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 18. Backup Freshness
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 18. Backup Freshness ---${C_RESET}"

if [[ -d "$BACKUP_DIR" ]]; then
  NEWEST_BACKUP=$(find "$BACKUP_DIR" -name "*.sql.gz" -type f 2>/dev/null | \
    xargs ls -t --time-style=+%s 2>/dev/null | head -1)

  if [[ -n "$NEWEST_BACKUP" ]]; then
    BACKUP_EPOCH=$(stat -c '%Y' "$NEWEST_BACKUP" 2>/dev/null || echo 0)
    NOW_EPOCH=$(date +%s)
    BACKUP_AGE_H=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))
    BACKUP_FILE_NAME=$(basename "$NEWEST_BACKUP")

    if [[ "$BACKUP_AGE_H" -le 36 ]]; then
      run_check "BACKUP_FRESH" "Newest backup: ${BACKUP_FILE_NAME} (${BACKUP_AGE_H}h old)" "PASS"
    else
      run_check "BACKUP_FRESH" "Newest backup is ${BACKUP_AGE_H}h old (threshold 36h)" "WARN"
    fi
  else
    run_check "BACKUP_FRESH" "No .sql.gz files in ${BACKUP_DIR}" "WARN"
  fi
else
  run_check "BACKUP_FRESH" "Backup dir ${BACKUP_DIR} does not exist" "WARN"
fi

# ════════════════════════════════════════════════════════════════════════════════
# 19. Test-restore Last Run
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_BOLD}--- 19. Test-Restore Log ---${C_RESET}"

RESTORE_LOG=$(find "$LOG_DIR" /var/backups/cyberknight -name "cyberknight-restore-test.log" \
  -type f 2>/dev/null | xargs ls -t 2>/dev/null | head -1)

if [[ -n "$RESTORE_LOG" ]] && [[ -f "$RESTORE_LOG" ]]; then
  RESTORE_LAST_LINE=$(tail -1 "$RESTORE_LOG" 2>/dev/null | tr -d '\n')
  RESTORE_LOG_AGE_H=$(( ($(date +%s) - $(stat -c '%Y' "$RESTORE_LOG" 2>/dev/null || echo 0)) / 3600 ))

  if echo "$RESTORE_LAST_LINE" | grep -qiE "ok|success|pass|hoan tat|thanh cong"; then
    if [[ "$RESTORE_LOG_AGE_H" -le 192 ]]; then  # 8 days
      run_check "TEST_RESTORE" "Last test-restore OK (${RESTORE_LOG_AGE_H}h ago)" "PASS"
    else
      run_check "TEST_RESTORE" "Last test-restore OK but ${RESTORE_LOG_AGE_H}h old (threshold 8 days)" "WARN"
    fi
  else
    run_check "TEST_RESTORE" "Last test-restore: ${RESTORE_LAST_LINE:0:80}" "FAIL"
  fi
else
  run_check "TEST_RESTORE" "No test-restore log found" "WARN"
fi

# ════════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║         POST-DEPLOY CHECK — FINAL SUMMARY                       ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

total=0; pass=0; fail=0; warn=0
for entry in "${CHECKS[@]}"; do
  IFS='|' read -r name status detail <<< "$entry"
  total=$((total + 1))
  case "$status" in
    PASS) pass=$((pass + 1));  sym="[PASS]" ;;
    FAIL) fail=$((fail + 1)); sym="[FAIL]" ;;
    WARN) warn=$((warn + 1)); sym="[WARN]" ;;
  esac
  printf "  %-6s %-18s %s\n" "$sym" "$name" "$detail"
done

echo ""
echo "  Total: $total  |  PASS: $pass  |  FAIL: $fail  |  WARN: $warn"
echo ""

if [[ "$critical_failures" -gt 0 ]]; then
  log_fail "=== CRITICAL FAILURES DETECTED — $critical_failures check(s) failed ==="
  exit 1
else
  log_pass "=== ALL CHECKS PASSED (${warn} warning(s) — review above) ==="
  exit 0
fi
