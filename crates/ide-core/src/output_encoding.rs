//! Keeps Python process output aligned with the configured console encoding.
//! Native diagnostics still use the platform ANSI fallback when they are not UTF-8.

use std::collections::BTreeMap;

/// Decodes complete lines or collected output from IDE-managed tools, preferring UTF-8.
/// Windows launcher/native diagnostics fall back to the system ANSI code page.
/// Callers must buffer incomplete lines so multibyte characters are never split.
/// Run consoles and protocol streams have their own encoding contracts.
pub fn decode_tool_output(bytes: &[u8]) -> String {
    #[cfg(windows)]
    // SAFETY: GetACP is an argument-less query with no preconditions.
    let code_page = unsafe { windows_sys::Win32::Globalization::GetACP() };
    #[cfg(not(windows))]
    let code_page = 65001;
    decode_tool_output_with_code_page(bytes, code_page)
}

fn decode_tool_output_with_code_page(bytes: &[u8], code_page: u32) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let encoding = encoding_for_code_page(code_page).unwrap_or(encoding_rs::UTF_8);
    // Collected output can mix UTF-8 application lines with native launcher diagnostics.
    let mut text = String::new();
    for line in bytes.split_inclusive(|b| *b == b'\n') {
        match std::str::from_utf8(line) {
            Ok(line) => text.push_str(line),
            Err(_) => text.push_str(&encoding.decode_without_bom_handling(line).0),
        }
    }
    text
}

fn encoding_for_code_page(cp: u32) -> Option<&'static encoding_rs::Encoding> {
    Some(match cp {
        65001 => encoding_rs::UTF_8,
        936 => encoding_rs::GBK,
        54936 => encoding_rs::GB18030,
        950 => encoding_rs::BIG5,
        932 => encoding_rs::SHIFT_JIS,
        949 => encoding_rs::EUC_KR,
        866 => encoding_rs::IBM866,
        874 => encoding_rs::WINDOWS_874,
        1250 => encoding_rs::WINDOWS_1250,
        1251 => encoding_rs::WINDOWS_1251,
        1252 => encoding_rs::WINDOWS_1252,
        1253 => encoding_rs::WINDOWS_1253,
        1254 => encoding_rs::WINDOWS_1254,
        1255 => encoding_rs::WINDOWS_1255,
        1256 => encoding_rs::WINDOWS_1256,
        1257 => encoding_rs::WINDOWS_1257,
        1258 => encoding_rs::WINDOWS_1258,
        20866 => encoding_rs::KOI8_R,
        21866 => encoding_rs::KOI8_U,
        _ => return None,
    })
}

/// Optional process adjustments. Arguments and notices remain generic launch metadata.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct EncodingFix {
    pub args: Option<Vec<String>>,
    pub env: Vec<(String, String)>,
    pub notice: Option<String>,
}

pub fn is_utf8(encoding: &str) -> bool {
    matches!(encoding.trim().to_ascii_lowercase().replace('_', "-").as_str(), "utf-8" | "utf8")
}

/// File name of a program without a Windows executable extension.
fn program_name(command: &str) -> String {
    let name = command.rsplit(['/', '\\']).next().unwrap_or(command).to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem.to_owned();
        }
    }
    name
}

/// Python output overrides respect the configured and inherited environment.
/// Other programs are unchanged, including manually launched legacy tools.
pub fn fix(
    program: &str,
    _args: &[String],
    vars: &BTreeMap<String, String>,
    inherited: impl Fn(&str) -> Option<String>,
    encoding: &str,
    windows: bool,
) -> EncodingFix {
    let encoding = encoding.trim();
    let mut out = EncodingFix::default();
    if encoding.is_empty() || (!windows && is_utf8(encoding)) || !is_python(&program_name(program)) {
        return out;
    }
    let current = vars.get("PYTHONIOENCODING").cloned().or_else(|| inherited("PYTHONIOENCODING"));
    if current.as_deref().unwrap_or_default().trim().is_empty() {
        out.env.push(("PYTHONIOENCODING".to_owned(), encoding.to_owned()));
    }
    out
}

/// Apply Python environment overrides using the first word of a shell command.
pub fn fix_command_line(
    line: &str,
    vars: &BTreeMap<String, String>,
    inherited: impl Fn(&str) -> Option<String>,
    encoding: &str,
    windows: bool,
) -> EncodingFix {
    let line = line.trim_start();
    let first = match line.chars().next() {
        Some(q @ ('"' | '\'')) => line[1..].split(q).next(),
        _ => line.split(char::is_whitespace).next(),
    }
    .unwrap_or_default();
    fix(first, &[], vars, inherited, encoding, windows)
}

/// `python`, `python3`, `python3.12`, `py`, and the runners that start one.
fn is_python(name: &str) -> bool {
    name == "python"
        || name == "py"
        || name.strip_prefix("python").is_some_and(|v| v.chars().all(|c| c.is_ascii_digit() || c == '.'))
        || matches!(name, "uv" | "poetry" | "pdm" | "pytest" | "pipenv")
}

/// Drops a caller-selected complete notice line, passing every other line through.
/// The start of a line is held only while it can still become that exact notice.
#[derive(Debug)]
pub struct NoticeFilter {
    notice: String,
    held: String,
    at_line_start: bool,
}

impl NoticeFilter {
    pub fn new(notice: String) -> Self {
        Self { notice, held: String::new(), at_line_start: true }
    }

