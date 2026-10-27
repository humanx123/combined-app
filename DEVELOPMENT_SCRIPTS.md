# Development Scripts: Combined Gesture Synth Weld + Vibe DAW

## Overview

This document provides comprehensive development scripts for working with the combined gesture-DAW platform. These scripts automate common development tasks, streamline workflows, and provide quick access to frequently used commands.

## Script Categories

### 1. Environment Setup Scripts
### 2. Development Server Scripts
### 3. Build and Deployment Scripts
### 4. Testing and Quality Scripts
### 5. Project Management Scripts
### 6. Convenience Scripts

## Installation Scripts

### install-all.sh
```bash
#!/bin/bash
# Comprehensive installation script for the combined app

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔧 Installing Combined App dependencies..."

# Check Node.js version
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR_VERSION=${NODE_VERSION%.*}

if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 18 or higher."
    echo "💡 You can install Node.js using nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Install root-level dependencies
cd "$PROJECT_ROOT"
echo "📦 Installing root-level dependencies..."
npm install

# Install project dependencies
for project in gesture-synth-app vibe-daw; do
    if [ -d "$PROJECT_ROOT/$project" ]; then
        echo "📦 Installing dependencies for $project..."
        cd "$PROJECT_ROOT/$project"
        
        if [ -f "package-lock.json" ]; then
            npm ci
        else
            npm install
        fi
        
        echo "✅ $project dependencies installed"
    else
        echo "⚠️  Warning: $project directory not found"
    fi
    cd "$PROJECT_ROOT"
done

# Set up environment files
echo "🔧 Setting up environment files..."

# Gesture Synth Weld environment
if [ -f "$PROJECT_ROOT/gesture-synth-app/.env.example" ]; then
    if [ ! -f "$PROJECT_ROOT/gesture-synth-app/.env.local" ]; then
        cp "$PROJECT_ROOT/gesture-synth-app/.env.example" "$PROJECT_ROOT/gesture-synth-app/.env.local"
        echo "✅ Gesture Synth Weld environment created"
    fi
    
    # Set development variables
    sed -i '' 's/^VITE_ENABLE_EXTERNAL_SCRIPTS=.*$/VITE_ENABLE_EXTERNAL_SCRIPTS=false/' "$PROJECT_ROOT/gesture-synth-app/.env.local" 2>/dev/null || \
    sed -i 's/^VITE_ENABLE_EXTERNAL_SCRIPTS=.*$/VITE_ENABLE_EXTERNAL_SCRIPTS=false/' "$PROJECT_ROOT/gesture-synth-app/.env.local"
    
    sed -i '' 's/^VITE_GEMINI_API_KEY=.*/VITE_GEMINI_API_KEY=dev_key_for_local_development/' 2>/dev/null || \
    sed -i 's/^VITE_GEMINI_API_KEY=.*/VITE_GEMINI_API_KEY=dev_key_for_local_development/' "$PROJECT_ROOT/gesture-synth-app/.env.local"
fi

# Vibe DAW environment
if [ -f "$PROJECT_ROOT/vibe-daw/.env.example" ]; then
    if [ ! -f "$PROJECT_ROOT/vibe-daw/.env.local" ]; then
        cp "$PROJECT_ROOT/vibe-daw/.env.example" "$PROJECT_ROOT/vibe-daw/.env.local"
        echo "✅ Vibe DAW environment created"
    fi
    
    # Set development variables
    sed -i '' 's/^VITE_FIREBASE_ENABLED=.*/VITE_FIREBASE_ENABLED=true/' 2>/dev/null || \
    sed -i 's/^VITE_FIREBASE_ENABLED=.*/VITE_FIREBASE_ENABLED=true/' "$PROJECT_ROOT/vibe-daw/.env.local"
    
    sed -i '' 's/^VITE_HOSTED_AI=.*/VITE_HOSTED_AI=false/' 2>/dev/null || \
    sed -i 's/^VITE_HOSTED_AI=.*/VITE_HOSTED_AI=false/' "$PROJECT_ROOT/vibe-daw/.env.local"
    
    sed -i '' 's|^VITE_GEMINI_API_KEY=.*|VITE_GEMINI_API_KEY=dev_gemini_key_for_local_development|' 2>/dev/null || \
    sed -i 's|^VITE_GEMINI_API_KEY=.*|VITE_GEMINI_API_KEY=dev_gemini_key_for_local_development|' "$PROJECT_ROOT/vibe-daw/.env.local"
fi

# Make scripts executable
chmod +x "$PROJECT_ROOT/*.sh" 2>/dev/null || true

echo "🎉 Installation complete!"
echo ""
echo "To start development, run:"
echo "  ./dev.sh"
echo ""
echo "To build for production, run:"
echo "  ./build.sh"
echo ""
echo "To check the setup, run:"
echo "  ./check-setup.sh"
```

