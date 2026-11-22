use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NavigationTarget {
    Internal,
    External,
    Blocked,
}

pub(crate) fn classify_url(uri: &str) -> NavigationTarget {
    let Ok(url) = Url::parse(uri) else {
        return NavigationTarget::Blocked;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return NavigationTarget::Blocked;
    }

    match (url.scheme(), url.host_str(), url.port_or_known_default()) {
        // Wry maps the custom protocol to HTTPS on Windows.
        ("https", Some("semyra.localhost"), Some(443))
        | ("semyra", Some("localhost"), None) => NavigationTarget::Internal,
        ("http" | "https", Some(_), _) | ("mailto", None, None) => NavigationTarget::External,
        _ => NavigationTarget::Blocked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_configured_origins_as_internal() {
        for uri in [
            "https://semyra.localhost/",
            "https://SEMYRA.LOCALHOST:443/#heading",
            "semyra://localhost/",
        ] {
            assert_eq!(classify_url(uri), NavigationTarget::Internal, "{uri}");
        }
        for uri in [
            "https://example.org/",
            "https://semyra.localhost:8443/",
            "http://semyra.localhost/",
            "mailto:reader@example.org",
        ] {
            assert_eq!(classify_url(uri), NavigationTarget::External, "{uri}");
        }
        for uri in ["semyra://example.org/", "file:///notes.md", "about:blank", "notes.md"] {
            assert_eq!(classify_url(uri), NavigationTarget::Blocked, "{uri}");
        }
    }
}
