// Popovers at the pointer: the context menus.

export function popAt(menu: HTMLElement, e: MouseEvent) {
    e.preventDefault();
    // at the pointer, above it or to its left where it wouldn't fit
    const show = () => {
        menu.showPopover();
        const { width, height } = menu.getBoundingClientRect();
        Object.assign(menu.style, {
            left: `${e.clientX + width > innerWidth ? e.clientX - width : e.clientX}px`,
            top: `${e.clientY + height > innerHeight ? e.clientY - height : e.clientY}px`
        });
    };
    // on Linux contextmenu fires on the press: opened before the release, the release would light-dismiss it
    if (e.buttons) addEventListener("pointerup", show, { once: true });
    else show();
}