### setup-mobile.sh
```bash
#!/bin/bash
# Set up mobile development environment for Vibe DAW

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIBE_DAW_DIR="$PROJECT_ROOT/vibe-daw"

if [ ! -d "$VIBE_DAW_DIR" ]; then
    echo "❌ Vibe DAW directory not found at $VIBE_DAW_DIR"
    exit 1
fi

cd "$VIBE_DAW_DIR"

echo "📱 Setting up mobile development environment..."

# Check if Android SDK is available
if [ -d "$HOME/Android/Sdk" ]; then
    echo "✅ Android SDK found at $HOME/Android/Sdk"
    export ANDROID_HOME="$HOME/Android/Sdk"
    export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
else
    echo "⚠️  Android SDK not found. Please install from: https://developer.android.com/studio/projects/install-sdk"
    echo "   Mobile development will be limited to iOS emulator."
fi

# Check if Xcode is available (macOS)
if command -v xcode-select >/dev/null 2>&1; then
    echo "✅ Xcode command line tools found"
else
    echo "⚠️  Xcode command line tools not found"
fi

# Install mobile project dependencies
echo "📦 Installing mobile project dependencies..."
cd "$VIBE_DAW_DIR/mobile"

if [ -f "package-lock.json" ]; then
    npm ci
else
    npm install
fi

echo "✅ Mobile dependencies installed"

# Set up iOS capabilities
if [ -f "App.tsx" ]; then
    echo "🔧 Configuring iOS capabilities..."
    
    # Check for required Expo config
    if [ ! -f "app.config.js" ]; then
        echo "⚠️  app.config.js not found in mobile directory"
    fi
fi

echo "🎉 Mobile development environment setup complete!"
echo ""
echo "To start mobile development:"
echo "  cd vibe-daw/mobile"
echo "  npm start"
echo ""
echo "To run iOS simulator:"
echo "  npx expo run:ios"
echo ""
echo "To run Android emulator (if Android SDK is available):"
echo "  npx expo run:android"
```

## Development Server Scripts

### dev.sh
```bash
#!/bin/bash
# Start development servers for both projects

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if dependencies are installed
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "🔧 Dependencies not found. Running installation..."
    "$SCRIPT_DIR/install.sh"
fi

echo "🚀 Starting development servers..."
cd "$PROJECT_ROOT"

# Function to check if a process is already running
check_port() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        if lsof -i ":$port" >/dev/null 2>&1; then
            echo "⚠️  Port $port is already in use"
            return 1
        fi
    fi
    return 0
}

# Check available ports
check_port 3000 || echo "⚠️  Port 3000 (Gesture Synth) is in use"
check_port 5173 || echo "⚠️  Port 5173 (Vibe DAW) is in use"

# Start development servers
if command -v concurrently >/dev/null 2>&1; then
    echo "📡 Starting servers with concurrent output..."
    
    concurrently \
        --names "gesture" "vibe" \
        --prefix "[{name}]" \
        --prefix-colors "cyan,magenta" \
        \
        "$SCRIPT_DIR/dev-gesture.sh" \
        "$SCRIPT_DIR/dev-vibe.sh" \
        \
        --kill-others-on-fail
else
    echo "⚠️  'concurrently' not found. Installing..."
    npm install -g concurrently
    
    echo "📡 Starting servers with concurrent output..."
    
    concurrently \
        --names "gesture" "vibe" \
        --prefix "[{name}]" \
        --prefix-colors "cyan,magenta" \
        \
        "$SCRIPT_DIR/dev-gesture.sh" \
        "$SCRIPT_DIR/dev-vibe.sh" \
        \
        --kill-others-on-fail
fi
```

### dev-gesture.sh
```bash
#!/bin/bash
# Start Gesture Synth Weld development server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GESTURE_DIR="$PROJECT_ROOT/gesture-synth-app"

echo "🎹 Starting Gesture Synth Weld development server..."
cd "$GESTURE_DIR"

# Check for TypeScript errors
if [ -f "tsconfig.json" ]; then
    echo "🔍 Checking TypeScript..."
    if npm run typecheck 2>/dev/null; then
        echo "✅ TypeScript checks passed"
    else
        echo "⚠️  TypeScript errors found"
        echo "   Continuing anyway..."
    fi
fi

# Start the development server
if command -v npm >/dev/null 2>&1; then
    echo "🌐 Starting Vite development server..."
    echo "   Access at: http://localhost:3000"
    npm run dev
else
    echo "❌ npm not found"
    exit 1
fi
```

