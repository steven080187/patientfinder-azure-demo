import type { ReactNode } from "react";
import { DesktopWorkspace } from "./DesktopWorkspace";
import { MobileWorkspace } from "./MobileWorkspace";

type WorkspaceShellProps = {
  isMobileWorkspace: boolean;
  privacyLocked: boolean;
  lockJokeText: string;
  lockWorkspace: () => void;
  unlockWorkspace: () => void;
  desktopMenuOpen: boolean;
  setDesktopMenuOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  hasUnreadHighlights: boolean;
  setShowNotificationComposer: (value: boolean) => void;
  setShowAddPatient: (value: boolean) => void;
  counselorLabel: string;
  canManageRosterScope: boolean;
  canManagePatients: boolean;
  hasAdminRole: boolean;
  forceRoster: boolean;
  caseLoadOnly: boolean;
  kindFilter: "all" | "New Patient" | "Current Patient" | "RSS+" | "RSS" | "Former Patient" | "Former Recent" | "Former Archived";
  setWorkspaceTab: (value: "roster" | "attention") => void;
  setKindFilter: (value: "all" | "New Patient" | "Current Patient" | "RSS+" | "RSS" | "Former Patient" | "Former Recent" | "Former Archived") => void;
  setCaseLoadOnly: (value: boolean) => void;
  setForceRoster: (value: boolean) => void;
  setSearch: (value: string) => void;
  showPastPatients: () => void;
  logout: () => void;
  setRoute: (value: any) => void;
  setMobileDashboardScale: (value: number | ((current: number) => number)) => void;
  children: ReactNode;
};

export function WorkspaceShell(props: WorkspaceShellProps) {
  const {
    isMobileWorkspace,
    privacyLocked,
    lockJokeText,
    lockWorkspace,
    unlockWorkspace,
    desktopMenuOpen,
    setDesktopMenuOpen,
    hasUnreadHighlights,
    setShowNotificationComposer,
    setShowAddPatient,
    counselorLabel,
    canManageRosterScope,
    canManagePatients,
    hasAdminRole,
    forceRoster,
    caseLoadOnly,
    kindFilter,
    setWorkspaceTab,
    setKindFilter,
    setCaseLoadOnly,
    setForceRoster,
    setSearch,
    showPastPatients,
    logout,
    setRoute,
    setMobileDashboardScale,
    children,
  } = props;

  if (isMobileWorkspace) {
    return (
      <MobileWorkspace
        privacyLocked={privacyLocked}
        lockJokeText={lockJokeText}
        lockWorkspace={lockWorkspace}
        unlockWorkspace={unlockWorkspace}
      >
        {children}
      </MobileWorkspace>
    );
  }

  return (
    <DesktopWorkspace
      privacyLocked={privacyLocked}
      lockJokeText={lockJokeText}
      lockWorkspace={lockWorkspace}
      unlockWorkspace={unlockWorkspace}
      desktopMenuOpen={desktopMenuOpen}
      setDesktopMenuOpen={setDesktopMenuOpen}
      hasUnreadHighlights={hasUnreadHighlights}
      setShowNotificationComposer={setShowNotificationComposer}
      counselorLabel={counselorLabel}
      canManageRosterScope={canManageRosterScope}
      canManagePatients={canManagePatients}
      hasAdminRole={hasAdminRole}
      forceRoster={forceRoster}
      caseLoadOnly={caseLoadOnly}
      kindFilter={kindFilter}
      setWorkspaceTab={setWorkspaceTab}
      setKindFilter={setKindFilter}
      setCaseLoadOnly={setCaseLoadOnly}
      setForceRoster={setForceRoster}
      setSearch={setSearch}
      showPastPatients={showPastPatients}
      logout={logout}
      setRoute={setRoute}
      setShowAddPatient={setShowAddPatient}
      setMobileDashboardScale={setMobileDashboardScale}
    >
      {children}
    </DesktopWorkspace>
  );
}
