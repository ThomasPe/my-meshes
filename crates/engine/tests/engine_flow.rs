//! End-to-end engine flow on a temporary library: add root, scan, list, edit metadata
//! (lazy sidecar creation, conflict detection), offline handling.

use meshkeep_engine::model::{ListQuery, SidecarState, SyncMode};
use meshkeep_engine::{Engine, EngineError, UpdateMetadata};
use std::fs;
use std::path::Path;

fn touch(p: &Path, bytes: usize) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, vec![0u8; bytes]).unwrap();
}

#[test]
fn add_scan_edit_conflict_offline() {
    let data = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    touch(&lib.path().join("Gridfinity/Bins/bin.stl"), 100);
    touch(&lib.path().join("Decor/Vase/vase.stl"), 200);
    touch(&lib.path().join("Decor/Vase/photo.jpg"), 50);

    let mut engine = Engine::open(data.path()).unwrap();
    let root = engine.add_root(lib.path(), SyncMode::Watch).unwrap();
    assert!(matches!(
        engine.add_root(lib.path(), SyncMode::Watch),
        Err(EngineError::RootExists(_))
    ));

    let mut seen = 0;
    let report = engine.scan_root(&root.id, |p| seen = p.projects_found).unwrap();
    assert_eq!(report.projects, 2);
    assert_eq!(seen, 2);
    assert!(
        !lib.path().join("Gridfinity/Bins/project.yaml").exists(),
        "scan must not create sidecars"
    );

    let list = engine.list_projects(&ListQuery::default()).unwrap();
    assert_eq!(list.len(), 2);
    let vase = list.iter().find(|p| p.title == "Vase").unwrap();
    assert_eq!(vase.file_count, 2);

    // lazy sidecar creation on first edit
    let full = engine.get_project(&vase.id).unwrap();
    assert_eq!(full.sidecar, SidecarState::Missing);
    assert!(full.sidecar_stamp.is_none());
    let updated = engine
        .update_metadata(
            &vase.id,
            UpdateMetadata {
                tags: Some(vec!["Decor".into(), "vase".into(), " decor ".into()]),
                creator: Some("Lena".into()),
                expected_stamp: None,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(updated.tags, vec!["decor", "vase"]);
    assert_eq!(updated.sidecar, SidecarState::Ok);
    assert!(lib.path().join("Decor/Vase/project.yaml").exists());
    let stamp = updated.sidecar_stamp.unwrap();

    // index reflects the edit
    let by_tag = engine
        .list_projects(&ListQuery {
            tags: vec!["vase".into()],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(by_tag.len(), 1);
    let by_text = engine
        .list_projects(&ListQuery {
            text: Some("lena".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(by_text.len(), 1);

    // external edit -> conflict, unless forced
    fs::write(
        lib.path().join("Decor/Vase/project.yaml"),
        "schema: 1\nmetadata:\n  title: Edited outside, longer text\n  tags: [external]\n",
    )
    .unwrap();
    let err = engine
        .update_metadata(
            &vase.id,
            UpdateMetadata {
                title: Some("Mine".into()),
                expected_stamp: Some(stamp),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(matches!(err, EngineError::SidecarConflict));
    let forced = engine
        .update_metadata(
            &vase.id,
            UpdateMetadata {
                title: Some("Mine".into()),
                force: true,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(forced.title, "Mine");
    assert_eq!(forced.tags, vec!["external"], "unrelated fields from the external edit survive");

    // offline root: projects stay, flagged offline; edits refused
    let moved = lib.path().with_extension("gone");
    fs::rename(lib.path(), &moved).unwrap();
    let roots = engine.roots().unwrap();
    assert_eq!(roots[0].status, meshkeep_engine::model::RootStatus::Offline);
    assert!(matches!(engine.scan_root(&root.id, |_| {}), Err(EngineError::RootOffline(_))));
    let still = engine.list_projects(&ListQuery::default()).unwrap();
    assert_eq!(still.len(), 2);
    assert!(still.iter().all(|p| p.offline));
    assert!(matches!(
        engine.update_metadata(&vase.id, UpdateMetadata::default()),
        Err(EngineError::RootOffline(_))
    ));
    fs::rename(&moved, lib.path()).unwrap();
    engine.roots().unwrap();
    engine.scan_root(&root.id, |_| {}).unwrap();
    assert!(engine.list_projects(&ListQuery::default()).unwrap().iter().all(|p| !p.offline));

    // traversal guard
    assert!(engine.resolve_file(&vase.id, "../../etc/passwd").is_err());
    assert!(engine.resolve_file(&vase.id, "vase.stl").unwrap().ends_with("vase.stl"));
}
