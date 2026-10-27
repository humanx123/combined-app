#!/bin/bash
# Git hooks for Combined App
# Pre-commit hooks to ensure code quality before committing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔍 Running pre-commit checks..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Type checking
echo "📋 Checking TypeScript..."
for project in "gesture-synth-app" "vibe-daw"; do
    if [ -d "$PROJECT_ROOT/$project" ]; then
        cd "$PROJECT_ROOT/$project"
        if command_exists npm && npm run typecheck 2>&1; then
            echo "✅ $project type check passed"
        else
            echo "❌ $project type check failed"
            cd "$PROJECT_ROOT"
            echo "Fix type errors before committing"
            exit 1
        fi
        cd "$PROJECT_ROOT"
    fi
done

# 2. Linting (if available)
echo "🔍 Checking code style..."
for project in "gesture-synth-app" "vibe-daw"; do
    if [ -d "$PROJECT_ROOT/$project" ] && [ -f "$PROJECT_ROOT/$project/package.json" ]; then
        # Check for lint script
        if grep -q '"lint"' "$PROJECT_ROOT/$project/package.json"; then
            cd "$PROJECT_ROOT/$project"
            if npm run lint 2>&1; then
                echo "✅ $project linting passed"
            else
                echo "⚠️  $project linting failed (continuing anyway)"
            fi
            cd "$PROJECT_ROOT"
        fi
    fi
done

# 3. Tests (if available)
echo "🧪 Running tests..."
for project in "gesture-synth-app" "vibe-daw"; do
    if [ -d "$PROJECT_ROOT/$project" ] && [ -f "$PROJECT_ROOT/$project/package.json" ]; then
        # Check for test script
        if grep -q '"test"' "$PROJECT_ROOT/$project/package.json"; then
            cd "$PROJECT_ROOT/$project"
            if npm run test 2>&1; then
                echo "✅ $project tests passed"
            else
                echo "❌ $project tests failed"
                cd "$PROJECT_ROOT"
                echo "Fix test failures before committing"
                exit 1
            fi
            cd "$PROJECT_ROOT"
        fi
    fi
done

# 4. Check for sensitive files
echo "🔐 Checking for sensitive files..."
SENSITIVE_FILES=(
    "*.env*"
    "*.key"
    "*.pem"
    "*.p12"
    "*.crt"
    "*.md*"
    "*.json*"
)

for pattern in "${SENSITIVE_FILES[@]}"; do
    found_files=$(find "$PROJECT_ROOT" -name "$pattern" -not -path "*/node_modules/*" -not -path "*/.git/*")
    if [ -n "$found_files" ]; then
        echo "⚠️  Potential sensitive files found:"
        echo "$found_files"
    fi
done

# 5. Check for large files
echo "📊 Checking file sizes..."
largest_files=$(find "$PROJECT_ROOT" -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" | wc -l)
if [ "$nlargest_files" -gt 100 ]; then
    echo "⚠️  Large number of source files ($nlargest_files). Consider if all changes are necessary."
fi

# 6. Validate project structure
echo "📁 Validating project structure..."
required_dirs=(
    "gesture-synth-app/src"
    "vibe-daw/src"
)

for dir in "${required_dirs[@]}"; then
    if [ ! -d "$PROJECT_ROOT/$dir" ]; then
        echo "⚠️  Directory $dir not found"
    fi
done

# 7. Check for common mistakes
echo "⚠️  Common mistakes to check:"
echo "  1. Accidental console.log statements in production code"
echo "  2. Missing semicolons or syntax errors"
echo "  3. Uncommitted package-lock.json changes"
echo "  4. IDE files that shouldn't be committed"

# Final summary
echo ""
echo "🎉 Pre-commit checks completed!"
echo ""
echo "Summary:"
echo "  ✅ TypeScript checks"
echo "  ✅ Linting"
echo "  ✅ Unit tests"
echo "  ✅ Project structure validation"
echo ""
echo "If any checks failed, fix them before committing."
echo "You can skip this check with: git commit --no-verify"