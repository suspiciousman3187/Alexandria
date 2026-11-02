use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

mod ahsearch;
mod sage_feed;

const BOX_PORT: u16 = 24233;
static CONN_SEQ: AtomicU64 = AtomicU64::new(1);
static IPC_BOUND: AtomicBool = AtomicBool::new(false);
static USER_QUITTING: AtomicBool = AtomicBool::new(false);
// "Show Only Over FFXI": auto-hide the Treasure Pool overlay unless FFXI
// (pol.exe) or this app is the foreground window. Default off (opt-in).
static POOL_FOCUS_FOLLOW: AtomicBool = AtomicBool::new(false);
static FOCUS_WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn conns() -> &'static Mutex<HashMap<u64, TcpStream>> {
    static C: OnceLock<Mutex<HashMap<u64, TcpStream>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(serde::Serialize)]
struct AddonInstallResult {
    installed_version: String,
    files_written: usize,
    files_skipped: usize,
    skipped_examples: Vec<String>,
    addon_dir: String,
}

fn read_addon_version(addon_dir: &Path) -> Option<String> {
    let main = addon_dir.join("Alexandria.lua");
    let content = fs::read_to_string(&main).ok()?;
    for line in content.lines().take(40) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("_addon.version") {
            let after_eq = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
            let v = after_eq.trim_matches(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == ',' || c == ';');
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

#[tauri::command]
fn read_installed_addon_version(addon_dir: String) -> Result<Option<String>, String> {
    let p = Path::new(&addon_dir);
    if !p.is_dir() {
        return Err(format!("not a directory: {}", addon_dir));
    }
    Ok(read_addon_version(p))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(64);
    for b in out.iter() {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn should_skip_addon_path(rel: &str) -> bool {
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with("data/") || normalized == "data" {
        return true;
    }
    if normalized.starts_with("../") || normalized.contains("/../") {
        return true;
    }
    let lower = normalized.to_lowercase();
    if lower.contains("config") && lower.ends_with(".json") {
        return true;
    }
    false
}

#[tauri::command]
fn install_addon_update(
    addon_dir: String,
    url: String,
    expected_sha256: Option<String>,
) -> Result<AddonInstallResult, String> {
    use std::io::Read;
    let target = Path::new(&addon_dir);
    if !target.is_dir() {
        return Err(format!("addon dir does not exist: {}", addon_dir));
    }
    let existing_main = target.join("Alexandria.lua");
    if !existing_main.is_file() {
        return Err(format!(
            "Alexandria.lua not found in {} — point at the addon folder",
            addon_dir
        ));
    }

    let resp = ureq::get(&url).call().map_err(|e| format!("download failed: {e}"))?;
    let mut bytes: Vec<u8> = Vec::new();
    resp.into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read failed: {e}"))?;
    if bytes.is_empty() {
        return Err("downloaded zero bytes".to_string());
    }

    if let Some(want) = expected_sha256.as_deref() {
        if !want.is_empty() {
            let got = sha256_hex(&bytes);
            if !got.eq_ignore_ascii_case(want) {
                return Err(format!("sha256 mismatch — got {got}, expected {want}"));
            }
        }
    }

    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("not a valid zip: {e}"))?;

    let mut has_main = false;
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let name = f.name();
        if name == "Alexandria.lua" || name.ends_with("/Alexandria.lua") {
            has_main = true;
        }
    }
    if !has_main {
        return Err("zip does not contain Alexandria.lua at the root — refusing to install".to_string());
    }

    let mut files_written = 0usize;
    let mut files_skipped = 0usize;
    let mut skipped_examples: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }
        let rel = raw_name.trim_start_matches("./").to_string();
        if should_skip_addon_path(&rel) {
            files_skipped += 1;
            if skipped_examples.len() < 5 {
                skipped_examples.push(rel.clone());
            }
            continue;
        }
        let out_path = target.join(&rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
        let mut buf: Vec<u8> = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| format!("read {}: {}", rel, e))?;
        if let Ok(existing) = fs::read(&out_path) {
            if existing == buf {
                files_skipped += 1;
                continue;
            }
        }
        let tmp_path = out_path.with_extension("tmp_update");
        fs::write(&tmp_path, &buf).map_err(|e| format!("write tmp {}: {}", tmp_path.display(), e))?;
        if out_path.exists() && fs::remove_file(&out_path).is_err() {
            let aside = out_path.with_extension("old_update");
            let _ = fs::remove_file(&aside);
            fs::rename(&out_path, &aside).map_err(|_| {
                format!(
                    "{} is in use and could not be replaced. Unload the addon in Windower (//lua unload Alexandria), install the update, then reload it.",
                    out_path.display()
                )
            })?;
        }
        fs::rename(&tmp_path, &out_path)
            .map_err(|e| format!("rename {} -> {}: {}", tmp_path.display(), out_path.display(), e))?;
        files_written += 1;
    }

    let installed_version = read_addon_version(target).unwrap_or_else(|| "unknown".to_string());
    Ok(AddonInstallResult {
        installed_version,
        files_written,
        files_skipped,
        skipped_examples,
        addon_dir: addon_dir.clone(),
    })
}

