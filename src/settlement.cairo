use starknet::ContractAddress;

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
pub trait ITalosSettlement<TContractState> {
    fn add_supported_token(ref self: TContractState, token: ContractAddress);
    fn settle_payment(
        ref self: TContractState,
        payer_address: ContractAddress,
        payer_pub_key: felt252,
        payee_address: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
        task_id: felt252,
        signature: Array<felt252>,
    );
    fn is_supported_token(self: @TContractState, token: ContractAddress) -> bool;
    fn is_task_settled(self: @TContractState, task_id: felt252) -> bool;
}

#[starknet::contract]
pub mod TalosSettlement {
    use super::{IERC20Dispatcher, IERC20DispatcherTrait, ITalosSettlement};
    use core::ec;
    use core::ecdsa::check_ecdsa_signature;
    use core::hash::HashStateTrait;
    use core::poseidon::PoseidonTrait;
    use core::traits::Into;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        supported_tokens: Map<ContractAddress, bool>,
        settled_tasks: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SupportedTokenAdded: SupportedTokenAdded,
        PaymentSettled: PaymentSettled,
    }

    #[derive(Drop, starknet::Event)]
    struct SupportedTokenAdded {
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
        fn add_supported_token(ref self: ContractState, token: ContractAddress) {
            let caller = get_caller_address();
            assert(self.admin.read() == caller, 'NOT_ADMIN');

            self.supported_tokens.entry(token).write(true);

            self.emit(Event::SupportedTokenAdded(SupportedTokenAdded { token, admin: caller }));
        }

        fn settle_payment(
            ref self: ContractState,
            payer_address: ContractAddress,
            payer_pub_key: felt252,
            payee_address: ContractAddress,
            token_address: ContractAddress,
            amount: u256,
            task_id: felt252,
            signature: Array<felt252>,
        ) {
            assert(self.supported_tokens.entry(token_address).read(), 'UNSUPPORTED_TOKEN');
            assert(!self.settled_tasks.entry(task_id).read(), 'TASK_ALREADY_SETTLED');
            assert(signature.len() == 2_usize, 'INVALID_SIGNATURE_LEN');

            let signature_r = *signature.at(0_u32);
            let signature_s = *signature.at(1_u32);
            assert(signature_r != 0, 'INVALID_SIG_R');
            assert(signature_s != 0, 'INVALID_SIG_S');
            let signature_r_u256: u256 = signature_r.into();
            let signature_s_u256: u256 = signature_s.into();
            let stark_order_u256: u256 = ec::stark_curve::ORDER.into();
            assert(signature_r_u256 < stark_order_u256, 'INVALID_SIG_R');
            assert(signature_s_u256 < stark_order_u256, 'INVALID_SIG_S');

            let message_hash = compute_mock_message_hash(
                payer_address, payer_pub_key, payee_address, token_address, amount, task_id,
            );
            assert(
                check_ecdsa_signature(message_hash, payer_pub_key, signature_r, signature_s),
                'INVALID_SIGNATURE',
            );

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

        fn is_supported_token(self: @ContractState, token: ContractAddress) -> bool {
            self.supported_tokens.entry(token).read()
        }

        fn is_task_settled(self: @ContractState, task_id: felt252) -> bool {
            self.settled_tasks.entry(task_id).read()
        }
    }

    fn compute_mock_message_hash(
        payer_address: ContractAddress,
        payer_pub_key: felt252,
        payee_address: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
        task_id: felt252,
    ) -> felt252 {
        PoseidonTrait::new()
            .update('TALOS_SETTLEMENT')
            .update(get_contract_address().into())
            .update(payer_address.into())
            .update(payer_pub_key)
            .update(payee_address.into())
            .update(token_address.into())
            .update(amount.low.into())
            .update(amount.high.into())
            .update(task_id)
            .finalize()
    }
}
