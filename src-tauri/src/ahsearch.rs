use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const IXFF: u32 = 0x4646_5849;
const PORT: u16 = 54002;
const KEY_SEED: [u8; 16] = [
    0x30, 0x73, 0x3D, 0x6D, 0x3C, 0x31, 0x49, 0x5A, 0x32, 0x7A, 0x42, 0x43, 0x63, 0x38, 0x7B, 0x7E,
];
static SUBKEY: &[u8] = include_bytes!("ahsearch_subkey.bin");

fn md5(b: &[u8]) -> [u8; 16] {
    md5::compute(b).0
}

struct Bf {
    p: [u32; 18],
    s: [u32; 1024],
}

fn load_ps() -> Bf {
    let mut p = [0u32; 18];
    let mut s = [0u32; 1024];
    for i in 0..18 {
        p[i] = u32::from_le_bytes(SUBKEY[i * 4..i * 4 + 4].try_into().unwrap());
    }
    for i in 0..1024 {
        let o = 72 + i * 4;
        s[i] = u32::from_le_bytes(SUBKEY[o..o + 4].try_into().unwrap());
    }
    Bf { p, s }
}

fn tt(x: u32, s: &[u32; 1024]) -> u32 {
    let a = (s[256 + ((x >> 8) & 0xFF) as usize] & 1) ^ 32;
    let b = (s[768 + ((x >> 24) & 0xFF) as usize] & 1) ^ 32;
    let c = s[512 + ((x >> 16) & 0xFF) as usize];
    let d = s[(x & 0xFF) as usize];
    a.wrapping_add(b).wrapping_add(c).wrapping_add(d)
}

fn encipher(mut xl: u32, mut xr: u32, bf: &Bf) -> (u32, u32) {
    for i in 0..16 {
        xl ^= bf.p[i];
        xr = tt(xl, &bf.s) ^ xr;
        std::mem::swap(&mut xl, &mut xr);
    }
    std::mem::swap(&mut xl, &mut xr);
    xr ^= bf.p[16];
    xl ^= bf.p[17];
    (xl, xr)
}

fn decipher(mut xl: u32, mut xr: u32, bf: &Bf) -> (u32, u32) {
    for i in (2..=17).rev() {
        xl ^= bf.p[i];
        xr = tt(xl, &bf.s) ^ xr;
        std::mem::swap(&mut xl, &mut xr);
    }
    std::mem::swap(&mut xl, &mut xr);
    xr ^= bf.p[1];
    xl ^= bf.p[0];
    (xl, xr)
}

fn blowfish_init(key: &[u8]) -> Bf {
    let mut bf = load_ps();
    let n = key.len();
    let mut j = 0usize;
    for i in 0..18 {
        let mut data: u32 = 0;
        for _ in 0..4 {
            let b = key[j] as i64;
            let sb = if b >= 128 { b - 256 } else { b };
            data = data.wrapping_shl(8) | (sb as u32);
            j += 1;
            if j >= n {
                j = 0;
            }
        }
        bf.p[i] ^= data;
    }
    let (mut dl, mut dr) = (0u32, 0u32);
    let mut i = 0;
    while i < 18 {
        let (l, r) = encipher(dl, dr, &bf);
        dl = l;
        dr = r;
        bf.p[i] = dl;
        bf.p[i + 1] = dr;
        i += 2;
    }
    for blk in 0..4 {
        let mut k = 0;
        while k < 256 {
            let (l, r) = encipher(dl, dr, &bf);
            dl = l;
            dr = r;
            bf.s[blk * 256 + k] = dl;
            bf.s[blk * 256 + k + 1] = dr;
            k += 2;
        }
    }
    bf
}

fn cipher_blocks(buf: &mut [u8], length: usize, bf: &Bf, decrypt: bool) {
    let mut tmp = (length - 12) / 4;
    tmp -= tmp % 2;
    let mut i = 0;
    while i < tmp {
        let o = 8 + i * 4;
        let xl = u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
        let xr = u32::from_le_bytes(buf[o + 4..o + 8].try_into().unwrap());
        let (nl, nr) = if decrypt {
            decipher(xl, xr, bf)
        } else {
            encipher(xl, xr, bf)
        };
        buf[o..o + 4].copy_from_slice(&nl.to_le_bytes());
        buf[o + 4..o + 8].copy_from_slice(&nr.to_le_bytes());
        i += 2;
    }
}

fn tail() -> [u8; 4] {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0x1122_3344);
    nanos.to_le_bytes()
}

fn connect(host: &str) -> Result<TcpStream, String> {
    let addr: std::net::SocketAddr = format!("{host}:{PORT}")
        .parse()
        .map_err(|_| format!("bad search-server address: {host}"))?;
    let s = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| format!("connect {host}: {e}"))?;
    s.set_read_timeout(Some(Duration::from_secs(8))).ok();
    Ok(s)
}

