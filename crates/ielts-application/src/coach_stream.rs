//! Learner-visible text of a streaming coach reply.
//!
//! The coach asks the model for one JSON object, `{"answer":"...", ...}`. While
//! the reply streams, only the decoded value of that top-level `answer` string
//! is forwarded: JSON syntax, `teachingNotes` and any other field never reach
//! the learner. The persisted answer is still parsed from the complete reply.
//!
//! The scanner is byte-based so chunk boundaries may fall anywhere, including
//! inside a `\uXXXX` escape, a surrogate pair or a multibyte character.

/// Incremental extractor for the top-level `"answer"` string of a JSON reply.
#[derive(Default)]
pub(crate) struct AnswerStream {
    /// Nesting of `{` and `[` outside strings.
    depth: usize,
    /// The next string token is an object key at the top level.
    expect_key: bool,
    /// The last top-level key closed as `"answer"`; a `:` must follow.
    after_answer_key: bool,
    /// `"answer":` was read; the value must open with a string.
    awaiting_value: bool,
    /// Role of the string token being read, `None` outside strings.
    role: Option<Role>,
    escape: Escape,
    /// A high surrogate waiting for its low half.
    pending_high: Option<u16>,
    /// Decoded bytes of the current string, plus any undecoded UTF-8 tail.
    text: Vec<u8>,
    /// Visible text completed by the current call.
    ready: String,
    /// Set once the answer string closed or the reply left the answer shape.
    finished: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    Key,
    Answer,
    Other,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Escape {
    #[default]
    None,
    Slash,
    Unicode { value: u32, digits: u8 },
}

impl AnswerStream {
    /// Feeds the next raw content bytes and returns the newly visible answer text.
    pub(crate) fn push(&mut self, chunk: &[u8]) -> String {
        for &byte in chunk {
            if self.finished {
                break;
            }
            match self.role {
                Some(role) => self.step_string(role, byte),
                None => self.step_structure(byte),
            }
        }
        let mut visible = std::mem::take(&mut self.ready);
        if self.role == Some(Role::Answer) {
            visible.push_str(&self.drain_utf8(false));
        }
        visible
    }

    fn step_structure(&mut self, byte: u8) {
        if byte.is_ascii_whitespace() {
            return;
        }
        if self.after_answer_key {
            self.after_answer_key = false;
            if byte == b':' {
                self.awaiting_value = true;
                return;
            }
        }
        if self.awaiting_value {
            self.awaiting_value = false;
            if byte == b'"' {
                self.open_string(Role::Answer);
            } else {
                // A non-string answer (null, number, ...) has no visible text.
                self.finished = true;
            }
            return;
        }
        match byte {
            b'{' => {
                self.depth += 1;
                self.expect_key = self.depth == 1;
            }
            b'[' => {
                self.depth += 1;
                self.expect_key = false;
            }
            b'}' | b']' => {
                if self.depth > 0 {
                    self.depth -= 1;
                    if self.depth == 0 {
                        self.finished = true;
                    }
                }
                self.expect_key = false;
            }
            b',' => self.expect_key = self.depth == 1,
            b'"' => {
                let role = if self.depth == 1 && self.expect_key { Role::Key } else { Role::Other };
                self.open_string(role);
            }
            _ => self.expect_key = false,
        }
    }

    fn open_string(&mut self, role: Role) {
        self.expect_key = false;
        self.role = Some(role);
        self.text.clear();
        self.escape = Escape::None;
        self.pending_high = None;
    }

    fn step_string(&mut self, role: Role, byte: u8) {
        match self.escape {
            Escape::None => {}
            Escape::Slash => {
                self.escape = Escape::None;
                self.simple_escape(byte);
                return;
            }
            Escape::Unicode { value, digits } => {
                match hex_digit(byte) {
                    Some(digit) if digits == 3 => {
                        self.escape = Escape::None;
                        self.code_unit(((value << 4) | digit) as u16);
                    }
                    Some(digit) => {
                        self.escape = Escape::Unicode { value: (value << 4) | digit, digits: digits + 1 };
                    }
                    // Not valid JSON. The string cannot be decoded past this point, and
                    // the byte may be the closing quote, so the answer ends here.
                    None => self.finished = true,
                }
                return;
            }
        }
        match byte {
            b'\\' => self.escape = Escape::Slash,
            b'"' => self.close_string(role),
            _ => {
                self.flush_high();
                self.text.push(byte);
            }
        }
    }

