//! Content hashing for duplicate detection (phase 2) and change detection.
use crate::error::{io_err, Result};
use rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = std::fs::File::open(path).map_err(io_err(path))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(io_err(path))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Hash many files on all cores. Errors are returned per file, not fatal for the batch.
pub fn sha256_many(paths: &[PathBuf]) -> Vec<(PathBuf, Result<String>)> {
    paths.par_iter().map(|p| (p.clone(), sha256_file(p))).collect()
}
