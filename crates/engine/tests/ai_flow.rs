//! AI assistance (ADR-0003) through the engine with the mock provider: the key gate, the
//! schema validation, the response cache, the error mapping and the promise that the key
//! never lands in `settings.json`.

use meshkeep_engine::ai::{AiSettings, MockMode, MockProvider};
use meshkeep_engine::model::{ListQuery, SyncMode};
use meshkeep_engine::{Engine, EngineError, UpdateMetadata};
use std::fs;
use std::path::Path;
use std::sync::Arc;

fn touch(p: &Path, bytes: &[u8]) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, bytes).unwrap();
}

fn library() -> (tempfile::TempDir, tempfile::TempDir, Engine, String) {
    let data = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    touch(&lib.path().join("Desk/Cable Clips/clip_6mm.stl"), &[0u8; 100]);
    touch(&lib.path().join("Desk/Cable Clips/clip_8mm.stl"), &[0u8; 120]);
    touch(
        &lib.path().join("Desk/Cable Clips/README.md"),
        b"# Cable clips\nBy Maker Mia. License: CC-BY-4.0\n",
    );
    touch(&lib.path().join("Decor/Vase/vase.stl"), &[0u8; 200]);
    let mut engine = Engine::open(data.path()).unwrap();
    let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
    engine.scan_root(&root.id, |_| {}).unwrap();
    let vase = engine
        .list_projects(&ListQuery::default())
        .unwrap()
        .into_iter()
        .find(|p| p.title == "Vase")
        .unwrap();
    engine
        .update_metadata(
            &vase.id,
            UpdateMetadata {
                tags: Some(vec!["decor".into(), "vase".into()]),
                expected_stamp: None,
                ..Default::default()
            },
        )
        .unwrap();
    let clips = engine
        .list_projects(&ListQuery::default())
        .unwrap()
        .into_iter()
        .find(|p| p.title == "Cable Clips")
        .unwrap();
    (data, lib, engine, clips.id)
}

#[test]
fn no_key_means_no_call_and_the_key_stays_out_of_settings() {
    let (data, _lib, mut engine, clips) = library();
    let mock = Arc::new(MockProvider::new(MockMode::Ok));
    engine.set_ai_provider(Some(mock.clone()));
    for key in [None, Some(""), Some("   ")] {
        assert!(matches!(engine.ai_suggest_metadata(&clips, key), Err(EngineError::AiDisabled)));
        assert!(matches!(engine.ai_test_connection(key), Err(EngineError::AiDisabled)));
    }
    assert_eq!(mock.calls(), 0, "a missing key must short-circuit before the provider");

    // settings carry the endpoint and model, never a key
    let saved = engine
        .set_ai_settings(AiSettings {
            base_url: Some("http://localhost:11434/".into()),
            model: "my-model".into(),
            ..AiSettings::default()
        })
        .unwrap();
    assert_eq!(saved.base_url.as_deref(), Some("http://localhost:11434"));
    assert_eq!(engine.ai_settings().model, "my-model");
    let secret = "sk-ant-test-secret-value";
    engine.ai_test_connection(Some(secret)).unwrap();
    let text = fs::read_to_string(data.path().join("settings.json")).unwrap();
    assert!(text.contains("\"ai\""), "settings.json carries the ai block: {text}");
    assert!(text.contains("my-model"));
    assert!(!text.contains(secret), "the key must never be written to settings.json");
    assert!(!text.to_lowercase().contains("sk-ant"));
    let again = Engine::open(data.path()).unwrap();
    assert_eq!(again.ai_settings(), engine.ai_settings());
    assert!(matches!(
        engine.set_ai_settings(AiSettings {
            base_url: Some("ftp://nope".into()),
            ..AiSettings::default()
        }),
        Err(EngineError::NotAllowed(_))
    ));
}

