//! Metadata for read-only documents served by a language server.
use percent_encoding::percent_decode_str;

pub fn scheme(uri: &str) -> &str {
    uri.split_once(':').map(|(s, _)| s).unwrap_or("")
}

pub fn title(uri: &str) -> String {
    let rest = uri.split_once(':').map(|(_, r)| r).unwrap_or(uri);
    let path = rest.split(['?', '#']).next().unwrap_or(rest);
    path.split('/')
        .rfind(|s| !s.is_empty())
        .map(|name| percent_decode_str(name).decode_utf8_lossy().into_owned())
        .unwrap_or_else(|| uri.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn virtual_titles_decode_paths_without_queries() {
        assert_eq!(title("generated://module/my%20file.py?revision=2#L4"), "my file.py");
        assert_eq!(title("untitled:notes.txt"), "notes.txt");
        assert_eq!(scheme("generated://module/file.py"), "generated");
        assert_eq!(title("generated:"), "generated:");
    }
}
