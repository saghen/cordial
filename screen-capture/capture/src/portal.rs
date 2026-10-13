// The portal source (P4): any desktop's xdg ScreenCast portal through ashpd (CreateSession, SelectSources, Start,
// OpenPipeWireRemote). The portal shows its own picker, unless it accepts the restore token of an earlier cast; with
// persist mode 2 it hands out a new token for the next one. The cast's node is on the PipeWire remote the portal opens
// for us (an fd), not on the default one. The calls run once, at startup, under a blocking executor; zbus runs the
// connection on a thread of its own, so nothing async touches the frame path.

use std::os::fd::OwnedFd;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context as _, Result};
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::{PersistMode, Session};
use futures_lite::future::block_on;
use futures_lite::StreamExt;

use crate::out::stage;
use crate::Shared;

struct Inner {
    proxy: Screencast,
    session: Session<Screencast>,
}

/// a running portal cast: its node, the remote it's on (taken by the PipeWire thread), the token for the next one
pub struct Portal {
    inner: Arc<Inner>,
    pub node: u32,
    pub fd: Option<OwnedFd>,
    pub token: Option<String>,
    closed: Arc<AtomicBool>,
}

/// One monitor or window, the cursor embedded or hidden as `cursor` says (Mutter's numbering: 1 embedded) where the
/// portal offers it. The session's Closed signal (the user stopped the cast in the desktop's UI) quits through `sh`.
/// The session is closed when dropped, failures here included.
pub fn start(sh: Arc<Shared>, cursor: u32, restore: Option<&str>) -> Result<Portal> {
    block_on(async {
        let proxy = Screencast::new().await.context("portal: ScreenCast")?;
        stage("bus");
        let session = proxy
            .create_session(Default::default())
            .await
            .context("portal: CreateSession")?;
        stage("session");
        let inner = Arc::new(Inner { proxy, session });
        let closed = Arc::new(AtomicBool::new(false));
        let mut p = Portal {
            inner: inner.clone(),
            node: 0,
            fd: None,
            token: None,
            closed: closed.clone(),
        };
        let watch = inner.clone();
        std::thread::spawn(move || {
            block_on(async {
                if let Ok(mut s) = watch.session.receive_closed().await {
                    if s.next().await.is_some() {
                        closed.store(true, Ordering::Relaxed);
                        sh.quit("cast closed");
                    }
                }
            })
        });

        let modes = inner.proxy.available_cursor_modes().await.unwrap_or_default();
        let want = if cursor == 1 {
            CursorMode::Embedded
        } else {
            CursorMode::Hidden
        };
        let mode = modes.contains(want).then_some(want);
        inner
            .proxy
            .select_sources(
                &inner.session,
                SelectSourcesOptions::default()
                    .set_cursor_mode(mode)
                    .set_sources(SourceType::Monitor | SourceType::Window)
                    .set_multiple(false)
                    .set_persist_mode(PersistMode::ExplicitlyRevoked)
                    .set_restore_token(restore),
            )
            .await
            .context("portal: SelectSources")?
            .response()
            .context("portal: SelectSources")?;
        stage("record");
        let streams = inner
            .proxy
            .start(&inner.session, None, Default::default())
            .await
            .context("portal: Start")?
            .response()
            .context("portal: Start (cancelled in the picker?)")?;
        stage("cast-started");
        let stream = streams.streams().first().context("portal: no stream")?;
        p.node = stream.pipe_wire_node_id();
        p.token = streams.restore_token().map(str::to_owned);
        p.fd = Some(
            inner
                .proxy
                .open_pipe_wire_remote(&inner.session, Default::default())
                .await
                .context("portal: OpenPipeWireRemote")?,
        );
        eprintln!(
            "portal: node {}, {:?} {:?}, restore token {}",
            p.node,
            stream.source_type(),
            stream.size(),
            if p.token.is_some() { "given" } else { "none" }
        );
        stage("node");
        Ok(p)
    })
}

impl Drop for Portal {
    fn drop(&mut self) {
        if !self.closed.load(Ordering::Relaxed) {
            if let Err(e) = block_on(self.inner.session.close()) {
                eprintln!("portal: Close: {e}");
            }
        }
    }
}
