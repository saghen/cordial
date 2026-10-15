// A search field: the query as it's typed, Enter with it, Escape. autofocus focuses it once it's shown: in a popover
// that shows after mounting it, the attribute (the popover focuses it as it opens); in one already open (the message
// menu's reaction search), at once

export function SearchInput(p: {
  class: string
  placeholder: string
  value?: string
  autofocus?: boolean
  onInput?(query: string): void
  onEnter?(query: string): void
  onEscape?(): void
}) {
  return (
    <input
      class={p.class}
      type="search"
      placeholder={p.placeholder}
      value={p.value ?? ''}
      autofocus={p.autofocus}
      ref={(input) => p.autofocus && queueMicrotask(() => input.focus())}
      onInput={(e) => p.onInput?.(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onEnter?.(e.currentTarget.value)
        else if (e.key === 'Escape') p.onEscape?.()
      }}
    />
  )
}