fn recv_packet(s: &mut TcpStream) -> Vec<u8> {
    let mut data = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match s.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                data.extend_from_slice(&chunk[..n]);
                if data.len() >= 2 {
                    let declared = u16::from_le_bytes([data[0], data[1]]) as usize;
                    if data.len() >= declared {
                        break;
                    }
                }
            }
            Err(_) => break,
        }
    }
    data
}

fn decode_name(raw: &[u8]) -> String {
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    raw[..end]
        .iter()
        .map(|&b| b as char)
        .collect::<String>()
        .trim()
        .to_string()
}

#[derive(serde::Serialize)]
pub struct AhSale {
    pub price: u32,
    pub date: u32,
    pub seller: String,
    pub buyer: String,
}

#[derive(serde::Serialize)]
pub struct AhHistory {
    pub item: u16,
    pub count: u32,
    pub cat: u16,
    pub sales: Vec<AhSale>,
}

#[derive(serde::Serialize)]
pub struct AhCatItem {
    pub id: u16,
    pub single: u32,
    pub stack: u32,
}

#[derive(serde::Serialize)]
pub struct AhCategory {
    pub total: u16,
    pub items: Vec<AhCatItem>,
}

fn build_history_request(item_id: u16, stack: bool, key_tail: [u8; 4]) -> Vec<u8> {
    let length = 268usize;
    let mut buf = vec![0u8; length];
    buf[0x00..0x02].copy_from_slice(&(length as u16).to_le_bytes());
    buf[0x04..0x08].copy_from_slice(&IXFF.to_le_bytes());
    buf[0x08..0x0A].copy_from_slice(&184u16.to_le_bytes());
    buf[0x0A] = 0x80;
    buf[0x0B] = if stack { 0x06 } else { 0x05 };
    buf[0x12..0x14].copy_from_slice(&item_id.to_le_bytes());
    buf[0x14] = 0x04;
    buf[0x15] = if stack { 1 } else { 0 };
    let h = md5(&buf[0x08..length - 0x14]);
    buf[length - 0x14..length - 0x04].copy_from_slice(&h);
    buf[length - 0x04..length].copy_from_slice(&key_tail);
    let mut seed = KEY_SEED.to_vec();
    seed.extend_from_slice(&key_tail);
    let bf = blowfish_init(&md5(&seed));
    cipher_blocks(&mut buf, length, &bf, false);
    buf
}

fn parse_history(data: &[u8]) -> Result<AhHistory, String> {
    if data.len() < 28 {
        return Err("short response".into());
    }
    let mut buf = data.to_vec();
    let length = u16::from_le_bytes([buf[0], buf[1]]) as usize;
    if length < 28 || length > buf.len() {
        return Err(format!("bad length {length}"));
    }
    let mut seed = KEY_SEED.to_vec();
    seed.extend_from_slice(&buf[length - 4..length]);
    seed.extend_from_slice(&[0u8; 4]);
    let bf = blowfish_init(&md5(&seed));
    cipher_blocks(&mut buf, length, &bf, true);
    if md5(&buf[8..length - 0x14]) != buf[length - 0x14..length - 0x04] {
        return Err("hash mismatch".into());
    }
    let typ = buf[0x0B] & 0x1F;
    if typ != 0x05 && typ != 0x06 {
        return Err(format!("unexpected type {:#x}", buf[0x0B]));
    }
    let item = u16::from_le_bytes([buf[0x18], buf[0x19]]);
    let count = u32::from_le_bytes([buf[0x1A], buf[0x1B], buf[0x1C], buf[0x1D]]);
    let cat = u16::from_le_bytes([buf[0x1E], buf[0x1F]]);
    let marker = u16::from_le_bytes([buf[0x08], buf[0x09]]) as usize;
    let nrec = if marker >= 0x20 { (marker - 0x20) / 40 } else { 0 };
    let mut sales = Vec::new();
    for i in 0..nrec {
        let o = 0x20 + 40 * i;
        if o + 40 > length - 0x14 {
            break;
        }
        sales.push(AhSale {
            price: u32::from_le_bytes([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]),
            date: u32::from_le_bytes([buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]]),
            seller: decode_name(&buf[o + 0x08..o + 0x18]),
            buyer: decode_name(&buf[o + 0x18..o + 0x28]),
        });
    }
    Ok(AhHistory {
        item,
        count,
        cat,
        sales,
    })
}

fn query_history(host: &str, item_id: u16, stack: bool) -> Result<AhHistory, String> {
    let mut s = connect(host)?;
    s.write_all(&build_history_request(item_id, stack, tail()))
        .map_err(|e| format!("send: {e}"))?;
    parse_history(&recv_packet(&mut s))
}

