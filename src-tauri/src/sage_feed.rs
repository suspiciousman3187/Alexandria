use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Bidirectional link to Sage's master-overlay feed server. Sage is a pure display + relay; Alexandria owns
// every setting. So this socket:
//   * SENDS Alexandria-owned data up to Sage for display -- AH prices (t:"poolprice") and pool settings
//     state (t:"poolsettings": drop-list membership, per-character auto-lot/pass rules, price-display mode),
//   * READS command lines back down -- the overlay's ... menu clicks, relayed by Sage's host -- and emits
//     each as the "sage-command" Tauri event so the desktop applies it to its OWN stores, then re-tees.
// When Sage is not running the loopback connect is refused and the thread just retries with backoff.
const SAGE_ADDR: &str = "127.0.0.1:2027";

fn sender() -> &'static Mutex<Option<mpsc::Sender<String>>> {
    static T: OnceLock<Mutex<Option<mpsc::Sender<String>>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(None))
}

fn enqueue(line: String) {
    if let Ok(g) = sender().lock() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(line);
        }
    }
}

// Start the background connection thread once, at Tauri setup, capturing the AppHandle for event emission.
pub fn start(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<String>();
    if let Ok(mut g) = sender().lock() {
        *g = Some(tx);
    }
    std::thread::spawn(move || {
        let addr: std::net::SocketAddr = match SAGE_ADDR.parse() {
            Ok(a) => a,
            Err(_) => return,
        };
        loop {
            let stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
                Ok(s) => s,
                Err(_) => {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };
            let mut writer = match stream.try_clone() {
                Ok(w) => w,
                Err(_) => {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };
            let _ = writer.write_all(b"{\"t\":\"hello\",\"app\":\"alexandria\"}\n");

            // Reader thread: emit every inbound command line for the desktop to handle.
            let read_stream = match stream.try_clone() {
                Ok(s) => s,
                Err(_) => continue,
            };
            let rapp = app.clone();
            let reader = std::thread::spawn(move || {
                let mut br = BufReader::new(read_stream);
                let mut line = String::new();
                loop {
                    line.clear();
                    match br.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let l = line.trim();
                            if !l.is_empty() {
                                let _ = rapp.emit("sage-command", l.to_string());
                            }
                        }
                    }
                }
            });

            // Writer loop on this thread: drain the outgoing queue; break when the socket dies.
            loop {
                match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(msg) => {
                        if writer.write_all(msg.as_bytes()).is_err() {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if reader.is_finished() {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let _ = reader.join();
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

#[derive(serde::Deserialize)]
pub struct PriceIn {
    pub id: u32,
    #[serde(default)]
    pub median: i64,
    #[serde(default)]
    pub listed: i64,
    #[serde(default)]
    pub smedian: i64,
    #[serde(default)]
    pub slisted: i64,
}

#[tauri::command]
pub fn sage_pool_prices(prices: Vec<PriceIn>) {
    if prices.is_empty() {
        return;
    }
    let mut parts = String::new();
    for (i, p) in prices.iter().enumerate() {
        if i > 0 {
            parts.push(',');
        }
        parts.push_str(&format!(
            "{{\"id\":{},\"median\":{},\"listed\":{},\"smedian\":{},\"slisted\":{}}}",
            p.id, p.median, p.listed, p.smedian, p.slisted
        ));
    }
    enqueue(format!("{{\"t\":\"poolprice\",\"prices\":[{}]}}\n", parts));
}

// Forward a pre-built JSON line (e.g. t:"poolsettings") to Sage as-is.
#[tauri::command]
pub fn sage_send(line: String) {
    let mut l = line;
    if !l.ends_with('\n') {
        l.push('\n');
    }
    enqueue(l);
}
