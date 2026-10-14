// A presence status in stock's shapes: online's dot, idle's moon, dnd's bar, offline's ring (invisible shows as offline)

export function Status(p: { kind: string }) {
  return <i class={['status', p.kind]} />
}
