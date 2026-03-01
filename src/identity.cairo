use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Agent {
    pub owner: ContractAddress,
    pub pub_key: felt252,
    pub metadata_uri: ByteArray,
    pub is_active: bool,
}

#[starknet::interface]
pub trait ITalosIdentity<TContractState> {
    fn register_agent(
        ref self: TContractState, pub_key: felt252, metadata_uri: ByteArray,
    ) -> u256;
    fn update_metadata(ref self: TContractState, agent_id: u256, metadata_uri: ByteArray);
    fn get_agent(self: @TContractState, agent_id: u256) -> Agent;
    fn get_agent_count(self: @TContractState) -> u256;
}

#[starknet::contract]
pub mod TalosIdentity {
    use super::{Agent, ITalosIdentity};
    use starknet::{get_caller_address, ContractAddress};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        agent_count: u256,
        agents: Map<u256, Agent>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        AgentRegistered: AgentRegistered,
        MetadataUpdated: MetadataUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct AgentRegistered {
        #[key]
        agent_id: u256,
        owner: ContractAddress,
        pub_key: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct MetadataUpdated {
        #[key]
        agent_id: u256,
        owner: ContractAddress,
    }

    #[abi(embed_v0)]
    impl TalosIdentityImpl of ITalosIdentity<ContractState> {
        fn register_agent(
            ref self: ContractState, pub_key: felt252, metadata_uri: ByteArray,
        ) -> u256 {
            let caller = get_caller_address();
            let new_agent_id = self.agent_count.read() + 1_u256;

            self.agents.write(
                new_agent_id, Agent { owner: caller, pub_key, metadata_uri, is_active: true },
            );
            self.agent_count.write(new_agent_id);

            self.emit(
                Event::AgentRegistered(
                    AgentRegistered { agent_id: new_agent_id, owner: caller, pub_key },
                ),
            );

            new_agent_id
        }

        fn update_metadata(ref self: ContractState, agent_id: u256, metadata_uri: ByteArray) {
            let caller = get_caller_address();
            let agent = self.agents.read(agent_id);

            assert(agent.is_active, 'AGENT_NOT_FOUND');
            assert(agent.owner == caller, 'NOT_AGENT_OWNER');

            self.agents.write(
                agent_id,
                Agent {
                    owner: agent.owner,
                    pub_key: agent.pub_key,
                    metadata_uri,
                    is_active: agent.is_active,
                },
            );

            self.emit(Event::MetadataUpdated(MetadataUpdated { agent_id, owner: caller }));
        }

        fn get_agent(self: @ContractState, agent_id: u256) -> Agent {
            self.agents.read(agent_id)
        }

        fn get_agent_count(self: @ContractState) -> u256 {
            self.agent_count.read()
        }
    }
}
