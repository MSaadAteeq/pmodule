export type ParakeetMenuItem = {
  id: string;
  label: string;
  onSelect: () => void | Promise<void>;
  visible?: boolean;
};

export function ParakeetMenuDropdown({
  open,
  items,
  menuClassName,
}: {
  open: boolean;
  items: ParakeetMenuItem[];
  menuClassName?: string;
}) {
  if (!open) return null;
  const cls = menuClassName?.trim()
    ? `pa-menu-dropdown ${menuClassName}`
    : "pa-menu-dropdown";
  return (
    <div className={cls} role="menu" onMouseDown={(e) => e.stopPropagation()}>
      {items
        .filter((i) => i.visible !== false)
        .map((i) => (
          <button key={i.id} type="button" role="menuitem" onClick={() => void i.onSelect()}>
            {i.label}
          </button>
        ))}
    </div>
  );
}
