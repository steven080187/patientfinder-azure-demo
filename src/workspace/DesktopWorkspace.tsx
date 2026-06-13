import type { ReactNode } from "react";
import patientFinderLogo from "../assets/patientfinder-logo.svg";
import "./desktopWorkspace.css";

type DesktopWorkspaceProps = {
  privacyLocked: boolean;
  lockJokeText: string;
  lockWorkspace: () => void;
  unlockWorkspace: () => void;
  desktopMenuOpen: boolean;
  setDesktopMenuOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  hasUnreadHighlights: boolean;
  setShowNotificationComposer: (value: boolean) => void;
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
  setShowAddPatient: (value: boolean) => void;
  setMobileDashboardScale: (value: number | ((current: number) => number)) => void;
  children: ReactNode;
};

export function DesktopWorkspace({
  privacyLocked,
  lockJokeText,
  lockWorkspace,
  unlockWorkspace,
  desktopMenuOpen,
  setDesktopMenuOpen,
  hasUnreadHighlights,
  setShowNotificationComposer,
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
  setShowAddPatient,
  setMobileDashboardScale,
  children,
}: DesktopWorkspaceProps) {
  return (
    <div className={!privacyLocked ? "workspaceShell" : "workspaceShell locked"}>
        {!privacyLocked ? (
        <aside className="workspaceSidebar">
          <button className="workspaceBrand compact unlocked" onClick={lockWorkspace}>
            <img className="workspaceLogo compact unlocked" src={patientFinderLogo} alt="patientfinder logo" />
          </button>

          <button
            className={
              desktopMenuOpen
                ? "workspaceActionBtn primary workspaceSidebarMenuToggle"
                : hasUnreadHighlights
                  ? "workspaceActionBtn workspaceSidebarMenuToggle hasNotification"
                  : "workspaceActionBtn workspaceSidebarMenuToggle"
            }
            onClick={() => setDesktopMenuOpen((open) => !open)}
          >
            {desktopMenuOpen ? "Close menu" : "Menu"}
            {hasUnreadHighlights ? <span className="menuNotificationDot" aria-hidden="true" /> : null}
          </button>

          {desktopMenuOpen ? (
            <>
              <div className="workspaceSidebarSection">
                <div className="workspaceMobileScaleRow workspaceDesktopScaleRow">
                  <button
                    className="workspaceMobileScaleBtn"
                    onClick={() => setMobileDashboardScale((scale) => Math.min(1.25, Number((scale + 0.05).toFixed(2))))}
                    title="Increase font size"
                    aria-label="Increase font size"
                  >
                    +
                  </button>
                  <button
                    className="workspaceMobileScaleBtn"
                    onClick={() => setMobileDashboardScale((scale) => Math.max(0.85, Number((scale - 0.05).toFixed(2))))}
                    title="Decrease font size"
                    aria-label="Decrease font size"
                  >
                    -
                  </button>
                </div>
              </div>

              <div className="workspaceSidebarSection">
                <button
                  className={hasUnreadHighlights ? "workspaceActionBtn workspaceActionBtnGlow" : "workspaceActionBtn"}
                  onClick={() => setShowNotificationComposer(true)}
                >
                  Highlights
                </button>
                <button
                  className={!forceRoster && caseLoadOnly ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                  onClick={() => {
                    setWorkspaceTab("roster");
                    setKindFilter("all");
                    setCaseLoadOnly(true);
                    setForceRoster(false);
                    setSearch("");
                  }}
                >
                  {counselorLabel} case load
                </button>
                {canManageRosterScope ? (
                  <button
                    className={forceRoster ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                    onClick={() => {
                      setWorkspaceTab("roster");
                      setKindFilter("all");
                      setForceRoster(true);
                      setCaseLoadOnly(false);
                      setSearch("");
                    }}
                  >
                    Full roster
                  </button>
                ) : null}
                <button
                  className={kindFilter === "Former Patient" ? "workspaceActionBtn primary" : "workspaceActionBtn"}
                  onClick={showPastPatients}
                >
                  Past patients
                </button>
                <button className="workspaceActionBtn" onClick={() => setRoute({ name: "attendance" })}>
                  Visits & tests
                </button>
                <button className="workspaceActionBtn" onClick={() => setRoute({ name: "billing" })}>
                  Billing
                </button>
                <button className="workspaceActionBtn" onClick={() => setRoute({ name: "groups" })}>
                  Groups
                </button>
                <button className="workspaceActionBtn" onClick={() => setRoute({ name: "mobile" })}>
                  Mobile
                </button>
                {hasAdminRole ? (
                  <button className="workspaceActionBtn" onClick={() => setRoute({ name: "patientbridge" })}>
                    patientbridge
                  </button>
                ) : null}
              </div>

              <div className="workspaceSidebarSection">
                {canManagePatients ? (
                  <button className="workspaceActionBtn" onClick={() => setShowAddPatient(true)}>
                    Add patient
                  </button>
                ) : null}
                <button className="workspaceActionBtn" onClick={logout}>
                  Logout
                </button>
              </div>
            </>
          ) : null}
        </aside>
      ) : null}

      <main className={!privacyLocked ? "workspaceMain" : "workspaceMain desktopLocked"}>
        {privacyLocked ? (
          <div className="workspaceDesktopLockStage">
            <button className="workspaceBrand hero locked" onClick={unlockWorkspace}>
              <img className="workspaceLogo hero locked" src={patientFinderLogo} alt="patientfinder logo" />
            </button>
            <button className="workspaceUnlockBtn" onClick={unlockWorkspace}>
              Unlock
            </button>
            <div className="workspaceLockJokeStage desktop">
              <div className="workspaceLockJokeCard desktop">
                <div className="workspaceLockJokeGlow" aria-hidden="true" />
                <div className="workspaceLockJokeText">{lockJokeText}</div>
              </div>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
