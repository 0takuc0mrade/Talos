#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DEPLOYED_ENV_FILE="${DEPLOYED_ENV_FILE:-offchain/.env.deployed}"
OFFCHAIN_ENV_FILE="${OFFCHAIN_ENV_FILE:-offchain/.env}"

ensure_deployed_env_file() {
  if [[ -f "${DEPLOYED_ENV_FILE}" ]]; then
    return 0
  fi
  echo "error: deployment env file not found: ${DEPLOYED_ENV_FILE}" >&2
  echo "hint: run scripts/deploy_talos.sh first or set DEPLOYED_ENV_FILE" >&2
  exit 1
}

load_deployed_env() {
  set -a
  # shellcheck disable=SC1090
  source "${DEPLOYED_ENV_FILE}"
  set +a
}

ensure_talos_admin() {
  if [[ -n "${TALOS_ADMIN:-}" ]]; then
    return 0
  fi

  if [[ -t 0 ]]; then
    read -r -p "Enter TALOS_ADMIN address: " TALOS_ADMIN
    if [[ -z "${TALOS_ADMIN}" ]]; then
      echo "error: TALOS_ADMIN cannot be empty" >&2
      exit 1
    fi
    export TALOS_ADMIN
    return 0
  fi

  echo "error: missing TALOS_ADMIN. Set it in env for non-interactive runs." >&2
  exit 1
}

ensure_network_selection() {
  if [[ -n "${STARKNET_RPC_URL:-}" || -n "${STARKNET_NETWORK:-}" ]]; then
    if [[ -n "${STARKNET_NETWORK:-}" ]]; then
      STARKNET_NETWORK="${STARKNET_NETWORK,,}"
      export STARKNET_NETWORK
    fi
    return 0
  fi

  if [[ -t 0 ]]; then
    echo "No network configuration found." >&2
    read -r -p "Enter STARKNET_RPC_URL (leave blank to use network name): " STARKNET_RPC_URL
    if [[ -n "${STARKNET_RPC_URL}" ]]; then
      export STARKNET_RPC_URL
      return 0
    fi

    read -r -p "Enter STARKNET_NETWORK (e.g. sepolia): " STARKNET_NETWORK
    if [[ -n "${STARKNET_NETWORK}" ]]; then
      STARKNET_NETWORK="${STARKNET_NETWORK,,}"
      export STARKNET_NETWORK
      return 0
    fi
  fi

  echo "error: missing network config. Set STARKNET_RPC_URL or STARKNET_NETWORK." >&2
  exit 1
}

ensure_sncast_profile() {
  if [[ -n "${SNCAST_PROFILE:-}" ]]; then
    return 0
  fi

  if [[ -t 0 ]]; then
    local profile_input
    read -r -p "Enter SNCAST_PROFILE [default]: " profile_input
    SNCAST_PROFILE="${profile_input:-default}"
    export SNCAST_PROFILE
    return 0
  fi
}

ensure_required_env() {
  local key="$1"
  local value="${!key:-}"
  if [[ -n "${value}" ]]; then
    return 0
  fi
  echo "error: missing required env var ${key}" >&2
  exit 1
}

prompt_if_empty() {
  local key="$1"
  local prompt="$2"
  local value="${!key:-}"
  if [[ -n "${value}" ]]; then
    return 0
  fi

  if [[ -t 0 ]]; then
    local input
    read -r -p "${prompt}: " input
    if [[ -n "${input}" ]]; then
      printf -v "${key}" '%s' "${input}"
      export "${key}"
    fi
  fi
}

default_chain_id_for_network() {
  local network="$1"
  case "${network}" in
    sepolia)
      printf '0x534e5f5345504f4c4941'
      ;;
    mainnet)
      printf '0x534e5f4d41494e'
      ;;
    *)
      echo "error: unsupported network '${network}' for default chain id" >&2
      exit 1
      ;;
  esac
}

