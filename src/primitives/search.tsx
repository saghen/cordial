// A search field: the query as it's typed, Enter with it, Escape. autofocus focuses it once it's shown (a popover
// shows after mounting its contents; the message menu's reaction search mounts in a menu already open)

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
      ref={(input) => p.autofocus && queueMicrotask(() => input.focus())}
      onInput={(e) => p.onInput?.(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') p.onEnter?.(e.currentTarget.value)
        else if (e.key === 'Escape') p.onEscape?.()
      }}
    />
  )
}