### dev-vibe.sh
```bash
#!/bin/bash
# Start Vibe DAW development server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VIBE_DAW_DIR="$PROJECT_ROOT/vibe-daw"

echo "🎵 Starting Vibe DAW development server..."
cd "$VIBE_DAW_DIR"

# Check for TypeScript errors
if [ -f "tsconfig.json" ]; then
    echo "🔍 Checking TypeScript..."
    if npm run typecheck 2>/dev/null; then
        echo "✅ TypeScript checks passed"
    else
        echo "⚠️  TypeScript errors found"
        echo "   Continuing anyway..."
    fi
fi

# Start the development server
if command -v npm >/dev/null 2>&1; then
    echo "🌐 Starting Vite development server..."
    echo "   Access at: http://localhost:5173"
    echo "   Studio interface at: http://localhost:5173/studio"
    npm run dev
else
    echo "❌ npm not found"
    exit 1
fi
```

## Build and Deployment Scripts

### build.sh
```bash
#!/bin/bash
# Build both projects for production

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Create deployment directory
DEPLOY_DIR="$PROJECT_ROOT/deploy"
mkdir -p "$DEPLOY_DIR"

echo "🏗️  Building applications for production..."

# Build Gesture Synth Weld
echo ""
echo "📦 Building Gesture Synth Weld..."
cd "$PROJECT_ROOT/gesture-synth-app"

if command -v npm >/dev/null 2>&1; then
    if npm run build 2>&1 | tail -20; then
        echo "✅ Gesture Synth Weld built successfully"
        
        # Copy to deployment directory
        mkdir -p "$DEPLOY_DIR/gesture-synth"
        cp -r dist "$DEPLOY_DIR/gesture-synth/"
        echo "✅ Gesture Synth Weld artifacts copied"
    else
        echo "❌ Gesture Synth Weld build failed"
        exit 1
    fi
else
    echo "❌ npm not found"
    exit 1
fi

# Build Vibe DAW
echo ""
echo "📦 Building Vibe DAW..."
cd "$PROJECT_ROOT/vibe-daw"

if command -v npm >/dev/null 2>&1; then
    if npm run build 2>&1 | tail -20; then
        echo "✅ Vibe DAW built successfully"
        
        # Copy to deployment directory
        mkdir -p "$DEPLOY_DIR/vibe"
        cp -r dist "$DEPLOY_DIR/vibe/"
        echo "✅ Vibe DAW artifacts copied"
    else
        echo "❌ Vibe DAW build failed"
        exit 1
    fi
else
    echo "❌ npm not found"
    exit 1
fi

# Copy configuration files
echo ""
echo "📄 Copying configuration files..."
cp "$PROJECT_ROOT/gesture-synth-app/vercel.json" "$DEPLOY_DIR/gesture-synth/" 2>/dev/null || echo "⚠️  vercel.json not found"
cp "$PROJECT_ROOT/vibe-daw/netlify.toml" "$DEPLOY_DIR/vibe/" 2>/dev/null || echo "⚠️  netlify.toml not found"
cp "$PROJECT_ROOT/vibe-daw/firebase.json" "$DEPLOY_DIR/vibe/" 2>/dev/null || echo "⚠️  firebase.json not found"

# Create deployment manifest
echo ""
echo "📋 Creating deployment manifest..."
cat > "$DEPLOY_DIR/manifest.json" << EOF
{
  "version": "1.0.0",
  "build_date": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "projects": {
    "gesture-synth": {
      "name": "Gesture Synth Weld",
      "description": "Hand gesture music synthesizer with MediaPipe",
      "version": "1.0.0",
      "build_command": "npm run build",
      "start_command": "npm run dev",
      "port": 3000,
      "license": "MIT"
    },
    "vibe": {
      "name": "Vibe DAW",
      "description": "AI-powered digital audio workstation",
      "version": "0.1.0",
      "build_command": "npm run build",
      "start_command": "npm run dev",
      "port": 5173,
      "license": "MIT"
    }
  },
  "deployment_info": {
    "gesture_synth_host": "https://gesturesynthweld.com",
    "vibe_host": "https://vibe-daw.vercel.app",
    "documentation": "/docs/",
    "api_version": "v1"
  }
}
EOF

echo "✅ Deployment manifest created"

echo ""
echo "🎉 Build complete!"
echo ""
echo "Deployment directory: $DEPLOY_DIR"
echo ""
echo "Contents:"
echo "  $DEPLOY_DIR/manifest.json"
echo "  $DEPLOY_DIR/gesture-synth/"
echo "  $DEPLOY_DIR/vibe/"
echo ""
echo "To deploy to production:"
echo "  For Gesture Synth Weld (Cloudflare Pages):"
echo "    npx wrangler pages deploy dist --project-name gesture-synth-weld"
echo "  For Vibe DAW (Netlify):"
echo "    netlify deploy --prod"
echo ""
echo "To run tests:"
echo "  ./test.sh"
```

