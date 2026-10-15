// Discord's colours are numbers (roles, folders, profiles): as CSS
export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`
