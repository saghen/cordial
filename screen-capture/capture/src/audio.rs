// The stream's sound: the apps of the shared window, captured from PipeWire (mincord says which: the "audio" command,
// from niri's windows; main/cast.js). A PipeWire input stream of our own, linked to nobody by the session manager;
// we link the apps' output ports to it ourselves (PipeWire mixes what reaches one port), and relink when the target or
// the graph changes. Each buffer goes to stdout as an audio message (out.rs): 48 kHz stereo s16, as Opus takes it.
//
// Which apps: a stream's process is its client's `application.process.id` (pipewire-pulse's clients too; the node's
// own props don't always have it). A target is
//   pid=N    the window's process and every process below it (Chromium's and Electron's sound comes from a child);
//   steam=N  processes started by Steam for app N (their environment's SteamAppId / SteamGameId): niri's X11 windows
//            all have xwayland-satellite's pid, so a Proton game is found this way;
//   name=S   processes whose binary or application name is S (other X11 windows, by their app id).
// mincord's own processes (our parent and everything below it: the call's sound) and capture itself never match.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa::param::audio::{AudioFormat, AudioInfoRaw};
use pw::spa::pod::serialize::PodSerializer;
use pw::spa::pod::{Object, Pod, Value};
use pw::spa::sys as spa;
use pw::stream::{StreamFlags, StreamState};
use pw::types::ObjectType;

use crate::out::{info, now, send, MSG_AUDIO};

pub const RATE: u32 = 48000;
pub const CHANNELS: u32 = 2;

#[derive(Clone, Debug, Default, PartialEq)]
pub enum Target {
    #[default]
    Off,
    Pid(u32),
    Steam(String),
    Name(String),
}

impl Target {
    /// "off" | "pid=N" | "steam=N" | "name=S"
    pub fn parse(s: &str) -> Option<Target> {
        let s = s.trim();
        if s == "off" {
            return Some(Target::Off);
        }
        let (k, v) = s.split_once('=')?;
        match k {
            "pid" => v.parse().ok().map(Target::Pid),
            "steam" if !v.is_empty() => Some(Target::Steam(v.to_string())),
            "name" if !v.is_empty() => Some(Target::Name(v.to_lowercase())),
            _ => None,
        }
    }
}

/// a client's process: its pid, the chain of its parents, its Steam app, its names
struct App {
    pid: u32,
    ancestors: Vec<u32>,
    steam: Option<String>,
    names: Vec<String>,
}

struct Port {
    node: u32,
    out: bool,
    channel: String,
}

#[derive(Default)]
struct Graph {
    apps: HashMap<u32, App>,                    // client id ->
    clients: HashMap<u32, (pw::client::Client, pw::client::ClientListener)>,
    nodes: HashMap<u32, u32>,                   // Stream/Output/Audio node -> its client
    ports: HashMap<u32, Port>,
    links: HashMap<(u32, u32), pw::link::Link>, // (output port, our input port) ->
    own: Option<u32>,                           // our stream's node
    target: Target,
    linked: Vec<String>,                        // the apps linked, as last reported
}

/// the audio thread's target channel, set from the stdin thread
static AUDIO: Mutex<Option<pw::channel::Sender<Target>>> = Mutex::new(None);

/// sets what the stream's sound comes from; the audio thread starts on the first call
pub fn set_target(t: Target) {
    let mut a = AUDIO.lock().unwrap();
    if a.is_none() {
        let (tx, rx) = pw::channel::channel();
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || {
                if let Err(e) = run(rx) {
                    eprintln!("audio: {e:#}");
                    info(&format!("{{\"type\":\"audio\",\"error\":{:?}}}", format!("{e:#}")));
                }
            })
            .expect("audio thread");
        *a = Some(tx);
    }
    eprintln!("audio: target {t:?}");
    let _ = a.as_ref().unwrap().send(t);
}

fn stat_ppid(pid: u32) -> Option<u32> {
    let s = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    s[s.rfind(')')? + 2..].split(' ').nth(1)?.parse().ok()
}

/// pid, its parent, ... up to init
fn ancestors(pid: u32) -> Vec<u32> {
    let mut out = vec![pid];
    while let Some(p) = stat_ppid(*out.last().unwrap()).filter(|&p| p > 1 && out.len() < 64) {
        out.push(p);
    }
    out
}

fn steam_app(pid: u32) -> Option<String> {
    let env = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    env.split(|&b| b == 0).find_map(|kv| {
        let kv = std::str::from_utf8(kv).ok()?;
        kv.strip_prefix("SteamAppId=")
            .or(kv.strip_prefix("SteamGameId="))
            .filter(|v| !v.is_empty() && *v != "0")
            .map(str::to_string)
    })
}

