#!/bin/bash
# Deploy Combined App to Cloudflare Pages + GitHub Pages
# This script deploys Gesture Synth Weld to Cloudflare and Vibe DAW to GitHub Pages

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Starting Combined App Deployment..."
echo "======================================"

# Check for required secrets
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "❌ CLOUDFLARE_API_TOKEN not set"
    echo "   Set: export CLOUDFLARE_API_TOKEN=your_token"
    exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ GITHUB_TOKEN not set"
    echo "   Set: export GITHUB_TOKEN=ghp_your_token"
    exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler >/dev/null 2>&1; then
    echo "📦 Installing wrangler..."
    npm install -g wrangler
fi

# Check if logged in to Cloudflare
if ! wrangler whoami >/dev/null 2>&1; then
    echo "🔐 Logging into Cloudflare..."
    echo "   Token: $CLOUDFLARE_API_TOKEN"
    # Note: wrangler login uses browser, but we can use the token
    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"
fi

# ─── Deploy Gesture Synth Weld to Cloudflare Pages ───
echo ""
echo "======================================"
echo "📦 Deploying Gesture Synth Weld to Cloudflare Pages"
echo "======================================"

cd "$PROJECT_ROOT/gesture-synth-app"

echo "🔨 Building Gesture Synth Weld..."
if npm run build 2>&1 | tail -5; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo "☁️ Deploying to Cloudflare Pages..."
DEPLOY_OUTPUT=$(wrangler pages deploy dist --project-name gesture-synth-weld 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract URL if available
if echo "$DEPLOY_OUTPUT" | grep -q "https://"; then
    DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+' | head -1)
    echo "🌐 Gesture Synth URL: $DEPLOY_URL"
fi

# ─── Deploy Vibe DAW to GitHub Pages ───
echo ""
echo "======================================"
echo "📦 Deploying Vibe DAW to GitHub Pages"
echo "======================================"

cd "$PROJECT_ROOT/vibe-daw"

echo "🔨 Building Vibe DAW..."
if npm run build 2>&1 | tail -5; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo "☁️ Deploying to GitHub Pages..."
# Use GitHub Pages deployment
if [ -n "$GITHUB_TOKEN" ]; then
    # Push to gh-pages branch
    git checkout -b gh-pages 2>/dev/null || git checkout gh-pages
    git rm -rf . 2>/dev/null || true
    cp -r dist/* ./
    git add -A
    git commit -m "Deploy Vibe DAW to GitHub Pages" 2>/dev/null || echo "No changes to commit"
    git push origin gh-pages --force
    echo "✅ Vibe DAW deployed to GitHub Pages"
else
    echo "❌ GITHUB_TOKEN not set - cannot deploy to GitHub Pages"
fi

# ─── Summary ───
echo ""
echo "======================================"
echo "🎉 Deployment Complete!"
echo "======================================"
echo ""
echo "📋 Deployed URLs:"
echo "   Gesture Synth Weld: https://gesture-synth-weld.pages.dev"
echo "   Vibe DAW: https://<username>.github.io/<repo>/"
echo ""
echo "📋 Next Steps:"
echo "   1. Configure Gemini/Groq API keys"
echo "   2. Set up Firebase for Vibe DAW"
echo "   3. Configure Cloudflare R2 bucket"
echo "   4. Test both applications"
echo ""
echo "Environment vars loaded from:"
echo "   - gesture-synth-app/.env.local"
echo "   - vibe-daw/.env.local"