apply_starkzap_token_defaults() {
  case "${TALOS_NETWORK}" in
    sepolia)
      : "${TALOS_TOKEN_STRK_ADDRESS:=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d}"
      : "${TALOS_TOKEN_USDC_ADDRESS:=0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343}"
      ;;
    mainnet)
      : "${TALOS_TOKEN_STRK_ADDRESS:=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d}"
      : "${TALOS_TOKEN_WBTC_ADDRESS:=0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac}"
      : "${TALOS_TOKEN_USDC_ADDRESS:=0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb}"
      ;;
  esac

  export TALOS_TOKEN_STRK_ADDRESS TALOS_TOKEN_WBTC_ADDRESS TALOS_TOKEN_USDC_ADDRESS
}

extract_field() {
  local payload="$1"
  shift

  local field
  for field in "$@"; do
    local value
    value="$(
      printf '%s' "${payload}" \
        | grep -Eo "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" \
        | head -n1 \
        | cut -d'"' -f4 || true
    )"
    if [[ -n "${value}" ]]; then
      printf '%s' "${value}"
      return 0
    fi
  done

  return 1
}

extract_first_response_scalar() {
  local payload="$1"
  local response_block
  response_block="$(
    printf '%s' "${payload}" \
      | grep -Eo '"response"[[:space:]]*:[[:space:]]*\[[^]]*\]' \
      | head -n1 || true
  )"

  if [[ -n "${response_block}" ]]; then
    local response_value
    response_value="$(
      printf '%s' "${response_block}" \
        | grep -Eo '0x[0-9a-fA-F]+|[0-9]+' \
        | head -n1 || true
    )"
    if [[ -n "${response_value}" ]]; then
      printf '%s' "${response_value}"
      return 0
    fi
  fi

  local fallback
  fallback="$(printf '%s' "${payload}" | grep -Eo '0x[0-9a-fA-F]+|[0-9]+' | head -n1 || true)"
  if [[ -n "${fallback}" ]]; then
    printf '%s' "${fallback}"
    return 0
  fi

  return 1
}

normalize_hex() {
  local value="${1,,}"
  value="${value#0x}"
  value="$(printf '%s' "${value}" | sed -E 's/^0+//')"
  if [[ -z "${value}" ]]; then
    value="0"
  fi
  printf '0x%s' "${value}"
}

is_truthy_hex_scalar() {
  local scalar="$1"
  local normalized
  normalized="$(normalize_hex "${scalar}")"
  [[ "${normalized}" != "0x0" ]]
}

build_sncast_base() {
  local -a cmd=(sncast --json)

  if [[ "${SNCAST_WAIT:-1}" != "0" ]]; then
    cmd+=(--wait)
  fi

  if [[ -n "${SNCAST_PROFILE:-}" ]]; then
    cmd+=(-p "${SNCAST_PROFILE}")
  fi

  printf '%s\n' "${cmd[@]}"
}

run_sncast() {
  local allow_failure=0
  if [[ "${1:-}" == "--allow-failure" ]]; then
    allow_failure=1
    shift
  fi

  local -a base=("${SNCAST_BASE[@]}")
  local command="$1"
  shift
  local -a args=("${command}")
  if [[ -n "${STARKNET_RPC_URL:-}" ]]; then
    args+=(--url "${STARKNET_RPC_URL}")
  elif [[ -n "${STARKNET_NETWORK:-}" ]]; then
    args+=(--network "${STARKNET_NETWORK}")
  fi
  if (( "$#" > 0 )); then
    args+=("$@")
  fi

  local max_retries="${SNCAST_MAX_RETRIES:-5}"
  local retry_delay_seconds="${SNCAST_RETRY_DELAY_SECONDS:-8}"
  local attempt=0
  local output

  while true; do
    if output="$("${base[@]}" "${args[@]}" 2>&1)"; then
      echo "${output}" >&2
      printf '%s' "${output}"
      return 0
    fi

    if printf '%s' "${output}" | grep -qiE 'cu limit exceeded; Request too fast per second|error sending request for url|Error while calling RPC method spec_version|timed out|timeout|Connection refused|connection reset|503|429'; then
      if (( attempt < max_retries )); then
        attempt=$((attempt + 1))
        echo "warning: transient RPC error for 'sncast ${args[*]}', retry ${attempt}/${max_retries} in ${retry_delay_seconds}s" >&2
        sleep "${retry_delay_seconds}"
        continue
      fi
    fi

    echo "error: sncast ${args[*]} failed" >&2
    echo "${output}" >&2
    if (( allow_failure )); then
      printf '%s' "${output}"
      return 1
    fi
    exit 1
  done
}

