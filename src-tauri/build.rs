fn main() {
    println!("cargo:rerun-if-env-changed=PI_AGENT_DESKTOP_REQUIRE_UPDATER");
    println!("cargo:rerun-if-env-changed=PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY");
    if std::env::var("PI_AGENT_DESKTOP_REQUIRE_UPDATER").as_deref() == Ok("1") {
        let public_key = std::env::var("PI_AGENT_DESKTOP_UPDATER_PUBLIC_KEY").unwrap_or_default();
        assert!(
            !public_key.trim().is_empty(),
            "official desktop builds require the embedded updater public key"
        );
    }
    tauri_build::build()
}
