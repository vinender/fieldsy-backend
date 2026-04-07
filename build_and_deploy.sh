#!/bin/bash
# build_and_deploy.sh
# Automates git commit/push and Docker build/push for Fieldsy services
# Includes post-build validation to prevent server crashes
#
# Lives in: backend/build_and_deploy.sh (tracked by the backend git repo).
# A convenience symlink at the project root forwards to this file.
#
# Usage:
#   ./build_and_deploy.sh                    # Default: build all, prompt for commit msg
#   ./build_and_deploy.sh "commit message"   # With commit message
#   TYPECHECK=1 ./build_and_deploy.sh        # Run tsc --noEmit before building

set -e

# Resolve the project root regardless of where this script is invoked from.
# Follows the symlink at the project root if needed so we always end up at the
# parent directory of backend/, frontend/, admin/.
SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$0")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure PATH includes common binary locations
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Configuration
NAMESPACE="vinenderindiit"
PROJECT="fieldsy"
SERVICES=("backend" "frontend" "admin")

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Track failures and per-service timings (using simple vars — macOS bash 3.2 has no associative arrays)
FAILED_SERVICES=()
# Per-service values stored as: _BUILD_TIME_<service>, _PUSH_TIME_<service>, _IMAGE_SIZE_<service>

# Helper: format seconds as Xm Ys
fmt_time() {
    local secs=$1
    if [ "$secs" -ge 60 ]; then
        echo "$((secs / 60))m $((secs % 60))s"
    else
        echo "${secs}s"
    fi
}

# Helper: format bytes as human readable
fmt_bytes() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ]; then
        echo "$(echo "scale=2; $bytes / 1073741824" | bc)GB"
    elif [ "$bytes" -ge 1048576 ]; then
        echo "$(echo "scale=1; $bytes / 1048576" | bc)MB"
    else
        echo "${bytes}B"
    fi
}

# Timer
START_TIME=$(date +%s)

echo -e "${GREEN}🚀 Starting Deployment Workflow${NC}"

# ==========================================
# 0. PRE-FLIGHT CHECKS (fast — file existence only)
# ==========================================
echo -e "\n${CYAN}━━━ Pre-flight Checks ━━━${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed or not in PATH.${NC}"
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo -e "${RED}❌ Docker daemon is not running.${NC}"
    echo -e "${YELLOW}Fix: Start Docker Desktop and run this command:${NC}"
    echo ""
    echo -e "   ${CYAN}docker ps${NC}"
    echo ""
    echo -e "${YELLOW}Then try again:${NC}"
    echo ""
    echo -e "   ${CYAN}./build_and_deploy.sh${NC}"
    echo ""
    exit 1
fi

# Check critical files exist
for SERVICE in "${SERVICES[@]}"; do
    if [ ! -f "$SERVICE/Dockerfile" ]; then
        echo -e "${RED}❌ Missing $SERVICE/Dockerfile${NC}"
        exit 1
    fi
done

if [ ! -f "backend/src/server.ts" ]; then
    echo -e "${RED}❌ backend/src/server.ts not found.${NC}"
    exit 1
fi

if [ ! -d "backend/packages/stripe-auto-payout" ]; then
    echo -e "${RED}❌ backend/packages/stripe-auto-payout missing.${NC}"
    exit 1
fi

# Warn about missing env files (don't block)
for SERVICE in "frontend" "admin"; do
    if [ ! -f "$SERVICE/.env.production" ] && [ ! -f "$SERVICE/.env" ]; then
        echo -e "${YELLOW}⚠️  $SERVICE/.env.production missing${NC}"
    fi
done

echo -e "${GREEN}✅ Pre-flight checks passed${NC}"

# ==========================================
# 1. OPTIONAL TYPE CHECK (opt-in with TYPECHECK=1)
# ==========================================
if [ "$TYPECHECK" == "1" ]; then
    echo -e "\n${CYAN}━━━ Backend Type Check ━━━${NC}"
    cd backend
    [ ! -d "node_modules" ] && npm install
    if ! npx tsc --noEmit; then
        echo -e "${RED}❌ TypeScript compilation failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Type check passed.${NC}"
    cd ..
fi

# ==========================================
# 2. GIT OPERATIONS
# ==========================================
echo -e "\n${CYAN}━━━ Git Operations ━━━${NC}"

GLOBAL_COMMIT_MSG="$1"
CHANGED_SERVICES=()