call_contract_scalar() {
  local contract_address="$1"
  local function_name="$2"
  shift 2

  local -a args=(call --contract-address "${contract_address}" --function "${function_name}")
  if (( "$#" > 0 )); then
    args+=(--calldata "$@")
  fi

  local output
  output="$(run_sncast "${args[@]}")"
  local value
  value="$(extract_first_response_scalar "${output}")"
  if [[ -z "${value}" ]]; then
    echo "error: failed to parse response value for ${function_name}" >&2
    exit 1
  fi
  printf '%s' "${value}"
}

invoke_contract() {
  local contract_address="$1"
  local function_name="$2"
  shift 2

  local -a args=(invoke --contract-address "${contract_address}" --function "${function_name}")
  if (( "$#" > 0 )); then
    args+=(--calldata "$@")
  fi

  local output
  output="$(run_sncast "${args[@]}")"
  local tx_hash
  tx_hash="$(extract_field "${output}" transaction_hash)"
  if [[ -z "${tx_hash}" ]]; then
    echo "error: failed to parse invoke transaction hash for ${function_name}" >&2
    exit 1
  fi
  printf '%s' "${tx_hash}"
}

ensure_admin_match() {
  local module_name="$1"
  local module_address="$2"
  local onchain_admin
  onchain_admin="$(call_contract_scalar "${module_address}" get_admin)"
  if [[ "$(normalize_hex "${onchain_admin}")" != "$(normalize_hex "${TALOS_ADMIN}")" ]]; then
    echo "error: ${module_name} admin mismatch" >&2
    echo "expected TALOS_ADMIN=$(normalize_hex "${TALOS_ADMIN}")" >&2
    echo "on-chain admin=$(normalize_hex "${onchain_admin}")" >&2
    exit 1
  fi
  echo "==> ${module_name} admin verified: ${onchain_admin}" >&2
}

ensure_core_wired() {
  local module_name="$1"
  local module_address="$2"
  local current_core
  current_core="$(call_contract_scalar "${module_address}" get_core_protocol)"

  if [[ "$(normalize_hex "${current_core}")" == "$(normalize_hex "${TALOS_CORE_ADDRESS}")" ]]; then
    echo "==> ${module_name} core already wired" >&2
    return 0
  fi

  echo "==> Wiring core into ${module_name}" >&2
  invoke_contract "${module_address}" set_core_protocol "${TALOS_CORE_ADDRESS}" >/dev/null

  local updated_core
  updated_core="$(call_contract_scalar "${module_address}" get_core_protocol)"
  if [[ "$(normalize_hex "${updated_core}")" != "$(normalize_hex "${TALOS_CORE_ADDRESS}")" ]]; then
    echo "error: failed to wire ${module_name} core_protocol" >&2
    exit 1
  fi
}

ensure_token_contract_deployed() {
  local label="$1"
  local token_address="$2"

  if [[ -z "${token_address}" ]]; then
    return 0
  fi

  local output
  if ! output="$(
    run_sncast --allow-failure call \
      --contract-address "${token_address}" \
      --function decimals
  )"; then
    if printf '%s' "${output}" | grep -qiE 'error sending request for url|Error while calling RPC method spec_version|timed out|timeout|Connection refused|connection reset|503|429'; then
      echo "error: RPC connectivity issue while validating ${label} token (${token_address})." >&2
      echo "hint: retry with SNCAST_MAX_RETRIES/SNCAST_RETRY_DELAY_SECONDS, or switch to a more stable RPC endpoint." >&2
      echo "${output}" >&2
      exit 1
    fi
    echo "error: ${label} token address is not deployed (or not ERC20) on selected network/RPC: ${token_address}" >&2
    echo "hint: use Starkzap preset addresses for this network or leave optional tokens blank." >&2
    echo "${output}" >&2
    exit 1
  fi
}

