//! Cheap inspection of 3MF files. A 3MF is a zip; reading its central directory tells us
//! whether a slicer wrote it and whether it carries an embedded preview image, without
//! touching the geometry. Geometry is parsed in the frontend (worker) for the viewer.

use crate::error::{io_err, EngineError, Result};
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThreeMfInfo {
    /// Human-readable slicer name when the archive carries slicer project files.
    pub slicer: Option<String>,
    /// Zip entry name of the embedded preview image (PNG), if any.
    pub thumbnail_entry: Option<String>,
    /// The picture that shows this file rather than the model page: the slicer's rendering
    /// of the first plate where there is one, else the same entry as `thumbnail_entry`.
    pub plate_entry: Option<String>,
}

// Bambu Studio projects from MakerWorld carry the model page's cover photo (680 x 510, and a
// 240 x 180 copy); it comes before the slicer's rendering of the first plate.
const THUMB_CANDIDATES: &[&str] = &[
    "Auxiliaries/.thumbnails/thumbnail_middle.png",
    "Auxiliaries/.thumbnails/thumbnail_3mf.png",
    "Metadata/thumbnail.png",
    "Metadata/plate_1.png",
    "Metadata/Thumbnail.png",
    "Thumbnails/thumbnail.png",
];

// For the preview of one file among several (VIEW-8) the order is the other way round: the
// slicer's rendering shows what is in the file, the cover photo is the same for all of them.
const PLATE_CANDIDATES: &[&str] = &[
    "Metadata/plate_1.png",
    "Metadata/thumbnail.png",
    "Metadata/Thumbnail.png",
    "Thumbnails/thumbnail.png",
];

/// Where Bambu Studio keeps the photos of the model page (MakerWorld downloads).
const PICTURES_DIR: &str = "Auxiliaries/Model Pictures/";
const PICTURE_MAX: u64 = 32 << 20;

/// A photo stored inside a 3MF: shown in the project's gallery, never unpacked to disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EmbeddedPicture {
    /// The 3MF, relative to the project directory.
    pub file: String,
    /// Zip entry name inside it.
    pub entry: String,
    pub name: String,
    pub size: u64,
}

fn picture_name(entry: &str) -> Option<&str> {
    let name = entry.strip_prefix(PICTURES_DIR)?;
    let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
    (!name.contains(['/', '\\']) && matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp")).then_some(name)
}

/// The model pictures of one archive, in archive order. Reads the central directory only.
pub fn pictures(path: &Path, rel: &str) -> Result<Vec<EmbeddedPicture>> {
    let mut archive = open(path)?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let Ok(f) = archive.by_index_raw(i) else { continue };
        let Ok(entry) = f.name() else { continue };
        if let Some(name) = picture_name(&entry) {
            out.push(EmbeddedPicture {
                file: rel.to_string(),
                entry: entry.to_string(),
                name: name.to_string(),
                size: f.size(),
            });
        }
    }
    Ok(out)
}

/// The pictures of several archives; one that cannot be read contributes nothing.
pub fn pictures_of(files: &[(String, std::path::PathBuf)]) -> Vec<EmbeddedPicture> {
    files
        .iter()
        .flat_map(|(rel, path)| pictures(path, rel).unwrap_or_default())
        .collect()
}

/// Bytes of one model picture. Only entries `pictures` would list can be read this way.
pub fn read_picture(path: &Path, entry: &str) -> Result<Vec<u8>> {
    if picture_name(entry).is_none() {
        return Err(EngineError::NotAllowed(format!("{entry} is not a model picture")));
    }
    let mut archive = open(path)?;
    let file = archive.by_name(entry).map_err(|e| EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::NotFound, format!("{entry}: {e}")),
    })?;
    let mut out = Vec::new();
    file.take(PICTURE_MAX + 1).read_to_end(&mut out).map_err(io_err(path))?;
    if out.len() as u64 > PICTURE_MAX {
        return Err(EngineError::NotAllowed(format!("{entry} is larger than 32 MiB")));
    }
    Ok(out)
}

fn open(path: &Path) -> Result<zip::ZipArchive<File>> {
    let f = File::open(path).map_err(io_err(path))?;
    zip::ZipArchive::new(f).map_err(|e| crate::error::EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()),
    })
}

