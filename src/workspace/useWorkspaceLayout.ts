import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const workspaceScaleKey = "patientfinder.workspace.dashboardScale.v1";

const LOCK_SCREEN_JOKES = [
  "SUD counseling is 20% clinical skill and 80% getting the group back from snack break.",
  "My treatment plan says one thing. My progress note says, 'Please see attached chaos.'",
  "I became an SUD counselor for the calm environment and predictable schedules.",
  "Nothing says outpatient like three breakthroughs and one missing signature.",
  "My clinical style is motivational interviewing with a light touch of 'please sign here.'",
  "In recovery work, every small win matters, especially when someone actually shows up on time.",
  "I can de-escalate a room, but I still lose arguments with the printer.",
  "SUD counselors know relapse prevention and copier troubleshooting are both ongoing processes.",
  "The group topic was boundaries. The real topic was who took the good pen.",
  "I practice active listening and active searching for the attendance sheet.",
  "My resting face says empathy. My charting face says do not talk to me for six minutes.",
  "Recovery is one day at a time. Documentation is somehow all due today.",
  "I use person-centered care and counselor-centered coffee.",
  "Every no-show is a mystery, but every late arrival has a full backstory.",
  "SUD counseling: where 'resistance' and 'the Wi-Fi is down' can happen in the same hour.",
  "I believe in change, growth, and hitting save before the note disappears.",
  "The most powerful intervention is sometimes asking, 'Did you eat anything today?'",
  "I am fluent in reflective listening and in saying, 'We can process that after group.'",
  "My group starts at 9:00 and reality starts around 9:17.",
  "Counselors do not gossip. We discuss patterns in a confidential tone.",
  "Every discharge summary contains at least one sentence written with pure hope.",
  "If therapeutic silence were billable, I would retire early.",
  "SUD counselors can spot denial, avoidance, and an unsigned ROI from across the room.",
  "Half my job is holding space. The other half is finding forms.",
  "My self-care plan includes water, boundaries, and not opening one more chart at 4:59.",
  "There is no stronger bond than a counselor and the client who finally remembers their password.",
  "I entered behavioral health to help people. The fax machine took that personally.",
  "The official animal of outpatient treatment is the emotional support clipboard.",
  "Some heroes wear capes. Some carry Narcan and extra intake packets.",
  "Behind every strong SUD counselor is a note that still needs one tiny edit.",
] as const;

export type WorkspaceLayoutState = {
  isMobileWorkspace: boolean;
  privacyLocked: boolean;
  unlockWorkspace: () => void;
  lockWorkspace: () => void;
  lockJokeText: string;
  mobileDashboardScale: number;
  setMobileDashboardScale: Dispatch<SetStateAction<number>>;
};

export function useWorkspaceLayout() {
  const [privacyLocked, setPrivacyLocked] = useState(true);
  const [lockJokeIndex, setLockJokeIndex] = useState(() => Math.floor(Math.random() * LOCK_SCREEN_JOKES.length));
  const [isMobileWorkspace, setIsMobileWorkspace] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 720 : false
  );
  const [mobileDashboardScale, setMobileDashboardScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    const raw = window.localStorage.getItem(workspaceScaleKey);
    const parsed = raw ? Number(raw) : 1;
    return Number.isFinite(parsed) && parsed >= 0.85 && parsed <= 1.25 ? parsed : 1;
  });

  useEffect(() => {
    const onResize = () => setIsMobileWorkspace(window.innerWidth <= 720);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!privacyLocked) return;
    setLockJokeIndex(Math.floor(Math.random() * LOCK_SCREEN_JOKES.length));
    const interval = window.setInterval(() => {
      setLockJokeIndex((current) => (current + 1) % LOCK_SCREEN_JOKES.length);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [privacyLocked]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(workspaceScaleKey, String(mobileDashboardScale));
  }, [mobileDashboardScale]);

  return {
    isMobileWorkspace,
    privacyLocked,
    unlockWorkspace: () => setPrivacyLocked(false),
    lockWorkspace: () => setPrivacyLocked(true),
    lockJokeText: LOCK_SCREEN_JOKES[lockJokeIndex],
    mobileDashboardScale,
    setMobileDashboardScale,
  } satisfies WorkspaceLayoutState;
}