#[derive(Clone, serde::Serialize)]
struct BoxMsg {
    conn: u64,
    line: String,
}

fn start_box_server(app: AppHandle) {
    std::thread::spawn(move || loop {
        let listener = match TcpListener::bind(("127.0.0.1", BOX_PORT)) {
            Ok(l) => l,
            Err(e) => {
                log::warn!("[alex] box server could not bind 127.0.0.1:{BOX_PORT}: {e}; retrying");
                IPC_BOUND.store(false, Ordering::Relaxed);
                std::thread::sleep(std::time::Duration::from_secs(3));
                continue;
            }
        };
        IPC_BOUND.store(true, Ordering::Relaxed);
        log::info!("[alex] box server listening on 127.0.0.1:{BOX_PORT}");
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                let conn = CONN_SEQ.fetch_add(1, Ordering::Relaxed);
                if let Ok(w) = stream.try_clone() {
                    if let Ok(mut map) = conns().lock() {
                        map.insert(conn, w);
                    }
                }
                let reader = BufReader::new(stream);
                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => {
                            let _ = app.emit("alexandria://box-msg", BoxMsg { conn, line });
                        }
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                if let Ok(mut map) = conns().lock() {
                    map.remove(&conn);
                }
                let _ = app.emit("alexandria://box-gone", conn);
            });
        }
        IPC_BOUND.store(false, Ordering::Relaxed);
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

#[tauri::command]
fn send_box_command(conn: u64, line: String) -> Result<(), String> {
    let mut map = conns().lock().map_err(|e| e.to_string())?;
    let stream = map.get_mut(&conn).ok_or_else(|| format!("no connection {conn}"))?;
    let mut payload = line.into_bytes();
    payload.push(b'\n');
    stream.write_all(&payload).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn broadcast_box_command(line: String) -> Result<u32, String> {
    let mut map = conns().lock().map_err(|e| e.to_string())?;
    let mut payload = line.into_bytes();
    payload.push(b'\n');
    let mut sent = 0u32;
    for stream in map.values_mut() {
        if stream.write_all(&payload).and_then(|_| stream.flush()).is_ok() {
            sent += 1;
        }
    }
    Ok(sent)
}

#[tauri::command]
fn ipc_bound() -> bool {
    IPC_BOUND.load(Ordering::Relaxed)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let rd = match fs::read_dir(&path) {
        Ok(r) => r,
        Err(_) => return Ok(out),
    };
    for e in rd.flatten() {
        if e.path().is_file() {
            if let Some(s) = e.path().to_str() {
                out.push(s.to_string());
            }
        }
    }
    Ok(out)
}

fn join_redirect(base: &str, loc: &str, orig_query: Option<&str>) -> Option<String> {
    let mut next = if loc.starts_with("https://") {
        loc.to_string()
    } else if loc.starts_with('/') {
        let scheme_end = base.find("://")? + 3;
        let host_end = base[scheme_end..]
            .find('/')
            .map(|i| scheme_end + i)
            .unwrap_or(base.len());
        format!("{}{}", &base[..host_end], loc)
    } else {
        return None;
    };
    // Carry the original query (e.g. ?stack=0) onto canonical redirect targets
    // that drop it, otherwise FFXIAH single/stack pricing collapses to one view.
    if !next.contains('?') {
        if let Some(q) = orig_query {
            next.push('?');
            next.push_str(q);
        }
    }
    Some(next)
}

#[tauri::command]
async fn http_get(url: String, cookie: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || http_get_blocking(url, cookie))
        .await
        .map_err(|e| format!("request task failed: {e}"))?
}

fn http_get_blocking(url: String, cookie: Option<String>) -> Result<String, String> {
    use std::io::Read;
    if !url.starts_with("https://") {
        return Err("only https urls are allowed".into());
    }
    // Follow redirects by hand so the Cookie header rides along on every hop.
    // ureq drops manually-set headers across a redirect, which silently stripped
    // the FFXIAH `sid` cookie on its /item -> /item/<slug> canonical bounce and
    // pinned every lookup to the default server.
    let agent = ureq::builder().redirects(0).build();
    let cookie = cookie.filter(|c| !c.is_empty());
    let orig_query = url.split_once('?').map(|(_, q)| q.to_string());
    let mut current = url;
    let mut hops = 0;
    loop {
        let mut req = agent.get(&current).set("User-Agent", "Mozilla/5.0 Alexandria");
        if let Some(c) = cookie.as_deref() {
            req = req.set("Cookie", c);
        }
        let resp = req.call().map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        if (300..400).contains(&status) {
            hops += 1;
            if hops > 5 {
                return Err("too many redirects".into());
            }
            let loc = resp.header("Location").ok_or("redirect without location")?;
            let next = join_redirect(&current, loc, orig_query.as_deref())
                .ok_or("unsupported redirect target")?;
            if !next.starts_with("https://") {
                return Err("redirect to non-https url".into());
            }
            current = next;
            continue;
        }
        let mut body = String::new();
        resp.into_reader()
            .take(8 * 1024 * 1024)
            .read_to_string(&mut body)
            .map_err(|e| format!("read failed: {e}"))?;
        return Ok(body);
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) urls are allowed".into());
    }
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = recreate_main_window(&app);
    }
}