/// Classifies the archive by its entry names. Never reads file contents.
pub fn inspect(path: &Path) -> Result<ThreeMfInfo> {
    let archive = open(path)?;
    let names: Vec<String> = archive.file_names().filter_map(|n| n.ok()).map(|n| n.into_owned()).collect();
    Ok(classify(&names))
}

pub fn classify(names: &[String]) -> ThreeMfInfo {
    let has = |n: &str| names.iter().any(|x| x == n);
    let has_prefix = |p: &str| names.iter().any(|x| x.starts_with(p));
    let slicer = if has("Metadata/Slic3r_PE.config") || has("Metadata/Prusa_Slicer_model.config") || has("Metadata/Slic3r_PE_model.config")
    {
        Some("PrusaSlicer".to_string())
    } else if has("Metadata/project_settings.config") || has("Metadata/slice_info.config") || has("Metadata/model_settings.config") {
        Some("Bambu Studio / OrcaSlicer".to_string())
    } else if has_prefix("Cura/") || has("Metadata/_rels/3dmodel.model.rels") && has_prefix("Cura") {
        Some("Cura".to_string())
    } else {
        None
    };
    let thumbnail_entry = THUMB_CANDIDATES.iter().find(|c| has(c)).map(|c| c.to_string()).or_else(|| {
        names
            .iter()
            .find(|n| n.to_ascii_lowercase().ends_with(".png") && n.to_ascii_lowercase().contains("thumb"))
            .cloned()
    });
    let plate_entry = PLATE_CANDIDATES
        .iter()
        .find(|c| has(c))
        .map(|c| c.to_string())
        .or_else(|| thumbnail_entry.clone());
    ThreeMfInfo {
        slicer,
        thumbnail_entry,
        plate_entry,
    }
}

/// Reads the first `max` bytes of an entry (the model XML can be huge; its metadata sits at
/// the top). Missing entry -> error.
pub fn read_entry_head(path: &Path, entry: &str, max: usize) -> Result<Vec<u8>> {
    let mut archive = open(path)?;
    let file = archive.by_name(entry).map_err(|e| crate::error::EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::NotFound, format!("{entry}: {e}")),
    })?;
    let mut out = Vec::new();
    file.take(max as u64).read_to_end(&mut out).map_err(io_err(path))?;
    Ok(out)
}

