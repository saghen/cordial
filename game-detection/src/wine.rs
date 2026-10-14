// Rich Presence for Wine and Proton games (bridge/bridge.c). Each Wine prefix that starts (a new wineserver) gets the
// bridge, run by that prefix's own wine with the wineserver's environment, inside its container if it has one (Steam's
// pressure-vessel: nsenter into its user and mount namespaces). The bridge serves \\.\pipe\discord-ipc-0 there and
// connects back here over loopback TCP with a token (in its environment); each connection is carried to discord-ipc-N,
// the first that answers, as a native client would pick it. A prefix is bridged at the scan after it starts (within
// 5 s, before a game is usually up); the bridge leaves with the prefix or with this process (the next one bridges
// again).
//
// The bridge: $CORDIAL_WINE_BRIDGE (bridge.exe); without it, nothing here runs.

use std::collections::HashSet;
use std::io::Read;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::{env, fs, io, thread};

pub struct Bridge {
    exe: PathBuf,
    port: u16,
    token: String,
    prefixes: HashSet<u32>,
}

impl Bridge {
    pub fn start() -> Option<Bridge> {
        let exe = PathBuf::from(env::var_os("CORDIAL_WINE_BRIDGE")?);
        let listener = TcpListener::bind("127.0.0.1:0").ok()?;
        let port = listener.local_addr().ok()?.port();
        let mut random = [0u8; 16];
        fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).ok()?;
        let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let expected = token.clone();
        thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let expected = expected.clone();
                thread::spawn(move || relay(conn, &expected));
            }
        });
        Some(Bridge { exe, port, token, prefixes: HashSet::new() })
    }

    // a wineserver seen in this scan: a prefix to bridge, once
    pub fn wineserver(&mut self, pid: u32, exe: &Path) {
        if !self.prefixes.insert(pid) {
            return;
        }
        if let Err(e) = self.spawn(pid, exe) {
            eprintln!("game-detection: no Rich Presence bridge for wineserver {pid}: {e}");
        }
    }

    // wineservers gone since: their pids may come back as anything
    pub fn retain(&mut self, alive: &HashSet<u32>) {
        self.prefixes.retain(|p| alive.contains(p));
    }

    fn spawn(&self, pid: u32, wineserver: &Path) -> io::Result<()> {
        let wine = wineserver.with_file_name("wine");
        let root = PathBuf::from(format!("/proc/{pid}/root"));
        // the bridge as the prefix sees it: pressure-vessel has the host's / at /run/host
        let bridge = [self.exe.clone(), Path::new("/run/host").join(self.exe.strip_prefix("/").unwrap_or(&self.exe))]
            .into_iter()
            .find(|p| root.join(p.strip_prefix("/").unwrap_or(p)).exists())
            .ok_or_else(|| io::Error::other(format!("{} not visible to it", self.exe.display())))?;
        let environ = fs::read(format!("/proc/{pid}/environ"))?;
        let vars = environ.split(|&b| b == 0).filter_map(|v| {
            let v = std::str::from_utf8(v).ok()?;
            v.split_once('=')
        });
        let ns = |n: &str| {
            fs::read_link(format!("/proc/{pid}/ns/{n}")).ok() != fs::read_link(format!("/proc/self/ns/{n}")).ok()
        };
        let mut cmd = if ns("mnt") {
            // found on this PATH, not the prefix's
            let nsenter = env::split_paths(&env::var_os("PATH").unwrap_or_default())
                .map(|d| d.join("nsenter"))
                .find(|p| p.exists())
                .ok_or_else(|| io::Error::other("no nsenter on PATH"))?;
            let mut c = Command::new(nsenter);
            c.arg(format!("--target={pid}"));
            if ns("user") {
                c.args(["--user", "--preserve-credentials"]);
            }
            c.args(["--mount", "--wd=/"]).arg(&wine);
            c
        } else {
            Command::new(&wine)
        };
        cmd.args(["start", "/unix"])
            .arg(bridge)
            .arg(self.port.to_string())
            .env_clear()
            .envs(vars)
            .env("CORDIAL_WINE_TOKEN", &self.token)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // `wine start` returns once the bridge runs
        let mut child = cmd.spawn()?;
        thread::spawn(move || child.wait());
        Ok(())
    }
}

// `P` and the token: a game's connection, carried to Discord; `W`: the bridge's own, held until this exits
fn relay(mut tcp: TcpStream, token: &str) -> io::Result<()> {
    let mut hello = [0u8; 64];
    tcp.read_exact(&mut hello)?;
    let (kind, got) = hello.split(|&b| b == 0).next().unwrap_or_default().split_at_checked(1).unwrap_or_default();
    if got != token.as_bytes() {
        return Ok(());
    }
    if kind == b"W" {
        return tcp.read(&mut [0]).map(drop);
    }
    let mut unix = discord()?;
    let (mut tcp_r, mut unix_w) = (tcp.try_clone()?, unix.try_clone()?);
    let back = thread::spawn(move || {
        let _ = io::copy(&mut unix, &mut tcp);
        let _ = tcp.shutdown(Shutdown::Both);
    });
    let _ = io::copy(&mut tcp_r, &mut unix_w);
    let _ = unix_w.shutdown(Shutdown::Both);
    let _ = back.join();
    Ok(())
}

// as native clients look for it
fn discord() -> io::Result<UnixStream> {
    let dir = ["CORDIAL_IPC_DIR", "XDG_RUNTIME_DIR", "TMPDIR"].iter().find_map(env::var_os).unwrap_or("/tmp".into());
    (0..10)
        .find_map(|i| UnixStream::connect(Path::new(&dir).join(format!("discord-ipc-{i}"))).ok())
        .ok_or_else(|| io::Error::other("no discord-ipc socket answers"))
}
