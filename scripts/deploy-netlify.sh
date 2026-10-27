#!/bin/bash
# Deploy Netlify with configured env vars
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check required secrets
if [ -z "$NETLIFY_AUTH_TOKEN" ]; then
    echo "❌ NETLIFY_AUTH_TOKEN not set"
    echo "   Set: export NETLIFY_AUTH_TOKEN=your_token"
    exit 1
fi

if [ -z "$NETLIFY_SITE_ID" ]; then
    echo "❌ NETLIFY_SITE_ID not set"
    echo "   Set: export NETLIFY_SITE_ID=your_site_id"
    exit 1
fi

echo "🔨 Building Vibe DAW..."

# Build the app
cd "$PROJECT_ROOT/vibe-daw"
if npm run build 2>&1 | tail -5; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

# Deploy to Netlify
echo "☁️ Deploying to Netlify..."
DEPLOY_OUTPUT=$(netlify deploy --prod --site "$NETLIFY_SITE_ID" 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract URL if available
if echo "$DEPLOY_OUTPUT" | grep -q "https://"; then
    DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]+' | head -1)
    echo "🌐 Deployed URL: $DEPLOY_URL"
fi

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "📋 Next steps for Vibe DAW:"
echo "  1. Visit: $DEPLOY_URL"
echo "  2. Configure Gemini AI key in Netlify dashboard"
echo "  6. Set up Firebase if needed"
echo ""
echo "Environment vars loaded from: vibe-daw/.env.local"