#[derive(Drop, Serde, starknet::Store)]
pub struct ReputationData {
    pub total_score: u256,
    pub review_count: u256,
}

#[starknet::interface]
pub trait ITalosReputation<TContractState> {
    fn submit_feedback(
        ref self: TContractState, target_agent_id: u256, task_id: felt252, score: u8,
    );
    fn get_average_score(self: @TContractState, agent_id: u256) -> u8;
    fn get_reputation_data(self: @TContractState, agent_id: u256) -> ReputationData;
}

#[starknet::contract]
pub mod TalosReputation {
    use super::{ITalosReputation, ReputationData};
    use core::option::OptionTrait;
    use core::traits::TryInto;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        core_protocol: ContractAddress,
        reputation_by_agent: Map<u256, ReputationData>,
        task_feedback_submitted: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        FeedbackSubmitted: FeedbackSubmitted,
    }

    #[derive(Drop, starknet::Event)]
    struct FeedbackSubmitted {
        #[key]
        target_agent_id: u256,
        #[key]
        task_id: felt252,
        score: u8,
    }

    #[constructor]
    fn constructor(ref self: ContractState, core_protocol: ContractAddress) {
        self.core_protocol.write(core_protocol);
    }

    #[abi(embed_v0)]
    impl TalosReputationImpl of ITalosReputation<ContractState> {
        fn submit_feedback(
            ref self: ContractState, target_agent_id: u256, task_id: felt252, score: u8,
        ) {
            let caller = get_caller_address();
            assert(caller == self.core_protocol.read(), 'NOT_CORE_PROTOCOL');
            assert(score <= 100_u8, 'SCORE_OUT_OF_RANGE');
            assert(!self.task_feedback_submitted.read(task_id), 'TASK_ALREADY_FEEDBACKED');

            let score_u256: u256 = score.into();
            let current = self.reputation_by_agent.read(target_agent_id);
            let updated = ReputationData {
                total_score: current.total_score + score_u256,
                review_count: current.review_count + 1_u256,
            };

            self.reputation_by_agent.write(target_agent_id, updated);
            self.task_feedback_submitted.write(task_id, true);

            self.emit(Event::FeedbackSubmitted(FeedbackSubmitted { target_agent_id, task_id, score }));
        }

        fn get_average_score(self: @ContractState, agent_id: u256) -> u8 {
            let data = self.reputation_by_agent.read(agent_id);
            if data.review_count == 0_u256 {
                return 0_u8;
            }

            let average_u256 = data.total_score / data.review_count;
            assert(average_u256 <= 100_u256, 'AVERAGE_OUT_OF_RANGE');
            average_u256.try_into().expect('AVERAGE_CONVERSION_FAILED')
        }

        fn get_reputation_data(self: @ContractState, agent_id: u256) -> ReputationData {
            self.reputation_by_agent.read(agent_id)
        }
    }
}