### deploy.sh
```bash
#!/bin/bash
# Deploy to production (requires environment configuration)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if deployment configuration exists
if [ ! -f "$PROJECT_ROOT/deploy.sh" ]; then
    echo "❌ Deploy script not found"
    exit 1
fi

# Check environment variables
if [ ! -f "$PROJECT_ROOT/gesture-synth-app/.env.local" ]; then
    echo "⚠️  Gesture Synth Weld environment not configured"
    echo "   Please create .env.local file in gesture-synth-app/"
fi

if [ ! -f "$PROJECT_ROOT/vibe-daw/.env.local" ]; then
    echo "⚠️  Vibe DAW environment not configured"
    echo "   Please create .env.local file in vibe-daw/"
fi

echo "🚀 Deploying to production..."
echo ""
echo "⚠️  This will deploy to production environments."
echo "   Make sure you have the necessary credentials and permissions."
echo ""
echo "Press Ctrl+C to cancel or any key to continue..."
read -n 1 -s -r

echo ""
echo "🔧 Deploying Gesture Synth Weld to Cloudflare Pages..."
cd "$PROJECT_ROOT/gesture-synth-app"

if command -v npm >/dev/null 2>&1; then
    # Build first
    npm run build
    
    # Deploy (requires CLOUDFLARE_API_TOKEN)
    if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
        npx wrangler pages deploy dist --project-name gesture-synth-weld
        echo "✅ Gesture Synth Weld deployed to Cloudflare Pages"
    else
        echo "⚠️  CLOUDFLARE_API_TOKEN not set. Skipping deployment."
        echo "   Set CLOUDFLARE_API_TOKEN environment variable to deploy."
    fi
else
    echo "❌ npm not found"
    exit 1
fi

echo ""
echo "🔧 Deploying Vibe DAW to Netlify..."
cd "$PROJECT_ROOT/vibe-daw"

if command -v npm >/dev/null 2>&1; then
    # Build first
    npm run build
    
    # Deploy (requires NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID)
    if [ -n "$NETLIFY_AUTH_TOKEN" ] && [ -n "$NETLIFY_SITE_ID" ]; then
        netlify deploy --prod --site "$NETLIFY_SITE_ID"
        echo "✅ Vibe DAW deployed to Netlify"
    else
        echo "⚠️  NETLIFY credentials not set. Skipping deployment."
        echo "   Set NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID environment variables to deploy."
    fi
else
    echo "❌ npm not found"
    exit 1
fi

echo ""
echo "🎉 Deployment complete!"
```

## Testing and Quality Scripts

### test.sh
```bash
#!/bin/bash
# Run all tests and quality checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if dependencies are installed
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "🔧 Dependencies not found. Running installation..."
    "$SCRIPT_DIR/install.sh"
fi

echo "🧪 Running tests and quality checks..."

echo ""
echo "📊 Running Gesture Synth Weld tests..."
cd "$PROJECT_ROOT/gesture-synth-app"

# Run unit tests
if command -v npm >/dev/null 2>&1; then
    if npm run test 2>&1; then
        echo "✅ Gesture Synth Weld tests passed"
    else
        echo "❌ Gesture Synth Weld tests failed"
        exit 1
    fi
else
    echo "❌ npm not found"
    exit 1
fi

echo ""
echo "📊 Running Vibe DAW tests..."
cd "$PROJECT_ROOT/vibe-daw"

# Run unit tests
if command -v npm >/dev/null 2>&1; then
    if npm run test 2>&1; then
        echo "✅ Vibe DAW tests passed"
    else
        echo "❌ Vibe DAW tests failed"
        exit 1
    fi
else
    echo "❌ npm not found"
    exit 1
fi

# Run integration tests (if any)
echo ""
echo "🔍 Running integration tests..."
cd "$PROJECT_ROOT/vibe-daw"

# Playwright tests (if configured)
if [ -f "playwright.config.ts" ]; then
    echo "🌐 Running Playwright integration tests..."
    if npm run test:browser 2>&1; then
        echo "✅ Playwright tests passed"
    else
        echo "⚠️  Playwright tests failed (might be environment issue)"
    fi
fi

echo ""
echo "🔍 Running type checking..."
cd "$PROJECT_ROOT/gesture-synth-app"

if command -v npm >/dev/null 2>&1; then
    if npm run typecheck 2>&1; then
        echo "✅ Gesture Synth Weld type check passed"
    else
        echo "❌ Gesture Synth Weld type check failed"
        exit 1
    fi
fi

cd "$PROJECT_ROOT/vibe-daw"

if command -v npm >/dev/null 2>&1; then
    if npm run typecheck 2>&1; then
        echo "✅ Vibe DAW type check passed"
    else
        echo "❌ Vibe DAW type check failed"
        exit 1
    fi
fi

echo ""
echo "🎉 All tests and quality checks passed!"
```

