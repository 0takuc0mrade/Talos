#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

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

    if printf '%s' "${output}" | grep -qi 'cu limit exceeded; Request too fast per second'; then
      if (( attempt < max_retries )); then
        attempt=$((attempt + 1))
        echo "warning: RPC rate limit hit for 'sncast ${args[*]}', retry ${attempt}/${max_retries} in ${retry_delay_seconds}s" >&2
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

declare_contract() {
  local contract_name="$1"
  local class_hash_env_key=""
  case "${contract_name}" in
    TalosIdentity)
      class_hash_env_key="TALOS_IDENTITY_CLASS_HASH"
      ;;
    TalosSettlement)
      class_hash_env_key="TALOS_SETTLEMENT_CLASS_HASH"
      ;;
    TalosReputation)
      class_hash_env_key="TALOS_REPUTATION_CLASS_HASH"
      ;;
    TalosCore)
      class_hash_env_key="TALOS_CORE_CLASS_HASH"
      ;;
  esac

  if [[ -n "${class_hash_env_key}" ]]; then
    local predeclared_class_hash="${!class_hash_env_key:-}"
    if [[ -n "${predeclared_class_hash}" ]]; then
      echo "==> Reusing ${contract_name} class hash from ${class_hash_env_key}" >&2
      printf '%s' "${predeclared_class_hash}"
      return 0
    fi
  fi

  echo "==> Declaring ${contract_name}" >&2
  local output
  output="$(run_sncast --allow-failure declare --contract-name "${contract_name}" || true)"

  local class_hash
  class_hash="$(extract_field "${output}" class_hash)"
  if [[ -z "${class_hash}" ]]; then
    class_hash="$(
      printf '%s' "${output}" \
        | grep -Eo 'class hash 0x[0-9a-fA-F]+' \
        | head -n1 \
        | awk '{ print $3 }' || true
    )"
    if [[ -n "${class_hash}" ]]; then
      echo "warning: ${contract_name} already declared, reusing class hash ${class_hash}" >&2
      printf '%s' "${class_hash}"
      return 0
    fi
  fi

  if [[ -z "${class_hash}" ]]; then
    echo "error: failed to parse class hash for ${contract_name}" >&2
    exit 1
  fi

  printf '%s' "${class_hash}"
}

deploy_contract() {
  local class_hash="$1"
  shift

  local -a args=(deploy --class-hash "${class_hash}")
  if (( "$#" > 0 )); then
    args+=(--constructor-calldata "$@")
  fi

  local output
  output="$(run_sncast "${args[@]}")"

  local contract_address
  contract_address="$(extract_field "${output}" contract_address deployed_contract_address)"
  if [[ -z "${contract_address}" ]]; then
    echo "error: failed to parse deployed contract address" >&2
    exit 1
  fi

  printf '%s' "${contract_address}"
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

write_output_env() {
  local output_file="$1"

  mkdir -p "$(dirname "${output_file}")"
  cat > "${output_file}" <<EOF
TALOS_NETWORK=${STARKNET_NETWORK:-}
STARKNET_RPC_URL=${STARKNET_RPC_URL:-}
STARKNET_CHAIN_ID=${STARKNET_CHAIN_ID:-}

TALOS_IDENTITY_ADDRESS=${IDENTITY_ADDRESS}
TALOS_SETTLEMENT_ADDRESS=${SETTLEMENT_ADDRESS}
TALOS_REPUTATION_ADDRESS=${REPUTATION_ADDRESS}
TALOS_CORE_ADDRESS=${CORE_ADDRESS}

TALOS_TOKEN_STRK_ADDRESS=${TALOS_TOKEN_STRK_ADDRESS:-}
TALOS_TOKEN_WBTC_ADDRESS=${TALOS_TOKEN_WBTC_ADDRESS:-}
TALOS_TOKEN_STRKBTC_ADDRESS=${TALOS_TOKEN_STRKBTC_ADDRESS:-}
TALOS_TOKEN_USDC_ADDRESS=${TALOS_TOKEN_USDC_ADDRESS:-}
EOF
}

ensure_talos_admin
ensure_network_selection
ensure_sncast_profile

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Building contracts with scarb" >&2
  scarb build >&2
fi

mapfile -t SNCAST_BASE < <(build_sncast_base)

IDENTITY_CLASS_HASH="$(declare_contract TalosIdentity)"
SETTLEMENT_CLASS_HASH="$(declare_contract TalosSettlement)"
REPUTATION_CLASS_HASH="$(declare_contract TalosReputation)"
CORE_CLASS_HASH="$(declare_contract TalosCore)"

echo "==> Deploying TalosIdentity" >&2
IDENTITY_ADDRESS="$(deploy_contract "${IDENTITY_CLASS_HASH}")"

echo "==> Deploying TalosSettlement (admin=${TALOS_ADMIN})" >&2
SETTLEMENT_ADDRESS="$(deploy_contract "${SETTLEMENT_CLASS_HASH}" "${TALOS_ADMIN}")"

echo "==> Deploying TalosReputation with temporary core=0x0 (admin=${TALOS_ADMIN})" >&2
REPUTATION_ADDRESS="$(deploy_contract "${REPUTATION_CLASS_HASH}" "0x0" "${TALOS_ADMIN}")"

echo "==> Deploying TalosCore" >&2
CORE_ADDRESS="$(
  deploy_contract \
    "${CORE_CLASS_HASH}" \
    "${IDENTITY_ADDRESS}" \
    "${SETTLEMENT_ADDRESS}" \
    "${REPUTATION_ADDRESS}"
)"

echo "==> Wiring core into settlement" >&2
invoke_contract "${SETTLEMENT_ADDRESS}" set_core_protocol "${CORE_ADDRESS}" >/dev/null

echo "==> Wiring core into reputation" >&2
invoke_contract "${REPUTATION_ADDRESS}" set_core_protocol "${CORE_ADDRESS}" >/dev/null

for token_var in TALOS_TOKEN_STRK_ADDRESS TALOS_TOKEN_WBTC_ADDRESS TALOS_TOKEN_STRKBTC_ADDRESS TALOS_TOKEN_USDC_ADDRESS; do
  token_address="${!token_var:-}"
  if [[ -n "${token_address}" ]]; then
    echo "==> Whitelisting token ${token_var}=${token_address}" >&2
    invoke_contract "${SETTLEMENT_ADDRESS}" add_supported_token "${token_address}" >/dev/null
  fi
done

OUTPUT_ENV_FILE="${OUTPUT_ENV_FILE:-offchain/.env.deployed}"
write_output_env "${OUTPUT_ENV_FILE}"

cat <<EOF

Talos deployment completed.

Identity:   ${IDENTITY_ADDRESS}
Settlement: ${SETTLEMENT_ADDRESS}
Reputation: ${REPUTATION_ADDRESS}
Core:       ${CORE_ADDRESS}

Generated env file: ${OUTPUT_ENV_FILE}
EOF