    fn simple_escape(&mut self, byte: u8) {
        let decoded = match byte {
            b'u' => {
                self.escape = Escape::Unicode { value: 0, digits: 0 };
                return;
            }
            b'"' | b'\\' | b'/' => byte,
            b'b' => 0x08,
            b'f' => 0x0C,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            _ => return,
        };
        self.flush_high();
        self.text.push(decoded);
    }

    fn code_unit(&mut self, unit: u16) {
        if let Some(high) = self.pending_high.take() {
            if (0xDC00..=0xDFFF).contains(&unit) {
                let code = 0x10000 + ((u32::from(high) - 0xD800) << 10) + (u32::from(unit) - 0xDC00);
                self.push_char(char::from_u32(code).unwrap_or('\u{FFFD}'));
                return;
            }
            self.push_char('\u{FFFD}');
        }
        match unit {
            0xD800..=0xDBFF => self.pending_high = Some(unit),
            0xDC00..=0xDFFF => self.push_char('\u{FFFD}'),
            _ => self.push_char(char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}')),
        }
    }

    fn push_char(&mut self, ch: char) {
        let mut buf = [0u8; 4];
        self.text.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
    }

    fn flush_high(&mut self) {
        if self.pending_high.take().is_some() {
            self.push_char('\u{FFFD}');
        }
    }

    fn close_string(&mut self, role: Role) {
        self.flush_high();
        self.role = None;
        match role {
            Role::Key => {
                self.after_answer_key = self.depth == 1 && self.text == b"answer";
                self.text.clear();
            }
            Role::Answer => {
                // The string is complete: whatever is left, even a split
                // character, is final text now.
                let tail = self.drain_utf8(true);
                self.ready.push_str(&tail);
                self.finished = true;
            }
            Role::Other => self.text.clear(),
        }
    }

    /// Takes the longest valid UTF-8 prefix of `text`. An incomplete trailing
    /// sequence waits for more bytes unless `finalize` is set; invalid bytes
    /// become U+FFFD.
    fn drain_utf8(&mut self, finalize: bool) -> String {
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.text) {
                Ok(valid) => {
                    out.push_str(valid);
                    self.text.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.text[..valid]).unwrap_or(""));
                    match error.error_len() {
                        Some(len) => {
                            out.push('\u{FFFD}');
                            self.text.drain(..valid + len);
                        }
                        None => {
                            self.text.drain(..valid);
                            if finalize && !self.text.is_empty() {
                                out.push('\u{FFFD}');
                                self.text.clear();
                            }
                            break;
                        }
                    }
                }
            }
        }
        out
    }
}

fn hex_digit(byte: u8) -> Option<u32> {
    (byte as char).to_digit(16)
}

#[cfg(test)]
mod tests {
    use super::AnswerStream;

    /// Visible text of `chunks` fed one after another.
    fn visible(chunks: &[&[u8]]) -> String {
        let mut stream = AnswerStream::default();
        chunks.iter().map(|chunk| stream.push(chunk)).collect()
    }

    const REPLY: &str = r#"{"teachingNotes":[{"answer":"nested, not the answer","text":"x"}],"answer":"Check \"the\" qualifier.\nSecond \\ line \/ 你好 😀 你好 \t end","kind":"hint"}"#;
    const EXPECTED: &str = "Check \"the\" qualifier.\nSecond \\ line / 你好 😀 你好 \t end";

