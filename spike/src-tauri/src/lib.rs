//! Spike backend: a handful of commands that exercise exactly the things the
//! My Meshes engine will need from the shell (see docs/decisions/0001-tech-stack.md).
//!
//! - `generate_test_stl`: writes a synthetic binary STL of N triangles (50 MB at 1M).
//! - `read_file`: streams a file to the webview as a raw IPC response (no JSON, no base64).
//! - `write_thumbnail`: receives raw PNG bytes from the webview and writes them to the cache dir.
//! - `list_thumbnails` / `clear_thumbnails`: disk-side assertions for the E2E test.
//! - `scan_and_hash`: walks a directory and SHA-256-hashes every file in parallel (rayon).
//! - `system_info`: OS, arch, webview version, CPU count.

use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufWriter, Read, Write},
    path::PathBuf,
    time::Instant,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager,
};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn spike_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_cache_dir().map_err(err)?.join("spike");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[derive(Serialize)]
pub struct GenResult {
    path: String,
    bytes: u64,
    triangles: u32,
    millis: u128,
}

/// Height-field surface: an n×n grid of quads, two triangles each. 1,000,000 triangles
/// ≈ 50,000,084 bytes, which is the "50 MB STL" the spike protocol asks for.
#[tauri::command]
fn generate_test_stl(app: AppHandle, triangles: u32) -> CmdResult<GenResult> {
    let n = ((triangles.max(2) as f64 / 2.0).sqrt().ceil()) as u32;
    let tri_count = 2 * n * n;
    let path = spike_dir(&app)?.join(format!("test_{}k_tris.stl", tri_count / 1000));
    let t = Instant::now();
    let file = fs::File::create(&path).map_err(err)?;
    let mut w = BufWriter::with_capacity(1 << 20, file);
    w.write_all(&[0u8; 80]).map_err(err)?;
    w.write_all(&tri_count.to_le_bytes()).map_err(err)?;

    let size = 120.0f32;
    let step = size / n as f32;
    let height = |x: f32, y: f32| -> f32 {
        6.0 * (x * 0.12).sin() * (y * 0.12).cos() + 2.0 * (x * 0.5 + y * 0.3).sin() + 1.0 * (y * 0.9).cos()
    };
    let mut write_tri = |a: [f32; 3], b: [f32; 3], c: [f32; 3]| -> std::io::Result<()> {
        let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let mut nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        let len = (nrm[0] * nrm[0] + nrm[1] * nrm[1] + nrm[2] * nrm[2]).sqrt().max(1e-9);
        nrm.iter_mut().for_each(|c| *c /= len);
        let mut buf = [0u8; 50];
        let mut o = 0;
        for f in nrm.iter().chain(a.iter()).chain(b.iter()).chain(c.iter()) {
            buf[o..o + 4].copy_from_slice(&f.to_le_bytes());
            o += 4;
        }
        w.write_all(&buf)
    };
    for j in 0..n {
        for i in 0..n {
            let x0 = i as f32 * step - size / 2.0;
            let x1 = x0 + step;
            let y0 = j as f32 * step - size / 2.0;
            let y1 = y0 + step;
            let p00 = [x0, y0, height(x0, y0)];
            let p10 = [x1, y0, height(x1, y0)];
            let p01 = [x0, y1, height(x0, y1)];
            let p11 = [x1, y1, height(x1, y1)];
            write_tri(p00, p10, p11).map_err(err)?;
            write_tri(p00, p11, p01).map_err(err)?;
        }
    }
    w.flush().map_err(err)?;
    let bytes = fs::metadata(&path).map_err(err)?.len();
    Ok(GenResult { path: path.to_string_lossy().into_owned(), bytes, triangles: tri_count, millis: t.elapsed().as_millis() })
}

/// Raw binary IPC response: the webview gets an ArrayBuffer, no JSON encoding of 50 MB.
#[tauri::command]
fn read_file(path: String) -> CmdResult<Response> {
    let bytes = fs::read(&path).map_err(err)?;
    Ok(Response::new(bytes))
}

