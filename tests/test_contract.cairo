use core::traits::{Into, TryInto};
use snforge_std::{
    ContractClass, ContractClassTrait, DeclareResult, declare, start_cheat_block_timestamp_global,
    start_cheat_caller_address, start_mock_call,
};
use talos::reputation::{ITalosReputationDispatcher, ITalosReputationDispatcherTrait};
use talos::settlement::compute_settlement_hash_for_spec;
use talos::settlement::{ITalosSettlementDispatcher, ITalosSettlementDispatcherTrait};
use starknet::ContractAddress;

fn addr(v: felt252) -> ContractAddress {
    v.try_into().unwrap()
}

fn declare_class_or_panic(contract_name: ByteArray) -> ContractClass {
    match declare(contract_name) {
        Result::Ok(declare_result) => match declare_result {
            DeclareResult::Success(contract_class) => contract_class,
            DeclareResult::AlreadyDeclared(contract_class) => contract_class,
        },
        Result::Err(_) => core::panic_with_felt252('DECLARE_FAILED'),
    }
}

fn deploy_settlement(
    admin: ContractAddress,
) -> (ContractAddress, ITalosSettlementDispatcher) {
    let contract_class = declare_class_or_panic("TalosSettlement");
    let admin_felt: felt252 = admin.into();
    let constructor_calldata = array![admin_felt];

    let settlement_address = match contract_class.deploy(@constructor_calldata) {
        Result::Ok((address, _)) => address,
        Result::Err(_) => core::panic_with_felt252('DEPLOY_FAILED'),
    };

    (settlement_address, ITalosSettlementDispatcher { contract_address: settlement_address })
}

fn deploy_reputation(
    core_protocol: ContractAddress, admin: ContractAddress,
) -> (ContractAddress, ITalosReputationDispatcher) {
    let contract_class = declare_class_or_panic("TalosReputation");
    let core_felt: felt252 = core_protocol.into();
    let admin_felt: felt252 = admin.into();
    let constructor_calldata = array![core_felt, admin_felt];

    let reputation_address = match contract_class.deploy(@constructor_calldata) {
        Result::Ok((address, _)) => address,
        Result::Err(_) => core::panic_with_felt252('DEPLOY_FAILED'),
    };

    (reputation_address, ITalosReputationDispatcher { contract_address: reputation_address })
}

#[test]
fn test_settlement_hash_vector_1() {
    let actual = compute_settlement_hash_for_spec(
        addr(0x0457),
        'SN_SEPOLIA',
        addr(0x0111),
        addr(0x0222),
        addr(0x0333),
        1_000_000_u256,
        0x0abc123,
        1_735_689_600,
    );
    assert_eq!(actual, 0x69581519a53d776ef6bb583c847d1418def4ecd056e0cfc31f7bce08533de8f);
}

#[test]
fn test_settlement_hash_vector_2() {
    let actual = compute_settlement_hash_for_spec(
        addr(0x0777),
        'SN_MAIN',
        addr(0x1001),
        addr(0x2002),
        addr(0x3003),
        340282366920938463463374607431768211457_u256,
        0x0555aaa999,
        1_800_000_001,
    );
    assert_eq!(actual, 0x50691305e7022f55ca1a5074bac007e08584c714c735d8cfdc5121eb538bc9c);
}

#[test]
#[should_panic(expected: 'NOT_ADMIN')]
fn test_add_supported_token_requires_admin() {
    let admin = addr(0x1111);
    let unauthorized = addr(0x1234);
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, unauthorized);
    dispatcher.add_supported_token(addr(0x10));
}

#[test]
#[should_panic(expected: 'NOT_ADMIN')]
fn test_set_core_protocol_requires_admin() {
    let admin = addr(0x1111);
    let unauthorized = addr(0x1234);
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, unauthorized);
    dispatcher.set_core_protocol(addr(0x2222));
}

#[test]
#[should_panic(expected: 'NOT_CORE_PROTOCOL')]
fn test_settle_payment_requires_core_protocol() {
    let admin = addr(0x1111);
    let core = addr(0x2222);
    let unauthorized = addr(0x3333);
    let token = addr(0x3003);
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);
    dispatcher.add_supported_token(token);

    start_cheat_caller_address(settlement_address, unauthorized);
    dispatcher.settle_payment(
        addr(0x3001),
        addr(0x3002),
        token,
        10_u256,
        0x123,
        2_000_000_000,
        array![],
    );
}

#[test]
#[should_panic(expected: 'UNSUPPORTED_TOKEN')]
fn test_settle_payment_unsupported_token() {
    let admin = addr(0x1111);
    let core = addr(0x2222);
    let token = addr(0x3003);
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);

    start_cheat_caller_address(settlement_address, core);
    dispatcher.settle_payment(
        addr(0x3001),
        addr(0x3002),
        token,
        10_u256,
        0x123,
        2_000_000_000,
        array![],
    );
}

#[test]
#[should_panic(expected: 'TASK_ALREADY_SETTLED')]
fn test_settle_payment_replay_guard() {
    let admin = addr(0x1111);
    let core = addr(0x4444);
    let token = addr(0x3003);
    let payer = addr(0x3001);
    let payee = addr(0x3002);
    let task = 0x123;
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);
    dispatcher.add_supported_token(token);

    // Mock account abstraction and token transfers so the first settlement succeeds.
    start_mock_call(payer, selector!("is_valid_signature"), starknet::VALIDATED);
    start_mock_call(token, selector!("transfer_from"), true);

    start_cheat_caller_address(settlement_address, core);
    dispatcher.settle_payment(payer, payee, token, 10_u256, task, 2_000_000_000, array![]);

    dispatcher.settle_payment(payer, payee, token, 10_u256, task, 2_000_000_000, array![]);
}