ensure_any_token_address() {
  if [[ -n "${TALOS_TOKEN_STRK_ADDRESS:-}" || -n "${TALOS_TOKEN_WBTC_ADDRESS:-}" || -n "${TALOS_TOKEN_STRKBTC_ADDRESS:-}" || -n "${TALOS_TOKEN_USDC_ADDRESS:-}" ]]; then
    return 0
  fi
  echo "error: no token addresses configured. Provide at least one of STRK/WBTC/strkBTC/USDC." >&2
  exit 1
}

ensure_token_whitelisted() {
  local label="$1"
  local token_address="$2"

  if [[ -z "${token_address}" ]]; then
    echo "==> Skipping ${label} whitelist: no address provided" >&2
    return 0
  fi

  ensure_token_contract_deployed "${label}" "${token_address}"

  local supported
  supported="$(call_contract_scalar "${TALOS_SETTLEMENT_ADDRESS}" is_supported_token "${token_address}")"
  if is_truthy_hex_scalar "${supported}"; then
    echo "==> Token ${label} already whitelisted (${token_address})" >&2
    return 0
  fi

  echo "==> Whitelisting token ${label} (${token_address})" >&2
  invoke_contract "${TALOS_SETTLEMENT_ADDRESS}" add_supported_token "${token_address}" >/dev/null

  local supported_after
  supported_after="$(call_contract_scalar "${TALOS_SETTLEMENT_ADDRESS}" is_supported_token "${token_address}")"
  if ! is_truthy_hex_scalar "${supported_after}"; then
    echo "error: token ${label} was not whitelisted after invoke" >&2
    exit 1
  fi
}

write_offchain_env() {
  local output_file="$1"
  mkdir -p "$(dirname "${output_file}")"

  cat > "${output_file}" <<EOF
STARKNET_RPC_URL=${STARKNET_RPC_URL}
STARKNET_CHAIN_ID=${STARKNET_CHAIN_ID}
TALOS_AGENT_ACCOUNT_ADDRESS=${TALOS_AGENT_ACCOUNT_ADDRESS:-}
TALOS_NETWORK=${TALOS_NETWORK}
TALOS_FEE_MODE=${TALOS_FEE_MODE:-user_pays}
TALOS_AUTO_ENSURE_READY=${TALOS_AUTO_ENSURE_READY:-false}

TALOS_IDENTITY_ADDRESS=${TALOS_IDENTITY_ADDRESS}
TALOS_SETTLEMENT_ADDRESS=${TALOS_SETTLEMENT_ADDRESS}
TALOS_REPUTATION_ADDRESS=${TALOS_REPUTATION_ADDRESS}
TALOS_CORE_ADDRESS=${TALOS_CORE_ADDRESS}
TALOS_TOKEN_STRK_ADDRESS=${TALOS_TOKEN_STRK_ADDRESS}
TALOS_TOKEN_WBTC_ADDRESS=${TALOS_TOKEN_WBTC_ADDRESS}
TALOS_TOKEN_STRKBTC_ADDRESS=${TALOS_TOKEN_STRKBTC_ADDRESS}
TALOS_TOKEN_USDC_ADDRESS=${TALOS_TOKEN_USDC_ADDRESS}

TALOS_MAX_AMOUNT_STRK=${TALOS_MAX_AMOUNT_STRK:-}
TALOS_MAX_AMOUNT_WBTC=${TALOS_MAX_AMOUNT_WBTC:-}
TALOS_MAX_AMOUNT_STRKBTC=${TALOS_MAX_AMOUNT_STRKBTC:-}
TALOS_MAX_AMOUNT_USDC=${TALOS_MAX_AMOUNT_USDC:-}
TALOS_MIN_DEADLINE_LEAD_SECONDS=${TALOS_MIN_DEADLINE_LEAD_SECONDS:-30}
TALOS_MAX_DEADLINE_HORIZON_SECONDS=${TALOS_MAX_DEADLINE_HORIZON_SECONDS:-900}
EOF
}