#[derive(Serialize)]
pub struct WriteResult {
    path: String,
    bytes: usize,
}

/// Raw binary IPC request: the webview sends PNG bytes as the body, the name in a header.
#[tauri::command]
fn write_thumbnail(app: AppHandle, request: Request<'_>) -> CmdResult<WriteResult> {
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect::<String>())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "thumb".to_string());
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw binary body".into());
    };
    let dir = spike_dir(&app)?.join("thumbs");
    fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("{name}.png"));
    let tmp = dir.join(format!("{name}.png.tmp"));
    fs::write(&tmp, bytes).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)?; // atomic replace, same rule as project.yaml later
    Ok(WriteResult { path: path.to_string_lossy().into_owned(), bytes: bytes.len() })
}

#[derive(Serialize)]
pub struct ThumbList {
    dir: String,
    count: usize,
    bytes: u64,
    files: Vec<String>,
}

#[tauri::command]
fn list_thumbnails(app: AppHandle) -> CmdResult<ThumbList> {
    let dir = spike_dir(&app)?.join("thumbs");
    let mut files = Vec::new();
    let mut bytes = 0u64;
    if dir.exists() {
        for e in fs::read_dir(&dir).map_err(err)? {
            let e = e.map_err(err)?;
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("png") {
                bytes += e.metadata().map_err(err)?.len();
                files.push(p.file_name().unwrap().to_string_lossy().into_owned());
            }
        }
    }
    files.sort();
    Ok(ThumbList { dir: dir.to_string_lossy().into_owned(), count: files.len(), bytes, files })
}

#[tauri::command]
fn clear_thumbnails(app: AppHandle) -> CmdResult<()> {
    let dir = spike_dir(&app)?.join("thumbs");
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(err)?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct HashResult {
    files: usize,
    bytes: u64,
    millis: u128,
    mb_per_s: f64,
    threads: usize,
    sample: Vec<(String, String)>,
}

/// The engine's duplicate-detection workload: walk, then hash every file on all cores.
#[tauri::command]
async fn scan_and_hash(path: String) -> CmdResult<HashResult> {
    let t = Instant::now();
    let files: Vec<PathBuf> = walkdir::WalkDir::new(&path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .collect();
    let hashed: Vec<(String, String, u64)> = files
        .par_iter()
        .filter_map(|p| {
            let mut f = fs::File::open(p).ok()?;
            let mut hasher = Sha256::new();
            let mut buf = vec![0u8; 1 << 20];
            let mut total = 0u64;
            loop {
                let n = f.read(&mut buf).ok()?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                total += n as u64;
            }
            Some((p.to_string_lossy().into_owned(), format!("{:x}", hasher.finalize()), total))
        })
        .collect();
    let bytes: u64 = hashed.iter().map(|h| h.2).sum();
    let millis = t.elapsed().as_millis();
    let mb_per_s = if millis > 0 { bytes as f64 / 1e6 / (millis as f64 / 1000.0) } else { 0.0 };
    Ok(HashResult {
        files: hashed.len(),
        bytes,
        millis,
        mb_per_s,
        threads: rayon::current_num_threads(),
        sample: hashed.iter().take(5).map(|h| (h.0.clone(), h.1[..16].to_string())).collect(),
    })
}

#[derive(Serialize)]
pub struct SystemInfo {
    os: String,
    arch: String,
    webview: String,
    cpus: usize,
    cache_dir: String,
    e2e_feature: bool,
}

#[tauri::command]
fn system_info(app: AppHandle) -> CmdResult<SystemInfo> {
    Ok(SystemInfo {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        cache_dir: spike_dir(&app)?.to_string_lossy().into_owned(),
        e2e_feature: cfg!(feature = "e2e"),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    // WebdriverIO support (execute API + embedded WebDriver server). Only in `--features e2e` builds.
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            generate_test_stl,
            read_file,
            write_thumbnail,
            list_thumbnails,
            clear_thumbnails,
            scan_and_hash,
            system_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
