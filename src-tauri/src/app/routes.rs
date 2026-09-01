//! Shared route allowlist for shell deep links.
//! Port of the spirit of Electron `normalizePracticeShellRoute` without dual maintenance of HTTP.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTarget {
    pub path: String,
    pub query: Vec<(String, String)>,
    pub hash: String,
    pub legacy: bool,
    pub rejected: bool,
    pub reason: Option<String>,
}

const ALLOWED_PREFIXES: &[&str] = &[
    "/",
    "/overview",
    "/reading",
    "/writing",
    "/history",
    "/settings",
    "/compose",
    "/evaluating",
    "/result",
    "/library",
    "/practice",
];

pub fn normalize_route(raw: &str) -> RouteTarget {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return RouteTarget {
            path: "/".into(),
            query: vec![],
            hash: String::new(),
            legacy: false,
            rejected: false,
            reason: None,
        };
    }

    // Reject obvious protocol / traversal abuse.
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("://")
        || lower.starts_with("javascript:")
        || lower.starts_with("data:")
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return RouteTarget {
            path: "/".into(),
            query: vec![],
            hash: String::new(),
            legacy: false,
            rejected: true,
            reason: Some("route rejected by allowlist".into()),
        };
    }

    let (path_and_query, hash) = match trimmed.split_once('#') {
        Some((left, right)) => (left, right.to_string()),
        None => (trimmed, String::new()),
    };

    let (path_part, query_part) = match path_and_query.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (path_and_query, None),
    };

    let mut path = path_part.trim().to_string();
    if path.is_empty() {
        path = "/".into();
    }
    if !path.starts_with('/') {
        path = format!("/{path}");
    }
    // collapse duplicate slashes
    while path.contains("//") {
        path = path.replace("//", "/");
    }

    let query = query_part
        .map(|q| {
            q.split('&')
                .filter_map(|pair| {
                    if pair.is_empty() {
                        return None;
                    }
                    let mut it = pair.splitn(2, '=');
                    let k = it.next().unwrap_or("").to_string();
                    let v = it.next().unwrap_or("").to_string();
                    if k.is_empty() {
                        None
                    } else {
                        Some((k, v))
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if let Some(redirect) = map_legacy(&path, &query) {
        return redirect;
    }

    if !is_allowed(&path) {
        return RouteTarget {
            path: "/".into(),
            query: vec![],
            hash: String::new(),
            legacy: false,
            rejected: true,
            reason: Some(format!("path not allowed: {path}")),
        };
    }

    RouteTarget {
        path,
        query,
        hash,
        legacy: false,
        rejected: false,
        reason: None,
    }
}

fn is_allowed(path: &str) -> bool {
    ALLOWED_PREFIXES.iter().any(|prefix| {
        path == *prefix || (*prefix != "/" && path.starts_with(&format!("{prefix}/")))
    }) || path == "/"
}

fn map_legacy(path: &str, query: &[(String, String)]) -> Option<RouteTarget> {
    // `/?view=browse` -> /reading/library
    if path == "/" {
        if let Some((_, view)) = query.iter().find(|(k, _)| k == "view") {
            if view == "browse" {
                return Some(RouteTarget {
                    path: "/reading/library".into(),
                    query: query.iter().filter(|(k, _)| k != "view").cloned().collect(),
                    hash: String::new(),
                    legacy: true,
                    rejected: false,
                    reason: Some("mapped legacy /?view=browse".into()),
                });
            }
        }
    }

    if path == "/library" {
        return Some(RouteTarget {
            path: "/reading/library".into(),
            query: query.to_vec(),
            hash: String::new(),
            legacy: true,
            rejected: false,
            reason: Some("mapped legacy /library".into()),
        });
    }

    // old memorize / review query markers
    if path.starts_with("/practice") || path == "/reading" {
        let mode = query
            .iter()
            .find(|(k, _)| k == "mode")
            .map(|(_, v)| v.as_str());
        if mode == Some("memorize") || mode == Some("memorise") {
            return Some(RouteTarget {
                path: "/reading/memorize".into(),
                query: query.iter().filter(|(k, _)| k != "mode").cloned().collect(),
                hash: String::new(),
                legacy: true,
                rejected: false,
                reason: Some("mapped legacy memorize mode".into()),
            });
        }
        if mode == Some("review") {
            return Some(RouteTarget {
                path: "/reading/review".into(),
                query: query.iter().filter(|(k, _)| k != "mode").cloned().collect(),
                hash: String::new(),
                legacy: true,
                rejected: false,
                reason: Some("mapped legacy review mode".into()),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_protocol() {
        let r = normalize_route("https://evil.example/x");
        assert!(r.rejected);
    }

    #[test]
    fn maps_browse_query() {
        let r = normalize_route("/?view=browse&q=tea");
        assert!(!r.rejected);
        assert!(r.legacy);
        assert_eq!(r.path, "/reading/library");
        assert!(r.query.iter().any(|(k, v)| k == "q" && v == "tea"));
    }

    #[test]
    fn allows_history() {
        let r = normalize_route("/history");
        assert!(!r.rejected);
        assert_eq!(r.path, "/history");
    }
}
