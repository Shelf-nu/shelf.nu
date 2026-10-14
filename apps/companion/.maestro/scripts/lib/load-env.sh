# shellcheck shell=bash
#############################################################################
# Maestro env loading, shared by run-all.sh and run-suite.sh.
#
# Source this file, then call:
#   load_maestro_env "$MAESTRO_DIR"   # fills MAESTRO_ENV_FLAGS, exports keys
#   missing_flow_vars "$flow"         # prints SHELF_TEST_* vars a flow needs
#                                     # that no env file set
#
# Values come from env/test.env, then from each env/e2e*.env file that
# seed-e2e.sh writes for its fixtures. A fixture file only adds keys: a key
# already set by test.env or an earlier file is kept and the duplicate is
# reported, so a fixture can never silently change a test.env value.
#
# A fixture file stays on disk until its `*-down` step runs. If the database
# was reset in between, the file still names rows that no longer exist; the
# fixture flows say so in their first wait step. Re-run the `*-up` step.
#############################################################################

# Maestro doesn't reliably read shell env vars; flows get them through -e.
MAESTRO_ENV_FLAGS=()
# Keys loaded so far, one per line, for duplicate and missing-var checks.
MAESTRO_ENV_KEYS=""

# Loads test.env and the fixture env files into MAESTRO_ENV_FLAGS.
#
# $1: the .maestro directory. Exits 1 when env/test.env is missing.
load_maestro_env() {
  local maestro_dir="$1"
  local test_env="$maestro_dir/env/test.env"
  if [ ! -f "$test_env" ]; then
    echo -e "\033[0;31m✗ Missing env file: $test_env\033[0m"
    echo "  Copy env/test.env.example to env/test.env and fill in values."
    exit 1
  fi

  local env_file key value
  for env_file in "$test_env" "$maestro_dir"/env/e2e*.env; do
    [ -f "$env_file" ] || continue
    while IFS='=' read -r key value || [ -n "$key" ]; do
      key="${key%$'\r'}"
      value="${value%$'\r'}"
      # Skip comments and empty lines
      [[ -z "$key" || "$key" == \#* ]] && continue
      # Strip quotes from value
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      if printf '%s\n' "$MAESTRO_ENV_KEYS" | grep -qxF "$key"; then
        echo -e "\033[1;33m⚠ $(basename "$env_file") sets $key again; keeping the first value\033[0m"
        continue
      fi
      MAESTRO_ENV_KEYS+="$key"$'\n'
      MAESTRO_ENV_FLAGS+=(-e "$key=$value")
      export "$key=$value"
    done < "$env_file"
  done
}

# Prints, space-separated, the SHELF_TEST_* vars a flow references that no
# loaded env file set. Empty output means the flow has what it needs. Only
# SHELF_TEST_* names count: other ${VARS} are defined inside the flows.
#
# $1: path to the flow file.
missing_flow_vars() {
  local flow="$1" var missing=()
  for var in $(grep -oE '\$\{SHELF_TEST_[A-Z0-9_]+' "$flow" | cut -c3- | sort -u); do
    printf '%s\n' "$MAESTRO_ENV_KEYS" | grep -qxF "$var" || missing+=("$var")
  done
  echo "${missing[*]:-}"
}