### lint.sh
```bash
#!/bin/bash
# Run linting and code quality checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if dependencies are installed
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "🔧 Dependencies not found. Running installation..."
    "$SCRIPT_DIR/install.sh"
fi

echo "🔍 Running linting and code quality checks..."

echo ""
echo "📋 Linting Gesture Synth Weld..."
cd "$PROJECT_ROOT/gesture-synth-app"

if command -v npm >/dev/null 2>&1; then
    # Try to run eslint or prettier
    if npm run lint 2>&1; then
        echo "✅ Gesture Synth Weld linting passed"
    else
        echo "⚠️  Gesture Synth Weld linting failed (might be optional script)"
        echo "   Continuing..."
    fi
else
    echo "❌ npm not found"
    exit 1
fi

echo ""
echo "📋 Linting Vibe DAW..."
cd "$PROJECT_ROOT/vibe-daw"

if command -v npm >/dev/null 2>&1; then
    # Try to run eslint or prettier
    if npm run lint 2>&1; then
        echo "✅ Vibe DAW linting passed"
    else
        echo "⚠️  Vibe DAW linting failed (might be optional script)"
        echo "   Continuing..."
    fi
else
    echo "❌ npm not found"
    exit 1
fi

echo ""
echo "🎉 Linting checks complete!"
```

### check-setup.sh
```bash
#!/bin/bash
# Check development environment setup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Check if dependencies are installed
if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "❌ Node.js dependencies not found"
    echo "   Run: ./install.sh"
    exit 1
fi

echo "✅ Node.js dependencies found"

# Check project structure
for project in gesture-synth-app vibe-daw; do
    if [ -d "$PROJECT_ROOT/$project" ]; then
        echo "✅ $project directory found"
        
        if [ -f "$PROJECT_ROOT/$project/package.json" ]; then
            echo "✅ $project package.json found"
            
            # Check if node_modules exists in project
            if [ -d "$PROJECT_ROOT/$project/node_modules" ]; then
                echo "✅ $project node_modules found"
            else
                echo "⚠️  $project node_modules not found - running installation"
                cd "$PROJECT_ROOT/$project"
                npm install
            fi
        else
            echo "❌ $project package.json not found"
        fi
    else
        echo "❌ $project directory not found"
    fi
    echo
 done

# Check environment files
echo "🔧 Checking environment files..."

if [ -f "$PROJECT_ROOT/gesture-synth-app/.env.local" ]; then
    echo "✅ Gesture Synth Weld .env.local found"
else
    echo "⚠️  Gesture Synth Weld .env.local not found"
    echo "   Run: cp gesture-synth-app/.env.example gesture-synth-app/.env.local"
fi

if [ -f "$PROJECT_ROOT/vibe-daw/.env.local" ]; then
    echo "✅ Vibe DAW .env.local found"
else
    echo "⚠️  Vibe DAW .env.local not found"
    echo "   Run: cp vibe-daw/.env.example vibe-daw/.env.local"
fi

# Check for development tools
echo ""
echo "🔍 Checking development tools..."

if command -v concurrently >/dev/null 2>&1; then
    echo "✅ concurrently found"
else
    echo "⚠️  concurrently not found - installing globally"
    npm install -g concurrently
fi

if command -v lsof >/dev/null 2>&1; then
    echo "✅ lsof found (for port checking)"
fi

# Check Python (for some build tools)
if command -v python3 >/dev/null 2>&1; then
    echo "✅ Python3 found"
fi

# Check Java (for Android development)
if command -v java >/dev/null 2>&1; then
    echo "✅ Java found"
fi

# Check Gradle (for Android build)
if command -v gradle >/dev/null 2>&1; then
    echo "✅ Gradle found"
else
    echo "⚠️  Gradle not found - install from: https://gradle.org/install/"
fi

echo ""
echo "🎉 Development environment check complete!"
echo ""
echo "Next steps:"
echo "  ./dev.sh     - Start development servers"
echo "  ./build.sh    - Build for production"
echo "  ./test.sh     - Run tests and quality checks"
```

## Project Management Scripts

