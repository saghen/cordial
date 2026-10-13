// The message input: one textarea calling stock's chat input actions in stock's order. Enter sends, Shift+Enter is a new
// line, Up in an empty box edits the last own message in place (Enter saves, Escape leaves). Its text is the draft.
// Files from + wait as chips above it and go with the next message.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import { startTyping, stopTyping } from "../adapter/triggers";
import type { Rec } from "../adapter/discord";
import { dmName } from "./channels";
import { authorOf, can as allowed, type Message, nameOf, PERMS } from "./lib/model";
import { $ } from "./lib/store";

export function MessageInput() {
    const channelId = createMemo(() => $.SelectedChannel.getChannelId());
    const editing = createMemo(() => channelId() ? $.EditMessage.getEditingMessageId(channelId()!) : undefined);
    const can = createMemo(() => {
        const c = channelId() && $.Channel.getChannel(channelId()!);
        return !!c && allowed(PERMS.SEND_MESSAGES, c);
    });
    const reply = createMemo(() => channelId() ? $.PendingReply.getPendingReply(channelId()!) : undefined);
    const uploads = createMemo(() => channelId() ? $.UploadAttachment.getUploads(channelId()!, 0) : []);
    let box!: HTMLTextAreaElement, files!: HTMLInputElement;
    const complete = createAutocomplete(() => box, () => channelId() ? S.Channel.getChannel(channelId()!) : undefined);

    // as stock: the draft is saved at most every 500 ms while it changes (first and last change included), and on a switch
    let last = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const save = (id: string) => {
        clearTimeout(timer);
        timer = undefined;
        last = Date.now();
        A.drafts.saveDraft(id, S.Draft.getDraft(id, 0), 0);
    };
    const saveSoon = (id: string) => {
        const wait = last + 500 - Date.now();
        if (wait <= 0) save(id);
        else timer ??= setTimeout(() => save(id), wait);
    };

    // a switch saves the text left behind (empty included); the box then shows the new channel's draft, or the
    // message being edited, and takes the focus
    createEffect(() => [channelId(), editing()] as const, ([id, edit], prev) => {
        if (prev?.[0] && prev[0] !== id) save(prev[0]);
        box.value = !id ? "" : edit ? A.parser.unparse(S.EditMessage.getEditingTextValue(id) ?? "", id) : S.Draft.getDraft(id, 0);
        if (id) box.focus();
    });
    // as stock: "Message #channel", "Message @user"
    const target = () => {
        const c = channelId() && $.Channel.getChannel(channelId()!);
        return !c ? "" : c.guild_id ? ` #${c.name}` : c.type === 1 ? ` @${dmName(c)}` : ` ${dmName(c)}`;
    };

    const input = () => {
        const id = channelId()!, text = box.value;
        complete.update();
        if (editing()) return A.messages.updateEditMessage(id, text);
        A.drafts.changeDraft(id, text, 0);
        saveSoon(id);
        if (text.trim() && !text.startsWith("/")) startTyping(id);
        else if (!text) stopTyping(id);
    };

    const send = () => {
        const id = channelId()!, channel = S.Channel.getChannel(id)!, text = box.value.trim(), edit = editing();
        if (edit) {
            // an unchanged or emptied message just leaves edit mode (stock asks to delete an emptied one)
            const content = A.parser.parse(channel, text).content;
            if (text && content !== S.Message.getMessage(id, edit)?.content) A.messages.editMessage(id, edit, { content, components: undefined });
            A.messages.endEditMessage(id);
        } else if (text || uploads().length) {
            const options = A.messages.getSendMessageOptionsForReply(S.PendingReply.getPendingReply(id));
            // with files, as stock: no optimistic row (eagerDispatch), the message shows once uploaded
            const attachmentsToUpload = uploads().length ? uploads() : undefined;
            A.messages.sendMessage(id, A.parser.parse(channel, text), undefined,
                { ...options, attachmentsToUpload, eagerDispatch: attachmentsToUpload ? false : undefined, location: "chat_input" });
            if (reply()) A.replies.remove(id);
            if (attachmentsToUpload) A.uploads.clearAll(id, 0);
            // stock clears its box (a save of the empty draft), then hears its own change (a change, and a throttled save)
            box.value = "";
            A.drafts.saveDraft(id, "", 0);
            A.drafts.changeDraft(id, "", 0);
            saveSoon(id);
        }
    };

    const key = (e: KeyboardEvent) => {
        const id = channelId()!;
        if (complete.key(e)) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        } else if (e.key === "Escape" && editing()) {
            A.messages.endEditMessage(id);
        } else if (e.key === "Escape" && reply()) {
            A.replies.remove(id);
        } else if (e.key === "ArrowUp" && !box.value && !editing()) {
            const last = S.Message.getLastEditableMessage(id);
            if (last) {
                e.preventDefault();
                A.messages.startEditMessageRecord(id, last);
            }
        }
    };

    return <>
        <Show when={reply()}>{r => <label data-mc="reply">
            Replying to <b>{authorOf(r().message as Message, r().channel.guild_id).name}</b>
            <Show when={r().showMentionToggle}>
                <button data-mc="reply:mention" class={{ on: r().shouldMention }}
                    onClick={() => A.replies.mention(channelId()!, !r().shouldMention)}>@ {r().shouldMention ? "on" : "off"}</button>
            </Show>
            <button data-mc="reply:cancel" onClick={() => A.replies.remove(channelId()!)}>✕</button>
        </label>}</Show>
        <Show when={uploads().length}>
            <ul data-mc="uploads"><For each={uploads()}>{u =>
                <button data-mc={`upload:${u.filename}`} title="Remove" onClick={() => A.uploads.remove(channelId()!, u.id, 0)}>{u.filename} ✕</button>
            }</For></ul>
        </Show>
        <button data-mc="attach" title="Upload a file" hidden={!channelId() || !can()} onClick={() => files.click()} />
        <input ref={files} type="file" multiple hidden onChange={() => {
            A.promptToUpload.prompt([...files.files!], S.Channel.getChannel(channelId()!)!, 0);
            files.value = "";
        }} />
        <textarea ref={box} data-mc="composer" class={{ editing: !!editing() }} rows={1} hidden={!channelId()} disabled={!can()}
        placeholder={editing() ? "Editing: Enter saves, Escape cancels" : can() ? `Message${target()}` : "You can't send messages here"}
        onInput={input} onKeyDown={key} />
        {complete.view}
    </>;
}

