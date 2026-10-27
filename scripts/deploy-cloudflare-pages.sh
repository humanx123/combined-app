#!/bin/bash
# Deploy Cloudflare Pages with configured env vars
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔨 Building Gesture Synth Weld..."

# Build the app
cd "$PROJECT_ROOT/gesture-synth-app"
if npm run build 2>&1 | tail -5; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

# Deploy to Cloudflare Pages
echo "☁️ Deploying to Cloudflare Pages..."
DEPLOY_OUTPUT=$(wrangler pages deploy dist --project-name gesture-synth-weld 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract URL if available
if echo "$DEPLOY_OUTPUT" | grep -q "https://"; then
    DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+' | head -1)
    echo "🌐 Deployed URL: $DEPLOY_URL"
fi

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📋 Next steps for Gesture Synth:"
echo "  1. Visit: $DEPLOY_URL"
echo "  2. Configure Gemini AI key if needed"
echo "  3. Set up Cloudflare R2 bucket for storage"
echo ""
echo "Environment vars loaded from: gesture-synth-app/.env.local"