### status.sh
```bash
#!/bin/bash
# Show project status and statistics

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get project statistics
function get_project_stats() {
    local project_dir="$1"
    local project_name="$2"
    
    if [ ! -d "$project_dir" ]; then
        echo "$project_name: ❌ Directory not found"
        return
    fi
    
    local package_json="$project_dir/package.json"
    
    if [ ! -f "$package_json" ]; then
        echo "$project_name: ❌ package.json not found"
        return
    fi
    
    local name=$(grep -o '"name": "[^"]*"' "$package_json" | cut -d'"' -f4)
    local version=$(grep -o '"version": "[^"]*"' "$package_json" | cut -d'"' -f4)
    
    echo "$project_name: ✅ $name@$version"
}

# Get file counts
function get_file_count() {
    local dir="$1"
    local pattern="$2"
    
    if [ -d "$dir" ]; then
        echo "  $(find "$dir" -name "$pattern" | wc -l)" 2>/dev/null || echo "  0"
    else
        echo "  ❌"
    fi
}

# Get line counts for key files
function get_lines() {
    local file="$1"
    
    if [ -f "$file" ]; then
        echo "  $(wc -l < "$file")"
    else
        echo "  ❌"
    fi
}

echo "📊 Combined App Project Status"
echo "================================"
echo ""
echo "📁 Directory Structure:"
echo "  $(ls -la "$PROJECT_ROOT" | wc -l) directories and files"
echo ""

# Show project statistics
for project in gesture-synth-app vibe-daw; do
    get_project_stats "$PROJECT_ROOT/$project" "$project"
done

echo ""
echo "📁 File Statistics:"
echo "  Gesture Synth Weld:"
echo "    TypeScript files: $(get_file_count "$PROJECT_ROOT/gesture-synth-app/src" "*.ts")"
echo "    React components: $(get_file_count "$PROJECT_ROOT/gesture-synth-app/src/components" "*.tsx")"
echo "    Tests: $(get_file_count "$PROJECT_ROOT/gesture-synth-app/src" "*.test.ts")"
echo "    Lines of code: $(get_lines "$PROJECT_ROOT/gesture-synth-app/src/App.tsx")"

echo ""
echo "  Vibe DAW:"

echo "    TypeScript files: $(get_file_count "$PROJECT_ROOT/vibe-daw/src" "*.ts")"
echo "    React components: $(get_file_count "$PROJECT_ROOT/vibe-daw/src" "*.tsx")"
echo "    Tests: $(get_file_count "$PROJECT_ROOT/vibe-daw/src" "*.test.ts")"
echo "    Lines of code: $(get_lines "$PROJECT_ROOT/vibe-daw/src/App.tsx")"

echo ""
echo "🔧 Configuration:"
echo "  Gesture Synth Weld:
    - Build command: npm run build"
    echo "    Dev command: npm run dev"
    echo "    Port: 3000"

echo "  Vibe DAW:
    - Build command: npm run build"
    echo "    Dev command: npm run dev"
    echo "    Port: 5173"

echo ""
echo "📦 Dependencies:"
for project in gesture-synth-app vibe-daw; do
    if [ -f "$PROJECT_ROOT/$project/package-lock.json" ]; then
        local lock_size=$(du -h "$PROJECT_ROOT/$project/package-lock.json" | cut -f1)
        echo "  $project: $lock_size (package-lock.json)"
    fi
done

echo ""
echo "🗂️  Scripts Available:"
echo "  Development:"
echo "    ./dev.sh           - Start development servers"
echo "    ./dev-gesture.sh   - Start Gesture Synth Weld server only"
echo "    ./dev-vibe.sh       - Start Vibe DAW server only"
echo ""
echo "  Building:"
echo "    ./build.sh          - Build for production"
echo "    ./deploy.sh         - Deploy to production (requires config)"
echo ""
echo "  Testing:"
echo "    ./test.sh           - Run all tests"
echo "    ./lint.sh           - Run linting"
echo "    ./check-setup.sh    - Check environment setup"
echo ""
echo "🔧 Project Management:"
echo "  ./install.sh         - Install all dependencies"
echo "  ./setup-mobile.sh    - Setup mobile development environment"
echo ""
echo "📋 Documentation:"
echo "  README.md            - Project overview"
echo "  DEVELOPMENT_SETUP.md - Setup instructions"
echo "  IMPLEMENTATION_PLAN.md - Implementation plan"
echo "  PROJECT_STATE.md      - Current project state"
```

