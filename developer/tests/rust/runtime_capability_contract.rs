use super::*;

// Keep this fixture independent of REQUIRED_RUNTIME_CAPABILITIES so changes to
// the host's required names or versions are checked against the wire contract.
fn full_handshake() -> RuntimeHandshake {
    RuntimeHandshake {
        selected_protocol: 1,
        runtime_version: "0.1.0".into(),
        build_id: "capability-contract-build".into(),
        capabilities: BTreeMap::from([
            ("runtime.health".into(), "1".into()),
            ("runtime.shutdown".into(), "1".into()),
            ("memory.candidates.extract".into(), "1".into()),
            ("memory.candidates.generate".into(), "1".into()),
            ("dream.daily".into(), "1".into()),
            ("planner.study_plan".into(), "1".into()),
        ]),
        required_host_capabilities: BTreeMap::from([
            ("model.invoke".into(), "1".into()),
            ("tool.invoke".into(), "1".into()),
        ]),
        max_frame_bytes: 1024 * 1024,
    }
}

#[test]
fn full_runtime_contract_satisfies_host_requirements() {
    assert_eq!(
        validate_handshake(
            &full_handshake(),
            Some("capability-contract-build"),
            REQUIRED_RUNTIME_CAPABILITIES,
        ),
        Ok(())
    );
}

#[test]
fn host_rejects_each_missing_required_runtime_capability() {
    for &(capability, _) in REQUIRED_RUNTIME_CAPABILITIES {
        let mut handshake = full_handshake();
        handshake.capabilities.remove(capability);
        assert_eq!(
            validate_handshake(
                &handshake,
                Some("capability-contract-build"),
                REQUIRED_RUNTIME_CAPABILITIES,
            ),
            Err(RuntimeHostError::MissingCapability(capability.into())),
            "missing required capability {capability} must fail negotiation"
        );
    }
}

#[test]
fn host_rejects_each_unsupported_required_runtime_version() {
    for &(capability, expected_version) in REQUIRED_RUNTIME_CAPABILITIES {
        let mut handshake = full_handshake();
        handshake.capabilities.insert(capability.into(), "2".into());
        assert_eq!(
            validate_handshake(
                &handshake,
                Some("capability-contract-build"),
                REQUIRED_RUNTIME_CAPABILITIES,
            ),
            Err(RuntimeHostError::CapabilityVersionMismatch {
                capability: capability.into(),
                expected: expected_version.into(),
                actual: "2".into(),
            }),
            "unsupported version of {capability} must fail negotiation"
        );
    }
}

#[test]
fn host_accepts_additional_runtime_capabilities() {
    let mut handshake = full_handshake();
    handshake
        .capabilities
        .insert("future.optional".into(), "1".into());
    assert_eq!(
        validate_handshake(
            &handshake,
            Some("capability-contract-build"),
            REQUIRED_RUNTIME_CAPABILITIES,
        ),
        Ok(())
    );
}