fn recreate_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let url = WebviewUrl::App("index.html".into());
    let w = WebviewWindowBuilder::new(app, "main", url)
        .title("Alexandria")
        .inner_size(1280.0, 860.0)
        .visible(true)
        .resizable(true)
        .decorations(false)
        .build()?;
    let _ = w.set_icon(tauri::include_image!("icons/taskbar.png"));
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn destroy_main_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    use tauri::Manager;
    USER_QUITTING.store(true, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    } else {
        app.exit(0);
    }
}

#[cfg(target_os = "windows")]
fn setup_tray(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_item = MenuItemBuilder::with_id("tray_show", "Show Alexandria").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build()?;

    let _tray = TrayIconBuilder::with_id("main_tray")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default_window_icon".into())
        })?)
        .tooltip("Alexandria")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => show_main_window(app.clone()),
            "tray_quit" => quit_app(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn setup_tray(_app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ── "Show Only Over FFXI" (focus-follow) ────────────────────────────────────
// True when the foreground window belongs to FFXI (pol.exe) or to this app.
#[cfg(windows)]
fn foreground_is_game_or_self() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return false;
        }
        if pid == std::process::id() {
            return true;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return false;
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        let base = full.rsplit(|c| c == '\\' || c == '/').next().unwrap_or("");
        base.eq_ignore_ascii_case("pol.exe")
    }
}

#[cfg(not(windows))]
fn foreground_is_game_or_self() -> bool {
    true
}

// Polls the foreground every 250ms and hides/shows the pool overlay when
// focus-follow is on. Only toggles visibility it changed itself, so it never
// fights the user's own close/minimize.
fn start_focus_watcher(app: tauri::AppHandle) {
    use tauri::Manager;
    if FOCUS_WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut hidden_by_ff = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let win = match app.get_webview_window("pool") {
                Some(w) => w,
                None => {
                    hidden_by_ff = false;
                    continue;
                }
            };
            if !POOL_FOCUS_FOLLOW.load(Ordering::Relaxed) {
                if hidden_by_ff {
                    let w = win.clone();
                    let _ = app.run_on_main_thread(move || { let _ = w.show(); });
                    hidden_by_ff = false;
                }
                continue;
            }
            let over = foreground_is_game_or_self();
            if over && hidden_by_ff {
                let w = win.clone();
                let _ = app.run_on_main_thread(move || { let _ = w.show(); });
                hidden_by_ff = false;
            } else if !over && !hidden_by_ff {
                if win.is_visible().unwrap_or(false) {
                    let w = win.clone();
                    let _ = app.run_on_main_thread(move || { let _ = w.hide(); });
                    hidden_by_ff = true;
                }
            }
        }
    });
}

#[tauri::command]
fn set_pool_focus_follow(enabled: bool) {
    POOL_FOCUS_FOLLOW.store(enabled, Ordering::Relaxed);
}

pub fn run() {
    let builder = tauri::Builder::default();
    // Single-instance guard (release only, so a dev window can still run alongside a release build).
    // Only the first instance can bind the box server port :24233; extra launches would spin forever in
    // the bind-retry loop with a window that never connects (the "opened it 4 times, none connect" report).
    // A second launch now just focuses the running window instead of opening a dead one. Must be registered
    // before the other plugins.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            let _ = recreate_main_window(app);
        }
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            start_box_server(app.handle().clone());
            sage_feed::start(app.handle().clone());
            start_focus_watcher(app.handle().clone());
            let _ = setup_tray(app.handle());
            // Force a high-res window icon. Tauri's default_window_icon resolves to a small (32px) source,
            // which Windows then upscales for the taskbar/alt-tab at higher DPI -> a blurry, mushy icon. Set
            // the window icon explicitly to the hi-res face so Windows downscales cleanly instead.
            {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_icon(tauri::include_image!("icons/taskbar.png"));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc_bound,
            read_text_file,
            write_text_file,
            delete_file,
            list_dir,
            open_url,
            show_main_window,
            destroy_main_window,
            quit_app,
            send_box_command,
            broadcast_box_command,
            read_installed_addon_version,
            install_addon_update,
            http_get,
            ahsearch::ah_history,
            ahsearch::ah_category,
            sage_feed::sage_pool_prices,
            sage_feed::sage_send,
            set_pool_focus_follow,
        ])
        .on_window_event(|window, event| {
            // When the MAIN window is destroyed, tear down the pop-out Pool/Gearsets windows too, so closing
            // Alexandria never leaves an orphan overlay lingering on screen (it can't be closed and keeps the
            // process alive). A hide-to-tray uses hide(), not destroy, so this only fires on a real close.
            use tauri::Manager;
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                for label in ["pool", "gearsets"] {
                    if let Some(w) = app.get_webview_window(label) { let _ = w.destroy(); }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