#[test]
fn suggestion_is_validated_cached_and_reports_what_was_sent() {
    let (data, _lib, mut engine, clips) = library();
    let mock = Arc::new(MockProvider::new(MockMode::Ok));
    engine.set_ai_provider(Some(mock.clone()));

    let s = engine.ai_suggest_metadata(&clips, Some("key")).unwrap();
    assert_eq!(mock.calls(), 1);
    assert_eq!(s.title.as_deref(), Some("Cable Clips"));
    assert_eq!(s.creator.as_deref(), Some("Mock Creator"));
    assert_eq!(s.license.as_deref(), Some("CC-BY-4.0"));
    assert_eq!(s.tags, vec!["cable", "clips", "mock"]);
    assert_eq!(
        s.new_tags,
        vec!["cable", "clips", "mock"],
        "nothing in the library carries these yet"
    );
    assert!(!s.cached);
    assert_eq!(s.model, "mock");
    assert_eq!(s.sent.files, 3);
    assert_eq!(s.sent.documents, vec!["README.md"]);
    assert!(!s.sent.thumbnail, "no preview rendered yet");
    assert!(!s.sent.sidecar);
    assert!(data.path().join("ai-cache").is_dir());

    // same inputs: served from the cache, the provider is not asked again
    let again = engine.ai_suggest_metadata(&clips, Some("key")).unwrap();
    assert!(again.cached);
    assert_eq!(again.tags, s.tags);
    assert_eq!(again.sent, s.sent);
    assert_eq!(mock.calls(), 1);

    // an edit changes the inputs, so the next suggestion is a fresh call that sees the sidecar
    let p = engine.get_project(&clips).unwrap();
    engine
        .update_metadata(
            &clips,
            UpdateMetadata {
                tags: Some(vec!["cable".into()]),
                expected_stamp: p.sidecar_stamp,
                ..Default::default()
            },
        )
        .unwrap();
    let after = engine.ai_suggest_metadata(&clips, Some("key")).unwrap();
    assert_eq!(mock.calls(), 2);
    assert!(!after.cached);
    assert!(after.sent.sidecar);
    assert_eq!(after.new_tags, vec!["clips", "mock"], "cable is in the vocabulary now");

    // the prompt never carries model bytes, only names, sizes and text files
    let prepared = engine.ai_prepare_suggestion(&clips).unwrap();
    assert!(prepared.request.text.contains("clip_6mm.stl (model, 0 KB)"));
    assert!(prepared.request.text.contains("By Maker Mia"));
    assert!(prepared.request.text.contains("Library tag vocabulary: cable, decor, vase"));
    assert!(prepared.request.image_png.is_none());
    assert!(prepared.cached.is_some());
}

#[test]
fn provider_errors_map_to_typed_errors_and_are_not_cached() {
    let (data, _lib, mut engine, clips) = library();
    for (mode, check) in [
        (
            MockMode::Unauthorized,
            (|e: &EngineError| matches!(e, EngineError::AiUnauthorized(_))) as fn(&EngineError) -> bool,
        ),
        (MockMode::RateLimited, |e| matches!(e, EngineError::AiRateLimited(_))),
        (MockMode::Invalid, |e| matches!(e, EngineError::AiInvalidResponse(_))),
        (MockMode::Unavailable, |e| matches!(e, EngineError::AiUnavailable(_))),
    ] {
        engine.set_ai_provider(Some(Arc::new(MockProvider::new(mode))));
        let err = engine.ai_suggest_metadata(&clips, Some("key")).unwrap_err();
        assert!(check(&err), "{mode:?}: {err}");
        let err = engine.ai_test_connection(Some("key")).unwrap_err();
        assert!(check(&err), "{mode:?}: {err}");
    }
    assert!(!data.path().join("ai-cache").exists(), "failures leave no cache entry");

    // an offline root never produces a request
    let offline = tempfile::tempdir().unwrap();
    touch(&offline.path().join("Gone/part.stl"), &[0u8; 10]);
    let root = engine.add_root(offline.path(), SyncMode::Manual).unwrap();
    engine.scan_root(&root.id, |_| {}).unwrap();
    let gone = engine
        .list_projects(&ListQuery::default())
        .unwrap()
        .into_iter()
        .find(|p| p.title == "Gone")
        .unwrap();
    drop(offline);
    engine.roots().unwrap();
    let mock = Arc::new(MockProvider::new(MockMode::Ok));
    engine.set_ai_provider(Some(mock.clone()));
    assert!(matches!(
        engine.ai_suggest_metadata(&gone.id, Some("key")),
        Err(EngineError::RootOffline(_))
    ));
    assert_eq!(mock.calls(), 0);
}
