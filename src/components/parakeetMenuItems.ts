import type { ParakeetMenuItem } from "./ParakeetMenuDropdown";

type Common = {
  closeMenu: () => void;
  tauri: boolean;
  clickThroughMode: boolean;
  isSuperAdmin: boolean;
  onClickThrough: () => void;
  onPlaceWindow: () => void;
  onUpgrade: () => void;
  onCloud: () => void;
  onAdmin: () => void;
  onSignOut: () => Promise<void>;
};

export function homeParakeetMenuItems(
  p: Common & {
    onOpenSession: () => void;
  }
): ParakeetMenuItem[] {
  const { closeMenu, tauri, clickThroughMode, isSuperAdmin } = p;
  return [
    {
      id: "open",
      label: "Open session",
      onSelect: () => {
        p.onOpenSession();
        closeMenu();
      },
    },
    {
      id: "through",
      label: "Click-through mode",
      visible: tauri && !clickThroughMode,
      onSelect: () => {
        p.onClickThrough();
        closeMenu();
      },
    },
    {
      id: "place",
      label: "Place window",
      visible: tauri,
      onSelect: () => {
        p.onPlaceWindow();
        closeMenu();
      },
    },
    {
      id: "upgrade",
      label: "Upgrade",
      onSelect: () => {
        p.onUpgrade();
        closeMenu();
      },
    },
    {
      id: "cloud",
      label: "Cloud",
      visible: tauri,
      onSelect: () => {
        p.onCloud();
        closeMenu();
      },
    },
    {
      id: "admin",
      label: "Admin",
      visible: isSuperAdmin,
      onSelect: () => {
        p.onAdmin();
        closeMenu();
      },
    },
    {
      id: "out",
      label: "Sign out",
      onSelect: async () => {
        await p.onSignOut();
        closeMenu();
      },
    },
  ];
}

export function assistantParakeetMenuItems(
  p: Common & {
    onHome: () => void;
  }
): ParakeetMenuItem[] {
  const { closeMenu, tauri, clickThroughMode, isSuperAdmin } = p;
  return [
    {
      id: "home",
      label: "Home screen",
      onSelect: () => {
        p.onHome();
        closeMenu();
      },
    },
    {
      id: "through",
      label: "Click-through mode",
      visible: tauri && !clickThroughMode,
      onSelect: () => {
        p.onClickThrough();
        closeMenu();
      },
    },
    {
      id: "place",
      label: "Place window",
      visible: tauri,
      onSelect: () => {
        p.onPlaceWindow();
        closeMenu();
      },
    },
    {
      id: "upgrade",
      label: "Upgrade",
      onSelect: () => {
        p.onUpgrade();
        closeMenu();
      },
    },
    {
      id: "cloud",
      label: "Cloud",
      visible: tauri,
      onSelect: () => {
        p.onCloud();
        closeMenu();
      },
    },
    {
      id: "admin",
      label: "Admin",
      visible: isSuperAdmin,
      onSelect: () => {
        p.onAdmin();
        closeMenu();
      },
    },
    {
      id: "out",
      label: "Sign out",
      onSelect: async () => {
        await p.onSignOut();
        closeMenu();
      },
    },
  ];
}

export function floatingParakeetMenuItems(
  p: Common & {
    onFullWindow: () => void;
    onHome: () => void;
  }
): ParakeetMenuItem[] {
  const { closeMenu, tauri, clickThroughMode, isSuperAdmin } = p;
  return [
    {
      id: "full",
      label: "Full session window",
      onSelect: () => {
        p.onFullWindow();
        closeMenu();
      },
    },
    {
      id: "home",
      label: "Home screen",
      onSelect: () => {
        p.onHome();
        closeMenu();
      },
    },
    {
      id: "through",
      label: "Click-through mode",
      visible: tauri && !clickThroughMode,
      onSelect: () => {
        p.onClickThrough();
        closeMenu();
      },
    },
    {
      id: "place",
      label: "Place window",
      visible: tauri,
      onSelect: () => {
        p.onPlaceWindow();
        closeMenu();
      },
    },
    {
      id: "upgrade",
      label: "Upgrade",
      onSelect: () => {
        p.onUpgrade();
        closeMenu();
      },
    },
    {
      id: "cloud",
      label: "Cloud",
      visible: tauri,
      onSelect: () => {
        p.onCloud();
        closeMenu();
      },
    },
    {
      id: "admin",
      label: "Admin",
      visible: isSuperAdmin,
      onSelect: () => {
        p.onAdmin();
        closeMenu();
      },
    },
    {
      id: "out",
      label: "Sign out",
      onSelect: async () => {
        await p.onSignOut();
        closeMenu();
      },
    },
  ];
}