impl Graph {
    fn matches(&self, app: &App) -> bool {
        // (capture's parent is mincord's main process)
        let mincord = std::os::unix::process::parent_id();
        if app.ancestors.contains(&mincord) || app.pid == std::process::id() {
            return false;
        }
        match &self.target {
            Target::Off => false,
            Target::Pid(p) => app.ancestors.contains(p),
            Target::Steam(id) => app.steam.as_ref() == Some(id),
            Target::Name(n) => app.names.iter().any(|x| x == n),
        }
    }

    /// the links there should be, made and removed to match
    fn sync(&mut self, core: &pw::core::Core) {
        let mut want: HashSet<(u32, u32)> = HashSet::new();
        let mut linked = Vec::new();
        if let Some(own) = self.own {
            let input = |ch: &str| {
                self.ports
                    .iter()
                    .find(|(_, p)| p.node == own && !p.out && p.channel == ch)
                    .map(|(&id, _)| id)
            };
            let (fl, fr) = (input("FL"), input("FR"));
            for (&node, client) in &self.nodes {
                let Some(app) = self.apps.get(client).filter(|a| self.matches(a)) else {
                    continue;
                };
                let mut any = false;
                for (&id, p) in self.ports.iter().filter(|(_, p)| p.node == node && p.out) {
                    // left to left, right to right, the rest (mono, centre, LFE) to both
                    let to = match p.channel.as_str() {
                        "FL" | "RL" | "SL" | "FLC" | "RLC" => vec![fl],
                        "FR" | "RR" | "SR" | "FRC" | "RRC" => vec![fr],
                        _ => vec![fl, fr],
                    };
                    for i in to.into_iter().flatten() {
                        want.insert((id, i));
                        any = true;
                    }
                }
                if any {
                    linked.push(app.names.first().cloned().unwrap_or_else(|| app.pid.to_string()));
                }
            }
        }
        self.links.retain(|k, _| want.contains(k));
        for (o, i) in want {
            if self.links.contains_key(&(o, i)) {
                continue;
            }
            let (on, inn) = (self.ports[&o].node, self.ports[&i].node);
            let props = properties! {
                "link.output.node" => on.to_string(),
                "link.output.port" => o.to_string(),
                "link.input.node" => inn.to_string(),
                "link.input.port" => i.to_string(),
                *pw::keys::OBJECT_LINGER => "false",
            };
            match core.create_object::<pw::link::Link>("link-factory", &props) {
                Ok(l) => {
                    self.links.insert((o, i), l);
                }
                Err(e) => eprintln!("audio: link {o} -> {i}: {e}"),
            }
        }
        linked.sort();
        linked.dedup();
        if linked != self.linked {
            eprintln!("audio: linked {linked:?}");
            let names: Vec<String> = linked.iter().map(|n| format!("{n:?}")).collect();
            info(&format!("{{\"type\":\"audio\",\"apps\":[{}]}}", names.join(",")));
            self.linked = linked;
        }
    }
}

/// S16LE, 48 kHz, FL FR: PipeWire converts and mixes into it
fn format() -> Vec<u8> {
    let mut fmt = AudioInfoRaw::new();
    fmt.set_format(AudioFormat::S16LE);
    fmt.set_rate(RATE);
    fmt.set_channels(CHANNELS);
    let mut pos = [0; spa::SPA_AUDIO_MAX_CHANNELS as usize];
    pos[0] = spa::SPA_AUDIO_CHANNEL_FL;
    pos[1] = spa::SPA_AUDIO_CHANNEL_FR;
    fmt.set_position(pos);
    let obj = Object {
        type_: spa::SPA_TYPE_OBJECT_Format,
        id: spa::SPA_PARAM_EnumFormat,
        properties: fmt.into(),
    };
    PodSerializer::serialize(std::io::Cursor::new(Vec::new()), &Value::Object(obj))
        .expect("pod")
        .0
        .into_inner()
}