fn build_category_request(cat: u8, key_tail: [u8; 4]) -> Vec<u8> {
    let length = 268usize;
    let mut buf = vec![0u8; length];
    buf[0x00..0x02].copy_from_slice(&(length as u16).to_le_bytes());
    buf[0x04..0x08].copy_from_slice(&IXFF.to_le_bytes());
    buf[0x08..0x0A].copy_from_slice(&184u16.to_le_bytes());
    buf[0x0A] = 0x80;
    buf[0x0B] = 0x15;
    buf[0x0E..0x10].copy_from_slice(&1u16.to_le_bytes());
    buf[0x12] = 1;
    buf[0x14..0x16].copy_from_slice(&4u16.to_le_bytes());
    buf[0x16] = cat;
    buf[0x18..0x1C].copy_from_slice(&2u32.to_le_bytes());
    buf[0x1C..0x20].copy_from_slice(&2u32.to_le_bytes());
    let h = md5(&buf[0x08..length - 0x14]);
    buf[length - 0x14..length - 0x04].copy_from_slice(&h);
    buf[length - 0x04..length].copy_from_slice(&key_tail);
    let mut seed = KEY_SEED.to_vec();
    seed.extend_from_slice(&key_tail);
    let bf = blowfish_init(&md5(&seed));
    cipher_blocks(&mut buf, length, &bf, false);
    buf
}

fn build_more_request(key_tail: [u8; 4]) -> Vec<u8> {
    let length = 76usize;
    let mut buf = vec![0u8; length];
    buf[0x00..0x02].copy_from_slice(&(length as u16).to_le_bytes());
    buf[0x04..0x08].copy_from_slice(&IXFF.to_le_bytes());
    buf[0x08..0x0A].copy_from_slice(&16u16.to_le_bytes());
    buf[0x0A] = 0x80;
    buf[0x0B] = 0x10;
    buf[0x10..0x12].copy_from_slice(&3u16.to_le_bytes());
    buf[0x12..0x14].copy_from_slice(&1u16.to_le_bytes());
    let h = md5(&buf[0x08..length - 0x14]);
    buf[length - 0x14..length - 0x04].copy_from_slice(&h);
    buf[length - 0x04..length].copy_from_slice(&key_tail);
    let mut seed = KEY_SEED.to_vec();
    seed.extend_from_slice(&key_tail);
    let bf = blowfish_init(&md5(&seed));
    cipher_blocks(&mut buf, length, &bf, false);
    buf
}

fn parse_listing(data: &[u8]) -> Option<(Vec<AhCatItem>, u16, bool)> {
    if data.len() < 2 {
        return None;
    }
    let mut buf = data.to_vec();
    let length = u16::from_le_bytes([buf[0], buf[1]]) as usize;
    if length < 28 || length > buf.len() {
        return None;
    }
    let mut seed = KEY_SEED.to_vec();
    seed.extend_from_slice(&buf[length - 4..length]);
    seed.extend_from_slice(&[0u8; 4]);
    let bf = blowfish_init(&md5(&seed));
    cipher_blocks(&mut buf, length, &bf, true);
    if buf[0x0B] != 0x95 {
        return None;
    }
    let total = u16::from_le_bytes([buf[0x0E], buf[0x0F]]);
    let end = u16::from_le_bytes([buf[0x08], buf[0x09]]) as usize;
    let is_last = buf[0x0A] == 0x80;
    let mut items = Vec::new();
    let n = if end >= 0x18 { (end - 0x18) / 10 } else { 0 };
    for i in 0..n {
        let o = 0x18 + 10 * i;
        if o + 10 > length {
            break;
        }
        items.push(AhCatItem {
            id: u16::from_le_bytes([buf[o], buf[o + 1]]),
            single: u32::from_le_bytes([buf[o + 2], buf[o + 3], buf[o + 4], buf[o + 5]]),
            stack: u32::from_le_bytes([buf[o + 6], buf[o + 7], buf[o + 8], buf[o + 9]]),
        });
    }
    Some((items, total, is_last))
}

fn query_category(host: &str, cat: u8) -> Result<AhCategory, String> {
    let mut s = connect(host)?;
    s.write_all(&build_category_request(cat, tail()))
        .map_err(|e| format!("send: {e}"))?;
    let mut items: Vec<AhCatItem> = Vec::new();
    let mut total = 0u16;
    let mut guard = 0;
    loop {
        match parse_listing(&recv_packet(&mut s)) {
            None => break,
            Some((pitems, ptotal, is_last)) => {
                items.extend(pitems);
                total = ptotal;
                if is_last || items.len() as u16 >= total || guard >= 80 {
                    break;
                }
                s.write_all(&build_more_request(tail()))
                    .map_err(|e| format!("send more: {e}"))?;
                guard += 1;
            }
        }
    }
    Ok(AhCategory { total, items })
}

#[tauri::command]
pub async fn ah_history(host: String, item_id: u16, stack: bool) -> Result<AhHistory, String> {
    tauri::async_runtime::spawn_blocking(move || query_history(&host, item_id, stack))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn ah_category(host: String, cat: u16) -> Result<AhCategory, String> {
    tauri::async_runtime::spawn_blocking(move || query_category(&host, cat as u8))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}