/// Reads one entry (the embedded preview) into memory. Capped at 8 MiB.
pub fn read_entry(path: &Path, entry: &str) -> Result<Vec<u8>> {
    let mut archive = open(path)?;
    let file = archive.by_name(entry).map_err(|e| crate::error::EngineError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::NotFound, format!("{entry}: {e}")),
    })?;
    let mut out = Vec::new();
    file.take(8 << 20).read_to_end(&mut out).map_err(io_err(path))?;
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    /// A 1x1 transparent PNG.
    pub const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63,
        0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xE2, 0x26, 0x05, 0x9B, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42,
        0x60, 0x82,
    ];

    pub const MODEL_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>
     <vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>
     <triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>
     <triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/><triangle v1="3" v2="0" v3="4"/><triangle v1="3" v2="4" v3="7"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>"#;

    /// Writes a minimal 3MF; `extra` entries let tests fake slicer markers and thumbnails.
    pub fn write_3mf(path: &Path, extra: &[(&str, &[u8])]) {
        let f = File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("[Content_Types].xml", opts).unwrap();
        w.write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/></Types>"#).unwrap();
        w.start_file("_rels/.rels", opts).unwrap();
        w.write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>"#).unwrap();
        w.start_file("3D/3dmodel.model", opts).unwrap();
        w.write_all(MODEL_XML.as_bytes()).unwrap();
        for (name, bytes) in extra {
            w.start_file(*name, opts).unwrap();
            w.write_all(bytes).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn classifies_plain_prusa_and_bambu() {
        let t = tempfile::tempdir().unwrap();
        let plain = t.path().join("plain.3mf");
        write_3mf(&plain, &[]);
        assert_eq!(inspect(&plain).unwrap(), ThreeMfInfo::default());

        let prusa = t.path().join("prusa.3mf");
        write_3mf(
            &prusa,
            &[
                ("Metadata/Slic3r_PE.config", b"; generated by PrusaSlicer"),
                ("Metadata/thumbnail.png", TINY_PNG),
            ],
        );
        let info = inspect(&prusa).unwrap();
        assert_eq!(info.slicer.as_deref(), Some("PrusaSlicer"));
        assert_eq!(info.thumbnail_entry.as_deref(), Some("Metadata/thumbnail.png"));
        assert_eq!(read_entry(&prusa, "Metadata/thumbnail.png").unwrap(), TINY_PNG);

        let bambu = t.path().join("bambu.3mf");
        write_3mf(
            &bambu,
            &[("Metadata/project_settings.config", b"{}"), ("Metadata/plate_1.png", TINY_PNG)],
        );
        let info = inspect(&bambu).unwrap();
        assert_eq!(info.slicer.as_deref(), Some("Bambu Studio / OrcaSlicer"));
        assert_eq!(info.thumbnail_entry.as_deref(), Some("Metadata/plate_1.png"));
    }

    #[test]
    fn makerworld_cover_photo_wins_over_the_plate_rendering() {
        // entry names of a real MakerWorld download
        let names = |list: &[&str]| list.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        let info = classify(&names(&[
            "Auxiliaries/Model Pictures/IMG_5973.webp",
            "Auxiliaries/.thumbnails/thumbnail_3mf.png",
            "Auxiliaries/.thumbnails/thumbnail_middle.png",
            "Auxiliaries/.thumbnails/thumbnail_small.png",
            "Metadata/project_settings.config",
            "Metadata/plate_1.png",
        ]));
        assert_eq!(info.slicer.as_deref(), Some("Bambu Studio / OrcaSlicer"));
        assert_eq!(
            info.thumbnail_entry.as_deref(),
            Some("Auxiliaries/.thumbnails/thumbnail_middle.png")
        );
        // the preview of the file itself is the slicer's rendering, not the page's photo
        assert_eq!(info.plate_entry.as_deref(), Some("Metadata/plate_1.png"));
        let cover_only = classify(&names(&["Auxiliaries/.thumbnails/thumbnail_3mf.png"]));
        assert_eq!(cover_only.plate_entry.as_deref(), Some("Auxiliaries/.thumbnails/thumbnail_3mf.png"));

        let small_only = classify(&names(&["Auxiliaries/.thumbnails/thumbnail_3mf.png", "Metadata/plate_1.png"]));
        assert_eq!(
            small_only.thumbnail_entry.as_deref(),
            Some("Auxiliaries/.thumbnails/thumbnail_3mf.png")
        );
    }

    #[test]
    fn model_pictures_are_listed_and_read_and_nothing_else_is() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("mw.3mf");
        write_3mf(
            &p,
            &[
                ("Auxiliaries/Model Pictures/IMG_5973.webp", b"webp-bytes"),
                ("Auxiliaries/Model Pictures/front.JPG", b"jpg"),
                ("Auxiliaries/Model Pictures/notes.txt", b"text"),
                ("Auxiliaries/Profile Pictures/print.webp", b"profile"),
                ("Auxiliaries/.thumbnails/thumbnail_middle.png", TINY_PNG),
                ("Metadata/plate_1.png", TINY_PNG),
            ],
        );
        let list = pictures(&p, "files/mw.3mf").unwrap();
        assert_eq!(
            list.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(),
            ["IMG_5973.webp", "front.JPG"]
        );
        assert_eq!(list[0].file, "files/mw.3mf");
        assert_eq!(list[0].entry, "Auxiliaries/Model Pictures/IMG_5973.webp");
        assert_eq!(list[0].size, 10);
        assert_eq!(read_picture(&p, &list[0].entry).unwrap(), b"webp-bytes");
        // other entries of the archive are not reachable through the picture reader
        assert!(read_picture(&p, "3D/3dmodel.model").is_err());
        assert!(read_picture(&p, "Metadata/plate_1.png").is_err());
        assert!(read_picture(&p, "Auxiliaries/Model Pictures/../../3D/3dmodel.model").is_err());
        assert!(read_picture(&p, "Auxiliaries/Model Pictures/missing.png").is_err());
        // a broken archive next to a good one does not hide the good one's pictures
        let bad = t.path().join("bad.3mf");
        std::fs::write(&bad, b"not a zip").unwrap();
        let all = pictures_of(&[("bad.3mf".into(), bad), ("mw.3mf".into(), p)]);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("bad.3mf");
        std::fs::write(&p, b"not a zip").unwrap();
        assert!(inspect(&p).is_err());
    }
}
