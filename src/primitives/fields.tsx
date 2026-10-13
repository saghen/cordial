// Labelled fields: a name over its control (TextField, Select, Range, Radios), or a checkbox before its label (Check).
// The control takes the surrounding text size; the name is set small and capitalised as stock's.

import { For, omit } from 'solid-js'
import type { JSX } from '@solidjs/web'

export function TextField(p: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'children'> & { label: JSX.Element }) {
  const rest = omit(p, 'label')
  return (
    <label class="field">
      <span>{p.label}</span>
      <input {...rest} />
    </label>
  )
}

// options as [value, label, disabled]
export function Select<T extends string>(p: {
  label: JSX.Element
  options: readonly (readonly [T, JSX.Element, boolean?])[]
  value: T
  onChange(value: T): void
}) {
  return (
    <label class="field">
      <span>{p.label}</span>
      <select onChange={(e) => p.onChange(e.currentTarget.value as T)}>
        <For each={p.options}>
          {([value, label, disabled]) => (
            <option value={value} selected={value === p.value} disabled={disabled}>
              {label}
            </option>
          )}
        </For>
      </select>
    </label>
  )
}

// onInput as it's dragged, onChange once it's let go
export const Range = (p: {
  label: JSX.Element
  min?: number
  max: number
  value: number
  disabled?: boolean
  onInput?(value: number): void
  onChange?(value: number): void
}) => (
  <label class="field">
    <span>{p.label}</span>
    <input
      type="range"
      min={p.min ?? 0}
      max={p.max}
      value={p.value}
      disabled={p.disabled}
      onInput={(e) => p.onInput?.(+e.currentTarget.value)}
      onChange={(e) => p.onChange?.(+e.currentTarget.value)}
    />
  </label>
)

export const Check = (p: { label: JSX.Element; checked: boolean; onChange(on: boolean): void }) => (
  <label class="check">
    <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.currentTarget.checked)} />
    {p.label}
  </label>
)

export const Radios = <T extends string>(p: {
  label: JSX.Element
  name: string
  options: readonly (readonly [T, JSX.Element])[]
  value: T
  onChange(value: T): void
}) => (
  <fieldset class="field">
    <legend>{p.label}</legend>
    <For each={p.options}>
      {([value, label]) => (
        <label class="check">
          <input type="radio" name={p.name} checked={value === p.value} onChange={() => p.onChange(value)} />
          {label}
        </label>
      )}
    </For>
  </fieldset>
)