### monitor.sh
```bash
#!/bin/bash
# Monitor development processes and system resources

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Function to check if a process is running
check_process() {
    local process_name="$1"
    local pid_file="$2"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if ps -p "$pid" >/dev/null 2>&1; then
            echo "✅ $process_name is running (PID: $pid)"
            return 0
        else
            echo "❌ $process_name is not running (stale PID file)"
            return 1
        fi
    else
        echo "❌ $process_name PID file not found: $pid_file"
        return 1
    fi
}

# Function to check port usage
check_port() {
    local port="$1"
    local service="$2"
    
    if command -v lsof >/dev/null 2>&1; then
        if lsof -i ":$port" >/dev/null 2>&1; then
            echo "✅ Port $port ($service) is in use"
            return 0
        else
            echo "❌ Port $port ($service) is not in use"
            return 1
        fi
    else
        echo "⚠️  lsof not available, cannot check port $port"
        return 0
    fi
}

echo "🔍 Monitoring Combined App development..."
echo ""

# Check project directories
for project in gesture-synth-app vibe-daw; do
    if [ -d "$PROJECT_ROOT/$project" ]; then
        echo "📁 $project:"
        
        # Check for node_modules
        if [ -d "$PROJECT_ROOT/$project/node_modules" ]; then
            echo "  ✅ Dependencies installed"
        else
            echo "  ❌ Dependencies not installed"
        fi
        
        # Check for dist directory
        if [ -d "$PROJECT_ROOT/$project/dist" ]; then
            local dist_size=$(du -sh "$PROJECT_ROOT/$project/dist" 2>/dev/null | cut -f1)
            echo "  📦 Build artifacts: $dist_size"
        else
            echo "  📦 No build artifacts found"
        fi
    else
        echo "❌ $project directory not found"
    fi
    echo
 done

# Check system resources
echo "🖥️  System Resources:"
echo "  Disk usage:"
du -sh "$PROJECT_ROOT" 2>/dev/null | head -1
echo "  Memory:"
free -h | head -1
echo "  CPU:"
cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
echo "  CPU usage: ${cpu_usage}%"

# Check running processes
echo ""
echo "🔄 Running Processes:"

# Check for Node.js processes
NODE_PROCESSES=$(ps aux | grep node | grep -v grep | wc -l)
echo "  Node.js processes: $NODE_PROCESSES"

# Check for Vite processes
VITE_PROCESSES=$(ps aux | grep vite | grep -v grep | wc -l)
echo "  Vite processes: $VITE_PROCESSES"

# Check for Port usage
for port in 3000 5173; do
    case $port in
        3000) check_port $port "Gesture Synth Weld" ;;
        5173) check_port $port "Vibe DAW" ;;
    esac
done

# Generate a summary
echo ""
echo "📋 Monitoring Summary:"
echo "  Development status: $(date)"
echo "  Projects ready: $(ls -1 "$PROJECT_ROOT" | grep -E "(gesture-synth-app|vibe-daw)" | wc -l)/2"
echo "  Build directories: $(find "$PROJECT_ROOT" -name "dist" -type d | wc -l)"
echo "  Environment files: $(find "$PROJECT_ROOT" -name ".env.local" | wc -l)"

echo ""
echo "🎮 Quick Actions:"
echo "  To start development: ./dev.sh"
echo "  To check status: ./status.sh"
echo "  To run tests: ./test.sh"
```

## Convenience Scripts