    #[test]
    fn whole_reply_yields_the_decoded_answer_and_stops_at_its_closing_quote() {
        let mut stream = AnswerStream::default();
        let mut out = stream.push(REPLY.as_bytes());
        assert_eq!(out, EXPECTED);
        // Everything after the answer's closing quote is ignored.
        out = stream.push(b"more text");
        assert_eq!(out, "");
    }

    #[test]
    fn every_byte_split_yields_the_same_text() {
        let bytes = REPLY.as_bytes();
        for split in 0..=bytes.len() {
            let got = visible(&[&bytes[..split], &bytes[split..]]);
            assert_eq!(got, EXPECTED, "split at byte {split}");
        }
    }

    #[test]
    fn one_byte_chunks_never_emit_a_partial_character_or_escape() {
        let bytes = REPLY.as_bytes();
        let chunks: Vec<&[u8]> = bytes.chunks(1).collect();
        assert_eq!(visible(&chunks), EXPECTED);
    }

    #[test]
    fn surrogate_pairs_and_multibyte_characters_split_across_chunks() {
        // 😀 as an escaped surrogate pair, split between the two escapes and inside them.
        let text = br#"{"answer":"\ud83d\ude00"}"#;
        for split in 0..=text.len() {
            assert_eq!(visible(&[&text[..split], &text[split..]]), "😀", "split {split}");
        }
        // A raw 4-byte character cut in the middle of its UTF-8 sequence.
        let raw = "{\"answer\":\"a😀b\"}".as_bytes();
        for split in 0..=raw.len() {
            assert_eq!(visible(&[&raw[..split], &raw[split..]]), "a😀b", "raw split {split}");
        }
    }

    #[test]
    fn a_lone_surrogate_becomes_the_replacement_character() {
        assert_eq!(visible(&[br#"{"answer":"x\ud83dy\ude00z\udc00"}"#]), "x\u{FFFD}y\u{FFFD}z\u{FFFD}");
        assert_eq!(visible(&[br#"{"answer":"lone\ud83d"}"#]), "lone\u{FFFD}");
    }

    #[test]
    fn nested_and_later_answer_keys_are_not_the_visible_answer() {
        assert_eq!(visible(&[br#"{"teachingNotes":[{"answer":"no"}]}"#]), "");
        assert_eq!(visible(&[br#"{"meta":{"answer":"no"},"answer":"yes"}"#]), "yes");
        assert_eq!(visible(&[br#"{"answerer":"no","answer":"yes"}"#]), "yes");
    }

    #[test]
    fn a_partial_reply_shows_what_has_arrived_so_far() {
        let mut stream = AnswerStream::default();
        assert_eq!(stream.push(br#"{"answer":"Look at the "#), "Look at the ");
        assert_eq!(stream.push(br#"qualifier"#), "qualifier");
        assert_eq!(stream.push(br#"\u00"#), "");
        assert_eq!(stream.push(br#"e9"}"#), "\u{e9}");
    }

    #[test]
    fn a_malformed_unicode_escape_ends_the_answer_before_the_closing_quote() {
        let reply = br#"{"answer":"hi \u12","teachingNotes":[{"text":"secret note"}]}"#;
        assert_eq!(visible(&[reply]), "hi ");
        let mut stream = AnswerStream::default();
        assert_eq!(stream.push(br#"{"answer":"hi \u12"#), "hi ");
        assert_eq!(stream.push(br#"","teachingNotes":[{"text":"secret note"}]}"#), "");
    }

    #[test]
    fn a_non_string_answer_or_a_missing_answer_shows_nothing() {
        assert_eq!(visible(&[br#"{"answer":null,"text":"x"}"#]), "");
        assert_eq!(visible(&[br#"{"answer":42}"#]), "");
        assert_eq!(visible(&[br#"{"kind":"hint","text":"no answer key"}"#]), "");
        assert_eq!(visible(&[b"not json at all"]), "");
    }

    #[test]
    fn a_reply_that_is_not_an_object_shows_nothing() {
        assert_eq!(visible(&[br#"["answer","x"]"#]), "");
    }
}
