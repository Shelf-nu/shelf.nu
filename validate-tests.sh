#!/bin/bash

echo "=== Validating Test Files ==="
echo ""

files=(
  "app/hooks/search-params/index.test.ts"
  "app/modules/asset-filter-presets/service.server.test.ts"
  "app/modules/asset/query.server.test.ts"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    lines=$(wc -l < "$file")
    echo "✅ $file ($lines lines)"
  else
    echo "❌ $file (NOT FOUND)"
  fi
done

echo ""
echo "=== Test File Statistics ==="
echo ""

total_tests=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    test_count=$(grep -c "it(\|test(" "$file" || echo "0")
    describe_count=$(grep -c "describe(" "$file" || echo "0")
    echo "📊 $file:"
    echo "   - Test cases: $test_count"
    echo "   - Describe blocks: $describe_count"
    total_tests=$((total_tests + test_count))
  fi
done

echo ""
echo "🎯 Total test cases created: $total_tests"
echo ""
echo "To run tests:"
echo "  npm test -- app/hooks/search-params/index.test.ts --run"
echo "  npm test -- app/modules/asset-filter-presets/service.server.test.ts --run"
echo "  npm test -- app/modules/asset/query.server.test.ts --run"