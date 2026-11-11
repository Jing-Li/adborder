#!/bin/bash
# Grade: Run deterministic verifiers on all job outputs
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Grading all outputs ==="

TOTAL=0
PASSED=0
FAILED=0
MISSING=0

for job_dir in jobs/*/; do
  [ -d "$job_dir" ] || continue
  # Extract case id from job dir name: {case}-{pack}-{model}-{trial}
  case_id=$(echo "$job_dir" | sed 's|jobs/||' | grep -oP 'case-\d+')
  verifier="cases/$case_id/verifier/test.sh"
  outputs="$job_dir/outputs"

  if [ ! -d "$outputs" ]; then
    echo "  ⏭ $job_dir — no outputs, skipping"
    ((MISSING++))
    continue
  fi

  if [ ! -f "$verifier" ]; then
    echo "  ⚠ $case_id — no verifier, skipping"
    ((MISSING++))
    continue
  fi

  echo -n "  $job_dir ... "
  TOTAL=$((TOTAL + 1))

  # Run verifier, capture reward
  mkdir -p "$job_dir/logs/verifier"
  if bash "$verifier" "$outputs" > "$job_dir/logs/verifier/output.txt" 2>&1; then
    echo "1" > "$job_dir/reward.txt"
    echo "PASS (reward=1)"
    ((PASSED++))
  else
    echo "0" > "$job_dir/reward.txt"
    echo "FAIL (reward=0)"
    ((FAILED++))
  fi
done

echo ""
echo "=== Results ==="
echo "  Total: $TOTAL | Pass: $PASSED | Fail: $FAILED | Skip: $MISSING"
if [ $TOTAL -gt 0 ]; then
  RATE=$(echo "scale=1; $PASSED * 100 / $TOTAL" | bc)
  echo "  Pass Rate: ${RATE}%"
fi