    pub fn filter(&mut self, text: &str, out: &mut String) {
        for piece in text.split_inclusive('\n') {
            if !self.at_line_start && self.held.is_empty() {
                out.push_str(piece);
                self.at_line_start = piece.ends_with('\n');
                continue;
            }
            self.held.push_str(piece);
            if self.held.ends_with('\n') {
                if self.held.trim_end_matches(['\n', '\r']) != self.notice {
                    out.push_str(&self.held);
                }
                self.held.clear();
                self.at_line_start = true;
            } else if !self.could_be_notice() {
                out.push_str(&self.held);
                self.held.clear();
                self.at_line_start = false;
            }
        }
    }

    /// The held text is the start of the notice, or all of it before a `\r\n`.
    fn could_be_notice(&self) -> bool {
        match self.held.strip_suffix('\r') {
            Some(line) => line == self.notice,
            None => self.notice.starts_with(self.held.as_str()),
        }
    }

    /// The held-back start of a line, at the end of the stream.
    pub fn finish(&mut self) -> String {
        std::mem::take(&mut self.held)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_output_prefers_utf8() {
        for cp in [936, 1252, 65001, 0] {
            for text in ["", "plain ASCII\r\n", "中文 café 🦀\n"] {
                assert_eq!(decode_tool_output_with_code_page(text.as_bytes(), cp), text);
            }
        }
    }

    #[test]
    fn tool_output_decodes_native_diagnostics_and_mixed_lines() {
        const GBK: &[u8] = b"\xcf\xb5\xcd\xb3\xd5\xd2\xb2\xbb\xb5\xbd\xd6\xb8\xb6\xa8\xb5\xc4\xc2\xb7\xbe\xb6\xa1\xa3";
        assert_eq!(decode_tool_output_with_code_page(GBK, 936), "系统找不到指定的路径。");
        let mut mixed = "Tool: 中文\r\n".as_bytes().to_vec();
        mixed.extend_from_slice(GBK);
        mixed.extend_from_slice(b"\r\nlast");
        assert_eq!(decode_tool_output_with_code_page(&mixed, 936), "Tool: 中文\r\n系统找不到指定的路径。\r\nlast");
        assert_eq!(decode_tool_output_with_code_page(b"caf\xe9", 1252), "café");
        for cp in [65001, 0] {
            assert_eq!(decode_tool_output_with_code_page(b"a\xffb", cp), "a�b");
        }
    }

    #[test]
    fn python_launches_follow_console_encoding_and_user_overrides() {
        for program in ["python.exe", "python3", "python3.12", "py.exe", "uv.exe", "poetry", "pdm", "pytest", "pipenv"]
        {
            let result = fix(program, &[], &BTreeMap::new(), |_| None, "UTF-8", true);
            assert_eq!(result.env, [("PYTHONIOENCODING".into(), "UTF-8".into())], "{program}");
            assert!(result.args.is_none() && result.notice.is_none());
            assert_eq!(fix(program, &[], &BTreeMap::new(), |_| None, "UTF-8", false), EncodingFix::default());
        }
        let inherited = |_: &str| Some("GBK".into());
        assert!(fix("python", &[], &BTreeMap::new(), inherited, "UTF-8", true).env.is_empty());
        let explicit = BTreeMap::from([("PYTHONIOENCODING".into(), "utf-16".into())]);
        assert!(fix("python", &[], &explicit, inherited, "UTF-8", true).env.is_empty());
        let cleared = BTreeMap::from([("PYTHONIOENCODING".into(), String::new())]);
        assert_eq!(fix("python", &[], &cleared, inherited, "UTF-8", true).env[0].1, "UTF-8");
        assert_eq!(fix("python3", &[], &BTreeMap::new(), |_| None, " GBK ", false).env[0].1, "GBK");
    }

    #[test]
    fn unrelated_and_legacy_tools_get_no_runtime_injection() {
        for program in
            ["node", "cargo", "go", "R", "ark", "java", "mvn.cmd", "gradlew.bat", "sbt", "kotlinc", "groovy", "scala"]
        {
            assert_eq!(
                fix(program, &[], &BTreeMap::new(), |_| None, "UTF-8", true),
                EncodingFix::default(),
                "{program}"
            );
        }
        assert_eq!(fix("python", &[], &BTreeMap::new(), |_| None, "", true), EncodingFix::default());
    }

    #[test]
    fn shell_commands_preserve_quoted_paths_and_python_encodings() {
        for line in ["python manage.py runserver", r#""C:\Program Files\Python\python.exe" app.py"#] {
            assert_eq!(fix_command_line(line, &BTreeMap::new(), |_| None, "UTF-8", true).env[0].0, "PYTHONIOENCODING");
        }
        assert_eq!(
            fix_command_line("npm run dev && echo done", &BTreeMap::new(), |_| None, "UTF-8", true),
            EncodingFix::default()
        );
    }

    #[test]
    fn notice_filter_preserves_other_lines_across_chunk_boundaries() {
        let notice = "internal notice";
        let text = "internal notice\r\nerror: one\ninternal notice\ninternal notice suffix\nlast";
        let expected = "error: one\ninternal notice suffix\nlast";
        for i in 0..=text.len() {
            let mut filter = NoticeFilter::new(notice.into());
            let mut out = String::new();
            filter.filter(&text[..i], &mut out);
            filter.filter(&text[i..], &mut out);
            out.push_str(&filter.finish());
            assert_eq!(out, expected, "split at {i}");
        }
        let mut filter = NoticeFilter::new(notice.into());
        let mut out = String::new();
        filter.filter("internal", &mut out);
        assert!(out.is_empty());
        assert_eq!(filter.finish(), "internal");
    }
}
