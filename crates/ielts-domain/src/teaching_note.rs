//! The two semantic fields of a coach teaching note: who the note is about and
//! how long it stays useful.
//!
//! The model declares them, the host never trusts them for priority. One
//! definition (names, defaults, parsing) is shared by the validator that writes
//! notes and by every reader of stored payloads, so "absent or unreadable means
//! the default" is decided in exactly one place.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What a note is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeachingNoteScope {
    /// The learner as a person: a preference, a recurring confusion, whether a
    /// way of explaining worked. Useful across questions. The default, so every
    /// note stored before this field existed is a profile note.
    #[default]
    Profile,
    /// Only this question or passage ("I do not follow this paragraph"). Stored
    /// with the message and never read by anything that builds a learner view.
    Question,
}

impl TeachingNoteScope {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Profile => "profile",
            Self::Question => "question",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [Self::Profile, Self::Question].into_iter().find(|scope| scope.as_str() == value)
    }

    /// The scope of a stored note; absent or unrecognised is the default.
    pub fn of_note(note: &Value) -> Self {
        note["scope"].as_str().and_then(Self::parse).unwrap_or_default()
    }
}

/// How long a note is expected to stay useful.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeachingNoteHorizon {
    /// Only meaningful inside the conversation that produced it.
    Session,
    /// Meaningful for the next few days. The default.
    #[default]
    Recent,
    /// A stable, long-lived preference.
    Durable,
}

impl TeachingNoteHorizon {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Recent => "recent",
            Self::Durable => "durable",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [Self::Session, Self::Recent, Self::Durable].into_iter().find(|horizon| horizon.as_str() == value)
    }

    /// The horizon of a stored note; absent or unrecognised is the default.
    pub fn of_note(note: &Value) -> Self {
        note["horizon"].as_str().and_then(Self::parse).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn absent_or_unrecognised_values_are_the_defaults() {
        for note in [json!({}), json!({"scope": "everything", "horizon": "forever"}), json!({"scope": 3, "horizon": null}), json!("x")] {
            assert_eq!(TeachingNoteScope::of_note(&note), TeachingNoteScope::Profile, "{note}");
            assert_eq!(TeachingNoteHorizon::of_note(&note), TeachingNoteHorizon::Recent, "{note}");
        }
    }

    #[test]
    fn known_values_round_trip_through_their_names() {
        let note = json!({"scope": "question", "horizon": "durable"});
        assert_eq!(TeachingNoteScope::of_note(&note), TeachingNoteScope::Question);
        assert_eq!(TeachingNoteHorizon::of_note(&note), TeachingNoteHorizon::Durable);
        assert_eq!(TeachingNoteHorizon::parse("session"), Some(TeachingNoteHorizon::Session));
        assert_eq!(TeachingNoteHorizon::parse("Session"), None, "names are exact");
        assert_eq!(serde_json::to_value(TeachingNoteScope::Question).unwrap(), "question");
    }
}
