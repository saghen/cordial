// The composer: one textarea calling stock's chat input actions in stock's order. Enter sends, Shift+Enter is a new
// line, Up in an empty box edits the last own message in place (Enter saves, Escape leaves). Its text is the draft.

import { createEffect, createMemo } from "solid-js";

import { A, S } from "../adapter/core";
import { startTyping, stopTyping } from "../adapter/triggers";
import { $ } from "./store";

export function Composer() {
    const channelId = createMemo(() => $.SelectedChannel.getChannelId());
    const editing = createMemo(() => channelId() ? $.EditMessage.getEditingMessageId(channelId()!) : undefined);
    // stock's rule: anyone in a DM, SEND_MESSAGES elsewhere
    const can = createMemo(() => {
        const c = channelId() && $.Channel.getChannel(channelId()!);
        return !!c && (c.isPrivate() || $.Permission.can(2048n, c));
    });
    let box!: HTMLTextAreaElement;

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
    // message being edited
    createEffect(() => [channelId(), editing()] as const, ([id, edit], prev) => {
        if (prev?.[0] && prev[0] !== id) save(prev[0]);
        box.value = !id ? "" : edit ? A.parser.unparse(S.EditMessage.getEditingTextValue(id) ?? "", id) : S.Draft.getDraft(id, 0);
    });

    const input = () => {
        const id = channelId()!, text = box.value;
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
        } else if (text) {
            A.messages.sendMessage(id, A.parser.parse(channel, text), undefined, { location: "chat_input" });
            // stock clears its box (a save of the empty draft), then hears its own change (a change, and a throttled save)
            box.value = "";
            A.drafts.saveDraft(id, "", 0);
            A.drafts.changeDraft(id, "", 0);
            saveSoon(id);
        }
    };

    const key = (e: KeyboardEvent) => {
        const id = channelId()!;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        } else if (e.key === "Escape" && editing()) {
            A.messages.endEditMessage(id);
        } else if (e.key === "ArrowUp" && !box.value && !editing()) {
            const last = S.Message.getLastEditableMessage(id);
            if (last) {
                e.preventDefault();
                A.messages.startEditMessageRecord(id, last);
            }
        }
    };

    return <textarea ref={box} data-mc="composer" class={{ editing: !!editing() }} rows={1} hidden={!channelId()} disabled={!can()}
        placeholder={editing() ? "Editing: Enter saves, Escape cancels" : can() ? "Message" : "You can't send messages here"}
        onInput={input} onKeyDown={key} />;
}
