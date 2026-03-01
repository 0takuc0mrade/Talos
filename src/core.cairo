use starknet::ContractAddress;

#[starknet::interface]
pub trait ITalosCore<TContractState> {
    fn execute_agent_workflow(
        ref self: TContractState,
        payer_address: ContractAddress,
        payer_pub_key: felt252,
        payee_address: ContractAddress,
        token_address: ContractAddress,
        amount: u256,
        task_id: felt252,
        signature: Array<felt252>,
        target_agent_id: u256,
        score: u8,
    );
    fn get_identity_contract(self: @TContractState) -> ContractAddress;
    fn get_settlement_contract(self: @TContractState) -> ContractAddress;
    fn get_reputation_contract(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod TalosCore {
    use super::ITalosCore;
    use crate::identity::{ITalosIdentityDispatcher, ITalosIdentityDispatcherTrait};
    use crate::reputation::{ITalosReputationDispatcher, ITalosReputationDispatcherTrait};
    use crate::settlement::{ITalosSettlementDispatcher, ITalosSettlementDispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        identity_contract: ContractAddress,
        settlement_contract: ContractAddress,
        reputation_contract: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        WorkflowExecuted: WorkflowExecuted,
    }

    #[derive(Drop, starknet::Event)]
    struct WorkflowExecuted {
        #[key]
        task_id: felt252,
        #[key]
        target_agent_id: u256,
        payer: ContractAddress,
        payee: ContractAddress,
        token: ContractAddress,
        amount: u256,
        score: u8,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        identity_contract: ContractAddress,
        settlement_contract: ContractAddress,
        reputation_contract: ContractAddress,
    ) {
        self.identity_contract.write(identity_contract);
        self.settlement_contract.write(settlement_contract);
        self.reputation_contract.write(reputation_contract);
    }

    #[abi(embed_v0)]
    impl TalosCoreImpl of ITalosCore<ContractState> {
        fn execute_agent_workflow(
            ref self: ContractState,
            payer_address: ContractAddress,
            payer_pub_key: felt252,
            payee_address: ContractAddress,
            token_address: ContractAddress,
            amount: u256,
            task_id: felt252,
            signature: Array<felt252>,
            target_agent_id: u256,
            score: u8,
        ) {
            let identity = ITalosIdentityDispatcher { contract_address: self.identity_contract.read() };
            let settlement = ITalosSettlementDispatcher {
                contract_address: self.settlement_contract.read(),
            };
            let reputation = ITalosReputationDispatcher {
                contract_address: self.reputation_contract.read(),
            };

            let target_agent = identity.get_agent(target_agent_id);
            assert(target_agent.is_active, 'TARGET_AGENT_INACTIVE');

            settlement
                .settle_payment(
                    payer_address,
                    payer_pub_key,
                    payee_address,
                    token_address,
                    amount,
                    task_id,
                    signature,
                );
            reputation.submit_feedback(target_agent_id, task_id, score);

            self.emit(
                Event::WorkflowExecuted(
                    WorkflowExecuted {
                        task_id,
                        target_agent_id,
                        payer: payer_address,
                        payee: payee_address,
                        token: token_address,
                        amount,
                        score,
                    },
                ),
            );
        }

        fn get_identity_contract(self: @ContractState) -> ContractAddress {
            self.identity_contract.read()
        }

        fn get_settlement_contract(self: @ContractState) -> ContractAddress {
            self.settlement_contract.read()
        }

        fn get_reputation_contract(self: @ContractState) -> ContractAddress {
            self.reputation_contract.read()
        }
    }
}