fn run(targets: pw::channel::Receiver<Target>) -> Result<()> {
    pw::init();
    let ml = pw::main_loop::MainLoopRc::new(None)?;
    let ctx = pw::context::ContextRc::new(&ml, None)?;
    let core = ctx.connect_rc(None).map_err(|e| anyhow!("pw_context_connect: {e}"))?;
    let registry = core.get_registry_rc()?;
    let g = Rc::new(RefCell::new(Graph::default()));

    let stream = pw::stream::StreamBox::new(
        &core,
        "mincord-capture-audio",
        properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
            *pw::keys::NODE_NAME => "mincord-capture",
            *pw::keys::NODE_DESCRIPTION => "mincord Go Live sound",
            // scheduled with nothing linked too: silence then, and the stream's clock never stops
            *pw::keys::NODE_ALWAYS_PROCESS => "true",
        },
    )?;
    let mut seq = 0u32;
    let _stream_listener = stream
        .add_local_listener_with_user_data(())
        .state_changed({
            let g = g.clone();
            let core = core.clone();
            move |s, _, _, state| {
                eprintln!("audio: {}", format!("{state:?}").to_lowercase());
                if let StreamState::Paused | StreamState::Streaming = state {
                    let mut g = g.borrow_mut();
                    if g.own != Some(s.node_id()) {
                        g.own = Some(s.node_id());
                        g.sync(&core);
                    }
                }
            }
        })
        .process(move |s, _| {
            let Some(mut b) = s.dequeue_buffer() else {
                return;
            };
            let Some(d) = b.datas_mut().first_mut() else {
                return;
            };
            let (off, size) = (d.chunk().offset() as usize, d.chunk().size() as usize);
            let Some(data) = d.data() else {
                return;
            };
            let Some(pcm) = data.get(off..off + size) else {
                return;
            };
            let head: Vec<u8> = [RATE, CHANNELS].iter().flat_map(|v| v.to_le_bytes()).collect();
            send(MSG_AUDIO, seq, now(), &head, pcm, true);
            seq = seq.wrapping_add(1);
        })
        .register()?;
    let fmt = format();
    stream.connect(
        pw::spa::utils::Direction::Input,
        None,
        StreamFlags::MAP_BUFFERS,
        &mut [Pod::from_bytes(&fmt).expect("pod")],
    )?;

    let _registry_listener = registry
        .add_listener_local()
        .global({
            let g = g.clone();
            let core = core.clone();
            let registry = registry.clone();
            move |o| {
                let Some(props) = o.props else { return };
                let mut gm = g.borrow_mut();
                match o.type_ {
                    ObjectType::Client => {
                        // the process is in the client's info, not its global: bind it
                        let Ok(client) = registry.bind::<pw::client::Client, _>(o) else {
                            return;
                        };
                        let id = o.id;
                        let listener = client
                            .add_listener_local()
                            .info({
                                let g = g.clone();
                                let core = core.clone();
                                move |i| {
                                    let Some(p) = i.props() else { return };
                                    let Some(pid) = p.get("application.process.id").and_then(|v| v.parse().ok())
                                    else {
                                        return;
                                    };
                                    let names = ["application.process.binary", "application.name"]
                                        .iter()
                                        .filter_map(|k| p.get(k))
                                        .map(|v| v.trim_start_matches('.').trim_end_matches("-wrapped").to_lowercase())
                                        .collect();
                                    let app = App {
                                        pid,
                                        ancestors: ancestors(pid),
                                        steam: steam_app(pid),
                                        names,
                                    };
                                    let mut g = g.borrow_mut();
                                    g.apps.insert(id, app);
                                    g.sync(&core);
                                }
                            })
                            .register();
                        gm.clients.insert(id, (client, listener));
                    }
                    ObjectType::Node => {
                        let client = props.get("client.id").and_then(|v| v.parse().ok());
                        if let (Some("Stream/Output/Audio"), Some(c)) = (props.get("media.class"), client) {
                            gm.nodes.insert(o.id, c);
                            gm.sync(&core);
                        }
                    }
                    ObjectType::Port => {
                        let node = props.get("node.id").and_then(|v| v.parse().ok());
                        let (Some(node), Some(dir)) = (node, props.get("port.direction")) else {
                            return;
                        };
                        if props.get("port.monitor") == Some("true") {
                            return;
                        }
                        let channel = props.get("audio.channel").unwrap_or("MONO").to_string();
                        gm.ports.insert(o.id, Port { node, out: dir == "out", channel });
                        gm.sync(&core);
                    }
                    _ => {}
                }
            }
        })
        .global_remove({
            let g = g.clone();
            let core = core.clone();
            move |id| {
                let mut g = g.borrow_mut();
                g.clients.remove(&id);
                let gone = g.apps.remove(&id).is_some() | g.nodes.remove(&id).is_some();
                if g.ports.remove(&id).is_some() {
                    g.links.retain(|&(o, i), _| o != id && i != id);
                }
                if gone {
                    g.sync(&core);
                }
            }
        })
        .register();

    let _targets = targets.attach(ml.loop_(), {
        let g = g.clone();
        let core = core.clone();
        move |t| {
            let mut g = g.borrow_mut();
            g.target = t;
            g.sync(&core);
        }
    });
    ml.run();
    Ok(())
}
