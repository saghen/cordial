// Game detection for mincord: the Linux side of Discord's `discord_utils.setObservedGamesCallback`. Discord's own
// RunningGameStore builds the list of games to watch (its detectable games database, the user's overrides) and does
// everything after a match (presence, "Stream <game>", Registered Games); this only says which of them are running.
//
// stdin, then closed: one game to watch per line, `id \t arguments \t steam app ids \t executable \t executable ...`
// (Discord's list: executables of every OS, arguments empty for none, app ids comma-separated).
// stdout: whenever the running games change, one line per game, `id \t pid \t executable \t path`, then an empty line.
// Exits when its parent does.
//
// A process's paths are /proc/<pid>/exe and argv[0], the latter for Wine and Proton games (their exe is
// wine64-preloader, argv[0] `Z:\...\Game.exe`) and wrapped programs (Nix's .foo-wrapped). A path matches an
// executable when it ends with it at a `/`, lowercased with `\` as `/`, and the command line contains the game's
// arguments if any. Discord's database has Linux executables for only a few games, so a path under
// `<library>/steamapps/common/<installdir>/` also matches the game with that Steam app id (from the library's
// appmanifest_<id>.acf): native and Proton Steam games, and the many games the database knows only by app id.
//
// With $MINCORD_WINE_BRIDGE, Wine and Proton games also get Rich Presence (wine.rs).

mod wine;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, Read, Write};
use std::os::unix::process::parent_id;
use std::time::{Duration, SystemTime};
use std::{fs, io, thread};

const INTERVAL: Duration = Duration::from_secs(5);

struct Game {
    id: String,
    arguments: String,
}

#[derive(Default)]
struct Watch {
    games: Vec<Game>,
    // executables by their last path component: (game, executable)
    executables: HashMap<String, Vec<(usize, String)>>,
    steam: HashMap<String, usize>,
    // Steam libraries: installdir -> app id, read when steamapps/ changes
    libraries: HashMap<String, (Option<SystemTime>, HashMap<String, String>)>,
    bridge: Option<wine::Bridge>,
}

type Running = BTreeMap<usize, (u32, String, String)>;

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn main() {
    let mut watch = Watch { bridge: wine::Bridge::start(), ..Default::default() };
    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let mut fields = line.split('\t');
        let (Some(id), Some(arguments), Some(steam)) = (fields.next(), fields.next(), fields.next()) else { continue };
        let game = watch.games.len();
        for exe in fields.map(|e| e.trim_start_matches('>').to_lowercase().replace('\\', "/")).filter(|e| !e.is_empty()) {
            watch.executables.entry(basename(&exe).to_owned()).or_default().push((game, exe));
        }
        for app in steam.split(',').filter(|a| !a.is_empty()) {
            watch.steam.entry(app.to_owned()).or_insert(game);
        }
        watch.games.push(Game { id: id.to_owned(), arguments: arguments.to_lowercase() });
    }

    let parent = parent_id();
    let mut last = Running::new();
    loop {
        let running = watch.scan();
        if running != last {
            let mut out = String::new();
            for (game, (pid, exe, path)) in &running {
                out += &format!("{}\t{pid}\t{exe}\t{}\n", watch.games[*game].id, path.replace(['\t', '\n'], " "));
            }
            out.push('\n');
            if io::stdout().write_all(out.as_bytes()).and_then(|_| io::stdout().flush()).is_err() {
                return;
            }
            last = running;
        }
        thread::sleep(INTERVAL);
        if parent_id() != parent {
            return;
        }
    }
}

impl Watch {
    // running games: the first (lowest pid) process of each
    fn scan(&mut self) -> Running {
        let mut running = Running::new();
        let Ok(dir) = fs::read_dir("/proc") else { return running };
        let mut pids: Vec<u32> = dir.filter_map(|e| e.ok()?.file_name().to_str()?.parse().ok()).collect();
        pids.sort_unstable();
        // one read each: command lines past 16 KiB are cut (only arguments are matched there)
        let mut buf = vec![0; 16 << 10];
        let mut wineservers = HashSet::new();
        for pid in pids {
            // empty for kernel threads and zombies
            let Ok(n) = File::open(format!("/proc/{pid}/cmdline")).and_then(|mut f| f.read(&mut buf)) else { continue };
            let cmdline = &buf[..n];
            let Some(argv0) = cmdline.split(|&b| b == 0).next().filter(|a| !a.is_empty()) else { continue };
            let exe = fs::read_link(format!("/proc/{pid}/exe")).unwrap_or_default();
            if let Some(bridge) = &mut self.bridge
                && exe.file_name().is_some_and(|n| n == "wineserver")
            {
                wineservers.insert(pid);
                bridge.wineserver(pid, &exe);
            }
            let exe = exe.as_os_str().as_encoded_bytes();
            for path in [exe.strip_suffix(b" (deleted)").unwrap_or(exe), argv0] {
                let path = String::from_utf8_lossy(path).replace('\\', "/");
                if let Some((game, exe)) = self.by_executable(&path.to_lowercase(), cmdline).or_else(|| self.by_steam(&path)) {
                    running.entry(game).or_insert((pid, exe, path.to_lowercase()));
                    break;
                }
            }
        }
        if let Some(bridge) = &mut self.bridge {
            bridge.retain(&wineservers);
        }
        running
    }

    fn by_executable(&self, path: &str, cmdline: &[u8]) -> Option<(usize, String)> {
        let mut args = None;
        for (game, exe) in self.executables.get(basename(path))? {
            if !(path == exe || path.ends_with(&format!("/{exe}"))) {
                continue;
            }
            let arguments = &self.games[*game].arguments;
            let args = args.get_or_insert_with(|| String::from_utf8_lossy(cmdline).to_lowercase().replace('\0', " "));
            if arguments.is_empty() || args.contains(arguments.as_str()) {
                return Some((*game, exe.clone()));
            }
        }
        None
    }

    // `path` with its case, and Wine's Z: drive (the root) dropped
    fn by_steam(&mut self, path: &str) -> Option<(usize, String)> {
        let path = path.strip_prefix("Z:").or(path.strip_prefix("z:")).unwrap_or(path);
        let (library, rest) = path.split_once("/steamapps/common/")?;
        let installdir = rest.split('/').next()?;
        let steamapps = format!("{library}/steamapps");
        let modified = fs::metadata(&steamapps).and_then(|m| m.modified()).ok();
        let (read, apps) = self.libraries.entry(library.to_owned()).or_default();
        if !apps.contains_key(installdir) && *read != modified {
            *read = modified;
            *apps = read_library(&steamapps);
        }
        let game = *self.steam.get(apps.get(installdir)?)?;
        Some((game, basename(path).to_lowercase()))
    }
}

fn read_library(steamapps: &str) -> HashMap<String, String> {
    let mut apps = HashMap::new();
    for entry in fs::read_dir(steamapps).into_iter().flatten().flatten() {
        let name = entry.file_name();
        let Some(app) = name.to_str().and_then(|n| n.strip_prefix("appmanifest_")?.strip_suffix(".acf")) else { continue };
        let Ok(manifest) = fs::read_to_string(entry.path()) else { continue };
        // `"installdir"		"Factorio"`
        let installdir = manifest.lines().find_map(|l| {
            let mut quoted = l.split('"').skip(1).step_by(2);
            (quoted.next()? == "installdir").then(|| quoted.next()).flatten()
        });
        if let Some(installdir) = installdir {
            apps.insert(installdir.to_owned(), app.to_owned());
        }
    }
    apps
}