#[test]
#[should_panic(expected: 'INVALID_SIGNATURE')]
fn test_settle_payment_invalid_signature() {
    let admin = addr(0x1111);
    let core = addr(0x5554);
    let token = addr(0x3003);
    let payer = addr(0x3001);
    let payee = addr(0x3002);
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);
    dispatcher.add_supported_token(token);

    start_mock_call(payer, selector!("is_valid_signature"), 0_felt252);

    start_cheat_caller_address(settlement_address, core);
    dispatcher.settle_payment(payer, payee, token, 10_u256, 0x123, 2_000_000_000, array![1, 2]);
}

#[test]
#[should_panic(expected: 'SIGNATURE_EXPIRED')]
fn test_settle_payment_deadline_guard() {
    let admin = addr(0x1111);
    let core = addr(0x5555);
    let token = addr(0x3003);
    let deadline = 1_000_u64;
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);
    dispatcher.add_supported_token(token);

    start_cheat_caller_address(settlement_address, core);
    start_cheat_block_timestamp_global(2_000_u64);

    dispatcher.settle_payment(
        addr(0x3001),
        addr(0x3002),
        token,
        10_u256,
        0x123,
        deadline,
        array![],
    );
}

#[test]
fn test_settle_payment_success_marks_task_settled() {
    let admin = addr(0x1111);
    let core = addr(0x6666);
    let token = addr(0x3003);
    let payer = addr(0x3001);
    let payee = addr(0x3002);
    let task_id = 0xabc123;
    let (settlement_address, dispatcher) = deploy_settlement(admin);

    start_cheat_caller_address(settlement_address, admin);
    dispatcher.set_core_protocol(core);
    dispatcher.add_supported_token(token);

    start_mock_call(payer, selector!("is_valid_signature"), starknet::VALIDATED);
    start_mock_call(token, selector!("transfer_from"), true);

    start_cheat_caller_address(settlement_address, core);
    dispatcher
        .settle_payment(payer, payee, token, 10_u256, task_id, 2_000_000_000, array![1, 2]);

    assert(dispatcher.is_task_settled(task_id), 'TASK_NOT_MARKED_SETTLED');
}

#[test]
#[should_panic(expected: 'NOT_ADMIN')]
fn test_reputation_set_core_protocol_requires_admin() {
    let admin = addr(0x7777);
    let initial_core = addr(0x9999);
    let non_admin = addr(0x8888);
    let (reputation_address, dispatcher) = deploy_reputation(initial_core, admin);

    start_cheat_caller_address(reputation_address, non_admin);
    dispatcher.set_core_protocol(addr(0x1234));
}

#[test]
fn test_reputation_set_core_protocol_by_admin() {
    let admin = addr(0x7777);
    let initial_core = addr(0x9999);
    let new_core = addr(0x1234);
    let (reputation_address, dispatcher) = deploy_reputation(initial_core, admin);

    start_cheat_caller_address(reputation_address, admin);
    dispatcher.set_core_protocol(new_core);

    assert_eq!(dispatcher.get_core_protocol(), new_core);
}

#[test]
#[should_panic(expected: 'NOT_CORE_PROTOCOL')]
fn test_submit_feedback_requires_core_protocol() {
    let admin = addr(0x7777);
    let core = addr(0x9999);
    let non_core = addr(0x8888);
    let (reputation_address, dispatcher) = deploy_reputation(core, admin);

    start_cheat_caller_address(reputation_address, non_core);
    dispatcher.submit_feedback(1_u256, 0x1, 80_u8);
}

#[test]
#[should_panic(expected: 'SCORE_OUT_OF_RANGE')]
fn test_submit_feedback_score_range_guard() {
    let admin = addr(0x7777);
    let core = addr(0x7777);
    let (reputation_address, dispatcher) = deploy_reputation(core, admin);

    start_cheat_caller_address(reputation_address, core);
    dispatcher.submit_feedback(1_u256, 0x1, 101_u8);
}

#[test]
#[should_panic(expected: 'TASK_ALREADY_FEEDBACKED')]
fn test_submit_feedback_replay_guard() {
    let admin = addr(0x7777);
    let core = addr(0x6666);
    let (reputation_address, dispatcher) = deploy_reputation(core, admin);

    start_cheat_caller_address(reputation_address, core);
    dispatcher.submit_feedback(1_u256, 0xabc, 90_u8);
    dispatcher.submit_feedback(1_u256, 0xabc, 95_u8);
}

#[test]
fn test_get_average_score_zero_reviews_returns_zero() {
    let admin = addr(0x7777);
    let core = addr(0x5555);
    let (_, dispatcher) = deploy_reputation(core, admin);

    assert_eq!(dispatcher.get_average_score(1_u256), 0_u8);
}

#[test]
fn test_submit_feedback_updates_average_score() {
    let admin = addr(0x7777);
    let core = addr(0x4444);
    let (reputation_address, dispatcher) = deploy_reputation(core, admin);

    start_cheat_caller_address(reputation_address, core);
    dispatcher.submit_feedback(1_u256, 0x01, 80_u8);
    dispatcher.submit_feedback(1_u256, 0x02, 100_u8);

    assert_eq!(dispatcher.get_average_score(1_u256), 90_u8);
}
