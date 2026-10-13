// A presence status in stock's shapes: online's dot, idle's moon, dnd's bar, offline's ring (invisible shows as offline)

export const Status = (p: { kind: string }) => <i class={['status', p.kind]} />
