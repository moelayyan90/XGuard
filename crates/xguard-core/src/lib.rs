//! Deterministic policy engine for BAM Application Controlled Execution (ACE).
//!
//! The engine models the opt-in application speed-bump primitive described by
//! the BAM team: transactions touching an enrolled program are delayed unless
//! a top-level instruction carries an explicitly configured bypass marker.
//! Unknown applications are not affected.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;

pub const MIN_DELAY_MS: u8 = 10;
pub const MAX_DELAY_MS: u8 = 50;
pub const MAX_MARKER_BYTES: usize = 16;
pub const MAX_RULES: usize = 4096;
pub const MAX_MARKERS_PER_RULE: usize = 32;

const BASE58_ALPHABET: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    pub data_offset: u8,
    pub bytes: Vec<u8>,
}

impl Marker {
    fn matches(&self, data: &[u8]) -> bool {
        let start = self.data_offset as usize;
        let Some(end) = start.checked_add(self.bytes.len()) else {
            return false;
        };
        data.get(start..end) == Some(self.bytes.as_slice())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplicationRule {
    /// Base58 Solana program id.
    pub program_id: String,
    /// Top-level instruction markers that bypass the speed bump.
    pub bypass_markers: Vec<Marker>,
    /// Delay applied to protected flow. BAM's public proposal bounds this to 10-50ms.
    pub delay_ms: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyConfig {
    pub rules: Vec<ApplicationRule>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstructionView {
    pub program_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionView {
    /// Only top-level instructions. CPI is intentionally not represented as a top-level call.
    pub top_level_instructions: Vec<InstructionView>,
    /// All account keys referenced by the transaction, represented as base58 strings.
    /// If an enrolled program appears here but is not called at top level, the engine
    /// treats the flow conservatively as indirect/CPI and applies the speed bump.
    pub account_keys: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchReason {
    ProtectedTopLevelInstruction,
    IndirectOrCpiReference,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleMatch {
    pub program_id: String,
    pub delay_ms: u8,
    pub reason: MatchReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    /// Zero means the transaction stays on the normal path.
    pub delay_ms: u8,
    /// Stable, program-id-sorted matches for auditability.
    pub matches: Vec<RuleMatch>,
}

impl Decision {
    pub fn is_delayed(&self) -> bool {
        self.delay_ms > 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConfigError {
    TooManyRules {
        count: usize,
        max: usize,
    },
    InvalidProgramId {
        program_id: String,
    },
    DuplicateProgramId {
        program_id: String,
    },
    DelayOutOfRange {
        program_id: String,
        delay_ms: u8,
    },
    TooManyMarkers {
        program_id: String,
        count: usize,
        max: usize,
    },
    EmptyMarker {
        program_id: String,
    },
    MarkerTooLong {
        program_id: String,
        len: usize,
        max: usize,
    },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyRules { count, max } => write!(f, "too many rules: {count} > {max}"),
            Self::InvalidProgramId { program_id } => {
                write!(f, "invalid Solana program id: {program_id}")
            }
            Self::DuplicateProgramId { program_id } => {
                write!(f, "duplicate program id: {program_id}")
            }
            Self::DelayOutOfRange {
                program_id,
                delay_ms,
            } => write!(
                f,
                "delay for {program_id} must be between {MIN_DELAY_MS}ms and {MAX_DELAY_MS}ms, got {delay_ms}ms"
            ),
            Self::TooManyMarkers {
                program_id,
                count,
                max,
            } => {
                write!(
                    f,
                    "too many bypass markers for {program_id}: {count} > {max}"
                )
            }
            Self::EmptyMarker { program_id } => write!(f, "empty bypass marker for {program_id}"),
            Self::MarkerTooLong {
                program_id,
                len,
                max,
            } => {
                write!(
                    f,
                    "bypass marker for {program_id} is too long: {len} > {max}"
                )
            }
        }
    }
}

impl std::error::Error for ConfigError {}

impl PolicyConfig {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.rules.len() > MAX_RULES {
            return Err(ConfigError::TooManyRules {
                count: self.rules.len(),
                max: MAX_RULES,
            });
        }

        let mut seen = BTreeSet::new();
        for rule in &self.rules {
            if !is_pubkey_like(&rule.program_id) {
                return Err(ConfigError::InvalidProgramId {
                    program_id: rule.program_id.clone(),
                });
            }
            if !seen.insert(rule.program_id.as_str()) {
                return Err(ConfigError::DuplicateProgramId {
                    program_id: rule.program_id.clone(),
                });
            }
            if !(MIN_DELAY_MS..=MAX_DELAY_MS).contains(&rule.delay_ms) {
                return Err(ConfigError::DelayOutOfRange {
                    program_id: rule.program_id.clone(),
                    delay_ms: rule.delay_ms,
                });
            }
            if rule.bypass_markers.len() > MAX_MARKERS_PER_RULE {
                return Err(ConfigError::TooManyMarkers {
                    program_id: rule.program_id.clone(),
                    count: rule.bypass_markers.len(),
                    max: MAX_MARKERS_PER_RULE,
                });
            }
            for marker in &rule.bypass_markers {
                if marker.bytes.is_empty() {
                    return Err(ConfigError::EmptyMarker {
                        program_id: rule.program_id.clone(),
                    });
                }
                if marker.bytes.len() > MAX_MARKER_BYTES {
                    return Err(ConfigError::MarkerTooLong {
                        program_id: rule.program_id.clone(),
                        len: marker.bytes.len(),
                        max: MAX_MARKER_BYTES,
                    });
                }
            }
        }
        Ok(())
    }
}

/// Classifies one transaction against a validated policy.
///
/// Rules are independent and opt-in. If several enrolled programs match the same
/// transaction, the engine applies the maximum delay, matching BAM's published
/// conflict-resolution proposal for composable transactions.
pub fn classify(config: &PolicyConfig, tx: &TransactionView) -> Decision {
    let account_keys: BTreeSet<&str> = tx.account_keys.iter().map(String::as_str).collect();
    let mut matches = Vec::new();

    for rule in &config.rules {
        let top_level_calls: Vec<&InstructionView> = tx
            .top_level_instructions
            .iter()
            .filter(|ix| ix.program_id == rule.program_id)
            .collect();

        if top_level_calls.is_empty() {
            if account_keys.contains(rule.program_id.as_str()) {
                matches.push(RuleMatch {
                    program_id: rule.program_id.clone(),
                    delay_ms: rule.delay_ms,
                    reason: MatchReason::IndirectOrCpiReference,
                });
            }
            continue;
        }

        let every_call_bypasses = top_level_calls.iter().all(|ix| {
            rule.bypass_markers
                .iter()
                .any(|marker| marker.matches(&ix.data))
        });

        if !every_call_bypasses {
            matches.push(RuleMatch {
                program_id: rule.program_id.clone(),
                delay_ms: rule.delay_ms,
                reason: MatchReason::ProtectedTopLevelInstruction,
            });
        }
    }

    matches.sort_by(|a, b| a.program_id.cmp(&b.program_id));
    let delay_ms = matches.iter().map(|m| m.delay_ms).max().unwrap_or(0);
    Decision { delay_ms, matches }
}

fn is_pubkey_like(value: &str) -> bool {
    (32..=44).contains(&value.len()) && value.chars().all(|c| BASE58_ALPHABET.contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROGRAM_A: &str = "11111111111111111111111111111111";
    const PROGRAM_B: &str = "Vote111111111111111111111111111111111111111";

    fn config() -> PolicyConfig {
        PolicyConfig {
            rules: vec![
                ApplicationRule {
                    program_id: PROGRAM_A.into(),
                    bypass_markers: vec![Marker {
                        data_offset: 0,
                        bytes: vec![7],
                    }],
                    delay_ms: 20,
                },
                ApplicationRule {
                    program_id: PROGRAM_B.into(),
                    bypass_markers: vec![Marker {
                        data_offset: 1,
                        bytes: vec![9, 9],
                    }],
                    delay_ms: 40,
                },
            ],
        }
    }

    #[test]
    fn validates_reference_config() {
        assert_eq!(config().validate(), Ok(()));
    }

    #[test]
    fn unknown_transaction_stays_on_normal_path() {
        let tx = TransactionView {
            top_level_instructions: vec![],
            account_keys: vec![],
        };
        assert_eq!(classify(&config(), &tx).delay_ms, 0);
    }

    #[test]
    fn protected_top_level_call_is_delayed() {
        let tx = TransactionView {
            top_level_instructions: vec![InstructionView {
                program_id: PROGRAM_A.into(),
                data: vec![1, 2, 3],
            }],
            account_keys: vec![PROGRAM_A.into()],
        };
        let decision = classify(&config(), &tx);
        assert_eq!(decision.delay_ms, 20);
        assert_eq!(
            decision.matches[0].reason,
            MatchReason::ProtectedTopLevelInstruction
        );
    }

    #[test]
    fn explicit_top_level_marker_bypasses_delay() {
        let tx = TransactionView {
            top_level_instructions: vec![InstructionView {
                program_id: PROGRAM_A.into(),
                data: vec![7, 2, 3],
            }],
            account_keys: vec![PROGRAM_A.into()],
        };
        assert_eq!(classify(&config(), &tx).delay_ms, 0);
    }

    #[test]
    fn all_same_program_calls_must_bypass() {
        let tx = TransactionView {
            top_level_instructions: vec![
                InstructionView {
                    program_id: PROGRAM_A.into(),
                    data: vec![7],
                },
                InstructionView {
                    program_id: PROGRAM_A.into(),
                    data: vec![1],
                },
            ],
            account_keys: vec![PROGRAM_A.into()],
        };
        assert_eq!(classify(&config(), &tx).delay_ms, 20);
    }

    #[test]
    fn indirect_reference_is_delayed_conservatively() {
        let tx = TransactionView {
            top_level_instructions: vec![],
            account_keys: vec![PROGRAM_A.into()],
        };
        let decision = classify(&config(), &tx);
        assert_eq!(decision.delay_ms, 20);
        assert_eq!(
            decision.matches[0].reason,
            MatchReason::IndirectOrCpiReference
        );
    }

    #[test]
    fn composition_uses_maximum_delay() {
        let tx = TransactionView {
            top_level_instructions: vec![
                InstructionView {
                    program_id: PROGRAM_A.into(),
                    data: vec![1],
                },
                InstructionView {
                    program_id: PROGRAM_B.into(),
                    data: vec![1, 2, 3],
                },
            ],
            account_keys: vec![PROGRAM_A.into(), PROGRAM_B.into()],
        };
        assert_eq!(classify(&config(), &tx).delay_ms, 40);
    }

    #[test]
    fn rejects_out_of_range_delay() {
        let mut cfg = config();
        cfg.rules[0].delay_ms = 9;
        assert!(matches!(
            cfg.validate(),
            Err(ConfigError::DelayOutOfRange { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_programs() {
        let mut cfg = config();
        cfg.rules.push(cfg.rules[0].clone());
        assert!(matches!(
            cfg.validate(),
            Err(ConfigError::DuplicateProgramId { .. })
        ));
    }
}
