//! Cheap inspection of 3MF files. A 3MF is a zip; reading its central directory tells us
//! whether a slicer wrote it and whether it carries an embedded preview image, without
//! touching the geometry. Geometry is parsed in the frontend (worker) for the viewer.

use crate::error::{io_err, Result};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ThreeMfInfo {
    /// Human-readable slicer name when the archive carries slicer project files.
    pub slicer: Option<String>,
    /// Zip entry name of the embedded preview image (PNG), if any.
    pub thumbnail_entry: Option<String>,
}

const THUMB_CANDIDATES: &[&str] = &[
    "Metadata/thumbnail.png",
    "Metadata/plate_1.png",
    "Metadata/Thumbnail.png",
    "Thumbnails/thumbnail.png",
];

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
    ThreeMfInfo { slicer, thumbnail_entry }
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
    fn garbage_is_an_error_not_a_panic() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("bad.3mf");
        std::fs::write(&p, b"not a zip").unwrap();
        assert!(inspect(&p).is_err());
    }
}