maybe_run_offchain_validation() {
  local run_validation="${RUN_OFFCHAIN_VALIDATION:-}"
  if [[ -z "${run_validation}" && -t 0 ]]; then
    local input
    read -r -p "Run offchain validation now? [Y/n]: " input
    input="${input,,}"
    if [[ -z "${input}" || "${input}" == "y" || "${input}" == "yes" ]]; then
      run_validation="1"
    else
      run_validation="0"
    fi
  fi

  if [[ "${run_validation}" == "1" ]]; then
    echo "==> Running offchain type-check" >&2
    npm --prefix offchain run check
    echo "==> Running offchain tests" >&2
    npm --prefix offchain test
  fi
}

ensure_deployed_env_file
load_deployed_env
ensure_talos_admin
ensure_network_selection
ensure_sncast_profile

TALOS_NETWORK="${TALOS_NETWORK:-${STARKNET_NETWORK:-sepolia}}"
TALOS_NETWORK="${TALOS_NETWORK,,}"
export TALOS_NETWORK

if [[ -z "${STARKNET_CHAIN_ID:-}" ]]; then
  STARKNET_CHAIN_ID="$(default_chain_id_for_network "${TALOS_NETWORK}")"
  export STARKNET_CHAIN_ID
fi

if [[ -z "${STARKNET_RPC_URL:-}" ]]; then
  prompt_if_empty STARKNET_RPC_URL "Enter STARKNET_RPC_URL for offchain runtime"
fi

apply_starkzap_token_defaults

prompt_if_empty TALOS_TOKEN_STRK_ADDRESS "Enter STRK token address"
prompt_if_empty TALOS_TOKEN_USDC_ADDRESS "Enter USDC token address (optional if STRK/WBTC/strkBTC provided)"

ensure_required_env TALOS_IDENTITY_ADDRESS
ensure_required_env TALOS_SETTLEMENT_ADDRESS
ensure_required_env TALOS_REPUTATION_ADDRESS
ensure_required_env TALOS_CORE_ADDRESS
ensure_required_env STARKNET_CHAIN_ID
ensure_required_env STARKNET_RPC_URL
ensure_any_token_address

mapfile -t SNCAST_BASE < <(build_sncast_base)

echo "==> Verifying module admin ownership" >&2
ensure_admin_match "Settlement" "${TALOS_SETTLEMENT_ADDRESS}"
ensure_admin_match "Reputation" "${TALOS_REPUTATION_ADDRESS}"

ensure_core_wired "Settlement" "${TALOS_SETTLEMENT_ADDRESS}"
ensure_core_wired "Reputation" "${TALOS_REPUTATION_ADDRESS}"

ensure_token_whitelisted "STRK" "${TALOS_TOKEN_STRK_ADDRESS}"
ensure_token_whitelisted "WBTC" "${TALOS_TOKEN_WBTC_ADDRESS}"
ensure_token_whitelisted "STRKBTC" "${TALOS_TOKEN_STRKBTC_ADDRESS}"
ensure_token_whitelisted "USDC" "${TALOS_TOKEN_USDC_ADDRESS}"

write_offchain_env "${OFFCHAIN_ENV_FILE}"
maybe_run_offchain_validation

cat <<EOF

Talos post-deploy finalization completed.

Verified and/or applied:
- Admin ownership checks
- Core wiring checks
- Token whitelist checks
- Offchain env generation

Output env file: ${OFFCHAIN_ENV_FILE}
EOF
