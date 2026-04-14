import {
  type AccountInfo,
  PublicClientApplication,
  EventType,
  InteractionStatus,
  type AuthenticationResult,
} from "@azure/msal-browser";
import { MsalProvider, useIsAuthenticated, useMsal } from "@azure/msal-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AzureAuthState = {
  enabled: boolean;
  loading: boolean;
  isAuthenticated: boolean;
  user: { id: string; email: string; name: string } | null;
  roles: string[];
  accessToken: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const defaultState: AzureAuthState = {
  enabled: false,
  loading: false,
  isAuthenticated: false,
  user: null,
  roles: [],
  accessToken: null,
  login: async () => {},
  logout: async () => {},
};

const AzureAuthContext = createContext<AzureAuthState>(defaultState);

function getMsalConfig() {
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;

  if (!clientId || !tenantId) {
    return null;
  }

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      postLogoutRedirectUri: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
    },
    cache: {
      cacheLocation: "localStorage" as const,
    },
  };
}

function getLoginScopes() {
  const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;
  return apiScope ? ["openid", "profile", "email", apiScope] : ["openid", "profile", "email"];
}

const msalConfig = getMsalConfig();
const msalInstance = msalConfig ? new PublicClientApplication(msalConfig) : null;

if (msalInstance) {
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      msalInstance.setActiveAccount((event.payload as AuthenticationResult).account);
    }
  });
}

function AzureAuthStateProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  const account = useMemo<AccountInfo | null>(() => {
    if (instance.getActiveAccount()) {
      return instance.getActiveAccount();
    }
    return accounts[0] ?? null;
  }, [accounts, instance]);

  useEffect(() => {
    if (account && !instance.getActiveAccount()) {
      instance.setActiveAccount(account);
    }
  }, [account, instance]);

  useEffect(() => {
    let cancelled = false;

    async function loadToken() {
      if (!account) {
        if (!cancelled) {
          setAccessToken(null);
          setRoles([]);
        }
        return;
      }

      try {
        const result = await instance.acquireTokenSilent({
          account,
          scopes: getLoginScopes(),
        });
        if (!cancelled) {
          setAccessToken(result.accessToken);
          const claimRoles = (result.idTokenClaims as { roles?: unknown } | undefined)?.roles;
          if (Array.isArray(claimRoles)) {
            setRoles(claimRoles.filter((value): value is string => typeof value === "string"));
          } else {
            setRoles([]);
          }
        }
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setRoles([]);
        }
      }
    }

    if (inProgress === InteractionStatus.None) {
      void loadToken();
    }

    return () => {
      cancelled = true;
    };
  }, [account, inProgress, instance]);

  const value = useMemo<AzureAuthState>(
    () => ({
      enabled: true,
      loading: inProgress !== InteractionStatus.None,
      isAuthenticated,
      user: account
        ? {
            id: account.localAccountId,
            email: account.username,
            name: account.name ?? account.username,
          }
        : null,
      roles,
      accessToken,
      login: async () => {
        await instance.loginRedirect({ scopes: getLoginScopes() });
      },
      logout: async () => {
        await instance.logoutRedirect();
      },
    }),
    [accessToken, account, inProgress, instance, isAuthenticated, roles]
  );

  return <AzureAuthContext.Provider value={value}>{children}</AzureAuthContext.Provider>;
}

export function AzureAuthProvider({ children }: { children: ReactNode }) {
  if (!msalInstance) {
    return <AzureAuthContext.Provider value={defaultState}>{children}</AzureAuthContext.Provider>;
  }

  return (
    <MsalProvider instance={msalInstance}>
      <AzureAuthStateProvider>{children}</AzureAuthStateProvider>
    </MsalProvider>
  );
}

export function useAzureAuth() {
  return useContext(AzureAuthContext);
}
