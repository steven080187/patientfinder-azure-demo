import type { ReactNode } from "react";
import patientFinderLogo from "../assets/patientfinder-logo.svg";
import "./mobileWorkspace.css";

type MobileWorkspaceProps = {
  privacyLocked: boolean;
  lockJokeText: string;
  lockWorkspace: () => void;
  unlockWorkspace: () => void;
  children: ReactNode;
};

export function MobileWorkspace({ privacyLocked, lockJokeText, lockWorkspace, unlockWorkspace, children }: MobileWorkspaceProps) {
  return (
    <main className="workspaceMain">
      <section className={privacyLocked ? "workspaceMobileHero locked" : "workspaceMobileHero"}>
        <div className={privacyLocked ? "workspaceMobileBrand locked" : "workspaceMobileBrand"}>
          <button
            className="workspaceMobileBrandLink"
            onClick={privacyLocked ? unlockWorkspace : lockWorkspace}
            aria-label="patientfinder logo"
          >
            <img className="workspaceMobileLogo" src={patientFinderLogo} alt="patientfinder logo" />
          </button>
        </div>
      </section>

      {privacyLocked ? (
        <div className="workspacePrivacyStage">
          <div className="workspacePrivacyCard">
            <button className="btn" onClick={unlockWorkspace}>
              Unlock workspace
            </button>
          </div>
          <div className="workspaceLockJokeStage">
            <div className="workspaceLockJokeCard">
              <div className="workspaceLockJokeGlow" aria-hidden="true" />
              <div className="workspaceLockJokeText">{lockJokeText}</div>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </main>
  );
}