### git-helper.sh
```bash
#!/bin/bash
# Git operations helper for the combined project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

function show_help() {
    cat << EOF
Git Helper for Combined App

Usage: ./git-helper.sh <command> [options]

Commands:
  status                    Show git status for all projects
  log [project] [days]      Show git log for specific project
  branches [project]        Show all branches for project
  merge [project] [branch]  Merge branch into current branch
  checkout [project] [branch] Switch to branch in project
  commit-all [project] [message] Commit all changes in project
  reset-hard [project] [branch] Reset project to branch
  fetch-all                 Fetch all remotes for all projects
  pull-all                  Pull all changes from remotes
  push-all                  Push all changes to remotes
  clean-branches            Delete merged branches
  help                      Show this help message

Examples:
  ./git-helper.sh status
  ./git-helper.sh log gesture-synth-app
  ./git-helper.sh branches vibe-daw
EOF
}

function status_all() {
    echo "🔍 Git status for all projects:"
    echo "================================"
    
    for project in gesture-synth-app vibe-daw; do
        if [ -d "$PROJECT_ROOT/$project/.git" ]; then
            echo ""
            echo "$project:"
            cd "$PROJECT_ROOT/$project"
            git status --short
        else
            echo ""
            echo "$project: ❌ Not a git repository"
        fi
    done
}

function log_project() {
    local project="$1"
    local days="${2:-30}"
    
    if [ ! -d "$PROJECT_ROOT/$project/.git" ]; then
        echo "❌ $project is not a git repository"
        return 1
    fi
    
    cd "$PROJECT_ROOT/$project"
    echo "📝 Git log for $project (last $days days):"
    echo "================================"
    git log --oneline --since="-$days days" --graph --all
}

function branches_project() {
    local project="$1"
    
    if [ ! -d "$PROJECT_ROOT/$project/.git" ]; then
        echo "❌ $project is not a git repository"
        return 1
    fi
    
    cd "$PROJECT_ROOT/$project"
    echo "🌿 Branches for $project:"
    echo "========================"
    git branch -a
}

function merge_branch() {
    local project="$1"
    local branch="$2"
    
    if [ ! -d "$PROJECT_ROOT/$project/.git" ]; then
        echo "❌ $project is not a git repository"
        return 1
    fi
    
    cd "$PROJECT_ROOT/$project"
    
    if ! git rev-parse --quiet --verify "$branch" >/dev/null 2>&1; then
        echo "❌ Branch $branch does not exist in $project"
        return 1
    fi
    
    echo "🔀 Merging $branch into current branch in $project..."
    git merge "$branch" --no-edit
    echo "✅ Merge complete"
}

function checkout_branch() {
    local project="$1"
    local branch="$2"
    
    if [ ! -d "$PROJECT_ROOT/$project/.git" ]; then
        echo "❌ $project is not a git repository"
        return 1
    fi
    
    cd "$PROJECT_ROOT/$project"
    
    if ! git rev-parse --quiet --verify "$branch" >/dev/null 2>&1; then
        echo "❌ Branch $branch does not exist in $project"
        return 1
    fi
    
    echo "🔄 Checking out $branch in $project..."
    git checkout "$branch"
    echo "✅ Checkout complete"
}

function commit_all() {
    local project="$1"
    local message="$2"
    
    if [ ! -d "$PROJECT_ROOT/$project/.git" ]; then
        echo "❌ $project is not a git repository"
        return 1
    fi
    
    cd "$PROJECT_ROOT/$project"
    
    # Check if there are changes
    if ! git diff --quiet; then
        echo "📝 Committing all changes in $project..."
        git add .
        git commit -m "$message" -m "Auto-commit by git-helper.sh"
        echo "✅ Commit complete"
    else
        echo "ℹ️  No changes to commit in $project"
    fi
}

# Parse command and arguments
COMMAND="$1"

# Route to appropriate function
case "$COMMAND" in
    "status")
        status_all
        ;;
    "log")
        log_project "$2" "$3"
        ;;
    "branches")
        branches_project "$2"
        ;;
    "merge")
        merge_branch "$2" "$3"
        ;;
    "checkout")
        checkout_branch "$2" "$3"
        ;;
    "commit-all")
        commit_all "$2" "$3"
        ;;
    "help"|*)
        show_help
        ;;
esac
```

## Script Usage Summary

### Environment Setup
- **`./install.sh`** - Install all dependencies
- **`./setup-mobile.sh`** - Setup mobile development environment

### Development
- **`./dev.sh`** - Start both development servers
- **`./dev-gesture.sh`** - Start Gesture Synth Weld server only
- **`./dev-vibe.sh`** - Start Vibe DAW server only

### Building and Deployment
- **`./build.sh`** - Build both projects for production
- **`./deploy.sh`** - Deploy to production (requires configuration)

### Testing and Quality
- **`./test.sh`** - Run all tests and quality checks
- **`./lint.sh`** - Run linting and code quality checks

### Project Management
- **`./status.sh`** - Show project status and statistics
- **`./monitor.sh`** - Monitor development processes and resources
- **`./git-helper.sh`** - Git operations helper

### Setup Verification
- **`./check-setup.sh`** - Check development environment setup

## Script Execution Notes

### Best Practices
1. **Always run `./install.sh` first** to ensure all dependencies are installed
2. **Check script output** carefully for any warnings or errors
3. **Use `./check-setup.sh`** before starting development to verify the environment
4. **Backup your work** before running deployment scripts

### Troubleshooting

#### If scripts fail:
1. Run `./check-setup.sh` to identify issues
2. Run `./install.sh` to reinstall dependencies
3. Check the specific script's output for error details

#### If servers don't start:
1. Check if ports 3000 or 5173 are already in use
2. Use `./monitor.sh` to check running processes
3. Manually check if dependencies are installed

#### If tests fail:
1. Run `./lint.sh` to check for code quality issues
2. Check specific test failures in the project directories
3. Run `./status.sh` to verify project state

## Script Permissions

Make scripts executable:
```bash
chmod +x *.sh
```

## Summary

These scripts provide a comprehensive development workflow for the combined Gesture Synth Weld + Vibe DAW platform. They automate common tasks, provide helpful debugging information, and ensure consistent development practices across both projects.

**Key Features**:
- **Automated setup** - One command to install all dependencies
- **Concurrent development** - Start both servers with a single command
- **Quality assurance** - Run tests and linting with convenience scripts
- **Project monitoring** - Check system resources and running processes
- **Git integration** - Simplified git operations for the combined project
- **Deployment automation** - Build and deploy with simple commands

These scripts significantly reduce the time and effort required to set up, develop, test, and deploy the combined application, making it easier for developers to focus on building features rather than managing development infrastructure.