// autocomplete: `@` users and roles, `#` channels, `:` emoji (two letters at least, as stock), from
// stock's own queries. One list above the box; Up and Down move, Tab or Enter put the pick in the box as text the
// parser turns back into a mention, Escape closes

interface Item { text: string; label: string; icon?: string; }

const TOKEN = /(?:^|\s)([@#:])([^\s@#:]*)$/;

function createAutocomplete(box: () => HTMLTextAreaElement, channel: () => Rec | undefined) {
    const [token, setToken] = createSignal<{ kind: string; query: string; at: number; } | null>(null);
    const [sel, setSel] = createSignal(0);
    let menu!: HTMLMenuElement;

    const items = createMemo((): Item[] => {
        const t = token(), c = channel();
        if (!t || !c) return [];
        if (t.kind === "@") {
            // as stock's box: @everyone, @here and every role with the permission to mention everyone
            const everyone = !c.isPrivate() && S.Permission.can(PERMS.MENTION_EVERYONE, c);
            const r = A.autocomplete.queryMentionResults({ query: t.query, channel: c, canMentionEveryone: everyone, request: true });
            return [
                ...r.users.map((u: Rec) => ({ text: `@${u.user.username}`, label: nameOf(u.user, u.nick), icon: u.user.getAvatarURL(c.guild_id, 32) })),
                ...r.roles.map((role: Rec) => ({ text: `@${role.name}`, label: `@${role.name}` })),
                ...r.globals.filter((g: Rec) => g.text === "@everyone" || g.text === "@here").map((g: Rec) => ({ text: g.text, label: g.text }))
            ].slice(0, 10);
        }
        if (t.kind === "#") return A.autocomplete.queryChannelResults({ query: t.query, channel: c }).channels
            .slice(0, 10).map((ch: Rec) => ({ text: `#${ch.name}`, label: `#${ch.name}` }));
        if (t.query.length < 2) return [];
        return A.autocomplete.queryEmojiResults({ query: t.query, channel: c, intention: 3, maxCount: 10 }).emojis.unlocked
            .map((e: Rec) => ({ text: `:${e.name}:`, label: `:${e.name}:`, icon: e.url ?? undefined }));
    });

    // after each input: the token the caret ends
    const update = () => {
        const b = box(), m = TOKEN.exec(b.value.slice(0, b.selectionStart));
        setToken(m ? { kind: m[1], query: m[2], at: b.selectionStart - m[2].length - 1 } : null);
        setSel(0);
    };
    // open while there's something to pick (writes apply in a microtask: read them in an effect)
    createEffect(() => items().length > 0, open => {
        if (open) menu.showPopover();
        else if (menu.matches(":popover-open")) menu.hidePopover();
    });

    const pick = (item: Item) => {
        const b = box(), t = token()!;
        b.setRangeText(`${item.text} `, t.at, b.selectionStart, "end");
        b.dispatchEvent(new Event("input", { bubbles: true }));
        b.focus();
    };

    // true when the key was the list's
    const key = (e: KeyboardEvent) => {
        const n = items().length;
        if (!n || !menu.matches(":popover-open")) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") setSel((sel() + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        else if (e.key === "Tab" || e.key === "Enter") pick(items()[sel()]);
        else if (e.key === "Escape") menu.hidePopover();
        else return false;
        e.preventDefault();
        return true;
    };

    const view = <menu ref={menu} data-mc="autocomplete" popover="manual">
        <For each={items()}>{(item, i) =>
            <button data-mc={`complete:${item.text}`} class={{ sel: i() === sel() }}
                onPointerDown={e => e.preventDefault()} onClick={() => pick(item)}>
                {item.icon ? <img alt="" src={item.icon} /> : null}{item.label}
            </button>
        }</For>
    </menu>;

    return { view, update, key };
}