if [ -z "$GLOBAL_COMMIT_MSG" ]; then
    for SERVICE in "${SERVICES[@]}"; do
        if [ -d "$SERVICE" ] && [ -d "$SERVICE/.git" ]; then
            cd "$SERVICE"
            if [ -n "$(git status --porcelain)" ]; then
                CHANGED_SERVICES+=("$SERVICE")
            fi
            cd ..
        fi
    done

    if [ ${#CHANGED_SERVICES[@]} -gt 0 ]; then
        echo -e "${YELLOW}📝 Changes detected in: ${CHANGED_SERVICES[*]}${NC}"
        echo -e "${YELLOW}Enter commit message (Press Enter for default):${NC}"
        read -r USER_INPUT

        if [ -z "$USER_INPUT" ]; then
            GLOBAL_COMMIT_MSG="Auto-deploy update $(date '+%Y-%m-%d %H:%M:%S')"
        else
            GLOBAL_COMMIT_MSG="$USER_INPUT"
        fi
    fi
fi

for SERVICE in "${SERVICES[@]}"; do
    if [ -d "$SERVICE" ] && [ -d "$SERVICE/.git" ]; then
        cd "$SERVICE"
        if [ -n "$(git status --porcelain)" ]; then
            echo "[$SERVICE] Committing: '$GLOBAL_COMMIT_MSG'"
            git add .
            git commit -m "$GLOBAL_COMMIT_MSG"
            git push origin main || git push
            echo -e "${GREEN}✅ $SERVICE pushed.${NC}"
        else
            echo -e "${GREEN}✨ $SERVICE — no changes.${NC}"
        fi
        cd ..
    fi
done

# ==========================================
# 3. DOCKER BUILD & PUSH
# ==========================================
echo -e "\n${CYAN}━━━ Docker Build & Push ━━━${NC}"

# Auto-login to GHCR
if [ -f ".gh_token" ]; then
    CR_PAT=$(cat .gh_token)
    if ! echo "$CR_PAT" | docker login ghcr.io -u vinenderindiit --password-stdin 2>/dev/null; then
        echo -e "${RED}❌ Docker login failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ GHCR login OK${NC}"
fi

for SERVICE in "${SERVICES[@]}"; do
    if [ -d "$SERVICE" ] && [ -f "$SERVICE/Dockerfile" ]; then
        IMAGE_TAG="ghcr.io/$NAMESPACE/$PROJECT-$SERVICE:latest"
        STEP_START=$(date +%s)

        echo -e "\n${CYAN}━━━ $SERVICE ━━━${NC}"

        # NOTE: Do NOT copy .env over .env.production for frontend/admin
        # Production URLs are injected via Dockerfile ARGs at build time
        # Local .env has localhost URLs for development only

        # Build
        BUILD_START=$(date +%s)
        echo "Building..."
        if [ "$SERVICE" == "backend" ]; then
            if ! DOCKER_BUILDKIT=1 docker build -f "$SERVICE/Dockerfile" -t "$IMAGE_TAG" . ; then
                echo -e "${RED}❌ Build FAILED${NC}"
                FAILED_SERVICES+=("$SERVICE")
                continue
            fi
        else
            # For frontend/admin: extract NEXT_PUBLIC_* and auth vars from .env
            # and pass them as --build-arg so they're baked into the production build
            BUILD_ARGS=""
            if [[ "$SERVICE" == "frontend" || "$SERVICE" == "admin" ]]; then
                ENV_FILE="$SERVICE/.env"
                if [ -f "$ENV_FILE" ]; then
                    echo -e "${CYAN}   Injecting env vars from $ENV_FILE into build...${NC}"
                    while IFS='=' read -r key value; do
                        # Skip comments and empty lines
                        [[ -z "$key" || "$key" == \#* ]] && continue
                        # Strip inline comments and trim whitespace
                        value=$(echo "$value" | sed "s/#.*$//" | sed "s/^['\"]//;s/['\"]$//" | xargs)
                        # Only pass NEXT_PUBLIC_*, NEXTAUTH_URL, and NEXTAUTH_SECRET
                        if [[ "$key" == NEXT_PUBLIC_* || "$key" == "NEXTAUTH_URL" || "$key" == "NEXTAUTH_SECRET" ]]; then
                            BUILD_ARGS="$BUILD_ARGS --build-arg $key=$value"
                        fi
                    done < "$ENV_FILE"
                    # Always override API URLs with production values
                    BUILD_ARGS="$BUILD_ARGS --build-arg NEXT_PUBLIC_API_URL=https://api.fieldsy.co.uk/api"
                    BUILD_ARGS="$BUILD_ARGS --build-arg NEXT_PUBLIC_BACKEND_URL=https://api.fieldsy.co.uk"
                    BUILD_ARGS="$BUILD_ARGS --build-arg NEXTAUTH_URL=https://fieldsy.co.uk"
                fi
            fi

            if ! DOCKER_BUILDKIT=1 docker build $BUILD_ARGS -t "$IMAGE_TAG" "./$SERVICE" ; then
                echo -e "${RED}❌ Build FAILED${NC}"
                FAILED_SERVICES+=("$SERVICE")
                continue
            fi
        fi
        BUILD_END=$(date +%s)
        eval "_BUILD_TIME_${SERVICE}=$(( BUILD_END - BUILD_START ))"

        # Get image size
        IMG_SIZE_BYTES=$(docker image inspect "$IMAGE_TAG" --format='{{.Size}}' 2>/dev/null || echo "0")
        eval "_IMAGE_SIZE_${SERVICE}=$IMG_SIZE_BYTES"

        eval "BT=\$_BUILD_TIME_${SERVICE}"
        echo -e "${GREEN}   Built in $(fmt_time $BT) — Image size: $(fmt_bytes $IMG_SIZE_BYTES)${NC}"

        # Post-build validation (fast — just checks file existence inside image)
        echo "Validating..."
        if [ "$SERVICE" == "backend" ]; then
            if ! docker run --rm "$IMAGE_TAG" sh -c "test -f /app/backend/dist/server.js"; then
                echo -e "${RED}❌ dist/server.js missing inside image! Skipping push.${NC}"
                FAILED_SERVICES+=("$SERVICE")
                continue
            fi
        fi

        if [[ "$SERVICE" == "frontend" || "$SERVICE" == "admin" ]]; then
            if ! docker run --rm "$IMAGE_TAG" sh -c "test -f /app/server.js && test -d /app/.next/static"; then
                echo -e "${RED}❌ Next.js output missing inside image! Skipping push.${NC}"
                FAILED_SERVICES+=("$SERVICE")
                continue
            fi
        fi

        # Push (track time and compute upload speed)
        PUSH_START=$(date +%s)
        echo "Pushing..."
        if ! docker push "$IMAGE_TAG"; then
            echo -e "${RED}❌ Push FAILED${NC}"
            FAILED_SERVICES+=("$SERVICE")
            continue
        fi
        PUSH_END=$(date +%s)
        PUSH_DURATION=$(( PUSH_END - PUSH_START ))
        eval "_PUSH_TIME_${SERVICE}=$PUSH_DURATION"

        # Estimate upload speed from image size and push duration
        if [ "$PUSH_DURATION" -gt 0 ] && [ "$IMG_SIZE_BYTES" -gt 0 ]; then
            SPEED_BPS=$(( IMG_SIZE_BYTES / PUSH_DURATION ))
            SPEED_MBPS=$(echo "scale=1; $SPEED_BPS * 8 / 1000000" | bc 2>/dev/null || echo "N/A")
            echo -e "${GREEN}   Pushed in $(fmt_time $PUSH_DURATION) — Upload speed: ~${SPEED_MBPS} Mbps${NC}"
        else
            echo -e "${GREEN}   Pushed in ${PUSH_DURATION}s (cached — no layers transferred)${NC}"
        fi

        STEP_END=$(date +%s)
        echo -e "${GREEN}✅ $SERVICE done ($(fmt_time $(( STEP_END - STEP_START ))))${NC}"
    fi
done

# ==========================================
# 4. SUMMARY
# ==========================================
END_TIME=$(date +%s)
TOTAL_TIME=$(( END_TIME - START_TIME ))

echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Deployment Summary — Total: $(fmt_time $TOTAL_TIME)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Per-service breakdown
TOTAL_PUSH_BYTES=0
TOTAL_PUSH_SECS=0

for SERVICE in "${SERVICES[@]}"; do
    eval "BT=\${_BUILD_TIME_${SERVICE}:-}"
    eval "PT=\${_PUSH_TIME_${SERVICE}:-}"
    eval "IS=\${_IMAGE_SIZE_${SERVICE}:-0}"

    # Check if service failed
    FAILED=false
    for F in "${FAILED_SERVICES[@]}"; do
        [ "$F" == "$SERVICE" ] && FAILED=true
    done

    if $FAILED; then
        echo -e "  ${RED}✗ $SERVICE — FAILED${NC}"
    elif [ -n "$BT" ]; then
        echo -e "  ${GREEN}✓ $SERVICE${NC}"
        echo -e "      Build: $(fmt_time $BT)   Push: $(fmt_time $PT)   Image: $(fmt_bytes $IS)"
        TOTAL_PUSH_BYTES=$(( TOTAL_PUSH_BYTES + IS ))
        TOTAL_PUSH_SECS=$(( TOTAL_PUSH_SECS + PT ))
    else
        echo -e "  ${GREEN}– $SERVICE — skipped${NC}"
    fi
done

# Average upload speed across all pushes
echo -e "${CYAN}───────────────────────────────────────────────────${NC}"
if [ "$TOTAL_PUSH_SECS" -gt 0 ] && [ "$TOTAL_PUSH_BYTES" -gt 0 ]; then
    AVG_SPEED_MBPS=$(echo "scale=1; $TOTAL_PUSH_BYTES * 8 / $TOTAL_PUSH_SECS / 1000000" | bc 2>/dev/null || echo "N/A")
    echo -e "  Avg upload speed: ~${AVG_SPEED_MBPS} Mbps"
fi
echo -e "  Total time: $(fmt_time $TOTAL_TIME)"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    echo -e "\n${RED}❌ FAILED: ${FAILED_SERVICES[*]}${NC}"
    echo -e "${YELLOW}   DO NOT run server_update.sh until fixed.${NC}"
    exit 1
else
    echo -e "\n${GREEN}✅ All services built, validated, and pushed.${NC}"

    # ==========================================
    # 5. SSH INTO SERVER & RUN UPDATE
    # ==========================================
    echo -e "\n${CYAN}━━━ Server Update ━━━${NC}"
    echo -e "${YELLOW}Syncing configuration files to production server...${NC}"

    # Target host and credentials
    SERVER_IP="ec2-13-134-171-181.eu-west-2.compute.amazonaws.com"
    SSH_KEY="~/Downloads/fieldsy-client.pem"
    REMOTE_PATH="/var/www/fieldsy"

    # Sync GitHub token for Docker authentication
    if [ -f ".gh_token" ]; then
        echo "Syncing .gh_token for GHCR authentication..."
        scp -i "$SSH_KEY" ".gh_token" "ubuntu@$SERVER_IP:$REMOTE_PATH/.gh_token"
    fi

    # Sync backend .env directly (runtime config: DB, Stripe keys, etc.)
    if [ -f "backend/.env" ]; then
        echo "Syncing backend/.env..."
        scp -i "$SSH_KEY" "backend/.env" "ubuntu@$SERVER_IP:$REMOTE_PATH/backend/.env"
    fi

    # For frontend/admin: generate a production-safe .env from local .env
    # - Copies all vars (auth secrets, Firebase keys, Stripe keys)
    # - Overrides API/Backend URLs with production values (never localhost)
    for SERVICE in "frontend" "admin"; do
        if [ -f "$SERVICE/.env" ]; then
            echo "Generating production $SERVICE/.env..."
            PROD_ENV=$(mktemp)
            # Copy local .env but override URLs
            while IFS= read -r line; do
                case "$line" in
                    NEXT_PUBLIC_API_URL=*)
                        echo "NEXT_PUBLIC_API_URL=https://api.fieldsy.co.uk/api" >> "$PROD_ENV" ;;
                    NEXT_PUBLIC_BACKEND_URL=*)
                        echo "NEXT_PUBLIC_BACKEND_URL=https://api.fieldsy.co.uk" >> "$PROD_ENV" ;;
                    NEXTAUTH_URL=*)
                        echo "NEXTAUTH_URL=https://fieldsy.co.uk" >> "$PROD_ENV" ;;
                    *)
                        echo "$line" >> "$PROD_ENV" ;;
                esac
            done < "$SERVICE/.env"
            scp -i "$SSH_KEY" "$PROD_ENV" "ubuntu@$SERVER_IP:$REMOTE_PATH/$SERVICE/.env"
            rm "$PROD_ENV"
            echo -e "${GREEN}   $SERVICE/.env synced (URLs overridden to production)${NC}"
        fi
    done

    echo -e "${YELLOW}Connecting to production server to pull images and restart...${NC}"
    ssh -i "$SSH_KEY" "ubuntu@$SERVER_IP" "cd $REMOTE_PATH && ./server-update.sh"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Server update completed successfully.${NC}"
    else
        echo -e "${RED}❌ Server update failed. SSH into the server to check.${NC}"
        exit 1
    fi
fi
