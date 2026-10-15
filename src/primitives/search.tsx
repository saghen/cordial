// A search field: the query as it's typed, Enter with it, Escape. autofocus focuses it once it's shown: in a popover
// that shows after mounting it, the attribute (the popover focuses it as it opens); in one already open (the message
// menu's reaction search), at once. `key` sees each key first (true: it took it), as suggestions under the field do;
// `field` gets the element.

export function SearchInput(p: {
  class: string
  placeholder: string
  value?: string
  autofocus?: boolean
  field?(input: HTMLInputElement): void
  key?(e: KeyboardEvent): boolean
  onInput?(query: string): void
  onEnter?(query: string): void
  onEscape?(): void
  onFocus?(): void
  onBlur?(): void
}) {
  return (
    <input
      class={p.class}
      type="search"
      placeholder={p.placeholder}
      value={p.value ?? ''}
      autofocus={p.autofocus}
      ref={(input) => {
        p.field?.(input)
        if (p.autofocus) queueMicrotask(() => input.focus())
      }}
      onInput={(e) => p.onInput?.(e.currentTarget.value)}
      onFocus={() => p.onFocus?.()}
      onBlur={() => p.onBlur?.()}
      onKeyDown={(e) => {
        if (p.key?.(e)) return
        if (e.key === 'Enter') p.onEnter?.(e.currentTarget.value)
        else if (e.key === 'Escape') p.onEscape?.()
      }}
    />
  )
}
