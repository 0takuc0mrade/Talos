export const IDENTITY_ABI = [
  {
    type: "function",
    name: "register_agent",
    inputs: [
      { name: "pub_key", type: "core::felt252" },
      { name: "metadata_uri", type: "core::byte_array::ByteArray" }
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "external"
  },
  {
    type: "function",
    name: "get_agent_count",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view"
  }
];

export const SETTLEMENT_ABI = [
  {
    type: "function",
    name: "is_supported_token",
    inputs: [{ name: "token_address", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view"
  }
];

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" }
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external"
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view"
  }
];
