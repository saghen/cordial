// The cast itself (capture.c's cast_start / cast_stop / bus_poll): a niri screen cast of a window or an output through
// the Mutter ScreenCast D-Bus API niri implements, on the session bus. zbus's blocking API; its signals are read on
// threads of their own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use anyhow::{bail, Context as _, Result};
use zbus::blocking::Connection;
use zbus::zvariant::{OwnedObjectPath, Value};

use crate::out::{now, stage};
use crate::Shared;

#[zbus::proxy(
    interface = "org.gnome.Mutter.ScreenCast",
    default_service = "org.gnome.Mutter.ScreenCast",
    default_path = "/org/gnome/Mutter/ScreenCast"
)]
trait ScreenCast {
    fn create_session(&self, properties: HashMap<&str, Value<'_>>) -> zbus::Result<OwnedObjectPath>;
}

#[zbus::proxy(
    interface = "org.gnome.Mutter.ScreenCast.Session",
    default_service = "org.gnome.Mutter.ScreenCast"
)]
trait Session {
    fn record_window(&self, properties: HashMap<&str, Value<'_>>) -> zbus::Result<OwnedObjectPath>;
    fn record_monitor(&self, connector: &str, properties: HashMap<&str, Value<'_>>) -> zbus::Result<OwnedObjectPath>;
    fn start(&self) -> zbus::Result<()>;
    fn stop(&self) -> zbus::Result<()>;
    #[zbus(signal)]
    fn closed(&self) -> zbus::Result<()>;
}

#[zbus::proxy(
    interface = "org.gnome.Mutter.ScreenCast.Stream",
    default_service = "org.gnome.Mutter.ScreenCast"
)]
trait Stream {
    #[zbus(signal, name = "PipeWireStreamAdded")]
    fn pipewire_stream_added(&self, node_id: u32) -> zbus::Result<()>;
}

pub enum Source<'a> {
    Window(u64),
    Output(&'a str),
}

/// a running cast: its session, its PipeWire node
pub struct Cast {
    session: SessionProxyBlocking<'static>,
    pub path: String,
    pub node: u32,
    closed: Arc<AtomicBool>,
}

/// CreateSession, RecordWindow / RecordMonitor, Start, then the stream's node (up to 10 s). The session's Closed
/// signal (the window went away) quits through `sh`. The cast is stopped when dropped, failures here included.
pub fn start(sh: Arc<Shared>, source: Source, cursor: u32) -> Result<Cast> {
    let conn = Connection::session().context("dbus: connect")?;
    stage("bus");
    let path = ScreenCastProxyBlocking::new(&conn)?
        .create_session(HashMap::new())
        .context("dbus: CreateSession")?;
    stage("session");
    let session = SessionProxyBlocking::builder(&conn).path(path.clone())?.build()?;
    let closed = Arc::new(AtomicBool::new(false));
    let signals = session.receive_closed().context("dbus: match Closed")?;
    let mut cast = Cast {
        session,
        path: path.to_string(),
        node: 0,
        closed: closed.clone(),
    };
    std::thread::spawn(move || {
        if signals.into_iter().next().is_some() {
            closed.store(true, Ordering::Relaxed);
            sh.quit("cast closed");
        }
    });
    let cursor_mode = || ("cursor-mode", Value::U32(cursor));
    let stream = match source {
        Source::Window(id) => cast
            .session
            .record_window(HashMap::from([("window-id", Value::U64(id)), cursor_mode()]))
            .context("dbus: RecordWindow")?,
        Source::Output(name) => cast
            .session
            .record_monitor(name, HashMap::from([cursor_mode()]))
            .context("dbus: RecordMonitor")?,
    };
    stage("record");
    let added = StreamProxyBlocking::builder(&conn)
        .path(stream)?
        .build()?
        .receive_pipewire_stream_added()
        .context("dbus: match PipeWireStreamAdded")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for sig in added {
            if let Ok(a) = sig.args() {
                let _ = tx.send(a.node_id);
            }
        }
    });
    cast.session.start().context("dbus: Start")?;
    stage("cast-started");
    cast.node = wait_node(&rx, &cast)?;
    Ok(cast)
}

fn wait_node(rx: &mpsc::Receiver<u32>, cast: &Cast) -> Result<u32> {
    let deadline = now() + 10.0;
    while now() < deadline && !cast.closed.load(Ordering::Relaxed) && !crate::SIGNALLED.load(Ordering::Relaxed) {
        if let Ok(node) = rx.recv_timeout(Duration::from_millis(100)) {
            eprintln!("cast: session {}, node {node}", cast.path);
            stage("node");
            return Ok(node);
        }
    }
    bail!("dbus: no PipeWire stream from the cast")
}

/// niri keeps a cast alive after its D-Bus client is gone: stop it (mincord also stops a cast of ours left behind
/// through niri's IPC, should we be killed)
impl Drop for Cast {
    fn drop(&mut self) {
        if !self.closed.load(Ordering::Relaxed) {
            if let Err(e) = self.session.stop() {
                eprintln!("dbus: Stop: {e}");
            }
        }
    }
}

impl Cast {
    /// the session's number: niri's cast session id (mincord stops the cast through niri's IPC should we die)
    pub fn session_id(&self) -> Option<&str> {
        let id = &self.path[self.path.rfind('u')? + 1..];
        id.starts_with(|c: char| c.is_ascii_digit()).then_some(id)
    }
}
