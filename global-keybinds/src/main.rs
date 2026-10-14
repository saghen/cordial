// Global keybinds through the desktop's GlobalShortcuts portal (xdg-desktop-portal), for the shell (src/shell/main.js).
// Electron's globalShortcut binds through the same portal but reports presses only; this reports releases too, for
// push to talk.
//
// stdin: a shortcut a line, `ACCELERATOR\tDESCRIPTION` in Electron's accelerator syntax ("Ctrl+Shift+M"), until EOF.
// stdout: `bound ACCELERATOR\tTRIGGER` for each shortcut once the portal has bound it (TRIGGER: the desktop's own
// description of the keys, which the user may have changed), then `down ACCELERATOR` and `up ACCELERATOR` as they are
// pressed and released. On a failure, `error MESSAGE` and exit 1. Exits when the shell does (its parent changes, or
// stdout closes), so a crashed shell doesn't leave the shortcuts bound.

use std::io::{BufRead, Write};
use std::os::unix::process::parent_id;
use std::time::Duration;

use ashpd::desktop::{
    CreateSessionOptions,
    global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut},
};
use futures_util::StreamExt;

// "Ctrl+Shift+M" in the XDG shortcuts spec's syntax: "CTRL+SHIFT+m"
fn trigger(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|k| match k.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => "CTRL".into(),
            "alt" | "option" => "ALT".into(),
            "shift" => "SHIFT".into(),
            "super" | "meta" | "cmd" | "command" => "LOGO".into(),
            "space" => "space".into(),
            "enter" | "return" => "Return".into(),
            _ if k.chars().count() == 1 => k.to_lowercase(),
            _ => k.into(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn say(line: &str) {
    let mut out = std::io::stdout().lock();
    if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
        std::process::exit(0);
    }
}

async fn run(parent: u32, shortcuts: Vec<(String, String)>) -> ashpd::Result<()> {
    let portal = GlobalShortcuts::new().await?;
    let session = portal.create_session(CreateSessionOptions::default()).await?;
    let wanted: Vec<_> = shortcuts
        .iter()
        .map(|(id, description)| NewShortcut::new(id, description).preferred_trigger(trigger(id).as_str()))
        .collect();
    let mut down = portal.receive_activated().await?.fuse();
    let mut up = portal.receive_deactivated().await?.fuse();
    let bound = portal.bind_shortcuts(&session, &wanted, None, BindShortcutsOptions::default()).await?.response()?;
    for s in bound.shortcuts() {
        say(&format!("bound {}\t{}", s.id(), s.trigger_description()));
    }
    let mut tick = async_io::Timer::interval(Duration::from_secs(1)).fuse();
    loop {
        futures_util::select! {
            a = down.next() => match a { Some(a) => say(&format!("down {}", a.shortcut_id())), None => return Ok(()) },
            d = up.next() => match d { Some(d) => say(&format!("up {}", d.shortcut_id())), None => return Ok(()) },
            _ = tick.next() => if parent_id() != parent { return Ok(()) },
        }
    }
}

fn main() {
    let parent = parent_id();
    let shortcuts: Vec<(String, String)> = std::io::stdin()
        .lock()
        .lines()
        .map_while(Result::ok)
        .filter_map(|l| l.split_once('\t').map(|(a, d)| (a.to_owned(), d.to_owned())))
        .collect();
    if shortcuts.is_empty() {
        return;
    }
    if let Err(e) = async_io::block_on(run(parent, shortcuts)) {
        say(&format!("error {e}"));
        std::process::exit(1);
    }
}
