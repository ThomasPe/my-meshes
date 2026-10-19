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

#[test]
fn favorites_rename_delete_and_thumbnails() {
    use meshkeep_engine::model::{SortKey, ThumbSource};
    let data = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    touch(&lib.path().join("Gridfinity/Bins/small.stl"), 100);
    touch(&lib.path().join("Gridfinity/Bins/big.stl"), 300);
    touch(&lib.path().join("Decor/Vase/vase.stl"), 200);
    touch(&lib.path().join("Decor/Vase/photo.jpg"), 50);
    touch(&lib.path().join("Docs/Only/readme.txt"), 5);
    touch(&lib.path().join("Docs/Only/thing.stl"), 7);

    let mut engine = Engine::open(data.path()).unwrap();
    engine.set_deleter(Box::new(
        |p: &Path| if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) },
    ));
    let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
    engine.scan_root(&root.id, |_| {}).unwrap();
    let bins_id = format!("{}:Gridfinity/Bins", root.id);
    let vase_id = format!("{}:Decor/Vase", root.id);
    let only_id = format!("{}:Docs/Only", root.id);

    // favorites survive a rescan (they live in collections.json, not in the index)
    let fav = engine.set_favorite(&bins_id, true).unwrap();
    assert!(fav.favorite);
    engine.scan_root(&root.id, |_| {}).unwrap();
    let favs = engine
        .list_projects(&ListQuery {
            favorites: true,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(favs.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec![bins_id.as_str()]);
    assert_eq!(engine.favorite_count().unwrap(), 1);
    assert!(data.path().join("collections.json").exists());
    // sorting by "added" works and every project has a plausible added date
    let by_added = engine
        .list_projects(&ListQuery {
            sort: SortKey::Added,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(by_added.len(), 3);
    assert!(by_added.iter().all(|p| p.added.year() >= 2020));

    // thumbnails: queue picks the largest model per project, store + stale + failure
    let mut queue = engine.thumb_queue(10).unwrap();
    queue.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    assert_eq!(queue.len(), 3, "{queue:?}");
    let bins_job = queue.iter().find(|j| j.project_id == bins_id).unwrap();
    assert_eq!((bins_job.rel_path.as_str(), bins_job.source), ("big.stl", ThumbSource::Render));
    let png = include_bytes!("../src/threemf.rs"); // not a PNG
    assert!(engine.store_thumbnail(&bins_id, png).is_err());
    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63,
        0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xE2, 0x26, 0x05, 0x9B, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
        0x60, 0x82,
    ];
    let key = engine.store_thumbnail(&bins_id, TINY_PNG).unwrap();
    assert!(engine.thumbnail_path(&key).unwrap().is_file());
    assert!(engine.thumbnail_path("../index.sqlite").is_err());
    assert_eq!(engine.get_project(&bins_id).unwrap().thumb.as_deref(), Some(key.as_str()));
    assert_eq!(engine.thumb_queue(10).unwrap().len(), 2);
    engine.thumbnail_failed(&vase_id, "no webgl").unwrap();
    assert_eq!(engine.thumb_queue(10).unwrap().len(), 1);
    let stats = engine.thumb_stats().unwrap();
    assert_eq!((stats.done, stats.failed, stats.pending), (1, 1, 1));
    // the source file grows -> stale -> queued again
    touch(&lib.path().join("Gridfinity/Bins/big.stl"), 301);
    engine.scan_root(&root.id, |_| {}).unwrap();
    assert!(engine.get_project(&bins_id).unwrap().thumb.is_none());
    assert!(engine.thumb_queue(10).unwrap().iter().any(|j| j.project_id == bins_id));
    let key2 = engine.store_thumbnail(&bins_id, TINY_PNG).unwrap();
    assert_eq!(key, key2, "key is deterministic per project + source");

    // rename: collision check, favorites and thumbnail follow, old id is gone
    assert!(matches!(engine.rename_project(&bins_id, "Bins").unwrap().id.as_str(), id if id == bins_id));
    assert!(matches!(engine.rename_project(&bins_id, "Bi/ns"), Err(EngineError::InvalidName(_))));
    fs::create_dir_all(lib.path().join("Gridfinity/Taken")).unwrap();
    assert!(matches!(
        engine.rename_project(&bins_id, "Taken"),
        Err(EngineError::AlreadyExists(_))
    ));
    let renamed = engine.rename_project(&bins_id, "Bins v2").unwrap();
    assert_eq!(renamed.rel_path, "Gridfinity/Bins v2");
    assert!(renamed.favorite);
    assert_eq!(renamed.thumb.as_deref(), Some(key.as_str()));
    assert!(lib.path().join("Gridfinity/Bins v2/big.stl").exists());
    assert!(matches!(engine.get_project(&bins_id), Err(EngineError::ProjectNotFound(_))));
    assert_eq!(engine.favorite_count().unwrap(), 1);
    assert_eq!(engine.list_projects(&ListQuery::default()).unwrap().len(), 3);

    // delete a file: project stays while it still has a model, disappears otherwise
    assert!(matches!(
        engine.delete_file(&vase_id, "project.yaml"),
        Err(EngineError::NotAllowed(_))
    ));
    let after = engine.delete_file(&vase_id, "photo.jpg").unwrap().unwrap();
    assert_eq!(after.files.len(), 1);
    assert!(!lib.path().join("Decor/Vase/photo.jpg").exists());
    assert!(engine.delete_file(&only_id, "thing.stl").unwrap().is_none());
    assert!(matches!(engine.get_project(&only_id), Err(EngineError::ProjectNotFound(_))));
    assert!(lib.path().join("Docs/Only/readme.txt").exists(), "other files stay");

    // delete a project
    engine.delete_project(&renamed.id).unwrap();
    assert!(!lib.path().join("Gridfinity/Bins v2").exists());
    assert_eq!(engine.favorite_count().unwrap(), 0);
    assert_eq!(engine.list_projects(&ListQuery::default()).unwrap().len(), 1);
    let root_project = engine.list_projects(&ListQuery::default()).unwrap();
    assert_eq!(root_project[0].id, vase_id);

    // poll due-check
    let polled = engine.set_root_mode(&root.id, SyncMode::Poll, Some(60)).unwrap();
    assert_eq!(polled.poll_interval_secs, 60);
    let now = time::OffsetDateTime::now_utc();
    assert!(engine.poll_due(now).is_empty(), "scanned moments ago");
    assert_eq!(engine.poll_due(now + time::Duration::seconds(61)), vec![root.id.clone()]);

    // clearing the cache
    engine.clear_thumbnails().unwrap();
    assert!(!data.path().join("thumbs").exists());
}

#[test]
fn import_inbox_and_collections_through_the_engine() {
    use meshkeep_engine::import::{ArchivePolicy, ImportRequest, ImportRequestItem};
    use meshkeep_engine::model::SortKey;
    let data = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    let drop = tempfile::tempdir().unwrap();
    touch(&lib.path().join("Existing/part.stl"), 10);
    touch(&drop.path().join("Dropped Folder/a.stl"), 10);
    touch(&drop.path().join("loose.stl"), 10);

    let mut engine = Engine::open(data.path()).unwrap();
    engine.set_deleter(Box::new(
        |p: &Path| if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) },
    ));
    let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
    engine.scan_root(&root.id, |_| {}).unwrap();

    let items = engine.analyze_import(&[drop.path().join("Dropped Folder"), drop.path().join("loose.stl")]);
    assert_eq!(items.len(), 2);
    let report = engine
        .execute_import(
            &ImportRequest {
                root_id: root.id.clone(),
                archive_policy: ArchivePolicy::Keep,
                items: items
                    .iter()
                    .map(|i| ImportRequestItem {
                        source: i.source.clone(),
                        action: i.action,
                        name: i.name.clone(),
                    })
                    .collect(),
            },
            |_| {},
        )
        .unwrap();
    assert_eq!(report.projects, vec!["Dropped Folder"]);
    assert_eq!(report.inbox_files, 1);
    // the root was rescanned: the new project is listed, the inbox is not a project
    let list = engine.list_projects(&ListQuery::default()).unwrap();
    let mut names: Vec<_> = list.iter().map(|p| p.rel_path.as_str()).collect();
    names.sort();
    assert_eq!(names, vec!["Dropped Folder", "Existing"]);
    assert_eq!(engine.list_inbox(&root.id).unwrap().len(), 1);
    let promoted = engine.promote_inbox(&root.id, &["loose.stl".into()], "From Inbox").unwrap();
    assert_eq!(promoted.rel_path, "From Inbox");
    assert_eq!(promoted.model_count, 1);
    assert!(engine.list_inbox(&root.id).unwrap().is_empty());
    assert_eq!(engine.list_projects(&ListQuery::default()).unwrap().len(), 3);

    // collections: membership, manual order, rename and delete keep references straight
    let c = engine.create_collection("Desk").unwrap();
    let existing = format!("{}:Existing", root.id);
    engine.add_to_collection(&c.id, &[promoted.id.clone(), existing.clone()]).unwrap();
    let q = ListQuery {
        collection_id: Some(c.id.clone()),
        sort: SortKey::Collection,
        ..Default::default()
    };
    let members = engine.list_projects(&q).unwrap();
    assert_eq!(
        members.iter().map(|p| p.rel_path.as_str()).collect::<Vec<_>>(),
        vec!["From Inbox", "Existing"]
    );
    engine.reorder_collection(&c.id, &[existing.clone(), promoted.id.clone()]).unwrap();
    assert_eq!(engine.list_projects(&q).unwrap()[0].rel_path, "Existing");
    let renamed = engine.rename_project(&promoted.id, "Inbox Thing").unwrap();
    assert!(engine.collections()[0].projects.contains(&renamed.id));
    engine.delete_project(&renamed.id).unwrap();
    assert_eq!(engine.collections()[0].projects, vec![existing.clone()]);
    let smart = engine
        .create_smart_collection(
            "Everything",
            ListQuery {
                text: Some("exist".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(engine.list_smart_collection(&smart.id, None).unwrap().len(), 1);
    assert!(matches!(
        engine.list_projects(&ListQuery {
            collection_id: Some("nope".into()),
            ..Default::default()
        }),
        Err(EngineError::ProjectNotFound(_))
    ));
}

#[test]
fn scan_status_and_creator_filter() {
    let data = tempfile::tempdir().unwrap();
    let lib = tempfile::tempdir().unwrap();
    touch(&lib.path().join("A/a.stl"), 10);
    touch(&lib.path().join("B/b.stl"), 10);
    fs::write(lib.path().join("B/project.yaml"), "metadata:\n  creator: Lena Hofer\n").unwrap();
    fs::write(lib.path().join("A/project.yaml"), "metadata: [broken").unwrap();
    let mut engine = Engine::open(data.path()).unwrap();
    let root = engine.add_root(lib.path(), SyncMode::Manual).unwrap();
    engine.scan_root_as(&root.id, "startup", |_| {}).unwrap();
    let r = engine.root(&root.id).unwrap();
    let s = r.last_scan.expect("summary recorded");
    assert_eq!((s.projects, s.files, s.trigger.as_str()), (2, 2, "startup"));
    assert_eq!(s.warning_count, 1, "{:?}", s.warnings);
    assert!(r.last_error.is_none());
    engine.set_root_error(&root.id, "cannot watch").unwrap();
    assert_eq!(engine.root(&root.id).unwrap().last_error.as_deref(), Some("cannot watch"));
    engine.scan_root(&root.id, |_| {}).unwrap();
    assert!(engine.root(&root.id).unwrap().last_error.is_none(), "a good scan clears the error");
    let by_creator = engine
        .list_projects(&ListQuery {
            creator: Some("lena hofer".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(by_creator.len(), 1);
    assert_eq!(by_creator[0].rel_path, "B");
    // persisted across reopen
    drop(engine);
    let engine = Engine::open(data.path()).unwrap();
    assert!(engine.root(&root.id).unwrap().last_scan.is_some());
}
