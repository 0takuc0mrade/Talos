use starknet::ContractAddress;
use core::hash::HashStateTrait;
use core::poseidon::PoseidonTrait;
use core::traits::Into;

pub fn compute_settlement_hash_for_spec(
    verifying_contract: ContractAddress,
    chain_id: felt252,
    payer_address: ContractAddress,
    payee_address: ContractAddress,
    token_address: ContractAddress,
    amount: u256,
    task_id: felt252,
    deadline: u64,
) -> felt252 {
    PoseidonTrait::new()
        .update('TALOS_SETTLEMENT')
        .update('v1')
        .update(verifying_contract.into())
        .update(chain_id)
        .update(payer_address.into())
        .update(payee_address.into())
        .update(token_address.into())
        .update(amount.low.into())
        .update(amount.high.into())
        .update(task_id)
        .update(deadline.into())
        .finalize()
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait ISRC6<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
}

#[starknet::interface]
pub trait ITalosSettlement<TContractState> {
    fn set_core_protocol(ref self: TContractState, core_protocol: ContractAddress);
    fn transfer_admin(ref self: TContractState, new_admin: ContractAddress);
    fn add_supported_token(ref self: TContractState, token: ContractAddress);
    fn remove_supported_token(ref self: TContractState, token: ContractAddress);
    fn settle_payment(
        ref self: TContractState,
        payer_address: ContractAddress,
        payee_address: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
        task_id: felt252,
        deadline: u64,
        signature: Array<felt252>,
    );
    fn get_admin(self: @TContractState) -> ContractAddress;
    fn get_core_protocol(self: @TContractState) -> ContractAddress;
    fn is_supported_token(self: @TContractState, token: ContractAddress) -> bool;
    fn is_task_settled(self: @TContractState, task_id: felt252) -> bool;
}

#[starknet::contract]
pub mod TalosSettlement {
    use super::{
        IERC20Dispatcher, IERC20DispatcherTrait, ISRC6Dispatcher, ISRC6DispatcherTrait,
        ITalosSettlement, compute_settlement_hash_for_spec,
    };
    use core::traits::Into;
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address, get_tx_info,
    };
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        core_protocol: ContractAddress,
        supported_tokens: Map<ContractAddress, bool>,
        settled_tasks: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CoreProtocolSet: CoreProtocolSet,
        AdminTransferred: AdminTransferred,
        SupportedTokenAdded: SupportedTokenAdded,
        SupportedTokenRemoved: SupportedTokenRemoved,
        PaymentSettled: PaymentSettled,
    }

    #[derive(Drop, starknet::Event)]
    struct CoreProtocolSet {
        core_protocol: ContractAddress,
        admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct AdminTransferred {
        old_admin: ContractAddress,
        new_admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct SupportedTokenAdded {
        #[key]
        token: ContractAddress,
        admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct SupportedTokenRemoved {
        #[key]
        token: ContractAddress,
        admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentSettled {
        #[key]
        task_id: felt252,
        token: ContractAddress,
        payer: ContractAddress,
        payee: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
    }

    #[abi(embed_v0)]
    impl TalosSettlementImpl of ITalosSettlement<ContractState> {
        fn set_core_protocol(ref self: ContractState, core_protocol: ContractAddress) {
            let caller = get_caller_address();
            assert(self.admin.read() == caller, 'NOT_ADMIN');
            assert(core_protocol.into() != 0, 'ZERO_ADDRESS');

            self.core_protocol.write(core_protocol);
            self.emit(Event::CoreProtocolSet(CoreProtocolSet { core_protocol, admin: caller }));
        }

        fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
            let caller = get_caller_address();
            let old_admin = self.admin.read();
            assert(old_admin == caller, 'NOT_ADMIN');
            assert(new_admin.into() != 0, 'ZERO_ADDRESS');

            self.admin.write(new_admin);
            self.emit(Event::AdminTransferred(AdminTransferred { old_admin, new_admin }));
        }

        fn add_supported_token(ref self: ContractState, token: ContractAddress) {
            let caller = get_caller_address();
            assert(self.admin.read() == caller, 'NOT_ADMIN');

            self.supported_tokens.entry(token).write(true);

            self.emit(Event::SupportedTokenAdded(SupportedTokenAdded { token, admin: caller }));
        }

        fn remove_supported_token(ref self: ContractState, token: ContractAddress) {
            let caller = get_caller_address();
            assert(self.admin.read() == caller, 'NOT_ADMIN');

            self.supported_tokens.entry(token).write(false);
            self.emit(Event::SupportedTokenRemoved(SupportedTokenRemoved { token, admin: caller }));
        }

        fn settle_payment(
            ref self: ContractState,
            payer_address: ContractAddress,
            payee_address: ContractAddress,
            token_address: ContractAddress,
            amount: u256,
            task_id: felt252,
            deadline: u64,
            signature: Array<felt252>,
        ) {
            assert(self.core_protocol.read() == get_caller_address(), 'NOT_CORE_PROTOCOL');
            assert(self.supported_tokens.entry(token_address).read(), 'UNSUPPORTED_TOKEN');
            assert(!self.settled_tasks.entry(task_id).read(), 'TASK_ALREADY_SETTLED');
            assert(get_block_timestamp() <= deadline, 'SIGNATURE_EXPIRED');

            let message_hash = compute_mock_message_hash(
                payer_address, payee_address, token_address, amount, task_id, deadline,
            );
            let payer_account = ISRC6Dispatcher { contract_address: payer_address };
            let is_valid_signature_felt = payer_account.is_valid_signature(message_hash, signature);
            let is_valid_signature = is_valid_signature_felt == starknet::VALIDATED
                || is_valid_signature_felt == 1;
            assert(is_valid_signature, 'INVALID_SIGNATURE');

            // Mark before external call so the same task_id cannot be re-entered.
            self.settled_tasks.entry(task_id).write(true);

            let token = IERC20Dispatcher { contract_address: token_address };
            let transferred = token.transfer_from(payer_address, payee_address, amount);
            assert(transferred, 'TRANSFER_FAILED');

            self.emit(
                Event::PaymentSettled(
                    PaymentSettled {
                        task_id,
                        token: token_address,
                        payer: payer_address,
                        payee: payee_address,
                        amount,
                    },
                ),
            );
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn get_core_protocol(self: @ContractState) -> ContractAddress {
            self.core_protocol.read()
        }

        fn is_supported_token(self: @ContractState, token: ContractAddress) -> bool {
            self.supported_tokens.entry(token).read()
        }

        fn is_task_settled(self: @ContractState, task_id: felt252) -> bool {
            self.settled_tasks.entry(task_id).read()
        }
    }

    fn compute_mock_message_hash(
        payer_address: ContractAddress,
        payee_address: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
        task_id: felt252,
        deadline: u64,
    ) -> felt252 {
        let chain_id = get_tx_info().chain_id;
        compute_settlement_hash_for_spec(
            get_contract_address(), chain_id, payer_address, payee_address, token_address, amount,
            task_id, deadline,
        )
    }
}
